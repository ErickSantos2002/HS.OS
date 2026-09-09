"""O bloco da empresa pode estourar o teto dos sete arquivos sozinho.

⚠️ **21% do `AGENTS.md` da `nina` é gerado, e ela vive a 500 caracteres do
teto.** O bloco da empresa tem 3.955 chars e é reescrito inteiro a cada
`POST /onboarding-empresa`. Basta alguém acrescentar um parágrafo ao perfil da
empresa na tela para o arquivo passar de 20.000 — sem ninguém editar o
`AGENTS.md`, sem erro, e com o gateway truncando em silêncio (medido em
09/09/2026: `workspace bootstrap file AGENTS.md is 21813 chars (limit 20000)`).

O que se perde no truncamento é o **fim** do arquivo, que é onde mora o
"como eu respondo" — as regras de bastidor, de achado e de conferência.
"""
from app.routers.integracoes import _TETO_ARQUIVO, _com_bloco_da_empresa, _excede_o_teto


def test_o_teto_e_o_do_gateway():
    assert _TETO_ARQUIVO == 20_000


def test_arquivo_no_limite_passa():
    assert not _excede_o_teto("x" * 20_000)


def test_um_caractere_a_mais_nao_passa():
    assert _excede_o_teto("x" * 20_001)


def test_o_bloco_da_empresa_pode_estourar_sozinho():
    """O caso real: arquivo com folga pequena e um bloco que cresceu."""
    antes = "a" * 15_500 + "\n<!-- hsos:empresa:inicio -->\nvelho\n<!-- hsos:empresa:fim -->\n"
    assert not _excede_o_teto(antes)
    depois = _com_bloco_da_empresa(antes, "n" * 4_600)
    assert _excede_o_teto(depois), "o bloco novo devia estourar o teto"


def test_substituir_o_bloco_nao_empilha():
    """Regressão da razão de existirem marcadores."""
    base = "texto\n<!-- hsos:empresa:inicio -->\nvelho\n<!-- hsos:empresa:fim -->\nfim"
    novo = _com_bloco_da_empresa(base, "NOVO")
    assert novo.count("<!-- hsos:empresa:inicio -->") == 1
    assert "velho" not in novo and "NOVO" in novo and novo.endswith("fim")


# ── Os três lugares que escrevem nos sete arquivos ──────────────────────────
#
# A constante mora em `app/gateway/client.py` porque é fato do protocolo, não
# de um router. Estes testes existem para que ela não se separe dos usos: quem
# mexer no teto num lugar quebra aqui se esquecer dos outros.

def test_a_constante_mora_no_cliente_do_gateway():
    from app.gateway.client import TETO_ARQUIVO_AGENTE, excede_o_teto
    assert TETO_ARQUIVO_AGENTE == 20_000
    assert excede_o_teto("x" * 20_001) and not excede_o_teto("x" * 20_000)


def test_os_tres_escritores_usam_a_mesma_regra():
    """Contexto da empresa, roster automático e o PUT da tela."""
    import inspect
    from app.routers import agents, integracoes

    fonte_ag = inspect.getsource(agents)
    fonte_in = inspect.getsource(integracoes)
    assert fonte_in.count("excede_o_teto(") >= 1, "a distribuição do contexto não confere o teto"
    assert fonte_ag.count("excede_o_teto(") >= 2, "roster ou PUT da tela não conferem o teto"
