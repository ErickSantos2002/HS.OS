# backend/app/routers/conversas_marcadas.py
"""`/conversas/marcadas` — marcar conversa como não lida pela lista (039).

O `user_id` sai SEMPRE do token. Marcar canal exige ser membro humano; marcar
agente, que a pessoa possa vê-lo. Desmarcar não confere acesso: é a própria
linha da pessoa, e quem saiu do canal precisa conseguir limpá-la.

O aviso ao outro aparelho sai do trigger da 039 (`usuario:<id>`), não daqui.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.conversas_marcadas import alvo_da_marca
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.routers.anexos import _pode_ver_agente, membro_do_canal

router = APIRouter(prefix="/conversas/marcadas", tags=["conversas"])

# Só canal de que a pessoa AINDA é membro: removida com a marca ativa, a marca
# some da lista em vez de voltar com acesso negado.
_SQL_LISTAR = """
SELECT m.canal_id::text AS canal_id, m.agent_id, m.marcada_em
  FROM public.conversas_marcadas m
 WHERE m.user_id = $1::uuid
   AND (m.agent_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.channel_members cm
         WHERE cm.channel_id = m.canal_id
           AND cm.user_id = $1::text
           AND cm.member_type = 'human'))
 ORDER BY m.marcada_em DESC
"""

_SQL_MARCAR_CANAL = (
    "INSERT INTO public.conversas_marcadas (user_id, canal_id) "
    "VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING"
)
_SQL_MARCAR_AGENTE = (
    "INSERT INTO public.conversas_marcadas (user_id, agent_id) "
    "VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING"
)
_SQL_DESMARCAR_CANAL = (
    "DELETE FROM public.conversas_marcadas WHERE user_id = $1::uuid AND canal_id = $2::uuid"
)
_SQL_DESMARCAR_AGENTE = (
    "DELETE FROM public.conversas_marcadas WHERE user_id = $1::uuid AND agent_id = $2"
)


def _alvo(canal_id: str | None, agent_id: str | None) -> tuple[str, str]:
    try:
        return alvo_da_marca(canal_id, agent_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None


@router.get("")
async def listar(usuario: Usuario = Depends(usuario_atual)) -> list[dict]:
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(_SQL_LISTAR, usuario.id)
    return [
        {"canal_id": l["canal_id"], "agent_id": l["agent_id"],
         "marcada_em": l["marcada_em"].isoformat()}
        for l in linhas
    ]


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
async def marcar(canal_id: str | None = Query(None), agent_id: str | None = Query(None),
                 usuario: Usuario = Depends(usuario_atual)) -> Response:
    tipo, alvo = _alvo(canal_id, agent_id)
    async with sessao(role="service_role") as conn:
        if tipo == "canal":
            if not await membro_do_canal(conn, alvo, usuario.id, "human"):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não participa desta conversa.")
            await conn.execute(_SQL_MARCAR_CANAL, usuario.id, alvo)
        else:
            if not await _pode_ver_agente(conn, usuario.id, alvo):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não tem acesso a este agente.")
            await conn.execute(_SQL_MARCAR_AGENTE, usuario.id, alvo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def desmarcar(canal_id: str | None = Query(None), agent_id: str | None = Query(None),
                    usuario: Usuario = Depends(usuario_atual)) -> Response:
    tipo, alvo = _alvo(canal_id, agent_id)
    async with sessao(role="service_role") as conn:
        sql = _SQL_DESMARCAR_CANAL if tipo == "canal" else _SQL_DESMARCAR_AGENTE
        await conn.execute(sql, usuario.id, alvo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
