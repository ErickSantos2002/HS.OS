# backend/app/routers/anexos.py
"""Anexo de conversa: envio e leitura pela pessoa.

O agente lê por outra porta (`mcp_anexos.py`), com outra identidade; as duas
usam a mesma regra, de `app/anexos.py`.
"""
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app import anexos as ax
from app import armazenamento as arm
from app.database import sessao
from app.dependencies import Usuario, normalizar_agent_id, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/anexos", tags=["anexos"])

_URL_S = 300


class AnexoOut(BaseModel):
    id: str
    name: str
    size: int
    mimeType: str
    url: str = ""


class UrlOut(BaseModel):
    url: str
    expira_em: int


async def buscar_anexo(conn, anexo_id: str) -> ax.Anexo | None:
    # Valida o formato ANTES de consultar e deixa o resto propagar: engolir
    # `Exception` aqui transformava banco fora ou 017 não aplicada em 404
    # "Anexo não encontrado", o diagnóstico enganoso de 18/09.
    try:
        UUID(anexo_id)
    except (ValueError, AttributeError, TypeError):
        return None
    linha = await conn.fetchrow(ax.SQL_ANEXO, anexo_id)
    return ax.Anexo.de_linha(linha) if linha else None


async def membro_do_canal(conn, channel_id: str, membro_id: str, tipo: str) -> bool:
    return bool(await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM public.channel_members "
        "WHERE channel_id = $1::uuid AND user_id = $2 AND member_type = $3)",
        channel_id, membro_id, tipo,
    ))


async def _pode_ver_agente(conn, usuario_id: str, agent_id: str) -> bool:
    return bool(await conn.fetchval(
        "SELECT public.pode_ver_agente($1::uuid, $2)", usuario_id, agent_id
    ))


async def iniciar_anexo(dados, usuario: Usuario):
    """Autoriza o envio de um anexo. Chamado por `POST /storage/upload/iniciar`."""
    from app.routers.storage import InicioOut, _PUT_S, _validar_tamanho, emitir_ticket

    _validar_tamanho(dados.tamanho)
    if not (dados.nome or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta o nome do arquivo.")

    async with sessao(role="service_role") as conn:
        if dados.contexto == "canal" and dados.channel_id:
            try:
                UUID(dados.channel_id)
            except ValueError:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "channel_id inválido.")
            alvo = dados.channel_id
            pode = await membro_do_canal(conn, alvo, usuario.id, "human")
        elif dados.contexto == "conversa_agente" and dados.agent_id:
            alvo = normalizar_agent_id(dados.agent_id)
            # `pode_ver_agente` libera id sem perfil (regra de exibição); para
            # anexar, o agente tem que existir.
            if not await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM public.agent_profiles WHERE agent_id = $1)", alvo):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")
            pode = await _pode_ver_agente(conn, usuario.id, alvo)
        else:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Anexo precisa de contexto: canal (channel_id) ou conversa_agente (agent_id).")
    if not pode:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não participa desta conversa.")

    mime = ax.mime_normalizado(dados.mime)
    anexo_id = str(uuid4())
    caminho = ax.caminho_do_anexo(anexo_id, dados.contexto, alvo, dados.nome)
    k = arm.chave("anexos", caminho)
    url = await arm.url_put(k, mime, dados.tamanho, _PUT_S)
    ticket = emitir_ticket({
        "bucket": "anexos", "caminho": caminho, "tamanho": dados.tamanho, "mime": mime,
        "anexo_id": anexo_id, "nome": dados.nome.strip()[:200], "contexto": dados.contexto,
        "alvo": alvo,
    }, usuario.id)
    return InicioOut(url_put=url, ticket=ticket, expira_em=_PUT_S)


async def concluir_anexo(t: dict, usuario: Usuario) -> AnexoOut:
    """Confere o objeto no R2 e só então grava a linha — anexo sem arquivo não existe."""
    from app.routers.storage import _conferir_conclusao

    k = arm.chave("anexos", t["caminho"])
    obj = await arm.cabecalho(k)
    try:
        _conferir_conclusao(obj, int(t["tamanho"]))
    except HTTPException:
        if obj is not None:
            await arm.apagar(k)
        raise
    canal = t["contexto"] == "canal"
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """
                INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_user,
                                           contexto, channel_id, agent_id, dono_conversa)
                VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8::uuid, $9, $10::uuid)
                ON CONFLICT (caminho) DO NOTHING
                """,
                t["anexo_id"], t["caminho"], t["nome"], t["mime"], obj.tamanho, usuario.id,
                t["contexto"], t["alvo"] if canal else None,
                None if canal else t["alvo"], None if canal else usuario.id,
            )
    except Exception:
        await arm.apagar(k)
        raise
    logger.info("Anexo %s (%s, %d bytes) de %s em %s/%s", t["anexo_id"], t["nome"],
                obj.tamanho, usuario.id, t["contexto"], t["alvo"])
    return AnexoOut(id=t["anexo_id"], name=t["nome"], size=obj.tamanho, mimeType=t["mime"])


@router.get("/{anexo_id}/url", response_model=UrlOut)
async def url_do_anexo(anexo_id: str, usuario: Usuario = Depends(usuario_atual)):
    """URL assinada de 5 min, se a pessoa participa da conversa.

    404 para quem não pode — igual às outras portas privadas: quem não
    participa também não deveria descobrir que o anexo existe.
    """
    async with sessao(role="service_role") as conn:
        anexo = await buscar_anexo(conn, anexo_id)
        membro = bool(anexo and anexo.contexto == "canal"
                      and await membro_do_canal(conn, anexo.channel_id, usuario.id, "human"))
    if anexo is None or not ax.pessoa_pode_ler(anexo, usuario.id, membro):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
    url = await arm.url_get(arm.chave("anexos", anexo.caminho), _URL_S, nome_download=anexo.nome,
                          inline=ax.exibe_inline(anexo.mime))
    return UrlOut(url=url, expira_em=_URL_S)
