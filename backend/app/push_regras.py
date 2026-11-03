"""Quem recebe o push e o que ele diz — sem banco (spec 2026-11-03, B1).

Puro de propósito: o `push_envio` busca os membros e a linha da mensagem, e
estas funções decidem. Testado em `tests/test_push_regras.py`.

| evento                       | destinatário                                          |
|------------------------------|-------------------------------------------------------|
| resposta de agente (conversa)| a pessoa da conversa                                  |
| mensagem em DM               | o outro membro humano                                 |
| mensagem em canal/grupo      | humanos, menos o autor e quem silenciou               |
| menção em canal              | o mencionado, mesmo com o canal silenciado            |
| resposta em thread           | quem está na thread (mãe + quem respondeu), menos o autor |

Agente nunca recebe: a lista de membros que chega aqui já é só de humanos.
"""
import re
import unicodedata
from dataclasses import dataclass

# O mesmo do `EVERYONE_MENTION_REGEX` da tela (`channel-notifications.ts`).
_TODOS = re.compile(r"(^|\s)@todos\b", re.I | re.U)

_TETO_PREVIA = 140

# Até onde a varredura de menções olha — ver `mencionados`.
_TETO_CARACTERES = 10_000
_TETO_ARROBAS = 50


@dataclass(frozen=True)
class Membro:
    user_id: str
    nome: str
    silenciado: bool = False


def _normalizar(texto: str) -> str:
    """Sem acento e em minúscula, como o `normalizeMentionValue` da tela.

    ⚠️ Remover os diacríticos depois do NFD muda o comprimento da string; quem
    compara posições tem que normalizar o texto inteiro antes, nunca pedaços.
    """
    decomposto = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in decomposto if not unicodedata.combining(c)).lower()


def menciona_todos(conteudo: str) -> bool:
    return bool(_TODOS.search(conteudo or ""))


def mencionados(conteudo: str, membros: list[tuple[str, str]]) -> set[str]:
    """`@Nome` → os user_ids daquele nome (esclarecimento 2).

    Em cada `@`, vence o nome **mais longo** que casar ali com fronteira depois
    (`@Ana Paula` não acorda a Ana); nome repetido notifica todos os homônimos.
    """
    texto = _normalizar(conteudo)
    por_nome: dict[str, set[str]] = {}
    for uid, nome in membros:
        n = _normalizar(nome).strip()
        if n:
            por_nome.setdefault(n, set()).add(uid)
    nomes = sorted(por_nome, key=len, reverse=True)

    # ⚠️ **Trabalho limitado de propósito.** O conteúdo vem de quem escreve, e
    # a varredura roda num worker que atende todo mundo: uma mensagem com cem
    # mil "@" fatiando o texto a cada um era O(n²). Compara por índice, sem
    # cópia, e para nos primeiros `_TETO_ARROBAS` dentro dos primeiros
    # `_TETO_CARACTERES` — menção de verdade está no começo de mensagem humana.
    texto = texto[:_TETO_CARACTERES]
    achados: set[str] = set()
    for i, m in enumerate(re.finditer("@", texto)):
        if i >= _TETO_ARROBAS:
            break
        inicio = m.end()
        for n in nomes:
            if not texto.startswith(n, inicio):
                continue
            fim = inicio + len(n)
            if fim < len(texto) and (texto[fim].isalnum() or texto[fim] == "_"):
                continue
            achados |= por_nome[n]
            break
    return achados


def destinatarios_canal(autor_id: str, membros: list[Membro], conteudo: str,
                        participantes_thread: set[str] | None) -> set[str]:
    """Quem recebe uma mensagem de canal, DM ou thread.

    `participantes_thread` é `None` fora de thread; dentro, é o autor da mãe e
    quem já respondeu. Menção e `@todos` furam o silenciar (esclarecimento 2).
    """
    humanos = {m.user_id for m in membros}
    if menciona_todos(conteudo):
        return humanos - {autor_id}

    chamados = mencionados(conteudo, [(m.user_id, m.nome) for m in membros])
    if participantes_thread is None:
        base = {m.user_id for m in membros if not m.silenciado}
    else:
        base = {m.user_id for m in membros
                if m.user_id in participantes_thread and not m.silenciado}
    return (base | (chamados & humanos)) - {autor_id}


# ── prévia ──────────────────────────────────────────────────────────────────

_IMAGEM = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_TAG = re.compile(r"<[^>]+>")
_MARCAS = re.compile(r"(\*\*|__|~~|`+|\*)")
_INICIO_DE_LINHA = re.compile(r"^\s{0,3}(#{1,6}\s+|>\s?|[-+]\s+|\d+\.\s+)", re.M)


def previa(conteudo: str | None, anexos: list | None = None, audio: bool = False) -> str:
    """Até 140 caracteres, sem markdown nem HTML.

    Mensagem só com anexo vira "📎 arquivo"; só com áudio, "🎤 áudio" — senão a
    notificação chegaria em branco e a pessoa abriria o app para ver o nada.
    """
    t = conteudo or ""
    t = _IMAGEM.sub(r"\1", t)
    t = _LINK.sub(r"\1", t)
    t = _TAG.sub("", t)
    t = _INICIO_DE_LINHA.sub("", t)
    t = _MARCAS.sub("", t)
    t = " ".join(t.split())
    if not t:
        if anexos:
            return "📎 arquivo"
        if audio:
            return "🎤 áudio"
        return ""
    if len(t) > _TETO_PREVIA:
        t = t[:_TETO_PREVIA - 1].rstrip() + "…"
    return t


# ── payload ─────────────────────────────────────────────────────────────────
#
# ⚠️ Sem `notification_id` (esclarecimento 1): o push nasce da mensagem, não do
# sininho. O "Marcar como lida" do SW marca a conversa pelo `channel_id`, e na
# conversa com agente nem aparece — por isso o payload dela não leva canal.
#
# `conversa` é a chave que o SW compara com a conversa aberta na tela para não
# notificar quem está olhando; `tag` agrupa uma notificação por conversa.

def payload_canal(*, canal_id: str, canal_nome: str, tipo: str, autor: str,
                  conteudo: str, anexos: list | None, audio: bool,
                  thread_id: str | None) -> dict:
    titulo = autor if tipo == "dm" or not canal_nome else f"{autor} em #{canal_nome}"
    url = f"/chat?channel={canal_id}" + (f"&thread={thread_id}" if thread_id else "")
    return {
        "title": titulo,
        "body": previa(conteudo, anexos, audio),
        "url": url,
        "tag": f"thread:{thread_id}" if thread_id else f"canal:{canal_id}",
        "conversa": f"canal:{canal_id}",
        "channel_id": canal_id,
    }


def payload_agente(*, agent_id: str, agente_nome: str, conteudo: str,
                   anexos: list | None = None) -> dict:
    return {
        "title": agente_nome or agent_id,
        "body": previa(conteudo, anexos),
        "url": f"/chat?agent={agent_id}",
        "tag": f"agente:{agent_id}",
        "conversa": f"agente:{agent_id}",
    }
