# backend/tests/test_voz_entrega.py
"""O áudio vira anexo privado e entra na mensagem por UPDATE — o trigger de
tempo real leva à tela. Quem desligou a preferência não ganha áudio na conversa
direta; no canal o áudio é um só para todos."""
import asyncio

from app import voz_entrega as ve

PESSOA = "00000000-0000-4000-8000-0000000000a1"
CANAL = "00000000-0000-4000-8000-0000000000c1"
MSG = "00000000-0000-4000-8000-0000000000d1"


class Conn:
    def __init__(self, estado):
        self.e = estado

    async def fetchrow(self, sql, *a):
        self.e["sql"].append(sql)
        if "agent_profiles" in sql:
            return {"name": "Nina", "tts_voice_id": "pt-BR-FranciscaNeural"}
        if "resumo_em_audio" in sql:
            return {"resumo_em_audio": self.e["pref"]}
        return None

    async def execute(self, sql, *a):
        self.e["sql"].append(sql)
        self.e["args"].append(a)


class Sessao:
    def __init__(self, e):
        self.e = e

    async def __aenter__(self):
        return Conn(self.e)

    async def __aexit__(self, *a):
        return False


def _ambiente(monkeypatch, pref=True):
    e = {"sql": [], "args": [], "gravados": [], "pref": pref, "publicado": []}
    monkeypatch.setattr(ve, "sessao", lambda **k: Sessao(e))

    async def gravar(chave, dados, mime):
        e["gravados"].append((chave, len(dados), mime))
    monkeypatch.setattr(ve.arm, "gravar", gravar)
    monkeypatch.setattr(ve.arm, "chave", lambda b, c: f"{b}/{c}")
    monkeypatch.setattr(ve.hub, "publicar", lambda *a: e["publicado"].append(a))
    return e


async def _gerar_ok(texto, nome, voz):
    assert (nome, voz) == ("Nina", "pt-BR-FranciscaNeural")
    return b"ID3mp3"


async def _gerar_falha(texto, nome, voz):
    return None


def test_conversa_grava_anexo_e_acrescenta_a_midia(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_da_conversa(MSG, "nina", PESSOA, "Feito.", gerar=_gerar_ok))
    [(chave, tamanho, mime)] = e["gravados"]
    assert chave.startswith("anexos/") and mime == "audio/mpeg" and tamanho == 6
    assert any("INSERT INTO public.anexos" in s and "conversa_agente" in s for s in e["sql"])
    assert any("UPDATE public.conversations" in s and "media" in s for s in e["sql"])


def test_quem_desligou_nao_ganha_audio_na_conversa(monkeypatch):
    e = _ambiente(monkeypatch, pref=False)

    async def proibido(*a):
        raise AssertionError("gerou áudio para quem desligou")
    assert asyncio.run(ve.audio_da_conversa(MSG, "nina", PESSOA, "Feito.", gerar=proibido)) is False
    assert e["gravados"] == []


def test_canal_grava_anexo_troca_audio_url_e_avisa_a_tela(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_do_canal(MSG, CANAL, "nina", "Feito.", gerar=_gerar_ok))
    assert any("UPDATE public.channel_messages" in s and "audio_url" in s for s in e["sql"])
    assert any(a[1] == "mensagem-editada" for a in e["publicado"])


def test_falha_na_geracao_nao_grava_nada(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_do_canal(MSG, CANAL, "nina", "Feito.", gerar=_gerar_falha)) is False
    assert e["gravados"] == [] and not any("UPDATE" in s for s in e["sql"])


def test_resposta_ja_gravada_pelo_recuperar_nao_gera_segundo_audio(monkeypatch):
    """O `/recuperar` e o `/reply` gravam a mesma resposta por caminhos
    diferentes; o `_gravar_resposta` devolve `nova=False` para o segundo. Só o
    primeiro dispara o áudio — senão a mensagem ganharia dois players."""
    from app.routers import conversations as c
    disparados = []
    monkeypatch.setattr(c.voz_entrega, "disparar", lambda coro: (disparados.append(coro), coro.close()))
    c._audio_se_nova({"id": MSG}, False, "nina", PESSOA, "texto")
    assert disparados == []
    c._audio_se_nova({"id": MSG}, True, "nina", PESSOA, "texto")
    assert len(disparados) == 1


def test_aviso_de_falha_do_canal_nao_vira_audio():
    """Quando o agente não responde, o canal recebe 'Não consegui responder
    agora…'. Falar isso para todos os membros seria ruído."""
    from app.routers import channels as ch
    assert ch._merece_audio("Fechei o faturamento.") is True
    assert ch._merece_audio(ch._AVISO_FALHA) is False


def test_resposta_recuperada_antiga_nao_gera_audio():
    """O `/recuperar` pode trazer dezenas de respostas órfãs de dias atrás de
    uma vez; gerar áudio para todas seria rajada de chamadas e áudio que ninguém
    vai ouvir. Só a recente (até 30 min) ganha resumo."""
    from datetime import datetime, timedelta, timezone
    from app.routers import conversations as c
    agora = datetime(2026, 10, 13, 18, 0, tzinfo=timezone.utc)
    assert c._recente("2026-10-13T17:45:00.000Z", agora) is True
    assert c._recente("2026-10-13T17:00:00.000Z", agora) is False
    assert c._recente("lixo", agora) is False
