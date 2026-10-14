"""Conversas anteriores com o agente — o recorte, sem banco (spec 2026-10-14).

"Nova conversa" (`/limpar`) não apaga: grava um marco em `conversation_resets`
e a tela passa a mostrar só o que veio depois. Uma conversa anterior é o trecho
de `conversations` que um marco ENCERROU — do marco anterior (exclusivo) até
ele (inclusivo: o `/limpar` grava o marco depois da última mensagem, e empate
de relógio não pode jogar a última resposta para a conversa seguinte). O que
vem depois do último marco é a conversa atual e não entra aqui.

⚠️ O identificador é o uuid do reset, nunca o horário: a API devolve
milissegundos e o banco guarda microssegundos, e o horário não acharia o
trecho de volta.
"""
import re
from bisect import bisect_left

_TETO_TITULO = 80
_SEM_PERGUNTA = "Conversa sem pergunta"

# Lido pelas rotas de `conversations` e pela busca global: os resets de UM par
# pessoa × agente. Sem o `agent_id`, o reset de outra conversa recortaria esta.
SQL_RESETS = (
    "SELECT id::text AS id, created_at FROM public.conversation_resets "
    " WHERE user_id = $1::uuid AND agent_id = $2 ORDER BY created_at"
)


def _limpar(texto: str | None) -> str:
    return re.sub(r"\s+", " ", texto or "").strip()


def titulo_da_conversa(mensagens: list[dict]) -> str:
    """A primeira pergunta com mais de 3 palavras — "oi" e "olha os arquivos"
    não dizem do que a conversa tratou. Sem isso, a primeira pergunta; sem
    pergunta nenhuma, um nome fixo."""
    perguntas = [_limpar(m.get("content")) for m in mensagens if m.get("role") == "user"]
    perguntas = [p for p in perguntas if p]
    if not perguntas:
        return _SEM_PERGUNTA
    titulo = next((p for p in perguntas if len(p.split()) > 3), perguntas[0])
    if len(titulo) > _TETO_TITULO:
        titulo = titulo[: _TETO_TITULO - 1] + "…"
    return titulo


def _indice(resets: list[dict], instante) -> int:
    """Índice do primeiro reset com `created_at >= instante` — o que encerrou
    o trecho em que o instante cai."""
    return bisect_left([r["created_at"] for r in resets], instante)


def recortar_conversas(resets: list[dict], mensagens: list[dict]) -> list[dict]:
    """Os trechos encerrados, do mais novo ao mais antigo, sem os vazios (dois
    "Nova conversa" seguidos não viram item que abre em branco)."""
    grupos: dict[int, list[dict]] = {}
    for msg in mensagens:
        i = _indice(resets, msg["created_at"])
        if i < len(resets):
            grupos.setdefault(i, []).append(msg)
    return [
        {
            "id": resets[i]["id"],
            "ate": resets[i]["created_at"],
            "inicio": grupos[i][0]["created_at"],
            "titulo": titulo_da_conversa(grupos[i]),
            "mensagens": len(grupos[i]),
        }
        for i in sorted(grupos, reverse=True)
    ]


def limites_do_trecho(resets: list[dict], reset_id: str):
    """`(depois_de, ate)` do trecho que `reset_id` encerrou; `None` se o id
    não é um destes resets — de outra pessoa, de outro agente ou inventado."""
    for i, r in enumerate(resets):
        if r["id"] == reset_id:
            return (resets[i - 1]["created_at"] if i else None, r["created_at"])
    return None


def trecho_da_mensagem(resets: list[dict], instante) -> str | None:
    """O reset que encerrou a conversa desta mensagem; `None` se ela é da
    conversa atual. É o que leva a busca global ao lugar certo."""
    i = _indice(resets, instante)
    return resets[i]["id"] if i < len(resets) else None
