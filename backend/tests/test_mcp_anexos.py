# backend/tests/test_mcp_anexos.py
"""A identidade do agente no `hsos-anexos` é verificada, não declarada.

⚠️ **Os outros servidores MCP confiam no agente.** `hsos-alerta`,
`hsos-documentos` e `hsos-relatorios` recebem `agente` e `solicitante` como
argumento que o próprio agente preenche — o gateway não repassa quem chama
(`mcp_alerta.py`, 14/08/2026). Para alerta, o pior caso é ruído. Para anexo, é
a planilha de ponto do RH sendo lida por outro agente.

Aqui cada agente tem uma URL própria com um HMAC do id dele. Quem a monta é o
backend; o agente nem vê o segredo. A URL de um não serve para outro.
"""
from app.routers import mcp_anexos as m

SEGREDO = "s3gr3d0-de-teste"


def test_assinatura_e_estavel_e_depende_do_agente():
    a = m.assinatura_do_agente(SEGREDO, "bruce")
    assert a == m.assinatura_do_agente(SEGREDO, "bruce")
    assert a != m.assinatura_do_agente(SEGREDO, "nina")
    assert len(a) == 64


def test_assinatura_normaliza_o_id():
    assert m.assinatura_do_agente(SEGREDO, "Bruce") == m.assinatura_do_agente(SEGREDO, "bruce")


def test_assinatura_confere_so_a_propria():
    assert m.assinatura_confere(SEGREDO, "bruce", m.assinatura_do_agente(SEGREDO, "bruce"))
    assert not m.assinatura_confere(SEGREDO, "nina", m.assinatura_do_agente(SEGREDO, "bruce"))
    assert not m.assinatura_confere(SEGREDO, "bruce", "0" * 64)
    assert not m.assinatura_confere("", "bruce", m.assinatura_do_agente("", "bruce"))


def test_ferramenta_tem_a_regra_na_description():
    """O agente lê a `description`, não o docstring — lição do
    `dias_de_validade` de 08/09/2026."""
    ler = next(f for f in m._FERRAMENTAS if f["name"] == "ler_anexo")
    assert "id" in ler["inputSchema"]["required"]
    assert "pagina" in ler["inputSchema"]["properties"]
    assert "outra conversa" in ler["description"]


def test_falha_de_banco_vira_resposta_mcp_e_nao_500():
    """Erro de banco/R2 dentro do `tools/call` chega ao gateway como
    `isError`, não como 500 cru — o agente precisa de resposta MCP válida;
    a causa fica no log (`logger.exception`)."""
    import asyncio

    def quebra(**_):
        raise RuntimeError("banco fora")

    original = m.sessao
    m.sessao = quebra
    try:
        texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "x"}))
    finally:
        m.sessao = original
    assert erro is True
    assert texto == "Falha interna ao ler o anexo; avise o administrador."


# --- A fronteira de segurança do router ------------------------------------
import asyncio
import json

import pytest

from app import anexos as ax


def _anexo(**kw):
    base = dict(id="a1", caminho="x/y.xlsx", nome="ponto.xlsx", mime="", tamanho=1,
                contexto="conversa_agente", channel_id=None, agent_id="bruce",
                dono_conversa="u1")
    base.update(kw)
    return ax.Anexo(**base)


class _Sessao:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def isolado(monkeypatch):
    """Banco e R2 falsos; `arm.ler` FALHA se for chamado."""
    estado = {"anexo": None, "membro": False}

    async def buscar(conn, anexo_id):
        return estado["anexo"]

    async def membro(conn, canal, membro_id, tipo):
        return estado["membro"]

    async def ler_proibido(chave):
        raise AssertionError("arm.ler chamado para anexo que o agente não pode ler")

    monkeypatch.setattr(m, "sessao", lambda **k: _Sessao())
    monkeypatch.setattr(m, "buscar_anexo", buscar)
    monkeypatch.setattr(m, "membro_do_canal", membro)
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    return estado


def test_agente_nao_le_anexo_da_conversa_de_outro_agente(isolado):
    """Anexo `conversa_agente` do bruce, pedido pela nina: recusado e o R2
    nunca é tocado."""
    isolado["anexo"] = _anexo()
    texto, erro = asyncio.run(m._ler_anexo("nina", {"id": "a1"}))
    assert erro is True and "não pertence" in texto


def test_agente_fora_do_canal_nao_le_anexo_do_canal(isolado):
    isolado["anexo"] = _anexo(contexto="canal", channel_id="c1", agent_id=None)
    isolado["membro"] = False
    texto, erro = asyncio.run(m._ler_anexo("nina", {"id": "a1"}))
    assert erro is True and "não pertence" in texto


def test_pagina_nao_numerica_diz_o_problema_real(isolado):
    async def ler(chave):
        return b"x"

    isolado["anexo"] = _anexo()
    m.arm.ler = ler  # o monkeypatch do fixture restaura no fim
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1", "pagina": "abc"}))
    assert erro is True
    assert texto == "pagina deve ser um número inteiro a partir de 1."


class _Req:
    def __init__(self, corpo, falha=False):
        self.corpo, self.falha, self.lido = corpo, falha, False

    async def json(self):
        self.lido = True
        return self.corpo


def test_assinatura_errada_da_404_sem_ler_o_corpo(monkeypatch):
    async def segredo(nome):
        return SEGREDO

    monkeypatch.setattr(m, "ler_segredo", segredo)
    from fastapi import HTTPException
    req = _Req({})
    with pytest.raises(HTTPException) as e:
        asyncio.run(m.mcp_anexos("bruce", "0" * 64, req, None))
    assert e.value.status_code == 404 and req.lido is False


def test_corpo_que_nao_e_objeto_da_erro_jsonrpc(monkeypatch):
    async def segredo(nome):
        return SEGREDO

    monkeypatch.setattr(m, "ler_segredo", segredo)
    r = asyncio.run(m.mcp_anexos("bruce", m.assinatura_do_agente(SEGREDO, "bruce"),
                                 _Req([{"jsonrpc": "2.0"}]), None))
    assert json.loads(r.body)["error"]["code"] == -32600


def test_description_diz_o_que_o_codigo_garante():
    ler = next(f for f in m._FERRAMENTAS if f["name"] == "ler_anexo")
    assert "conversa com você" in ler["description"]
    assert "Use apenas ids que apareceram nesta conversa." in ler["description"]


def test_enviar_arquivo_existe_e_exige_destino_formato_e_conteudo():
    f = next(f for f in m._FERRAMENTAS if f["name"] == "enviar_arquivo")
    assert set(f["inputSchema"]["required"]) == {"para", "nome", "formato", "conteudo"}
    assert "já conversa" in f["description"]


def test_pode_enviar_so_para_quem_ja_conversa_com_o_agente():
    """Push é menos grave que pull, mas a planilha do RH mandada ao CEO por
    engano é vazamento do mesmo jeito. Destino tem que ser alguém que já abriu
    conversa com este agente."""
    import asyncio

    class Conn:
        def __init__(self, existe):
            self.existe = existe
            self.args = None

        async def fetchval(self, sql, *args):
            self.args = args
            return self.existe

    conn = Conn(False)
    assert asyncio.run(m._ja_conversa(conn, "bruce", "77071556-7a52-41d5-805a-cbbd3923da45")) is False
    assert conn.args == ("bruce", "77071556-7a52-41d5-805a-cbbd3923da45")
    assert asyncio.run(m._ja_conversa(Conn(True), "bruce", "77071556-7a52-41d5-805a-cbbd3923da45")) is True
    assert asyncio.run(m._ja_conversa(Conn(True), "bruce", "nao-e-uuid")) is False
