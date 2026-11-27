# backend/app/routers/encaminhar.py
"""Encaminhar mensagem, estilo WhatsApp (27/11/2026).

Spec: `docs/superpowers/specs/2026-11-27-encaminhar-mensagem-design.md`.

Tudo no servidor, numa chamada: ler a origem sob RLS, copiar os anexos para
cada destino e inserir com `encaminhada = true`. Feito no navegador, o anexo
chegava ao colega e dava 404 ao abrir — `pessoa_pode_ler` exige ser da
conversa onde o anexo nasceu.

⚠️ **Encaminhar não acorda agente.** Esta rota não chama
`startChannelAgentReplies` nem nada parecido, e o push ignora menção de texto
encaminhado (`conteudo_para_mencao`). Encaminhar não pode virar jeito de gastar
token ou de acordar o grupo inteiro sem querer.

Cada destino é independente: um que recusa (canal de avisos, DM bloqueada) vai
para `falhas` com o motivo e não derruba os outros.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import anexos as ax
from app import armazenamento as arm
from app import encaminhamento as E
from app.anexos import Anexo
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.realtime import hub, topico_canal
from app.routers.anexos import buscar_anexo, membro_do_canal
from app.routers.channels import (_COLUNAS_MSG, _VISIVEL_PARA_MIM, _msg_saida,
                                  _recusar_quem_nao_escreve, nome_de_quem_envia,
                                  traduzir_hs001)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/encaminhar", tags=["encaminhar"])

# Onde se pode encaminhar além das DMs abertas aqui: grupo e a conversa pessoal.
# DM existente com agente fica de fora — encaminhar não fala com agente.
_TIPOS_DESTINO = ("public", "private", "pessoal")


# ── formatos ────────────────────────────────────────────────────────────────

def item_copiado(anexo: Anexo, novo_id: str) -> dict:
    """O anexo copiado no formato de `channel_messages.attachments`."""
    return {"id": novo_id, "name": anexo.nome, "url": "", "size": anexo.tamanho,
            "mimeType": anexo.mime}


def media_copiada(anexo: Anexo, novo_id: str) -> dict:
    """O anexo copiado no formato do campo da conversa com agente.

    `base64` vazio + `id` = já está no servidor: o `finalizeStaged` passa adiante
    sem tentar subir de novo.
    """
    tipo = "image" if anexo.mime.startswith("image/") else "file"
    return {"type": tipo, "id": novo_id, "mimeType": anexo.mime, "base64": "",
            "name": anexo.nome, "size": anexo.tamanho, "url": ""}


def _conteudo_com_anexos(texto: str, anexos: list[dict]) -> str:
    """O "📎 nome" de mensagem só com arquivo — o mesmo de `conteudoComAnexos`."""
    if texto:
        return texto
    nomes = [a.get("name") or "arquivo" for a in anexos
             if not (a.get("mimeType") or "").startswith("image/")]
    return f"📎 {', '.join(nomes)}" if nomes else ""


# ── entrada e saída ─────────────────────────────────────────────────────────

class OrigemIn(BaseModel):
    tipo: Literal["canal", "agente"]
    id: str


class EncaminharIn(BaseModel):
    origem: OrigemIn
    pessoas: list[str] = Field(default_factory=list)
    canais: list[str] = Field(default_factory=list)
    guardi: bool = False


class Enviado(BaseModel):
    destino: str
    channel_id: str
    message_id: str


class Falha(BaseModel):
    destino: str
    motivo: str


class ParaOGuardi(BaseModel):
    agent_id: str
    autor: str
    texto: str
    anexos: list[dict]


class EncaminharOut(BaseModel):
    enviados: list[Enviado]
    falhas: list[Falha]
    guardi: ParaOGuardi | None = None


# ── origem ──────────────────────────────────────────────────────────────────

@dataclass
class _Origem:
    autor: str
    texto: str
    publicos: list[dict]
    anexos: list[Anexo]
    audio: Anexo | None = None


async def _anexos_legiveis(ids: list[str], usuario_id: str) -> list[Anexo]:
    """Só o que quem encaminha consegue abrir.

    O `attachments` é JSON escrito por quem mandou a mensagem original; um id de
    anexo de outra conversa ali dentro não pode virar cópia legível para outros.
    """
    legiveis = []
    async with sessao(role="service_role") as conn:
        for i in ids:
            a = await buscar_anexo(conn, i)
            membro = bool(a and a.contexto == "canal"
                          and await membro_do_canal(conn, a.channel_id, usuario_id, "human"))
            if a and ax.pessoa_pode_ler(a, usuario_id, membro):
                legiveis.append(a)
            else:
                logger.warning("encaminhar: anexo %s ilegível para %s — fica de fora", i, usuario_id)
    return legiveis


async def _ler_origem(o: OrigemIn, usuario: Usuario) -> _Origem:
    nao_achei = HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada.")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if o.tipo == "canal":
            try:
                linha = await conn.fetchrow(
                    f"SELECT {_COLUNAS_MSG} FROM public.channel_messages m "
                    f"WHERE m.id = $1::uuid AND m.deleted_at IS NULL AND {_VISIVEL_PARA_MIM} "
                    "  AND EXISTS (SELECT 1 FROM public.channel_members cm "
                    "               WHERE cm.channel_id = m.channel_id AND cm.user_id = $2 "
                    "                 AND cm.member_type = 'human')",
                    o.id, usuario.id,
                )
            except asyncpg.DataError:
                raise nao_achei
            if linha is None:
                raise nao_achei
            msg = _msg_saida(linha)
            publicos, ids = E.anexos_do_canal(msg.attachments)
            publicos = publicos[:E.LIMITE_ANEXOS]
            id_audio = E.audio_que_viaja(msg.audio_url, msg.author_type)
            autor, texto = msg.author_name, msg.content or ""
        else:
            try:
                linha = await conn.fetchrow(
                    "SELECT c.role, c.content, c.media, "
                    "       (SELECT ap.name FROM public.agent_profiles ap "
                    "         WHERE ap.agent_id = c.agent_id) AS agente "
                    "  FROM public.conversations c WHERE c.id = $1::uuid AND c.user_id = $2::uuid",
                    o.id, usuario.id,
                )
            except asyncpg.DataError:
                raise nao_achei
            if linha is None:
                raise nao_achei
            media = linha["media"]
            if isinstance(media, str):
                media = json.loads(media)
            if isinstance(media, dict):
                media = [media]
            ids = E.anexos_da_conversa(media, linha["role"])
            publicos, id_audio = [], None
            if linha["role"] == "agent":
                autor = linha["agente"] or "Agente"
            else:
                perfil = await conn.fetchrow(
                    "SELECT full_name FROM public.profiles WHERE id = $1::uuid", usuario.id)
                autor = nome_de_quem_envia(perfil, usuario)
            texto = linha["content"] or ""

    anexos = await _anexos_legiveis(E.ids_unicos(ids + ([id_audio] if id_audio else [])), usuario.id)
    audio = next((a for a in anexos if a.id == id_audio), None) if id_audio else None
    anexos = [a for a in anexos if a is not audio]
    if not texto and not anexos and not publicos and not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não há o que encaminhar nesta mensagem.")
    return _Origem(autor=autor, texto=texto, publicos=publicos, anexos=anexos, audio=audio)


# ── cópia ───────────────────────────────────────────────────────────────────

async def copiar_anexo(anexo: Anexo, contexto: str, alvo_id: str, usuario_id: str) -> str:
    """Copia objeto e linha para a conversa de destino; devolve o id novo.

    Cópia física porque `anexos.caminho` é UNIQUE e leva o id da conversa — e
    porque assim cada conversa fica dona do seu arquivo.
    """
    novo = str(uuid4())
    caminho = ax.caminho_do_anexo(novo, contexto, alvo_id, anexo.nome)
    await arm.copiar(arm.chave("anexos", anexo.caminho), arm.chave("anexos", caminho))
    canal = contexto == "canal"
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """
            INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_user,
                                       contexto, channel_id, agent_id, dono_conversa)
            VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8::uuid, $9, $10::uuid)
            """,
            novo, caminho, anexo.nome, anexo.mime, anexo.tamanho, usuario_id, contexto,
            alvo_id if canal else None, None if canal else alvo_id,
            None if canal else usuario_id,
        )
    return novo


# ── destinos ────────────────────────────────────────────────────────────────

async def _canal_da_pessoa(conn, pessoa_id: str) -> str:
    try:
        canal = await conn.fetchval("SELECT public.find_or_create_dm($1::uuid, '')", pessoa_id)
    except asyncpg.DataError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pessoa inválida.")
    except asyncpg.PostgresError as erro:
        traduzido = traduzir_hs001(erro)
        if traduzido is not None:
            raise traduzido from erro
        raise
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Não foi possível abrir a conversa.")
    return str(canal)


async def _conferir_canal(conn, channel_id: str, usuario_id: str) -> None:
    try:
        ok = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM public.channels c "
            "  JOIN public.channel_members m ON m.channel_id = c.id "
            " WHERE c.id = $1::uuid AND m.user_id = $2 AND m.member_type = 'human' "
            "   AND c.type::text = ANY($3::text[]))",
            channel_id, usuario_id, list(_TIPOS_DESTINO),
        )
    except asyncpg.DataError:
        ok = False
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não disponível para encaminhar.")


async def _entregar(destino: str, eh_pessoa: bool, origem: _Origem, usuario: Usuario):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if eh_pessoa:
            channel_id = await _canal_da_pessoa(conn, destino)
        else:
            channel_id = destino
            await _conferir_canal(conn, channel_id, usuario.id)
        await _recusar_quem_nao_escreve(conn, channel_id, usuario.id)

    # Fora da transação: a cópia no R2 não deve segurar conexão do banco.
    anexos = list(origem.publicos)
    for a in origem.anexos:
        anexos.append(item_copiado(a, await copiar_anexo(a, "canal", channel_id, usuario.id)))
    audio_url = None
    if origem.audio:
        audio_url = f"anexo:{await copiar_anexo(origem.audio, 'canal', channel_id, usuario.id)}"
    conteudo = _conteudo_com_anexos(origem.texto, anexos)

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        perfil = await conn.fetchrow(
            "SELECT full_name, avatar_url FROM public.profiles WHERE id = $1::uuid", usuario.id)
        nome = nome_de_quem_envia(perfil, usuario)
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.channel_messages
                (channel_id, author_id, author_type, author_name, author_avatar,
                 content, audio_url, attachments, encaminhada)
            VALUES ($1::uuid, $2, 'human', $3, $4, $5, $6, $7::text::jsonb, true)
            RETURNING {_COLUNAS_MSG.replace('m.', '')}
            """,
            channel_id, usuario.id, nome, (perfil or {}).get("avatar_url"), conteudo,
            audio_url, json.dumps(anexos) if anexos else None,
        )
        # O sininho: mesmo INSERT do `/notificar`, com a prévia marcada.
        await conn.execute(
            """
            INSERT INTO public.notifications
                (user_id, channel_id, message_id, author_name, content_preview)
            SELECT m.user_id::uuid, $1::uuid, NULL, $2, $3
              FROM public.channel_members m
             WHERE m.channel_id = $1::uuid AND m.member_type = 'human' AND m.user_id <> $4
            """,
            channel_id, nome, f"↪ {conteudo}"[:100], usuario.id,
        )
    saida = _msg_saida(linha)
    hub.publicar(topico_canal(channel_id), "mensagem", saida.model_dump())
    return Enviado(destino=destino, channel_id=channel_id, message_id=saida.id)


async def _para_o_guardi(origem: _Origem, usuario: Usuario) -> ParaOGuardi:
    async with sessao(role="service_role") as conn:
        guardi = await conn.fetchval(
            "SELECT agent_id FROM public.agent_profiles WHERE dono_id = $1::uuid LIMIT 1",
            usuario.id)
    if not guardi:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você ainda não tem Guardi.")
    copias = [media_copiada(a, await copiar_anexo(a, "conversa_agente", guardi, usuario.id))
              for a in origem.anexos + ([origem.audio] if origem.audio else [])]
    # Anexo público (GIF) não vira anexo do Guardi: entra como link no texto.
    links = "\n".join(str(p["url"]) for p in origem.publicos if p.get("url"))
    texto = "\n".join(t for t in (origem.texto, links) if t)
    return ParaOGuardi(agent_id=guardi, autor=origem.autor, texto=texto, anexos=copias)


async def _tentar(destino: str, coro, falhas: list[Falha]):
    try:
        return await coro
    except HTTPException as e:
        falhas.append(Falha(destino=destino, motivo=str(e.detail)))
    except Exception:  # noqa: BLE001 — um destino não derruba os outros
        logger.exception("encaminhar: falhou para %s", destino)
        falhas.append(Falha(destino=destino, motivo="Não foi possível encaminhar."))
    return None


# ── rotas ───────────────────────────────────────────────────────────────────

@router.post("", response_model=EncaminharOut)
async def encaminhar(dados: EncaminharIn, usuario: Usuario = Depends(usuario_atual)):
    try:
        E.conferir_destinos(dados.pessoas, dados.canais, dados.guardi, usuario.id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    origem = await _ler_origem(dados.origem, usuario)

    enviados: list[Enviado] = []
    falhas: list[Falha] = []
    for destino, eh_pessoa in [(p, True) for p in dados.pessoas] + [(c, False) for c in dados.canais]:
        r = await _tentar(destino, _entregar(destino, eh_pessoa, origem, usuario), falhas)
        if r:
            enviados.append(r)
    guardi = None
    if dados.guardi:
        guardi = await _tentar("guardi", _para_o_guardi(origem, usuario), falhas)
    logger.info("encaminhar: %s → %d enviados, %d falhas%s", usuario.id, len(enviados),
                len(falhas), ", guardi" if guardi else "")
    return EncaminharOut(enviados=enviados, falhas=falhas, guardi=guardi)


class PessoaOut(BaseModel):
    id: str
    nome: str
    avatar_url: str | None = None


class GrupoOut(BaseModel):
    id: str
    nome: str


class GuardiOut(BaseModel):
    id: str
    nome: str


class DestinosOut(BaseModel):
    guardi: GuardiOut | None = None
    pessoal: str | None = None
    grupos: list[GrupoOut]
    pessoas: list[PessoaOut]


@router.get("/destinos", response_model=DestinosOut)
async def destinos(usuario: Usuario = Depends(usuario_atual)):
    """A lista do seletor — decidida aqui, não montada no navegador."""
    async with sessao(role="service_role") as conn:
        g = await conn.fetchrow(
            "SELECT agent_id, COALESCE(NULLIF(name, ''), agent_id) AS nome "
            "  FROM public.agent_profiles WHERE dono_id = $1::uuid LIMIT 1", usuario.id)
        pessoal = await conn.fetchval(
            "SELECT id::text FROM public.channels WHERE type = 'pessoal' AND created_by = $1::uuid",
            usuario.id)
        grupos = await conn.fetch(
            """
            SELECT c.id::text AS id, c.name AS nome
              FROM public.channels c
              JOIN public.channel_members m ON m.channel_id = c.id
             WHERE m.user_id = $1 AND m.member_type = 'human'
               AND c.type::text IN ('public', 'private')
               AND public.pode_escrever_no_canal(c.id, $1)
             ORDER BY lower(c.name)
            """, usuario.id)
        pessoas = await conn.fetch(
            """
            SELECT id::text AS id, COALESCE(NULLIF(full_name, ''), email) AS nome, avatar_url
              FROM public.profiles
             WHERE status = 'active' AND id <> $1::uuid
             ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))
            """, usuario.id)
    return DestinosOut(
        guardi=GuardiOut(id=g["agent_id"], nome=g["nome"]) if g else None,
        pessoal=pessoal,
        grupos=[GrupoOut(**dict(r)) for r in grupos],
        pessoas=[PessoaOut(**dict(r)) for r in pessoas],
    )
