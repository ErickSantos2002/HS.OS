"""Regras do push: quem recebe e o que a notificação diz (spec 2026-11-03, B1).

Tudo puro — o banco só entrega a lista de membros. Os casos de menção são os
mesmos do `channel-notifications.ts` da tela, porque uma menção que a tela
destaca e o push ignora (ou o contrário) é o tipo de divergência que ninguém
percebe até alguém dizer "me marcaram e eu não fiquei sabendo".
"""
import pytest

from app.push_regras import (Membro, destinatarios_canal, endpoint_de_push_valido,
                             menciona_todos, mencionados, payload_agente, payload_canal,
                             previa)

ANA = "11111111-1111-1111-1111-111111111111"
ANA_PAULA = "22222222-2222-2222-2222-222222222222"
BIA = "33333333-3333-3333-3333-333333333333"
JOSE = "44444444-4444-4444-4444-444444444444"
ANA_2 = "55555555-5555-5555-5555-555555555555"


def _membros(silenciados=()):
    nomes = {ANA: "Ana", ANA_PAULA: "Ana Paula", BIA: "Bia", JOSE: "José Silva"}
    return [Membro(u, n, u in silenciados) for u, n in nomes.items()]


# ── menção ──────────────────────────────────────────────────────────────────

def test_mencao_casa_sem_caixa_nem_acento():
    """`@jose silva` tem que achar o José Silva: a tela normaliza assim, e o push
    divergir dela faria a menção destacada na tela não chegar ao celular."""
    assert mencionados("oi @jose silva, olha isso", [(JOSE, "José Silva")]) == {JOSE}


def test_nome_mais_longo_vence():
    """`@Ana Paula` é a Ana Paula, não a Ana. Sem o "mais longo", a Ana seria
    acordada por uma mensagem que não era para ela."""
    membros = [(ANA, "Ana"), (ANA_PAULA, "Ana Paula")]
    assert mencionados("@Ana Paula pode ver?", membros) == {ANA_PAULA}
    assert mencionados("@Ana pode ver?", membros) == {ANA}


def test_homonimos_sao_todos_notificados():
    """Dois "Ana" no canal: não dá para saber qual, então as duas recebem —
    perder a menção é pior que notificar a mais."""
    assert mencionados("@ana", [(ANA, "Ana"), (ANA_2, "Ana")]) == {ANA, ANA_2}


def test_mencao_exige_fronteira_depois_do_nome():
    """`@Anabela` não é menção à Ana."""
    assert mencionados("@Anabela chegou", [(ANA, "Ana")]) == set()


def test_mensagem_cheia_de_arroba_termina_rapido():
    """Cem mil "@" fatiando o texto a cada um era O(n²): segundos de CPU num
    worker que atende o WebSocket de todo mundo, a partir de uma mensagem que
    qualquer membro de canal escreve."""
    import time
    membros = [(ANA, "Ana"), (ANA_PAULA, "Ana Paula"), (JOSE, "José Silva")]
    inicio = time.perf_counter()
    assert mencionados("@" * 100_000, membros) == set()
    assert time.perf_counter() - inicio < 0.5


def test_todos_casa_como_na_tela():
    assert menciona_todos("@todos reunião agora")
    assert menciona_todos("aviso: @TODOS")
    assert not menciona_todos("email@todos.com")
    assert not menciona_todos("@todosnós")


# ── destinatários ───────────────────────────────────────────────────────────

def test_canal_notifica_humanos_menos_o_autor():
    assert destinatarios_canal(BIA, _membros(), "bom dia", None) == {ANA, ANA_PAULA, JOSE}


def test_canal_silenciado_nao_recebe():
    """Quem silenciou não recebe — era a escolha do Erick ("canal não silenciado")."""
    assert destinatarios_canal(BIA, _membros({ANA}), "bom dia", None) == {ANA_PAULA, JOSE}


def test_mencao_fura_o_silenciar():
    """Silenciou o canal, mas foi chamado pelo nome: recebe. Senão silenciar vira
    jeito de não ser encontrado."""
    assert ANA in destinatarios_canal(BIA, _membros({ANA}), "@Ana viu?", None)


def test_todos_fura_o_silenciar_de_todo_mundo():
    assert destinatarios_canal(BIA, _membros({ANA, JOSE}), "@todos aviso", None) == {
        ANA, ANA_PAULA, JOSE}


def test_autor_nunca_recebe_nem_se_mencionando():
    assert BIA not in destinatarios_canal(BIA, _membros(), "@Bia lembrete", None)


def test_thread_so_participantes_e_mencionados():
    """Resposta em thread vai para quem está na thread, não para o canal inteiro
    — senão cada "ok" numa discussão lateral acorda todo mundo."""
    r = destinatarios_canal(BIA, _membros(), "concordo", {ANA, BIA})
    assert r == {ANA}
    r = destinatarios_canal(BIA, _membros(), "concordo @José Silva", {ANA, BIA})
    assert r == {ANA, JOSE}


def test_thread_respeita_silenciar():
    assert destinatarios_canal(BIA, _membros({ANA}), "ok", {ANA, BIA}) == set()


# ── prévia e payload ────────────────────────────────────────────────────────

def test_previa_tira_markdown_e_corta_em_140():
    t = previa("**Faturamento** de `outubro`: [painel](https://x) " + "a" * 300)
    assert "**" not in t and "`" not in t and "https://x" not in t
    assert t.startswith("Faturamento de outubro: painel")
    assert len(t) <= 140 and t.endswith("…")


def test_previa_de_anexo_e_de_audio():
    """Mensagem só com arquivo ou áudio não pode virar notificação em branco."""
    assert previa("", anexos=[{"name": "a.pdf"}]) == "📎 arquivo"
    assert previa("", audio=True) == "🎤 áudio"
    assert previa("veja", anexos=[{"name": "a.pdf"}]) == "veja"


def test_previa_tira_html():
    assert previa("<b>oi</b> <script>x</script>tudo bem") == "oi xtudo bem"


def test_payload_de_dm_e_de_canal():
    dm = payload_canal(canal_id="c1", canal_nome="", tipo="dm", autor="Bia",
                       conteudo="oi", anexos=None, audio=False, thread_id=None)
    assert dm["title"] == "Bia"
    assert dm["url"] == "/chat?channel=c1"
    assert dm["channel_id"] == "c1" and dm["conversa"] == "canal:c1"
    assert dm["tag"] == "canal:c1"
    assert "notification_id" not in dm

    canal = payload_canal(canal_id="c2", canal_nome="geral", tipo="public", autor="Bia",
                          conteudo="oi", anexos=None, audio=False, thread_id="t9")
    assert canal["title"] == "Bia em #geral"
    assert canal["url"] == "/chat?channel=c2&thread=t9"
    assert canal["tag"] == "thread:t9" and canal["conversa"] == "canal:c2"


def test_payload_de_agente_nao_tem_canal():
    """Sem `channel_id`, o SW não oferece "Marcar como lida" — que não teria o
    que marcar numa conversa com agente (esclarecimento 1)."""
    p = payload_agente(agent_id="nina", agente_nome="Nina", conteudo="Pronto, **feito**.")
    assert p == {"title": "Nina", "body": "Pronto, feito.", "url": "/chat?agent=nina",
                 "tag": "agente:nina", "conversa": "agente:nina"}


# ── endpoint da inscrição (SSRF) ────────────────────────────────────────────
#
# O `endpoint` vem do navegador e o servidor faz POST nele. Sem a allowlist,
# qualquer pessoa logada fazia o backend chamar URL interna — a bridge do Swarm
# (172.18.0.1) ou o túnel do gateway (127.0.0.1:18789).

@pytest.mark.parametrize("url", [
    "https://fcm.googleapis.com/fcm/send/abc:APA91bHPRgkFLJu7tw5vT0fJzK1Rz2b_gq-x8Lxv9yQm",
    "https://fcm.googleapis.com/wp/dQ1nW3x-y_Z:APA91bF3k9",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://push.services.mozilla.com/wpush/v1/x",
    "https://web.push.apple.com/QF2xKj9pLm4nOqRsTuVwXyZ-_aBcDeFgHiJkLmNoPq",
    "https://push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bXyZ%3d",
    "https://fcm.googleapis.com:443/fcm/send/x",
])
def test_endpoint_dos_servicos_de_push_passa(url):
    assert endpoint_de_push_valido(url)


@pytest.mark.parametrize("url", [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://142.250.0.1/fcm/send/x",
    "https://localhost/x",
    "https://172.18.0.1/x",
    "http://127.0.0.1:18789/x",
    "https://fcm.googleapis.com:18789/x",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x",
    "https://evilnotify.windows.com/x",
    "https://fcm.googleapis.com@evil.com/",
    "https://user:senha@fcm.googleapis.com/x",
    "https://fcm.googleapis.com./x",
    "https://evil.com\\@fcm.googleapis.com/",
    "https://fcm.googleapis.com\\@evil.com/",
    "https://fcm%2egoogleapis.com/x",
    "https://evil.com%40fcm.googleapis.com/x",
    "https://fcm.googleapis.com/fcm send/x",
    "https://fcm.googleapis.com/fcm/send/\tx",
    "https://fcm.googleapis.com\t/x",
    "https://a@fcm.googleapis.com/x",
    "https://FCM.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com",
    "",
    "não é url",
    None,
])
def test_endpoint_fora_da_lista_e_recusado(url):
    assert not endpoint_de_push_valido(url)
