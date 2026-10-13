"""A camada única que fala com o R2.

⚠️ **O disco da VPS crescia sem teto.** Até 13/10/2026 todo upload — avatar,
áudio, anexo de conversa, PDF gerado — ia para `UPLOADS_DIR`, um volume
montado à mão no EasyPanel. Com anexo de até 100 MB entrando no caminho do
agente, isso deixou de ser aceitável. Tudo agora passa por este módulo, e ele
é o único lugar que conhece o R2.

Estes testes trancam as duas coisas que não podem regredir na troca: a
validação de caminho (que era do `_resolver` do disco e agora vale para a
chave) e a forma do erro quando o R2 falha — 502 nomeado, não 500.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app import armazenamento as a


@pytest.fixture(autouse=True)
def memoria():
    m = a.Memoria()
    a.definir(m)
    yield m
    a.definir(None)


def test_chave_junta_bucket_e_caminho():
    assert a.chave("anexos", "canal/x/1/a.pdf") == "anexos/canal/x/1/a.pdf"


def test_chave_ignora_barra_repetida_e_nas_pontas():
    assert a.chave("agent-files", "/avatars//nina.png/") == "agent-files/avatars/nina.png"


@pytest.mark.parametrize("ruim", ["..", "../x", "a/../b", ".", "a/./b", "", "a b", "a%2f..", "ç.pdf"])
def test_chave_recusa_caminho_que_escapa_ou_nao_e_seguro(ruim):
    """O regex de segmento aceita ponto — então `..` passaria nele sozinho.
    No disco quem segurava era o `resolve()`; na chave, é esta checagem."""
    with pytest.raises(HTTPException) as e:
        a.chave("anexos", ruim)
    assert e.value.status_code == 400


def test_chave_recusa_bucket_desconhecido():
    with pytest.raises(HTTPException) as e:
        a.chave("uploads", "x.png")
    assert e.value.status_code == 404


def test_gravar_ler_e_cabecalho_na_memoria():
    k = a.chave("anexos", "canal/c/1/a.txt")
    asyncio.run(a.gravar(k, b"oi", "text/plain"))
    assert asyncio.run(a.ler(k)) == b"oi"
    assert asyncio.run(a.cabecalho(k)) == a.Objeto(tamanho=2, mime="text/plain")


def test_ler_o_que_nao_existe_e_none_nao_erro():
    assert asyncio.run(a.ler("anexos/nao/existe")) is None
    assert asyncio.run(a.cabecalho("anexos/nao/existe")) is None


def test_listar_so_filhos_diretos_por_padrao(memoria):
    for k in ("agent-files/avatars/a.png", "agent-files/avatars/b.png", "agent-files/avatars/sub/c.png"):
        asyncio.run(a.gravar(k, b"x", "image/png"))
    nomes = [i["nome"] for i in asyncio.run(a.listar("agent-files/avatars/"))]
    assert nomes == ["a.png", "b.png"]
    todos = asyncio.run(a.listar("agent-files/", recursivo=True))
    assert len(todos) == 3


class Quebrado(a.Memoria):
    def gravar(self, chave, dados, mime):
        raise RuntimeError("SignatureDoesNotMatch")


def test_falha_do_r2_vira_502_nomeado():
    """Exceção crua do boto viraria 500 e a referência de erro genérica; quem
    está na tela precisa saber que o problema é o armazenamento."""
    a.definir(Quebrado())
    with pytest.raises(HTTPException) as e:
        asyncio.run(a.gravar("anexos/x", b"1", "text/plain"))
    assert e.value.status_code == 502
    assert "armazenamento" in e.value.detail.lower()


def test_sem_configuracao_responde_503_dizendo_o_que_falta(monkeypatch):
    a.definir(None)
    monkeypatch.setattr(a.settings, "R2_BUCKET", "")
    with pytest.raises(HTTPException) as e:
        asyncio.run(a.ler("anexos/x"))
    assert e.value.status_code == 503
    assert "R2_" in e.value.detail
