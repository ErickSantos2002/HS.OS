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


# ── O campo de dia da semana do `expr` ────────────────────────────────────
#
# ⚠️ **O guardião refazia briefing no sábado e no domingo.** O `_hora_marcada`
# lia só o minuto e a hora do `expr` e jogava fora o resto: com os cinco crons
# em `30 10 * * 1-5` (dias úteis), no sábado o cron corretamente não roda, o
# documento corretamente não existe, e o guardião concluía que tinha falhado.
#
# Medido em 03/09/2026 no banco de produção: `wiki_documents` tem briefing em
# sáb 22, dom 23, sáb 29 e dom 30/08, e `app_settings` tem 20 reservas
# `briefing_refeito:*` nesses mesmos quatro dias — com horário da janela do
# guardião (10:55–11:19 UTC), não do minuto do cron. Vinte execuções de agente
# e vinte alertas ao administrador dizendo que algo tinha falhado.

from datetime import datetime


def _job(expr: str) -> dict:
    return {"schedule": {"kind": "cron", "expr": expr}}


def _dia(iso: str) -> datetime:
    """Meio-dia em Brasília, para a data cair igual em UTC."""
    return datetime.fromisoformat(f"{iso}T09:00:00").replace(tzinfo=g.BRASILIA)


def test_sabado_nao_tem_hora_marcada_para_cron_de_dia_util():
    assert g._hora_marcada(_job("30 10 * * 1-5"), _dia("2026-08-29")) is None


def test_domingo_tambem_nao():
    assert g._hora_marcada(_job("30 10 * * 1-5"), _dia("2026-08-30")) is None


def test_dia_util_continua_tendo_hora_marcada():
    """A correção não pode ser "nunca conferir": quinta-feira ainda é dia de
    briefing, e é aí que o guardião tem que continuar acordando."""
    marcada = g._hora_marcada(_job("30 10 * * 1-5"), _dia("2026-09-03"))
    assert marcada is not None
    assert (marcada.hour, marcada.minute) == (7, 30)  # 10h30 UTC em Brasília


def test_sem_restricao_de_dia_roda_no_sabado():
    assert g._hora_marcada(_job("30 10 * * *"), _dia("2026-08-29")) is not None


def test_lista_de_dias_aceita_o_que_esta_na_lista():
    assert g._hora_marcada(_job("30 10 * * 1,4"), _dia("2026-09-03")) is not None


def test_lista_de_dias_recusa_o_que_nao_esta():
    assert g._hora_marcada(_job("30 10 * * 1,3"), _dia("2026-09-03")) is None


def test_domingo_vale_como_0_e_como_7():
    """No cron o domingo tem dois números. Aceitar só um deles faria o guardião
    ignorar em silêncio metade dos crons de domingo."""
    assert g._hora_marcada(_job("30 10 * * 0"), _dia("2026-08-30")) is not None
    assert g._hora_marcada(_job("30 10 * * 7"), _dia("2026-08-30")) is not None


def test_dia_do_mes_tambem_restringe():
    assert g._hora_marcada(_job("30 10 1 * *"), _dia("2026-09-03")) is None
    assert g._hora_marcada(_job("30 10 3 * *"), _dia("2026-09-03")) is not None


def test_expr_ilegivel_confere_mesmo_assim():
    """⚠️ Falha ABERTA, de propósito. Um `expr` que este código não sabe ler
    (nomes de dia, `L`, `#`) faz o guardião conferir como antes — refazer à toa
    custa uma execução, e não conferir devolve o estado em que ninguém descobre
    que o briefing sumiu. Entre os dois erros, o barato é o de conferir."""
    assert g._hora_marcada(_job("30 10 * * MON-FRI"), _dia("2026-08-29")) is not None
