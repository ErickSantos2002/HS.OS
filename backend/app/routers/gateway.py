"""Endpoints do gateway.

Todo acesso ao OpenClaw passa por aqui. O navegador nunca recebe o
`admin_token` — a configuração devolve apenas a URL e um booleano `tem_token`,
que é o que a edge function `get-gateway-status` já fazia certo e o resto do
código herdado fazia errado (ver o aviso no CLAUDE.md).
"""

import json
import logging

import httpx

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
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


# ─────────────────────────────────────────────────────────────────────────────
# Monitoramento — portado de `monitoring-proxy`
# ─────────────────────────────────────────────────────────────────────────────


class MonitoramentoOut(BaseModel):
    agents: list = []
    health: dict | None = None
    cron: list = []
    usage: dict | None = None


@router.get("/monitoramento", response_model=MonitoramentoOut)
async def monitoramento(usuario: Usuario = Depends(exige_papel("super_admin"))):
    """As quatro coleções que a tela de monitoramento desenha.

    Vêm das tabelas, não do gateway: quem fala com ele é o coletor, e a tela lê
    o que ficou gravado. É o que o hook já fazia com quatro consultas do
    navegador — junta-se aqui porque a tela sempre precisa das quatro.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        agentes = await conn.fetch(
            "SELECT * FROM public.agent_stats ORDER BY collected_at DESC LIMIT 200"
        )
        saude = await conn.fetchrow(
            "SELECT * FROM public.gateway_health ORDER BY collected_at DESC LIMIT 1"
        )
        cron = await conn.fetch("SELECT * FROM public.cron_jobs ORDER BY name")
        uso = await conn.fetchrow("SELECT * FROM public.usage_daily ORDER BY date DESC LIMIT 1")

    def limpar(linha):
        # `default=str` porque são tabelas de coleta com uuid, timestamp e
        # numeric misturados — enumerar tipo a tipo de quatro tabelas que mudam
        # com o coletor não se paga.
        return json.loads(json.dumps(dict(linha), default=str))

    return MonitoramentoOut(
        agents=[limpar(l) for l in agentes],
        health=limpar(saude) if saude else None,
        cron=[limpar(l) for l in cron],
        usage=limpar(uso) if uso else None,
    )


# Caminhos REST de manutenção no gateway. ⚠️ **Os dois respondem 404 nesta
# versão** (2026.7.1-2) — conferido ao vivo. A tela já tratava isso: o botão
# avisa "não disponível" em vez de dar erro. Ficam aqui porque a alternativa
# seria apagar o botão de uma função que volta quando o gateway expuser a rota.
_MANUTENCAO = {
    "restart": ("api/monitoring/gateway/restart", 15, "Endpoint de restart não disponível no gateway."),
    "cleanup-chrome": ("api/monitoring/cleanup-chrome", 10, "Endpoint de limpeza não disponível."),
}


@router.post("/manutencao/{acao}")
async def manutencao(acao: str, _: Usuario = Depends(exige_papel("super_admin"))):
    """Reinicia o gateway ou limpa os Chrome órfãos. Só `super_admin`.

    Rota REST, não JSON-RPC: é manutenção do processo do gateway, fora do
    protocolo que os agentes usam.

    404 do gateway devolve **200 com `success: false`**, não erro. É a diferença
    entre "esta versão não tem o botão" e "o botão falhou", e a tela mostra
    mensagens diferentes para cada uma.
    """
    if acao not in _MANUTENCAO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Ação desconhecida. Use: {', '.join(sorted(_MANUTENCAO))}.",
        )
    caminho, segundos, aviso = _MANUTENCAO[acao]

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")

    base = c.url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=segundos) as cliente:
            r = await cliente.post(
                f"{base}/{caminho}",
                headers={"Authorization": f"Bearer {c.token}", "Content-Type": "application/json"},
            )
    except httpx.TimeoutException:
        return {"success": False, "error": f"O gateway não respondeu em {segundos}s."}
    except httpx.HTTPError as e:
        return {"success": False, "error": f"Não foi possível falar com o gateway: {e}"}

    if r.status_code == 404:
        return {"success": False, "error": aviso}
    if r.status_code >= 400:
        return {"success": False, "error": f"O gateway respondeu {r.status_code}.",
                "detail": r.text[:500]}
    try:
        return r.json()
    except ValueError:
        return {"success": True}
