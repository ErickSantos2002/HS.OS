"""Guardi no GestorHS, fase 2b (Laboratório, 12/11/2026): certificado por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-laboratorio-design.md`.
O técnico fala os números da calibração e confirma um cartão que gera o
certificado (e, no GestorHS, conclui o aparelho no laboratório). O que se
tranca aqui:
- leitura que não é leitura ("181", "um oito um") é recusada ANTES do cartão:
  número errado num certificado é documento da Qualidade errado;
- a média é do SERVIDOR, arredondada como quem faz à mão (meio para cima) —
  o modelo nunca faz a conta;
- o payload nunca leva override de cabeçalho (nome do cliente, CNPJ, série):
  763 OS têm cabeçalho ajustado pela tela;
- regerar avisa que substitui e mostra a data antiga, não "hoje";
- avançar caixa no Laboratório com aparelho sem certificado recusa listando
  quais faltam, sem cartão que o GestorHS recusaria no clique.
"""
import pytest

from app import gestorhs_escrita as ge


# --- regras puras -----------------------------------------------------------------

def test_leitura_normaliza_e_recusa_o_que_nao_e_leitura():
    """Número errado num certificado é documento da Qualidade errado. "181" é o
    técnico falando "um oito um": aceitar viraria 181,000 no certificado."""
    assert ge.leitura("0,181") == "0,181" and ge.leitura("0.18") == "0,180" and ge.leitura(",181") == "0,181"
    assert ge.leitura(" 0,2 ") == "0,200"
    for ruim in ("181", "abc", "-0,1", "12,5", "", None, "0,1815", "0,1,8", True, "1e-1"):
        with pytest.raises(ValueError):
            ge.leitura(ruim)


def test_media_bate_com_os_certificados_reais():
    """As duas primeiras são certificados reais do GestorHS. A terceira dá
    0,1718, que em 3 casas é 0,172, como o técnico faz à mão. A conta é em
    `Decimal` com meio-para-cima: em float, "0,170" já não é 0,170."""
    assert ge.media(["0,170", "0,170", "0,170", "0,180", "0,190"]) == "0,176"
    assert ge.media(["0,186", "0,180", "0,184", "0,190", "0,190"]) == "0,186"
    assert ge.media(["0,171", "0,172", "0,172", "0,172", "0,172"]) == "0,172"   # 0,1718
    with pytest.raises(ValueError):
        ge.media(["0,170"] * 4)


def test_numero_ambiente_grava_com_ponto():
    """O banco guarda "22.0" e "1017.3" (formato dos certificados reais): com
    vírgula o PDF sairia diferente dos outros 2.909."""
    assert ge.numero_ambiente("22", "temperatura") == "22.0"
    assert ge.numero_ambiente("22,5", "temperatura") == "22.5"
    assert ge.numero_ambiente("1017,3", "pressao") == "1017.3"
    assert ge.numero_ambiente("1017,35", "pressao") == "1017.35"
    assert ge.numero_ambiente(22, "temperatura") == "22.0"
    for ruim in ("", None, "vinte", "22 graus", "-3", True):
        with pytest.raises(ValueError, match="temperatura"):
            ge.numero_ambiente(ruim, "temperatura")


def test_os_fora_do_laboratorio_ou_so_manutencao_recusa():
    """Fora do Laboratório o gerar não conclui nada e o técnico acharia que
    concluiu; OS só de manutenção não tem leitura para registrar."""
    campos = {"data_calibracao": None}
    with pytest.raises(ValueError, match="Laboratório"):
        ge.conferir_os_para_certificado({"id": 1, "fase": 4, "tipo_servico": "C"}, campos, [])
    with pytest.raises(ValueError, match="manutenção"):
        ge.conferir_os_para_certificado({"id": 1, "fase": 5, "tipo_servico": "M"}, campos, [])


def test_primeiro_certificado_sai_com_data_de_hoje():
    ex = ge.conferir_os_para_certificado(
        {"id": 11700, "fase": 5, "tipo_servico": "A", "cliente_nome": "ACME\nOS: 1",
         "equipamento_descricao": "Phoebus", "equipamento_serie": "F006097"},
        {"data_calibracao": None}, [])
    assert ex == {"os": 11700, "cliente": "ACME OS: 1", "modelo": "Phoebus", "serie": "F006097",
                  "data": "hoje", "substitui": False, "tipo": "calibração e manutenção",
                  "manutencao": True}


def test_regerar_mostra_a_data_antiga_e_avisa_que_substitui():
    """Regerar mantém a data (e com ela o cilindro congelado). O cartão dizendo
    "hoje" faria o técnico achar que o certificado ganhou data nova."""
    ex = ge.conferir_os_para_certificado(
        {"id": 1, "fase": 5, "tipo_servico": "C", "cliente_nome": "ACME",
         "equipamento_descricao": "Phoebus", "equipamento_serie": "F1"},
        {"data_calibracao": "2026-11-10"}, [{"tipo": "C"}])
    assert ex["data"] == "2026-11-10" and ex["substitui"] is True and ex["manutencao"] is False


def test_payload_nunca_leva_override_de_cabecalho():
    """Corpo com override zeraria (ou trocaria) o cabeçalho ajustado pela tela."""
    p = ge.payload_do_certificado({"cert": "HF1", "temperatura": "22", "pressao": "1017,3",
                                   "leituras": ["0,17"] * 5, "nomecli": "X"}, 9)
    assert p["ordem"] == 9 and p["calib_cert"] == "HF1"
    assert p["calib_temp"] == "22.0" and p["calib_pressao"] == "1017.3"
    assert [p[f"calib_teste{i}"] for i in range(1, 6)] == ["0,170"] * 5
    assert p["calib_teste_media"] == "0,170" and p["calib_situacao"] == "Aparelho subsequente"
    assert "data_calibracao" not in p
    assert not {"nomecli", "cnpj", "endcli", "serie", "modelo", "marca", "patrimonio", "datacompra"} & set(p)


def test_payload_valida_codigo_situacao_data_e_leituras():
    base = {"cert": "HF1", "temperatura": "22", "pressao": "1017", "leituras": ["0,17"] * 5}
    p = ge.payload_do_certificado({**base, "situacao": "Aparelho inicial", "data_calibracao": "2026-11-11"}, 9)
    assert p["calib_situacao"] == "Aparelho inicial" and p["data_calibracao"] == "2026-11-11"
    for ruim in ({**base, "cert": ""}, {**base, "cert": "X" * 31}, {**base, "cert": "HF\n1"},
                 {**base, "situacao": "Novo"}, {**base, "data_calibracao": "11/11/2026"},
                 {**base, "leituras": ["0,17"] * 4}, {**base, "leituras": "0,17"},
                 {**base, "leituras": ["0,17"] * 4 + ["181"]}, {**base, "pressao": "mil"}):
        with pytest.raises(ValueError):
            ge.payload_do_certificado(ruim, 9)


# --- a ferramenta, o executor e o 403 ---------------------------------------------

import asyncio  # noqa: E402
import json  # noqa: E402

import httpx  # noqa: E402
from cryptography.hazmat.primitives import serialization as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import acoes  # noqa: E402
from app import agente_token as at  # noqa: E402
from app.email.regras import FERRAMENTAS_BOT  # noqa: E402
from app.routers import mcp_bot  # noqa: E402
from app.routers.mcp_bot import FERRAMENTAS  # noqa: E402
from app.sistemas import gestorhs  # noqa: E402

_CTX = {"sistemas": ["gestorhs"], "email": "paulo@hs.com", "dono": "u-paulo", "primeiro": "Paulo"}
_ARGS = {"os": 11700, "cert": "HF02961", "temperatura": "22", "pressao": "1017,3",
         "leituras": ["0,170", "0,170", "0,170", "0,18", ".190"]}

# GestorHS falso das leituras: caminho → resposta.
_LEITURAS = {
    "/ordens/11700": {"id": 11700, "fase": 5, "tipo_servico": "C", "cliente_nome": "ACME",
                      "equipamento_descricao": "Phoebus", "equipamento_serie": "F006097"},
    "/ordens/11700/certificado-campos": {"nomecli": "ACME", "data_calibracao": None},
    "/ordens/11700/certificados": [],
    "/ordens/11701": {"id": 11701, "fase": 6, "tipo_servico": "C"},
    "/ordens/11701/certificado-campos": {"data_calibracao": None},
    "/ordens/11701/certificados": [],
}


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


@pytest.fixture
def gestor(chave, monkeypatch):
    """GestorHS falso + `criar_pendente` capturado. Escrita (não-GET) aqui é defeito."""
    estado = {"reqs": [], "pendentes": []}

    def h(req):
        estado["reqs"].append(req)
        if req.method != "GET":
            return httpx.Response(500, json={"detail": "escrita antes do cartão"})
        if req.url.path in _LEITURAS:
            return httpx.Response(200, json=_LEITURAS[req.url.path])
        return httpx.Response(404, json={"detail": "OS não encontrada"})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))

    async def pendente(conn, dono, bot, sistema, acao, payload, resumo):
        estado["pendentes"].append((sistema, acao, payload, resumo))
        return "a1"
    monkeypatch.setattr(mcp_bot.acoes, "criar_pendente", pendente)
    return estado


def _ferramenta(nome, args, ctx=_CTX):
    return asyncio.run(mcp_bot._gestorhs(object(), "paulo-bot", nome, args, ctx))


def test_ferramenta_no_guardi():
    """Fora de `FERRAMENTAS_BOT`, o `toolFilter.include` não a lista e o Guardi
    nunca a vê — mesmo com o servidor respondendo."""
    assert "gestorhs_gerar_certificado" in FERRAMENTAS_BOT
    assert "gestorhs_gerar_certificado" in {f["name"] for f in FERRAMENTAS}
    assert ("gestorhs", "gerar_certificado") in acoes.EXECUTORES


def test_sem_gestorhs_recusa_sem_rede(gestor):
    """Sem a flag, nada sai — nem a leitura de conferência."""
    with pytest.raises(mcp_bot._Recusa):
        _ferramenta("gestorhs_gerar_certificado", _ARGS, {**_CTX, "sistemas": ["taskhs"]})
    assert gestor["reqs"] == [] and gestor["pendentes"] == []


def test_cartao_tem_media_do_servidor_e_nenhuma_escrita_antes_do_clique(gestor):
    """A média que vai para o certificado é a do servidor (uma `media` mandada
    pelo agente é ignorada); e preparar o cartão só lê o GestorHS — escrever
    antes do clique geraria o certificado sem o técnico ver os números."""
    t = _ferramenta("gestorhs_gerar_certificado", {**_ARGS, "media": "0,999"})
    assert "Aguardando Paulo confirmar" in t
    sistema, acao, payload, resumo = gestor["pendentes"][0]
    assert (sistema, acao) == ("gestorhs", "gerar_certificado")
    assert payload["calib_teste_media"] == "0,176" and payload["calib_teste4"] == "0,180"
    assert payload["calib_teste5"] == "0,190" and payload["ordem"] == 11700
    assert payload["_exibir"]["serie"] == "F006097" and payload["_exibir"]["data"] == "hoje"
    assert resumo == "Certificado da OS 11700 (série F006097)"
    assert all(q.method == "GET" for q in gestor["reqs"])
    assert {q.url.path for q in gestor["reqs"]} == {
        "/ordens/11700", "/ordens/11700/certificado-campos", "/ordens/11700/certificados"}


def test_leitura_ruim_recusa_antes_da_rede(gestor):
    """"Um oito um" vira 181 na transcrição: recusar sem nem ler a OS."""
    with pytest.raises(ValueError, match="0,181"):
        _ferramenta("gestorhs_gerar_certificado", {**_ARGS, "leituras": ["181"] * 5})
    assert gestor["reqs"] == [] and gestor["pendentes"] == []


def test_os_fora_do_laboratorio_ou_inexistente_nao_gera_cartao(gestor):
    with pytest.raises(ValueError, match="Pós-Vendas"):
        _ferramenta("gestorhs_gerar_certificado", {**_ARGS, "os": 11701})
    with pytest.raises(mcp_bot._Recusa, match="q="):
        _ferramenta("gestorhs_gerar_certificado", {**_ARGS, "os": 999})
    assert gestor["pendentes"] == []


def _servidor(monkeypatch, responder):
    reqs = []

    def h(req):
        reqs.append(req)
        return responder(req, len(reqs))
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    return reqs


def _payload():
    return {**ge.payload_do_certificado(_ARGS, 11700),
            "nomecli": "adulterado", "_exibir": {"os": 11700, "serie": "F006097"}}


def _executar(p):
    return asyncio.run(acoes.EXECUTORES[("gestorhs", "gerar_certificado")]("paulo@hs.com", "paulo-bot", p))


def test_executor_gera_e_devolve_link_pdf(chave, monkeypatch):
    """O corpo sai por lista fixa: `_exibir`, `ordem` e um override plantado no
    payload não chegam ao GestorHS. E o PDF volta para o técnico conferir."""
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(
        200, json=[{"tipo": "C", "link_pdf": "https://cert/1.pdf"}]))
    r = _executar(_payload())
    assert reqs[0].method == "POST" and reqs[0].url.path == "/ordens/11700/gerar-certificado"
    corpo = json.loads(reqs[0].content)
    assert corpo["calib_teste_media"] == "0,176" and corpo["calib_temp"] == "22.0"
    assert not {"_exibir", "ordem", "nomecli"} & set(corpo)
    assert r == "Certificado gerado e aparelho concluído no laboratório. PDF: https://cert/1.pdf"


def test_executor_busca_o_link_se_o_gerar_nao_trouxer(chave, monkeypatch):
    """Sem o link o técnico não confere o PDF: se o retorno do gerar não o
    trouxer, a lista de certificados da OS é a segunda fonte."""
    def resp(r, n):
        if r.method == "POST":
            return httpx.Response(200, json=[])
        return httpx.Response(200, json=[{"tipo": "M", "link_pdf": "https://cert/m.pdf"},
                                         {"tipo": "C", "link_pdf": "https://cert/c.pdf"}])
    reqs = _servidor(monkeypatch, resp)
    r = _executar(_payload())
    assert [q.method for q in reqs] == ["POST", "GET"] and reqs[1].url.path == "/ordens/11700/certificados"
    assert r.endswith("PDF: https://cert/c.pdf")


def test_executor_sem_link_nao_inventa(chave, monkeypatch):
    _servidor(monkeypatch, lambda r, n: httpx.Response(200, json=[]))
    assert _executar(_payload()) == "Certificado gerado e aparelho concluído no laboratório."


def test_403_de_quem_nao_e_laboratorio(chave, monkeypatch):
    """Guardi da Expedição pedindo certificado: o GestorHS recusa pela função, e
    a pessoa precisa saber que é a função dela — e quem pode — não "erro"."""
    _servidor(monkeypatch, lambda r, n: httpx.Response(403, json={}))
    with pytest.raises(gestorhs.ErroSistema) as e:
        _executar(_payload())
    assert "sua função no GestorHS" in str(e.value) and "Laboratório" in str(e.value)


def test_descricao_manda_nao_calcular_e_perguntar_avancar():
    """Decisões 2 e 6 do Erick moram onde o agente lê: a descrição."""
    d = next(f for f in FERRAMENTAS if f["name"] == "gestorhs_gerar_certificado")["description"]
    assert "não calcule" in d and "avançar" in d and "NÃO executa" in d and "um aparelho por vez" in d
