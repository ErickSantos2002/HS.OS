"""Endpoints do gateway.

Todo acesso ao OpenClaw passa por aqui. O navegador nunca recebe o
`admin_token` — a configuração devolve apenas a URL e um booleano `tem_token`,
que é o que a edge function `get-gateway-status` já fazia certo e o resto do
código herdado fazia errado (ver o aviso no CLAUDE.md).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente
from app.dependencies import Usuario, exige_papel, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gateway", tags=["gateway"])


class ConfigOut(BaseModel):
    url: str
    tem_token: bool
    configurado: bool
    #: Quando true, o valor vem do `.env` do servidor e gravar não muda nada.
    fixado_por_env: bool = False


class ConfigIn(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    # Ausente = mantém o token atual. A tela nunca recebe o valor, então não
    # teria como devolvê-lo ao editar só a URL.
    token: str | None = Field(default=None, max_length=500)


class StatusOut(BaseModel):
    conectado: bool
    versao: str | None = None
    protocolo: int | None = None
    scopes: list[str] = []
    erro: str | None = None


async def _cliente():
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Gateway não configurado. Acesse Configurações → Gateway e informe URL e token.",
        )
    return obter_cliente(c.url, c.token)


@router.get("/config", response_model=ConfigOut)
async def ler_config(_: Usuario = Depends(exige_papel("super_admin"))):
    c = await cfg.carregar()
    return ConfigOut(url=c.url, tem_token=bool(c.token), configurado=c.configurado,
                     fixado_por_env=c.fixado_por_env)


@router.put("/config", response_model=ConfigOut)
async def gravar_config(
    dados: ConfigIn,
    _: Usuario = Depends(exige_papel("super_admin")),
):
    await cfg.gravar(dados.url, dados.token)
    c = await cfg.carregar()
    return ConfigOut(url=c.url, tem_token=bool(c.token), configurado=c.configurado,
                     fixado_por_env=c.fixado_por_env)


@router.get("/status", response_model=StatusOut)
async def status_gateway(_: Usuario = Depends(exige_papel("super_admin"))):
    """Não levanta erro quando o gateway está fora: a tela precisa mostrar
    'desconectado' com o motivo, não uma página de erro."""
    c = await cfg.carregar()
    if not c.configurado:
        return StatusOut(conectado=False, erro="Gateway não configurado.")
    try:
        cliente = obter_cliente(c.url, c.token)
        await cliente.chamar("sessions.list", {"limit": 1})
        info = cliente.info_servidor
        return StatusOut(
            conectado=True,
            versao=(info.get("server") or {}).get("version"),
            protocolo=info.get("protocol"),
            scopes=(info.get("auth") or {}).get("scopes") or [],
        )
    except ErroGateway as e:
        return StatusOut(conectado=False, erro=str(e))


@router.get("/models")
async def listar_modelos(_: Usuario = Depends(usuario_atual)):
    cliente = await _cliente()
    try:
        return await cliente.chamar("models.list", {"view": "configured"})
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


@router.get("/agents")
async def listar_agentes(_: Usuario = Depends(usuario_atual)):
    """Só os agentes vivos no gateway. A junção com `agent_profiles` (metadados
    e controle de acesso) fica no router de agentes, no Lote 2."""
    cliente = await _cliente()
    try:
        return await cliente.chamar("agents.list")
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


@router.get("/sessions")
async def listar_sessoes(
    limit: int = 50,
    _: Usuario = Depends(exige_papel("super_admin", "member")),
):
    cliente = await _cliente()
    try:
        return await cliente.chamar("sessions.list", {"limit": limit})
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
