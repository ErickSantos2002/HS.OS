"""Histórico de conversa com agente — substitui as consultas diretas a
`public.conversations` feitas por `frontend/src/lib/chat-persistence.ts`.

A tabela guarda o histórico **do lado do HS.OS**, que não é o mesmo do gateway:
o gateway tem a sessão do agente (com toolCall, toolResult e raciocínio), e aqui
fica só o par usuário/agente que a tela mostra. São visões diferentes do mesmo
diálogo, e a tela sempre leu daqui — não do gateway.

Tudo é escopado ao usuário do token. A tabela tem RLS por `auth.uid()`, mas o
filtro explícito por `user_id` fica assim mesmo: é a regra de negócio (cada um vê
a própria conversa), não só a defesa.
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])

# A tela carrega esta quantidade ao abrir e usa o mesmo número para decidir se
# há mais páginas — `INITIAL_PAGE_SIZE` do `chat-persistence.ts`.
_PAGINA_INICIAL = 50
_LIMITE_MAXIMO = 200

_COLUNAS = """
    id::text AS id, agent_id, role, content, media,
    to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') AS created_at
"""


class MensagemOut(BaseModel):
    id: str
    agent_id: str
    role: str  # user | agent
    content: str = ""
    media: list[dict] | None = None
    created_at: str


class PaginaOut(BaseModel):
    messages: list[MensagemOut]
    # Verdadeiro quando a página veio cheia: a tela usa isto para decidir se
    # mostra o "carregar mais".
    has_more: bool


class MensagemIn(BaseModel):
    role: str
    content: str = ""
    media: list[dict] | None = None
    # A tela gera o horário junto com a mensagem otimista e o manda para cá, para
    # que a ordem na tela e no banco não briguem quando a rede atrasa.
    created_at: str | None = None


_PAPEIS = {"user", "agent"}


def _instante(valor: str | None, campo: str) -> datetime | None:
    """ISO da tela → `datetime`.

    O asyncpg **não aceita string** em coluna `timestamptz`, mesmo com o cast
    `::timestamptz` no SQL: ele infere o tipo do parâmetro pela query e exige um
    `datetime`. Passando string, estoura `DataError` e vira 500 — que é erro de
    servidor para o que na verdade é entrada malformada.

    O `Z` do `toISOString()` do JavaScript é aceito pelo `fromisoformat` a partir
    do Python 3.11.
    """
    if valor is None:
        return None
    try:
        return datetime.fromisoformat(valor)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"`{campo}` precisa ser um timestamp ISO válido (ex.: 2026-08-06T14:30:00Z).",
        )


def _para_saida(linha) -> MensagemOut:
    d = dict(linha)
    bruto = d.get("media")
    # `media` é jsonb: o driver devolve string. Uma mensagem só sempre virou
    # lista, porque a tela aceita as duas formas e normalizar aqui evita o
    # `Array.isArray` do outro lado.
    midia = None
    if bruto:
        valor = json.loads(bruto) if isinstance(bruto, str) else bruto
        midia = valor if isinstance(valor, list) else [valor]
    return MensagemOut(
        id=d["id"],
        agent_id=d["agent_id"],
        role=d["role"],
        content=d.get("content") or "",
        media=midia,
        created_at=d["created_at"],
    )


@router.get("/{agent_id}", response_model=PaginaOut)
async def historico(
    agent_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=_PAGINA_INICIAL, ge=1, le=_LIMITE_MAXIMO),
    antes_de: str | None = Query(
        default=None,
        description="Timestamp ISO. Traz o que é mais antigo que isto — a paginação para trás.",
    ),
):
    """Página do histórico, do mais novo para o mais antigo.

    A ordem invertida é de propósito e vem do código herdado: para mostrar as 50
    últimas é preciso ordenar decrescente e limitar; quem inverte para exibir é a
    tela. Ordenar crescente traria as 50 **primeiras**, que é o oposto do que se
    quer ao abrir uma conversa.
    """
    condicoes = ["agent_id = $1", "user_id = $2::uuid"]
    args: list = [agent_id, usuario.id]
    corte = _instante(antes_de, "antes_de")
    if corte is not None:
        condicoes.append(f"created_at < ${len(args) + 1}")
        args.append(corte)

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM public.conversations "
            f"WHERE {' AND '.join(condicoes)} "
            f"ORDER BY created_at DESC LIMIT ${len(args) + 1}",
            *args, limite,
        )

    return PaginaOut(
        messages=[_para_saida(l) for l in linhas],
        has_more=len(linhas) == limite,
    )


@router.post("/{agent_id}", response_model=MensagemOut, status_code=status.HTTP_201_CREATED)
async def anexar(
    agent_id: str,
    dados: MensagemIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Grava uma mensagem e devolve a linha persistida.

    Devolver a linha inteira não é luxo: a tela troca a mensagem otimista pela
    persistida usando o `id` que sai daqui, e sem isso ficariam duas bolhas
    iguais na conversa.
    """
    if dados.role not in _PAPEIS:
        # O CHECK da tabela só admite user|agent. Barrar aqui dá mensagem
        # legível em vez de erro de constraint.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"role inválido. Use um de: {', '.join(sorted(_PAPEIS))}.",
        )

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.conversations (agent_id, user_id, role, content, media, created_at)
            VALUES ($1, $2::uuid, $3, $4, $5::jsonb, COALESCE($6, now()))
            RETURNING {_COLUNAS}
            """,
            agent_id, usuario.id, dados.role, dados.content,
            json.dumps(dados.media) if dados.media else None,
            _instante(dados.created_at, "created_at"),
        )
    return _para_saida(linha)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def limpar(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Apaga a conversa deste usuário com este agente.

    Não toca na sessão do gateway: são históricos separados, e limpar a tela não
    deveria fazer o agente esquecer o que conversaram. Era assim no código
    herdado — `clearConversationHistory` só mexia na tabela.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.conversations WHERE agent_id = $1 AND user_id = $2::uuid",
            agent_id, usuario.id,
        )
    logger.info("Conversa %s/%s limpa (%s)", usuario.id, agent_id, marca)
