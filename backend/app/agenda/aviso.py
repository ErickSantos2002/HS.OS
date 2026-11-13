"""O que a pessoa faz com um aviso de lembrete: "Adiar 10 min" ou "Feito".

Spec 2026-11-13-lembrete-que-chama-atencao. Os dois caminhos — a janela do app
(com login) e os botões da notificação (token de ação, sem login) — passam por
`reconhecer`, para a regra morar num lugar só.

⚠️ **Só vale sobre o aviso ATUAL e ainda não reconhecido** (`aviso_em = $2 AND
reconhecido_em IS NULL`). É o que torna o segundo clique inócuo e impede um
botão de um aviso velho (a notificação esquecida na bandeja) de mexer no aviso
novo. Quem respondeu primeiro ganha; os outros recebem `aplicado: false`.

⚠️ **O aviso às outras abas sai do banco** (`pg_notify('hsos_mudancas')`, mesmo
canal do trigger da 003), não de `hub.publicar`: são 2 workers e o hub é por
processo. A janela aberta noutro aparelho fecha por esse evento.

⚠️ A tabela é só do `service_role`, sem RLS: o caminho com login filtra por
`user_id` explicitamente. O caminho por token não filtra — o token É a
autorização, e ele só alcança o lembrete que assina.
"""
from __future__ import annotations

import json
from datetime import datetime

from app.agenda.regras import ADIAR, JANELA_PENDENTE

COMO = {"adiar": "adiado", "feito": "feito"}

SQL_RECONHECER = """
    UPDATE public.lembretes
       SET reconhecido_em = $3,
           reconhecido_como = $4,
           reaviso_em = $5,
           atualizado_em = now()
     WHERE id = $1::uuid
       AND aviso_em = $2
       AND reconhecido_em IS NULL
       AND ($6::uuid IS NULL OR user_id = $6::uuid)
    RETURNING user_id::text AS user_id, agent_id
"""

SQL_AVISAR_TELAS = "SELECT pg_notify('hsos_mudancas', $1)"

SQL_PENDENTES = """
    SELECT l.id::text AS id, l.titulo, l.instrucao, l.agent_id, l.aviso_em, l.reavisos,
           COALESCE(NULLIF(ap.name, ''), l.agent_id) AS agente_nome
      FROM public.lembretes l
      LEFT JOIN public.agent_profiles ap ON ap.agent_id = l.agent_id
     WHERE l.user_id = $1::uuid
       AND l.reconhecido_em IS NULL
       AND l.aviso_em IS NOT NULL
       AND l.aviso_em > $2
     ORDER BY l.aviso_em
"""


def efeito(acao: str, agora: datetime) -> tuple[str, datetime | None]:
    """`(reconhecido_como, reaviso_em)` de uma ação. Pura.

    Adiar marca o re-aviso para daqui a 10 min; Feito zera — sem re-aviso, nem
    a insistência de 5 min que estava marcada.
    """
    if acao not in COMO:
        raise ValueError(f"ação inválida: {acao!r}")
    return COMO[acao], (agora + ADIAR if acao == "adiar" else None)


async def reconhecer(conn, lembrete_id: str, aviso_em: datetime, acao: str,
                     agora: datetime, user_id: str | None = None) -> dict:
    """Aplica a ação. `user_id` None = caminho do token (já autorizado por ele)."""
    como, reaviso = efeito(acao, agora)
    linha = await conn.fetchrow(SQL_RECONHECER, lembrete_id, aviso_em, agora, como,
                                reaviso, user_id)
    if not linha:
        return {"aplicado": False}
    await conn.execute(SQL_AVISAR_TELAS, json.dumps({
        "tabela": "lembretes", "op": "UPDATE", "id": lembrete_id,
        "user_id": linha["user_id"], "agent_id": linha["agent_id"]}))
    return {"aplicado": True, "reconhecido_como": como, "reaviso_em": reaviso}


async def pendentes(conn, user_id: str, agora: datetime) -> list[dict]:
    """Avisados e não respondidos nas últimas 6 h — o que a janela do app abre."""
    return [dict(r) for r in await conn.fetch(SQL_PENDENTES, user_id, agora - JANELA_PENDENTE)]
