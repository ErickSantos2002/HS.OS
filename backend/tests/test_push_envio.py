"""O envio do push e a reserva entre workers (spec 2026-11-03, B1).

Conexão e `webpush` falsos — nada sai para a rede nem para o banco.
"""
import asyncio
import json
import threading
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from pywebpush import WebPushException

from app import push_envio as p

UID = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"
OUTRO = "7a1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a11"
MSG = "8b1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a12"
FCM = "https://fcm.googleapis.com/fcm/send/"


@pytest.fixture(autouse=True)
def _vapid(monkeypatch):
    monkeypatch.setattr(p, "chaves", lambda: ("pub", "priv", "mailto:x@y"))


class Conn:
    """Responde por trecho de SQL; guarda o que foi executado."""

    def __init__(self, respostas: dict):
        self.respostas = respostas
        self.executado: list[tuple[str, tuple]] = []

    def _achar(self, sql):
        for chave, valor in self.respostas.items():
            if chave in sql:
                return valor
        return None

    async def fetch(self, sql, *a):
        self.executado.append((sql, a))
        r = self._achar(sql)
        return r(*a) if callable(r) else (r or [])

    async def fetchrow(self, sql, *a):
        self.executado.append((sql, a))
        r = self._achar(sql)
        return r(*a) if callable(r) else r

    async def execute(self, sql, *a):
        self.executado.append((sql, a))


def _sessao_com(conn):
    @asynccontextmanager
    async def falsa(**_):
        yield conn
    return falsa


# ── enviar_para ─────────────────────────────────────────────────────────────

def test_envio_roda_fora_do_laco_de_eventos(monkeypatch):
    """`webpush` é síncrono (requests). Chamado direto dentro de `async`, cada
    push travava o worker inteiro — inclusive o WebSocket de todo mundo."""
    laco = threading.get_ident()
    threads = []

    def falso(**_):
        threads.append(threading.get_ident())

    conn = Conn({"FROM public.push_subscriptions": [
        {"id": "s1", "endpoint": FCM + "1", "p256dh": "k", "auth": "a"}]})
    monkeypatch.setattr(p, "webpush", falso)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    r = asyncio.run(p.enviar_para(UID, {"title": "t"}))
    assert r["enviados"] == 1
    assert threads and threads[0] != laco


def test_push_sobrevive_ao_aparelho_dormindo_e_nao_prende_a_thread(monkeypatch):
    """Os padrões do pywebpush são `ttl=0` e sem timeout. Com TTL zero o FCM e a
    Apple descartam o push se o aparelho estiver dormindo — justamente o caso
    de uso (app fechado, celular no bolso). Sem timeout, um serviço de push que
    não responde prende a thread para sempre."""
    argumentos = {}

    def falso(**kw):
        argumentos.update(kw)

    conn = Conn({"FROM public.push_subscriptions": [
        {"id": "s1", "endpoint": FCM + "1", "p256dh": "k", "auth": "a"}]})
    monkeypatch.setattr(p, "webpush", falso)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    asyncio.run(p.enviar_para(UID, {"title": "t"}))
    assert argumentos["ttl"] == 86400
    assert argumentos["timeout"] == 10
    assert argumentos["headers"] == {"Urgency": "high"}


def test_inscricao_morta_e_removida_e_erro_comum_nao_derruba(monkeypatch):
    """404/410 = aparelho desinstalado: insistir geraria erro a cada mensagem,
    para sempre. Outro erro só loga — push é acessório."""
    def falso(subscription_info, **_):
        ep = subscription_info["endpoint"]
        if ep.endswith("morta"):
            raise WebPushException("gone", response=SimpleNamespace(status_code=410))
        if ep.endswith("ruim"):
            raise WebPushException("500", response=SimpleNamespace(status_code=500))

    conn = Conn({"FROM public.push_subscriptions": [
        {"id": "s1", "endpoint": FCM + "morta", "p256dh": "k", "auth": "a"},
        {"id": "s2", "endpoint": FCM + "ruim", "p256dh": "k", "auth": "a"},
        {"id": "s3", "endpoint": FCM + "boa", "p256dh": "k", "auth": "a"}]})
    monkeypatch.setattr(p, "webpush", falso)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    r = asyncio.run(p.enviar_para(UID, {"title": "t"}))
    assert r == {"enviados": 1, "inscricoes": 3, "removidas": 1}
    apagou = [a for s, a in conn.executado if s.startswith("DELETE")]
    assert apagou == [(["s1"],)]


def test_banco_fora_nao_levanta(monkeypatch):
    @asynccontextmanager
    async def quebrada(**_):
        raise RuntimeError("banco indisponível")
        yield
    monkeypatch.setattr(p, "sessao", quebrada)
    assert asyncio.run(p.enviar_para(UID, {}))["enviados"] == 0


def test_sem_vapid_loga_uma_vez_e_nao_toca_no_banco(monkeypatch, caplog):
    """Sem as chaves o backend sobe — e diz uma vez, não a cada mensagem."""
    monkeypatch.setattr(p, "chaves", lambda: ("", "", "mailto:x@y"))
    monkeypatch.setattr(p, "_avisado", False)

    @asynccontextmanager
    async def proibida(**_):
        raise AssertionError("não devia abrir conexão")
        yield
    monkeypatch.setattr(p, "sessao", proibida)
    with caplog.at_level("WARNING"):
        assert not p.ligado()
        assert not p.ligado()
        asyncio.run(p.processar("channel_messages", MSG))
    assert [r.message for r in caplog.records].count("push desligado: VAPID ausente") == 1


# ── processar ───────────────────────────────────────────────────────────────

def _canal(recente=True, thread=None, conteudo="bom dia"):
    return {
        "channel_messages m": {
            "id": MSG, "channel_id": "c1", "author_id": OUTRO, "author_name": "Bia",
            "content": conteudo, "attachments": None, "audio_url": None,
            "thread_id": thread, "recente": recente, "nome_canal": "geral",
            "tipo": "public"},
        "channel_members cm": [
            {"user_id": UID, "nome": "Ana", "silenciado": False},
            {"user_id": OUTRO, "nome": "Bia", "silenciado": False}],
        "INSERT INTO public.push_enviados": lambda _m, us: [{"user_id": u} for u in us],
    }


def _capturar_envios(monkeypatch):
    enviados = []

    async def falso(user_id, payload):
        enviados.append((user_id, payload))
    monkeypatch.setattr(p, "enviar_para", falso)
    return enviados


def test_mensagem_de_canal_vai_para_os_outros_humanos(monkeypatch):
    conn = Conn(_canal())
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("channel_messages", MSG))
    assert [u for u, _ in enviados] == [UID]
    assert enviados[0][1]["title"] == "Bia em #geral"


def test_so_envia_para_quem_a_reserva_devolveu(monkeypatch):
    """Os 2 workers recebem o mesmo NOTIFY. Quem perde o `ON CONFLICT` recebe
    lista vazia e não envia — senão cada mensagem tocaria duas vezes."""
    r = _canal()
    r["INSERT INTO public.push_enviados"] = lambda _m, _us: []
    conn = Conn(r)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("channel_messages", MSG))
    assert enviados == []
    assert "ON CONFLICT DO NOTHING" in p.SQL_RESERVAR


def test_mensagem_antiga_nao_notifica(monkeypatch):
    """O `/recuperar` grava dezenas de respostas órfãs de uma vez; notificar
    cada uma seria uma rajada sobre coisa de horas atrás."""
    conn = Conn(_canal(recente=False))
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("channel_messages", MSG))
    assert enviados == []


def test_resposta_antiga_de_agente_nao_notifica(monkeypatch):
    conn = Conn({"FROM public.conversations c": {
        "id": MSG, "agent_id": "nina", "user_id": UID, "content": "x", "media": None,
        "recente": False, "agente_nome": "Nina"}})
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("conversations", MSG))
    assert enviados == []


def test_resposta_de_agente_vai_para_a_pessoa_da_conversa(monkeypatch):
    conn = Conn({
        "FROM public.conversations c": {
            "id": MSG, "agent_id": "nina", "user_id": UID, "content": "Pronto.",
            "media": None, "recente": True, "agente_nome": "Nina"},
        "INSERT INTO public.push_enviados": lambda _m, us: [{"user_id": u} for u in us]})
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("conversations", MSG))
    assert enviados == [(UID, {"title": "Nina", "body": "Pronto.", "url": "/chat?agent=nina",
                               "tag": "agente:nina", "conversa": "agente:nina"})]


def test_thread_busca_os_participantes(monkeypatch):
    r = _canal(thread="t1", conteudo="ok")
    r["channel_members cm"].append({"user_id": "9c1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a13",
                                    "nome": "Zé", "silenciado": False})
    r["WHERE id = $1::uuid OR thread_id"] = [{"author_id": UID}, {"author_id": OUTRO}]
    conn = Conn(r)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("channel_messages", MSG))
    assert [u for u, _ in enviados] == [UID]


def test_erro_no_processar_nao_levanta(monkeypatch):
    """Roda como tarefa solta a partir do NOTIFY: exceção ali some sem rastro
    e pode matar o laço. Tem que virar log."""
    @asynccontextmanager
    async def quebrada(**_):
        raise RuntimeError("x")
        yield
    monkeypatch.setattr(p, "sessao", quebrada)
    asyncio.run(p.processar("channel_messages", MSG))


def test_inscricao_antiga_com_endpoint_interno_e_pulada_e_apagada(monkeypatch):
    """SSRF: linhas gravadas antes da allowlist podem apontar para dentro da
    rede (a bridge do Swarm, o túnel do gateway). O envio confere de novo: não
    chama e apaga."""
    chamados = []

    def falso(subscription_info, **_):
        chamados.append(subscription_info["endpoint"])

    conn = Conn({"FROM public.push_subscriptions": [
        {"id": "s1", "endpoint": "http://172.18.0.1:8002/x", "p256dh": "k", "auth": "a"},
        {"id": "s2", "endpoint": FCM + "boa", "p256dh": "k", "auth": "a"}]})
    monkeypatch.setattr(p, "webpush", falso)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    r = asyncio.run(p.enviar_para(UID, {"title": "t"}))
    assert chamados == [FCM + "boa"]
    assert r == {"enviados": 1, "inscricoes": 2, "removidas": 1}
    apagou = [a for s, a in conn.executado if "DELETE" in s]
    assert apagou == [(["s1"],)]


# ── lembrete que chama atenção (spec 2026-11-13) ────────────────────────────
#
# O push do recado do lembrete é diferente do push de resposta: fica na tela
# até a pessoa decidir, e os botões da notificação funcionam sem login. A
# resposta seguinte do Guardi continua sendo push comum.

LEMBRETE = "22222222-2222-2222-2222-222222222222"
AVISO = "2026-11-13T17:00:27.123456+00:00"


def _recado_de_lembrete(de_novo=False):
    media = [{"type": "lembrete", "id": LEMBRETE, "name": "Hildon", "aviso_em": AVISO,
              "de_novo": de_novo, "mimeType": "", "base64": ""}]
    return {
        "FROM public.conversations c": {
            "id": MSG, "agent_id": "sandra-bot", "user_id": UID,
            "content": "⏰ Lembrete: Retornar contato para Hildon",
            "media": json.dumps(media), "recente": True, "agente_nome": "Sandra-Guardi"},
        "FROM public.lembretes": {"titulo": "Retornar contato para Hildon",
                                  "instrucao": "Ligar e confirmar a proposta."},
        "INSERT INTO public.push_enviados": lambda _m, us: [{"user_id": u} for u in us]}


def test_recado_de_lembrete_sai_com_payload_proprio_e_tokens(monkeypatch):
    """Sem `conversa` (o SW não cala lembrete para quem olha), `tag` por
    lembrete (o re-aviso substitui a notificação velha) e um token por ação,
    cada um conferível só para ESTE lembrete e ESTE aviso."""
    from datetime import datetime, timezone

    from app.agenda import token_acao
    monkeypatch.setattr(p.settings, "LEMBRETE_ACAO_SEGREDO", "z" * 64)
    conn = Conn(_recado_de_lembrete())
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("conversations", MSG))
    [(uid, payload)] = enviados
    assert uid == UID
    assert payload["tipo"] == "lembrete" and payload["lembrete_id"] == LEMBRETE
    assert payload["title"] == "⏰ Retornar contato para Hildon"
    assert payload["body"] == "Ligar e confirmar a proposta."
    assert payload["tag"] == f"lembrete:{LEMBRETE}" and "conversa" not in payload
    agora = datetime.now(timezone.utc)
    for acao in ("adiar", "feito"):
        lid, aviso_em, a = token_acao.conferir("z" * 64, payload["acoes"][acao], agora)
        assert (lid, aviso_em.isoformat(), a) == (LEMBRETE, AVISO, acao)
    # o lembrete é buscado pelo dono da conversa, não só pelo id do media
    [(sql, args)] = [e for e in conn.executado if "FROM public.lembretes" in e[0]]
    assert args == (LEMBRETE, UID) and "user_id = $2::uuid" in sql


def test_sem_segredo_o_lembrete_sai_sem_botoes(monkeypatch):
    """O backend sobe sem `LEMBRETE_ACAO_SEGREDO`: o push sai, persistente,
    só não traz os botões (que bateriam numa rota que responde 503)."""
    monkeypatch.setattr(p.settings, "LEMBRETE_ACAO_SEGREDO", "")
    conn = Conn(_recado_de_lembrete(de_novo=True))
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("conversations", MSG))
    [(_, payload)] = enviados
    assert "acoes" not in payload and payload["tipo"] == "lembrete"
    assert payload["title"].endswith("(de novo)")


def test_lembrete_apagado_vira_push_comum(monkeypatch):
    r = _recado_de_lembrete()
    r["FROM public.lembretes"] = None
    conn = Conn(r)
    monkeypatch.setattr(p, "sessao", _sessao_com(conn))
    enviados = _capturar_envios(monkeypatch)
    asyncio.run(p.processar("conversations", MSG))
    [(_, payload)] = enviados
    assert payload["tag"] == "agente:sandra-bot" and "tipo" not in payload
