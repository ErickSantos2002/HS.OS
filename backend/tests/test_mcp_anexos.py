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
