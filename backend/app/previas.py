"""Prévia da última mensagem de cada conversa — a lista do app do celular.

Spec `docs/superpowers/specs/2026-11-03-app-celular-design.md`, item 1: a lista
mostra, por conversa, a última mensagem sem markdown e com até 120 caracteres.
A conversa com agente já tinha isso (`/conversations/ultimas/por-agente`); DM e
canal não tinham, e montar no navegador custava uma ida por conversa.

⚠️ **As não lidas NÃO vêm daqui.** O contador do celular é o mesmo do desktop —
o das notificações (`unreadByChannel`). Uma segunda conta, no servidor, seria
outra definição de "não lida" para divergir em silêncio da primeira.
"""

import re

LIMITE = 120

# Ordem importa: imagem antes de link (`![a](b)` também casa como link), e
# bloco de código antes do código em linha.
_REGRAS = [
    (re.compile(r"```[a-zA-Z0-9_-]*\n?([\s\S]*?)```"), r"\1"),
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),
    (re.compile(r"`([^`]*)`"), r"\1"),
    (re.compile(r"(\*\*|__)(.+?)\1"), r"\2"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), r"\1"),
    (re.compile(r"~~(.+?)~~"), r"\1"),
    (re.compile(r"^\s{0,3}#{1,6}\s+", re.M), ""),
    (re.compile(r"^\s{0,3}>\s?", re.M), ""),
    (re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.M), ""),
]


def sem_markdown(texto: str) -> str:
    """O texto como a pessoa o leria, numa linha só."""
    for padrao, troca in _REGRAS:
        texto = padrao.sub(troca, texto)
    return re.sub(r"\s+", " ", texto).strip()


def texto_da_previa(content: str | None, attachments: list | None,
                    audio_url: str | None, apagada: bool,
                    autor_tipo: str = "human") -> str:
    """A linha que aparece embaixo do nome da conversa.

    Áudio de PESSOA é mensagem de voz: o `content` é a transcrição, e a prévia
    diz "🎤 Áudio", como o WhatsApp. Áudio de AGENTE é o resumo falado
    (`voz_entrega`) de uma resposta escrita — ali a prévia é o texto.
    """
    if apagada:
        return "Mensagem apagada"
    if audio_url and autor_tipo != "agent":
        return "🎤 Áudio"
    texto = sem_markdown(content or "")
    if not texto and attachments:
        primeiro = attachments[0] if isinstance(attachments[0], dict) else {}
        texto = f"📎 {primeiro.get('name') or 'arquivo'}"
    if len(texto) > LIMITE:
        texto = texto[:LIMITE].rstrip() + "…"
    return texto
