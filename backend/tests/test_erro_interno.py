"""Um 500 tem que chegar no navegador como 500, com CORS.

⚠️ **Sem isto, todo erro interno chega no front disfarçado de queda de rede** —
e manda quem está investigando olhar a camada errada.

Levantado em 18/09/2026, e custou três rodadas de diagnóstico. O
`POST /conversations/nina/send` estourava com `column "seq_depois" does not
exist` (a migração `016` não fora aplicada em produção) e devolvia
`500 Internal Server Error`, 21 bytes de `text/plain`. Só que a resposta saía
**sem `Access-Control-Allow-Origin`**: o navegador bloqueava, o `fetch` rejeitava,
e `frontend/src/lib/api.ts` classificava como `status === 0`, mostrando
"Não foi possível falar com o servidor.". A tela acusava a rede enquanto o
defeito era uma coluna faltando no banco. O DevTools mostrava o 500 de verdade;
a aplicação, não.

⚠️ **E o conserto óbvio não funciona.** Registrar `@app.exception_handler(Exception)`
NÃO resolve: no Starlette esse handler é atendido pelo `ServerErrorMiddleware`,
que fica **acima** do `CORSMiddleware` na pilha — a resposta continua saindo sem
os cabeçalhos. O que resolve é capturar a exceção num middleware montado **por
dentro** do CORS, que é o que `instalar_tratamento_de_erros` garante ao registrar
os dois na ordem certa. Por isso o teste central aqui é o do cabeçalho, e não o
do status: o status já estava certo antes.
"""
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from starlette.testclient import TestClient

from app.erros import instalar_tratamento_de_erros

ORIGEM = "https://hsos.healthsafetytech.com"


def montar() -> TestClient:
    """Uma aplicação mínima montada como a de produção: erro por dentro, CORS por fora."""
    app = FastAPI()

    @app.get("/explode")
    async def explode():
        raise RuntimeError('column "seq_depois" does not exist')

    @app.get("/ok")
    async def ok():
        return {"status": "ok"}

    @app.get("/recusa")
    async def recusa():
        raise HTTPException(status_code=403, detail="Permissão insuficiente.")

    instalar_tratamento_de_erros(app, origens=[ORIGEM])
    return TestClient(app, raise_server_exceptions=False)


def test_o_500_sai_com_cabecalho_de_cors():
    """O ponto todo: sem isto o navegador bloqueia e o front acusa queda de rede."""
    r = montar().get("/explode", headers={"Origin": ORIGEM})

    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == ORIGEM


def test_o_500_traz_detail_em_json():
    """O front lê `detail`; sem ele a tela cai no genérico de novo."""
    r = montar().get("/explode", headers={"Origin": ORIGEM})

    assert r.headers["content-type"].startswith("application/json")
    assert isinstance(r.json().get("detail"), str)
    assert r.json()["detail"].strip()


def test_o_detalhe_interno_nao_vaza_para_a_tela():
    """A mensagem do Postgres fica no log, não no navegador — mas a referência liga os dois."""
    r = montar().get("/explode", headers={"Origin": ORIGEM})

    assert "seq_depois" not in r.text
    assert "ref" in r.json()["detail"].lower()


def test_a_referencia_da_tela_aparece_no_log(caplog):
    """Sem o par referência+traceback, esconder o detalhe só troca um cego por outro."""
    with caplog.at_level("ERROR"):
        r = montar().get("/explode", headers={"Origin": ORIGEM})

    ref = r.json()["detail"].split("ref:")[1].split(")")[0].strip()
    assert ref in caplog.text
    assert "seq_depois" in caplog.text          # o motivo real foi registrado
    assert "RuntimeError" in caplog.text        # com traceback


def test_resposta_normal_continua_intacta():
    r = montar().get("/ok", headers={"Origin": ORIGEM})

    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers.get("access-control-allow-origin") == ORIGEM


def test_httpexception_nao_vira_500():
    """Erro de regra tem status e mensagem próprios — engolir tudo em 500 seria pior."""
    r = montar().get("/recusa", headers={"Origin": ORIGEM})

    assert r.status_code == 403
    assert r.json()["detail"] == "Permissão insuficiente."
    assert r.headers.get("access-control-allow-origin") == ORIGEM


@pytest.mark.parametrize("caminho", ["/explode", "/ok", "/recusa"])
def test_o_preflight_continua_respondendo(caminho):
    """Se o middleware novo ficasse por fora do CORS, o OPTIONS quebraria junto."""
    r = montar().options(
        caminho,
        headers={
            "Origin": ORIGEM,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == ORIGEM


# ⚠️ **O middleware fica na frente de TODA resposta, inclusive download.**
# `BaseHTTPMiddleware` consome e repassa o corpo, e é justamente aí que ele tem
# fama de estragar resposta grande ou em pedaços. `storage.py` devolve
# `FileResponse` em duas rotas (a planilha de vendedores e o bucket privado), e
# um relatório truncado no meio não daria erro nenhum — abriria corrompido na
# máquina de quem pediu. Por isso a conferência é do conteúdo, byte a byte, e
# não do status.
def test_download_de_arquivo_passa_intacto(tmp_path):
    conteudo = b"PK\x03\x04" + b"\xff" * 300_000
    alvo = tmp_path / "vendedores.xlsx"
    alvo.write_bytes(conteudo)

    app = FastAPI()

    @app.get("/arquivo")
    async def arquivo():
        return FileResponse(alvo, media_type="application/vnd.ms-excel")

    instalar_tratamento_de_erros(app, origens=[ORIGEM])
    r = TestClient(app).get("/arquivo", headers={"Origin": ORIGEM})

    assert r.status_code == 200
    assert r.content == conteudo
    assert r.headers.get("access-control-allow-origin") == ORIGEM


def test_resposta_em_pedacos_passa_intacta():
    esperado = b"".join(b"linha %d\n" % i for i in range(500))

    app = FastAPI()

    @app.get("/stream")
    async def stream():
        return StreamingResponse(
            (b"linha %d\n" % i for i in range(500)), media_type="text/plain"
        )

    instalar_tratamento_de_erros(app, origens=[ORIGEM])
    r = TestClient(app).get("/stream", headers={"Origin": ORIGEM})

    assert r.status_code == 200
    assert r.content == esperado
