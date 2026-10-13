# backend/app/routers/mcp_anexos.py
"""Servidor MCP `hsos-anexos` — o agente lê (e, na Task 11, envia) anexo.

⚠️ **A identidade vem da URL, não do argumento.** Cada agente tem no gateway
uma entrada própria (`hsos-anexos-<id>`) cuja URL termina em
`/<agentId>/<HMAC(ANEXOS_MCP_SEGREDO, agentId)>`. O servidor recalcula; não
bateu, 404 — sem confirmar que a rota existe. É o que separa este servidor
dos outros três, que confiam no `agente` que o próprio agente declara.

O `GUARDRAILS_API_TOKEN` continua exigido, como nos outros: a URL sozinha,
vazada num log, não abre nada.
"""
import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app import anexos as ax
from app import armazenamento as arm
from app.anexos_leitura import conteudo_legivel
from app.database import sessao
from app.dependencies import normalizar_agent_id
from app.integracoes import exige_segredo, ler_segredo
from app.routers.anexos import buscar_anexo, membro_do_canal

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mcp", tags=["mcp"])

_PROTOCOLO = "2024-11-05"


def assinatura_do_agente(segredo: str, agent_id: str) -> str:
    return hmac.new(segredo.encode(), normalizar_agent_id(agent_id).encode(), hashlib.sha256).hexdigest()


def assinatura_confere(segredo: str, agent_id: str, assinatura: str) -> bool:
    if not segredo:
        return False
    return hmac.compare_digest(assinatura_do_agente(segredo, agent_id), assinatura or "")


_FERRAMENTAS = [{
    "name": "ler_anexo",
    "description": (
        "Lê um arquivo que a pessoa anexou nesta conversa. Use o id que aparece em "
        "[anexo: … id=…]. Planilha volta por páginas de 200 linhas com o cabeçalho "
        "repetido; leia todas as páginas antes de concluir qualquer total. Só abre "
        "anexo desta conversa: id de outra conversa é recusado, e não adianta tentar de novo."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "O id do anexo, como veio em [anexo: … id=…]."},
            "aba": {"type": "string", "description": "Nome da aba (planilha). Omita para a primeira."},
            "pagina": {"type": "integer", "minimum": 1, "description": "Página, a partir de 1."},
        },
        "required": ["id"],
    },
}]


def _resposta(ident, resultado=None, erro=None):
    corpo = {"jsonrpc": "2.0", "id": ident}
    corpo["error" if erro else "result"] = erro or resultado
    return JSONResponse(corpo)


def _texto(ident, texto: str, erro: bool = False):
    return _resposta(ident, {"content": [{"type": "text", "text": texto}], "isError": erro})


async def _ler_anexo(agent_id: str, args: dict) -> tuple[str, bool]:
    anexo_id = str(args.get("id") or "").strip()
    try:
        async with sessao(role="service_role") as conn:
            anexo = await buscar_anexo(conn, anexo_id)
            no_canal = bool(anexo and anexo.contexto == "canal"
                            and await membro_do_canal(conn, anexo.channel_id, agent_id, "agent"))
        if anexo is None or not ax.agente_pode_ler(anexo, agent_id, no_canal):
            logger.warning("ler_anexo recusado: agente %s, anexo %s", agent_id, anexo_id)
            return ("Este anexo não pertence a uma conversa sua. Não tente de novo; "
                    "peça à pessoa para anexar o arquivo aqui."), True
        dados = await arm.ler(arm.chave("anexos", anexo.caminho))
    except Exception:  # noqa: BLE001
        # Erro de banco ou de R2 não pode virar 500 cru para o gateway: o agente
        # precisa de uma resposta MCP válida. A causa fica no log.
        logger.exception("ler_anexo: falha interna (agente %s, anexo %s)", agent_id, anexo_id)
        return "Falha interna ao ler o anexo; avise o administrador.", True
    if dados is None:
        return "O arquivo deste anexo não está mais no armazenamento.", True
    try:
        texto = conteudo_legivel(anexo.nome, anexo.mime, dados,
                                 aba=args.get("aba"), pagina=int(args.get("pagina") or 1))
    except Exception as e:  # noqa: BLE001
        logger.warning("ler_anexo: %s não pôde ser lido: %s", anexo.nome, e)
        return f"Não consegui ler {anexo.nome}: o arquivo parece corrompido ou protegido por senha.", True
    logger.info("ler_anexo: %s leu %s (%s)", agent_id, anexo.id, anexo.nome)
    return f"{anexo.nome}\n{texto}", False


@router.post("/anexos/{agent_id}/{assinatura}")
async def mcp_anexos(agent_id: str, assinatura: str, request: Request,
                     _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN"))):
    segredo = await ler_segredo("ANEXOS_MCP_SEGREDO") or ""
    if not assinatura_confere(segredo, agent_id, assinatura):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    agent_id = normalizar_agent_id(agent_id)

    try:
        corpo = await request.json()
    except Exception:
        return _resposta(None, erro={"code": -32700, "message": "JSON inválido."})
    metodo, ident, params = corpo.get("method"), corpo.get("id"), corpo.get("params") or {}

    if ident is None:
        return JSONResponse({}, status_code=status.HTTP_202_ACCEPTED)
    if metodo == "initialize":
        return _resposta(ident, {"protocolVersion": _PROTOCOLO, "capabilities": {"tools": {}},
                                 "serverInfo": {"name": "hsos-anexos", "version": "1.0.0"}})
    if metodo == "tools/list":
        return _resposta(ident, {"tools": _FERRAMENTAS})
    if metodo == "tools/call":
        nome, args = params.get("name"), params.get("arguments") or {}
        if nome == "ler_anexo":
            texto, erro = await _ler_anexo(agent_id, args)
            return _texto(ident, texto, erro)
        return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
    return _resposta(ident, erro={"code": -32601, "message": f"Método não suportado: {metodo}"})
