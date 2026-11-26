"""Aviso de pedido de ausência no Guardi do RH (spec 2026-11-26).

O anti-objetivo é o pedido que fica dias esperando porque ninguém abriu o
TalentHS — e o seu avesso, o RH recebendo o mesmo aviso duas vezes. A decisão
de quem avisar é pura e testada aqui; a etapa com banco e rede, mais abaixo,
com conexão e TalentHS falsos.
"""
from datetime import datetime, timedelta, timezone

from app import avisos_ausencia as av

AGORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
EMAIL_RH = "adm01@healthsafetytech.com"


def _pedido(**kw):
    base = {"id": "p-1", "user_name": "Ana Souza", "user_email": "ana@x.com",
            "department": "Comercial", "type_name": "Férias",
            "start_date": "2026-12-02", "end_date": "2026-12-06",
            "start_time": None, "end_time": None, "days": 5,
            "reason": "Viagem", "status": "pending"}
    base.update(kw)
    return base


# --- config ------------------------------------------------------------------

def test_config_ausente_e_desligado():
    """Chave ausente ou corrompida tem que DESLIGAR, não estourar: a etapa
    roda a cada 30 s junto dos lembretes, e um `KeyError` aqui viraria um
    traceback no log a cada passada."""
    assert av.config(None) == av.Config(ligado=False, destinatarios=())
    assert av.config("x") == av.Config(ligado=False, destinatarios=())
    c = av.config({"ligado": True, "destinatarios": [1, "u-1", None]})
    assert c == av.Config(ligado=True, destinatarios=("u-1",))


# --- decidir -----------------------------------------------------------------

def test_decidir_novo_e_reaviso():
    """O cartão vence em 24 h. Sem o reaviso, o pedido esquecido some de novo
    — exatamente o problema que o aviso existe para resolver."""
    novo = _pedido(id="p-novo")
    velho = _pedido(id="p-velho")
    recente = _pedido(id="p-recente")
    avisados = {"p-velho": AGORA - timedelta(hours=25), "p-recente": AGORA - timedelta(hours=2)}
    assert av.decidir([novo, velho, recente], avisados, EMAIL_RH, AGORA) == \
        [(novo, False), (velho, True)]


def test_decidir_pula_o_proprio_pedido():
    """A Lidisay pedindo férias não deve receber cartão para aprovar a si
    mesma — a comparação é por e-mail e sem caixa."""
    meu = _pedido(user_email="ADM01@healthsafetytech.com")
    assert av.decidir([meu], {}, EMAIL_RH, AGORA) == []


def test_decidir_pula_nao_pendente():
    """Aprovado entre a leitura e a decisão: avisar seria pedir uma decisão
    que já foi tomada."""
    assert av.decidir([_pedido(status="approved")], {}, EMAIL_RH, AGORA) == []


# --- recado ------------------------------------------------------------------

def test_recado_formato():
    """O recado é o que o RH lê no celular antes de decidir: quem, o quê,
    quando e por quê, numa linha."""
    assert av.texto_recado(_pedido(), False) == (
        "📅 Pedido de ausência — Ana Souza (Comercial): Férias, 02/12 a 06/12 (5 dias). "
        "Motivo: Viagem")
    um_dia = _pedido(start_date="2026-12-03", end_date="2026-12-03", days=1)
    assert "03/12 (1 dia)" in av.texto_recado(um_dia, False)
    horas = _pedido(start_date="2026-12-03", end_date="2026-12-03", days=1,
                    start_time="08:00", end_time="12:00")
    assert "03/12, 08:00–12:00" in av.texto_recado(horas, False)
    assert av.texto_recado(_pedido(), True).startswith("📅 Ainda pendente — Ana Souza")
    assert "Motivo" not in av.texto_recado(_pedido(reason=None), False)
    assert "Motivo" not in av.texto_recado(_pedido(reason="   "), False)


def test_recado_saneia_motivo():
    """O motivo é digitado por qualquer colaborador no TalentHS: quebras de
    linha viram espaço e o tamanho tem teto, senão um texto colado vira uma
    bolha de tela inteira no chat do RH."""
    t = av.texto_recado(_pedido(reason="linha 1\n\nlinha 2\r\n" + "x" * 500), False)
    motivo = t.split("Motivo: ", 1)[1]
    assert "\n" not in t and "\r" not in t
    assert motivo.startswith("linha 1 linha 2 ")
    assert len(motivo) == 300 and motivo.endswith("…")
