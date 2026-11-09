"""API da página de agenda: lembretes do Guardi e eventos do Outlook (09/11/2026).

Mesma ponta que a ferramenta `agenda_*` do Guardi (`mcp_bot.py`), pelo mesmo
domínio. ⚠️ O `agent_id` sai do Guardi da pessoa e o `criado_por` é sempre
"pessoa": nenhum dos dois vem do corpo.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from app.agenda import dominio, outlook
from app.agenda.regras import FUSO, RegraInvalida, regra_de
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agenda", tags=["agenda"])

_TETO_JANELA = timedelta(days=62)  # um mês com as bordas da grade
_NAO_ACHOU = "Lembrete não encontrado."


def _iso(v):
    return v.astimezone(FUSO).isoformat() if isinstance(v, datetime) else v


def _saida(linha: dict) -> dict:
    return {k: _iso(v) for k, v in linha.items()}


def _ponto(valor: str, campo: str) -> date | datetime:
    try:
        if len(valor) == 10:
            return date.fromisoformat(valor)
        d = datetime.fromisoformat(valor)
        return d.replace(tzinfo=FUSO) if d.tzinfo is None else d.astimezone(FUSO)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"`{campo}` precisa ser AAAA-MM-DD ou data e hora ISO.") from e


def _janela(de: str | None, ate: str | None) -> tuple[datetime | None, datetime | None]:
    """`de`/`ate` em Brasília. Data pura em `ate` é inclusiva (vai até o fim do dia)."""
    d = a = None
    if de:
        p = _ponto(de, "de")
        d = datetime.combine(p, datetime.min.time(), tzinfo=FUSO) if type(p) is date else p
    if ate:
        p = _ponto(ate, "ate")
        a = datetime.combine(p, datetime.min.time(), tzinfo=FUSO) + timedelta(days=1) if type(p) is date else p
    if d and a and a <= d:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "`ate` precisa ser depois de `de`.")
    if d and a and a - d > _TETO_JANELA:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A janela pode ter no máximo 62 dias.")
    return d, a


def _uuid(id: str) -> str:
    try:
        return str(uuid.UUID(id))
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NAO_ACHOU) from e


async def _guardi(conn, usuario: Usuario) -> str:
    agente = await dominio.guardi_de(conn, usuario.id)
    if not agente:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você ainda não tem Guardi.")
    return agente


def _agora() -> datetime:
    return datetime.now(timezone.utc)


class LembreteIn(BaseModel):
    titulo: str
    quando: str | None = None
    repetir: dict | None = None
    instrucao: str | None = None


class LembretePatch(BaseModel):
    titulo: str | None = None
    quando: str | None = None
    repetir: dict | None = None
    instrucao: str | None = None
    pausado: bool | None = None


@router.get("/lembretes")
async def listar(de: str | None = None, ate: str | None = None,
                 usuario: Usuario = Depends(usuario_atual)):
    d, a = _janela(de, ate)
    async with sessao(role="service_role") as conn:
        await _guardi(conn, usuario)
        linhas = await dominio.listar(conn, usuario.id, d, a)
    return {"lembretes": [_saida(l) for l in linhas]}


@router.post("/lembretes")
async def criar(dados: LembreteIn, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        agente = await _guardi(conn, usuario)
        try:
            regra = regra_de(dados.quando or None, dados.repetir or None)
            linha = await dominio.criar(conn, usuario.id, agente, dados.titulo, regra,
                                        dados.instrucao, "pessoa", _agora())
        except RegraInvalida as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return _saida(linha)


@router.patch("/lembretes/{id}")
async def editar(id: str, dados: LembretePatch, usuario: Usuario = Depends(usuario_atual)):
    lid = _uuid(id)
    enviados = dados.model_fields_set
    campos: dict = {}
    if "titulo" in enviados:
        campos["titulo"] = dados.titulo
    if "instrucao" in enviados:
        campos["instrucao"] = dados.instrucao
    if dados.pausado is not None:
        campos["ativo"] = not dados.pausado
    async with sessao(role="service_role") as conn:
        await _guardi(conn, usuario)
        try:
            if dados.quando or dados.repetir:
                campos["regra"] = regra_de(dados.quando or None, dados.repetir or None)
            if not campos:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para mudar.")
            linha = await dominio.editar(conn, usuario.id, lid, _agora(), **campos)
        except RegraInvalida as e:
            codigo = status.HTTP_404_NOT_FOUND if str(e) == _NAO_ACHOU else status.HTTP_400_BAD_REQUEST
            raise HTTPException(codigo, str(e)) from e
    return _saida(linha)


@router.delete("/lembretes/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar(id: str, usuario: Usuario = Depends(usuario_atual)):
    lid = _uuid(id)
    async with sessao(role="service_role") as conn:
        await _guardi(conn, usuario)
        if not await dominio.apagar(conn, usuario.id, lid):
            raise HTTPException(status.HTTP_404_NOT_FOUND, _NAO_ACHOU)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/outlook")
async def agenda_outlook(de: str | None = None, ate: str | None = None,
                         usuario: Usuario = Depends(usuario_atual)):
    d, a = _janela(de, ate)
    if d is None:
        d = datetime.combine(_agora().astimezone(FUSO).date(), datetime.min.time(), tzinfo=FUSO)
    if a is None:
        a = d + timedelta(days=7)
    try:
        async with sessao(role="service_role") as conn:
            # Savepoint: erro de SQL lá dentro não pode abortar a transação da sessão.
            async with conn.transaction():
                estado, eventos = await outlook.eventos(conn, usuario.id, d, a)
    except Exception:  # noqa: BLE001
        logger.exception("agenda: Outlook falhou para %s", usuario.id)
        return {"estado": "erro", "eventos": []}
    return {"estado": estado, "eventos": [_saida(e) for e in eventos]}
