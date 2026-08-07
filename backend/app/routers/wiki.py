"""Wiki — espaços e documentos.

Um espaço agrupa documentos e pode ter espaço-pai, formando a árvore da barra
lateral. O documento é markdown com título, e a ordenação é curadoria: fixados
primeiro, depois `order_index`, depois o mais recente.

O `created_by` e o `updated_by` saem do token, nunca do corpo. A tela mandava
`user.id` junto, o que é abrir para gravar em nome de outra pessoa.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wiki", tags=["wiki"])


def _cru(linha) -> dict:
    return json.loads(json.dumps(dict(linha), default=str))


# ─────────────────────────────────────────────────────────────────────────────
# Espaços
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/espacos")
async def listar_espacos(usuario: Usuario = Depends(usuario_atual)):
    """Os espaços, na ordem da barra lateral."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.wiki_spaces ORDER BY order_index NULLS LAST, created_at"
        )
    return [_cru(l) for l in linhas]


class EspacoIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    icon: str = "BookOpen"
    color: str = "#3D61FF"
    parent_id: str | None = None


@router.post("/espacos", status_code=status.HTTP_201_CREATED)
async def criar_espaco(dados: EspacoIn, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            INSERT INTO public.wiki_spaces
                (name, description, icon, color, parent_id, created_by)
            VALUES ($1,$2,$3,$4, NULLIF($5,'')::text::uuid, $6::uuid)
            RETURNING *
            """,
            dados.name, dados.description, dados.icon, dados.color,
            dados.parent_id or "", usuario.id,
        )
    return _cru(linha)


class EspacoPatchIn(BaseModel):
    """Tudo opcional — a tela renomeia, troca ícone ou reordena, um por vez."""
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    order_index: int | None = None


@router.patch("/espacos/{espaco_id}")
async def editar_espaco(
    espaco_id: str, dados: EspacoPatchIn, usuario: Usuario = Depends(usuario_atual)
):
    """`COALESCE($n, coluna)`: `null` é "não mexe", não "apaga"."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            UPDATE public.wiki_spaces SET
                name        = COALESCE($2, name),
                description = COALESCE($3, description),
                icon        = COALESCE($4, icon),
                color       = COALESCE($5, color),
                order_index = COALESCE($6, order_index)
             WHERE id = $1::uuid
            RETURNING *
            """,
            espaco_id, dados.name, dados.description, dados.icon, dados.color,
            dados.order_index,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espaço não encontrado.")
    return _cru(linha)


@router.delete("/espacos/{espaco_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_espaco(espaco_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Apaga o espaço. Os documentos dele vão junto, por FK.

    ⚠️ É destrutivo e não tem desfazer. A confirmação é da tela — aqui não há
    como distinguir "apagar de propósito" de "apagar por engano".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.wiki_spaces WHERE id = $1::uuid", espaco_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espaço não encontrado.")


# ─────────────────────────────────────────────────────────────────────────────
# Documentos
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/espacos/{espaco_id}/documentos")
async def listar_documentos(espaco_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Os documentos do espaço: fixados primeiro, depois a ordem, depois o mais
    recente. É curadoria, não ordem alfabética."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.wiki_documents WHERE space_id = $1::uuid "
            " ORDER BY is_pinned DESC NULLS LAST, order_index NULLS LAST, updated_at DESC",
            espaco_id,
        )
    return [_cru(l) for l in linhas]


@router.get("/documentos/{documento_id}")
async def obter_documento(documento_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT * FROM public.wiki_documents WHERE id = $1::uuid", documento_id
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento não encontrado.")
    return _cru(linha)


class DocumentoIn(BaseModel):
    space_id: str
    title: str = "Sem título"
    content: str = ""


@router.post("/documentos", status_code=status.HTTP_201_CREATED)
async def criar_documento(dados: DocumentoIn, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "INSERT INTO public.wiki_documents "
            "    (space_id, title, content, created_by, updated_by) "
            "VALUES ($1::uuid, $2, $3, $4::uuid, $4::uuid) RETURNING *",
            dados.space_id, dados.title, dados.content, usuario.id,
        )
    return _cru(linha)


class DocumentoPatchIn(BaseModel):
    title: str | None = None
    content: str | None = None
    is_pinned: bool | None = None
    order_index: int | None = None


@router.patch("/documentos/{documento_id}")
async def editar_documento(
    documento_id: str, dados: DocumentoPatchIn, usuario: Usuario = Depends(usuario_atual)
):
    """Edita e carimba quem editou e quando.

    O `updated_by` e o `updated_at` são do servidor. A tela mandava os dois, e
    `updated_at` com relógio de navegador adiantado faz "editado há 5 minutos"
    virar "daqui a 5 minutos" para quem vê.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            UPDATE public.wiki_documents SET
                title       = COALESCE($3, title),
                content     = COALESCE($4, content),
                is_pinned   = COALESCE($5, is_pinned),
                order_index = COALESCE($6, order_index),
                updated_by  = $2::uuid,
                updated_at  = now()
             WHERE id = $1::uuid
            RETURNING *
            """,
            documento_id, usuario.id, dados.title, dados.content,
            dados.is_pinned, dados.order_index,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento não encontrado.")
    return _cru(linha)


@router.delete("/documentos/{documento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_documento(documento_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.wiki_documents WHERE id = $1::uuid", documento_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento não encontrado.")
