# backend/app/encaminhamento.py
"""Encaminhar mensagem: o que viaja, para onde e com que limite.

Funções puras — a rota (`app/routers/encaminhar.py`) busca os fatos e
pergunta aqui. Spec: `docs/superpowers/specs/2026-11-27-encaminhar-mensagem-design.md`.
"""
from __future__ import annotations

LIMITE_DESTINOS = 10

# Da conversa com agente, só arquivo de verdade viaja. Os cartões
# (`email_aprovacao`, `acao_aprovacao`, `lembrete`) só valem na conversa onde
# nasceram — fora dela, o botão de aprovar seria de outra pessoa.
_TIPOS_QUE_VIAJAM = {"file", "image", "audio"}


def anexos_do_canal(attachments: list[dict] | None) -> tuple[list[dict], list[str]]:
    """`(vão_como_estão, ids_para_copiar)`.

    Com `id` é anexo privado: precisa de cópia na conversa de destino, senão
    quem recebe leva 404. Sem `id` é URL pública (GIF do Giphy, `/storage/...`
    antigo) e vai como está.
    """
    publicos, ids = [], []
    for a in attachments or []:
        if a.get("id"):
            ids.append(a["id"])
        else:
            publicos.append(a)
    return publicos, ids


def anexos_da_conversa(media: list[dict] | None, role: str) -> list[str]:
    """Ids de anexo da conversa com agente que viajam.

    O áudio do AGENTE é o resumo em áudio da própria resposta — leitura do
    texto que já vai junto; o da pessoa é o que ela gravou, e viaja.
    """
    ids = []
    for m in media or []:
        tipo = m.get("type")
        if tipo not in _TIPOS_QUE_VIAJAM or not m.get("id"):
            continue
        if tipo == "audio" and role != "user":
            continue
        ids.append(m["id"])
    return ids


def id_do_audio(audio_url: str | None) -> str | None:
    """`channel_messages.audio_url` guarda `anexo:<id>` desde a portagem para o R2."""
    if audio_url and audio_url.startswith("anexo:"):
        return audio_url[len("anexo:"):] or None
    return None


def conferir_destinos(pessoas: list[str], canais: list[str], guardi: bool, eu: str) -> None:
    """Recusa (ValueError com frase para a tela) antes de qualquer escrita."""
    total = len(pessoas) + len(canais) + (1 if guardi else 0)
    if total == 0:
        raise ValueError("Escolha para quem encaminhar.")
    if total > LIMITE_DESTINOS:
        raise ValueError(f"Dá para encaminhar para até {LIMITE_DESTINOS} de uma vez.")
    if len(set(pessoas)) != len(pessoas) or len(set(canais)) != len(canais):
        raise ValueError("Há destino repetido.")
    if eu in pessoas:
        raise ValueError("Para guardar para você, use a sua conversa de anotações.")


def conteudo_para_mencao(conteudo: str | None, encaminhada: bool) -> str:
    """O texto em que o push procura `@todos`/`@Nome`.

    Encaminhada não conta: a menção foi escrita para OUTRA conversa, e
    honrá-la aqui faria encaminhar furar o silenciar do grupo inteiro.
    """
    return "" if encaminhada else (conteudo or "")
