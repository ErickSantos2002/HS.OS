"""O guardião refazia em silêncio. Ver "O que falta" no artefato de 21/08:
*"descobre por ausência, não por aviso"*.

Ele já sabia das duas coisas e não contava nenhuma. Em 4 dos 9 dias úteis até
31/08/2026 os cinco briefings falharam e foram refeitos; o de Vendedores falhou
em 6 dos 9. Ninguém foi avisado uma vez sequer.

⚠️ **`urgente` fica de fora de propósito.** O `mcp_alerta` reserva essa
gravidade para tentativa de subverter o agente ou risco a dado sensível.
Briefing que não saiu é operação, não segurança — usar `urgente` aqui gastaria
o degrau que serve para outra coisa.
"""
from app import guardiao_briefings as g


def test_refeito_e_apenas_informativo():
    """Deu certo no fim: o valor chegou, custou uma execução a mais."""
    _, _, gravidade = g._alerta("Operação · 31/08", refeito=True)
    assert gravidade == "informativo"


def test_nao_saiu_pede_gente():
    """A tentativa única já foi gasta e o documento não existe. É aqui que
    alguém precisa olhar — e é exatamente o caso que era só uma linha de log."""
    _, detalhe, gravidade = g._alerta("Vendedores · 31/08", refeito=False)
    assert gravidade == "atencao"
    assert "Vendedores · 31/08" in detalhe


def test_o_titulo_aparece_no_assunto():
    assunto, _, _ = g._alerta("SDR · 31/08", refeito=True)
    assert "SDR · 31/08" in assunto


def test_assunto_cabe_no_limite_do_mcp_alerta():
    """O schema do alerta declara `maxLength: 60` no assunto. Título comprido
    não pode fazer o alerta ser recusado justamente no dia em que importa."""
    assunto, _, _ = g._alerta("Um título absurdamente longo que alguém escreveu no cron · 31/08",
                              refeito=False)
    assert len(assunto) <= 60


def test_as_duas_situacoes_dizem_coisas_diferentes():
    a_refeito, _, _ = g._alerta("Serviços · 31/08", refeito=True)
    a_falhou, _, _ = g._alerta("Serviços · 31/08", refeito=False)
    assert a_refeito != a_falhou
