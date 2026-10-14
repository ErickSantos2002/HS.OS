"""Visto por mensagem nos canais — lido, estados e "Dados da mensagem".

Substitui o `/dm-reads` (um horário por pessoa e canal). Ver spec
2026-10-14-vistos-por-mensagem-design.md e `app/recibos.py`.

Tudo como `service_role`, como nos anexos: a tabela não tem policy, e a regra
de quem vê o quê está aqui — membro do canal; o detalhe, só o autor.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.recibos import eh_uuid, estado_no_canal

router = APIRouter(prefix="/channels", tags=["chat"])

SQL_MEMBRO = """SELECT 1 FROM public.channel_members
                 WHERE channel_id = $1::uuid AND user_id = $2 LIMIT 1"""

# ⚠️ O canal lê só o nível de cima; cada thread lê a si mesma. Até a revisão
# final (14/10/2026) abrir o canal marcava como lidas as respostas de thread
# que a pessoa nunca abriu — azul falso para quem respondeu.
SQL_MARCAR_LIDO = """
    UPDATE public.recibos_mensagem r
       SET lida_em = now(), entregue_em = COALESCE(r.entregue_em, now())
      FROM public.channel_messages m
     WHERE r.message_id = m.id AND m.channel_id = $1::uuid AND m.thread_id IS NULL
       AND r.user_id = $2::uuid AND r.lida_em IS NULL
"""

SQL_MARCAR_LIDO_THREAD = """
    UPDATE public.recibos_mensagem r
       SET lida_em = now(), entregue_em = COALESCE(r.entregue_em, now())
      FROM public.channel_messages m
     WHERE r.message_id = m.id AND m.channel_id = $1::uuid AND m.thread_id = $3::uuid
       AND r.user_id = $2::uuid AND r.lida_em IS NULL
"""

# Só membros ATUAIS contam: quem saiu do grupo não pode travar o azul.
SQL_ESTADOS = """
    SELECT m.id::text AS id,
           count(r.user_id)                                   AS destinatarios,
           count(r.user_id) FILTER (WHERE r.entregue_em IS NOT NULL) AS entregues,
           count(r.user_id) FILTER (WHERE r.lida_em IS NOT NULL)     AS lidas
      FROM public.channel_messages m
      LEFT JOIN public.recibos_mensagem r
        ON r.message_id = m.id
       AND EXISTS (SELECT 1 FROM public.channel_members cm
                    WHERE cm.channel_id = m.channel_id AND cm.member_type = 'human'
                      AND cm.user_id = r.user_id::text)
     WHERE m.channel_id = $1::uuid AND m.author_id = $2
       AND m.author_type::text = 'human' AND m.deleted_at IS NULL
       AND m.created_at > now() - interval '90 days'
     GROUP BY m.id, m.created_at
     ORDER BY m.created_at DESC
     LIMIT 500
"""

SQL_DETALHE = """
    SELECT r.user_id::text AS user_id,
           COALESCE(NULLIF(p.full_name, ''), 'Sem nome') AS nome,
           to_char(r.entregue_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS entregue_em,
           to_char(r.lida_em     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS lida_em
      FROM public.recibos_mensagem r
      JOIN public.channel_members cm
        ON cm.channel_id = $1::uuid AND cm.member_type = 'human' AND cm.user_id = r.user_id::text
      LEFT JOIN public.profiles p ON p.id = r.user_id
     WHERE r.message_id = $2::uuid
     ORDER BY r.lida_em NULLS LAST, r.entregue_em NULLS LAST, nome
"""


def _mapa_de_estados(linhas) -> dict[str, str]:
    return {l["id"]: estado_no_canal(l["destinatarios"], l["entregues"], l["lidas"])
            for l in linhas}


async def _membro(conn, channel_id: str, user_id: str) -> bool:
    return bool(await conn.fetchval(SQL_MEMBRO, channel_id, user_id))


@router.post("/{channel_id}/lido", status_code=status.HTTP_204_NO_CONTENT)
async def marcar_lido(
    channel_id: str,
    usuario: Usuario = Depends(usuario_atual),
    thread_id: str | None = Query(default=None, description="Lê só as respostas desta thread."),
):
    """Marca como lido, agora, o que chegou para mim neste canal — o nível de
    cima, ou só as respostas de uma thread quando `thread_id` vem.

    Vale para DM e grupo. O horário é do servidor — recibo com relógio de
    navegador errado mostraria "lida" na hora errada para quem mandou.
    """
    if thread_id is not None and not eh_uuid(thread_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thread não encontrada.")
    async with sessao(role="service_role") as conn:
        if not await _membro(conn, channel_id, usuario.id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")
        if thread_id:
            await conn.execute(SQL_MARCAR_LIDO_THREAD, channel_id, usuario.id, thread_id)
        else:
            await conn.execute(SQL_MARCAR_LIDO, channel_id, usuario.id)


@router.get("/{channel_id}/recibos", response_model=dict[str, str])
async def estados(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """O visto de cada mensagem MINHA no canal: `{message_id: estado}`."""
    async with sessao(role="service_role") as conn:
        if not await _membro(conn, channel_id, usuario.id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")
        linhas = await conn.fetch(SQL_ESTADOS, channel_id, usuario.id)
    return _mapa_de_estados(linhas)


class ReciboOut(BaseModel):
    user_id: str
    nome: str
    entregue_em: str | None = None
    lida_em: str | None = None


@router.get("/{channel_id}/messages/{message_id}/recibos", response_model=list[ReciboOut])
async def dados_da_mensagem(channel_id: str, message_id: str,
                            usuario: Usuario = Depends(usuario_atual)):
    """"Dados da mensagem": quem recebeu e quem leu, com horário.

    Só o autor vê — como no WhatsApp. Para os outros a resposta é 404, igual à
    de mensagem inexistente, para não confirmar que ela existe.
    """
    async with sessao(role="service_role") as conn:
        # Membro AINDA: quem saiu do grupo não segue vendo quem lê lá dentro.
        if not await _membro(conn, channel_id, usuario.id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada.")
        autor = await conn.fetchval(
            "SELECT author_id FROM public.channel_messages "
            " WHERE id = $1::uuid AND channel_id = $2::uuid AND author_type::text = 'human'",
            message_id, channel_id)
        if autor is None or autor != usuario.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada.")
        linhas = await conn.fetch(SQL_DETALHE, channel_id, message_id)
    return [ReciboOut(**dict(l)) for l in linhas]
