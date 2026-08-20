"""Relatórios que o agente gera — hoje só o de vendedores do HSGrowth.

O Erick vinha rodando `~/projetos/relatorios-hsgrowth/vendedores.py` na mão e
mandando a planilha por WhatsApp. Aqui ela vira duas coisas: um endpoint para a
tela e uma ferramenta MCP para o `atlas`, que é quem responde por funil.

⚠️ **A régua de negócio NÃO mora aqui.** `app/relatorios/vendedores.py` é cópia
fiel do script do Erick; este arquivo só resolve conexão, armazenamento e
permissão. Mudança de régua acontece lá primeiro — ver o cabeçalho de lá.

⚠️ **O arquivo vai para o bucket PRIVADO**, no mesmo caminho de PDF e DOCX:
`generated-documents/<usuário>/<id>.xlsx`, com registro em
`generated_documents`. A planilha traz card a card com nome de cliente, valor e
link; não é coisa para URL que qualquer um abre.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.integracoes import exige_segredo
from app.relatorios import vendedores as gerador
from app.routers.integracoes import _url_do_banco
from app.routers.storage import _resolver

logger = logging.getLogger(__name__)
router = APIRouter(tags=["relatorios"])

_MIN_DIAS, _MAX_DIAS = 1, 365


class RelatorioOut(BaseModel):
    documento_id: str
    nome: str
    dias: int
    vendedores: int
    cards_parados: int
    tamanho_bytes: int


async def _dsn_hsgrowth(conn) -> str:
    """Conexão de leitura do HSGrowth, tirada do conector cadastrado.

    ⚠️ **Não é variável de ambiente, de propósito.** A credencial já está em
    `integrations`, mantida pela tela de Conectores — duplicá-la no `.env` criaria
    dois lugares para trocar a senha e um deles ficaria para trás.
    """
    linha = await conn.fetchrow(
        "SELECT * FROM public.integrations WHERE key_name = 'HSGROWTH_DB' LIMIT 1"
    )
    if linha is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "O conector do HSGrowth não está cadastrado em Conectores.",
        )
    cred = linha["credentials"]
    return _url_do_banco(linha, json.loads(cred) if isinstance(cred, str) else cred, True)


async def _gerar_e_guardar(dono_id: str, dias: int, agente: str | None) -> RelatorioOut:
    """Roda o relatório e grava como documento do `dono_id`."""
    if not _MIN_DIAS <= dias <= _MAX_DIAS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"`dias` precisa estar entre {_MIN_DIAS} e {_MAX_DIAS}.",
        )

    async with sessao(role="service_role") as conn:
        dsn = await _dsn_hsgrowth(conn)

    try:
        # ⚠️ Roda numa thread: `gerar` usa psycopg síncrono e openpyxl, e segurar
        # o loop por dezenas de segundos travaria todo mundo — inclusive a espera
        # da resposta de quem estiver conversando com outro agente.
        import anyio
        dados, nome, resumo = await anyio.to_thread.run_sync(gerador.gerar, dsn, dias)
    except Exception as e:  # noqa: BLE001
        logger.warning("Relatório de vendedores falhou: %s", e)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Não consegui montar a planilha: {e}"
        )

    doc_id = str(uuid4())
    caminho = f"{dono_id}/{doc_id}.xlsx"
    destino = _resolver("generated-documents", caminho)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(dados)

    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """
                INSERT INTO public.generated_documents
                    (id, user_id, agent_id, title, doc_type, storage_path, size_bytes)
                VALUES ($1::uuid, $2::uuid, $3, $4, 'xlsx', $5, $6)
                """,
                doc_id, dono_id, agente,
                f"Vendedores — últimos {dias} dias ({resumo['data']})",
                caminho, len(dados),
            )
    except Exception:
        # Arquivo órfão em disco não aparece em lugar nenhum e ocupa espaço para
        # sempre — mesma decisão do `gerar_documento`.
        destino.unlink(missing_ok=True)
        raise

    logger.info("Relatório de vendedores (%dd) gerado para %s por %s — %d bytes",
                dias, dono_id, agente or "tela", len(dados))
    return RelatorioOut(documento_id=doc_id, nome=nome, dias=dias,
                        vendedores=resumo["vendedores"],
                        cards_parados=resumo["cards_parados"],
                        tamanho_bytes=len(dados))


@router.post("/relatorios/vendedores", response_model=RelatorioOut,
             status_code=status.HTTP_201_CREATED)
async def vendedores(
    dias: int = Query(default=gerador.DIAS_PADRAO, description="Janela em dias."),
    usuario: Usuario = Depends(usuario_atual),
):
    """Gera a planilha de vendedores e guarda como documento meu."""
    return await _gerar_e_guardar(usuario.id, dias, None)


# ─────────────────────────────────────────────────────────────────────────────
# A mesma coisa, para o agente
# ─────────────────────────────────────────────────────────────────────────────

_FERRAMENTAS = [{
    "name": "publicar_pagina",
    "description": (
        "Publica uma página HTML e devolve um LINK que qualquer pessoa abre, sem "
        "login. Use quando pedirem um relatório para MANDAR a alguém — vendedor, "
        "SDR, time de serviços — que não usa o HS.OS. NÃO escreva o arquivo no "
        "seu workspace: o caminho do seu disco não é alcançável por ninguém."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "titulo": {"type": "string", "description": "Nome da página, curto."},
            "html": {"type": "string",
                     "description": "O HTML completo. É servido como está — o "
                                    "estilo vai dentro dele."},
            "solicitante": {"type": "string",
                            "description": "Id de quem pediu: o `hsos-<id>` da sua "
                                           "chave de sessão, sem o prefixo."},
            "dias_de_validade": {"type": "integer",
                                 "description": "Opcional. Depois disso o link diz "
                                                "'expirado'. Sem isso, não expira."},
        },
        "required": ["titulo", "html"],
    },
}, {
    "name": "relatorio_vendedores",
    "description": (
        "Gera a planilha de vendedores do HSGrowth (esforço, cards travados e "
        "negócios ganhos) e a guarda em Documentos, no nome de quem pediu. "
        "Devolve o nome do arquivo e os números do resumo. É a MESMA régua que o "
        "Erick usa — não recalcule nada por conta própria."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "dias": {"type": "integer",
                     "description": "Janela em dias. O padrão é 30, que é o que se usa."},
            "solicitante": {"type": "string",
                            "description": "Id da pessoa que pediu, o `hsos-<id>` da sua "
                                           "chave de sessão sem o prefixo. Sem ele o "
                                           "arquivo fica no nome do administrador."},
        },
        "required": [],
    },
}]


def _resposta(ident, resultado=None, erro=None):
    corpo = {"jsonrpc": "2.0", "id": ident}
    corpo["error"] = erro if erro else None
    if erro is None:
        corpo["result"] = resultado
        del corpo["error"]
    return corpo


async def _dono_do_pedido(conn, solicitante: str | None) -> str | None:
    """Quem fica como dono do que o agente publicou.

    Sem `solicitante` válido, cai no administrador — o mesmo desenho do
    `/mcp/wiki`. Um cron não tem pessoa pedindo, e artefato sem dono não
    aparece em lugar nenhum.
    """
    pedido = (solicitante or "").strip()
    if pedido:
        dono = await conn.fetchval(
            "SELECT id::text FROM public.profiles WHERE id = $1::uuid", pedido)
        if dono:
            return dono
    return await conn.fetchval(
        "SELECT p.id::text FROM public.profiles p "
        "  JOIN public.user_roles r ON r.user_id = p.id "
        " WHERE r.role = 'administrador' ORDER BY p.created_at LIMIT 1")


async def _publicar_pagina(ident, args: dict):
    """Publica o HTML e devolve o link público.

    ⚠️ **Isto existe porque o agente não tinha como entregar arquivo.** Em
    20/08/2026 o CEO pediu três vezes um relatório para mandar aos vendedores, e
    recebeu três vezes um caminho do disco da VPS do gateway
    (`MEDIA:/root/.openclaw/workspace-atlas/…`), com o agente afirmando que havia
    anexado. Ninguém alcança aquele caminho, e a tela não renderiza `MEDIA:`.

    O destino certo já existia: `artifacts_published` + a rota pública
    `/artifact/:id`. Os vendedores **não são usuários do HS.OS** — só três
    pessoas têm login — então salvar em Documentos não os alcançaria.

    ⚠️ **O link é público para quem o tiver.** O id é um UUID que não se
    adivinha, mas não há senha: quem receber, abre. Para relatório com nome de
    cliente e valor, use `dias_de_validade`.
    """
    titulo = str(args.get("titulo") or "").strip()
    html = str(args.get("html") or "").strip()
    if not titulo or not html:
        return _resposta(ident, {"content": [{"type": "text",
            "text": "Preciso de `titulo` e `html` para publicar."}], "isError": True})

    dias = args.get("dias_de_validade")
    expira = None
    if isinstance(dias, int) and dias > 0:
        expira = datetime.now(timezone.utc) + timedelta(days=dias)

    async with sessao(role="service_role") as conn:
        dono = await _dono_do_pedido(conn, args.get("solicitante"))
        if not dono:
            return _resposta(ident, {"content": [{"type": "text",
                "text": "Não há administrador cadastrado para ficar como dono."}],
                "isError": True})

        # Mesmo HTML já publicado por essa pessoa devolve o link que existe. É a
        # regra que o `POST /artefatos/publicados` já usa: republicar duas vezes
        # deixaria dois links vivos para a mesma coisa, e o primeiro — que já
        # pode ter sido enviado — viraria órfão em silêncio.
        linha = await conn.fetchrow(
            "SELECT id::text AS id FROM public.artifacts_published "
            " WHERE created_by = $1::uuid AND html_content = $2 "
            " ORDER BY created_at DESC LIMIT 1", dono, html)
        reaproveitado = linha is not None
        if not linha:
            linha = await conn.fetchrow(
                """
                INSERT INTO public.artifacts_published
                    (title, html_content, created_by, is_public, expires_at)
                VALUES ($1, $2, $3::uuid, true, $4)
                RETURNING id::text AS id
                """, titulo, html, dono, expira)

    base = (settings.FRONTEND_URL or "").split(",")[0].strip().rstrip("/")
    url = f"{base}/artifact/{linha['id']}"
    logger.info("Página publicada %s (%s) para %s%s",
                linha["id"], titulo, dono, " [reaproveitada]" if reaproveitado else "")

    validade = (f"\n\nO link expira em {dias} dia(s)." if expira else
                "\n\nO link não expira. Quem tiver o endereço abre — não mande "
                "para fora de quem deve ver.")
    return _resposta(ident, {"content": [{"type": "text",
        "text": f"**{titulo}** publicado.\n\n{url}\n\n"
                f"Qualquer pessoa abre esse link, sem login.{validade}"}]})


@router.post("/mcp/relatorios")
async def mcp_relatorios(
    request: Request,
    corpo: dict = Body(...),
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Servidor MCP com o relatório de vendedores.

    ⚠️ **Só o `atlas` deveria enxergar isto.** O corte é feito na configuração do
    gateway (`tools.deny` por agente), não aqui — é onde os outros conectores já
    são cortados, e ter duas travas em lugares diferentes acaba com uma delas
    desatualizada.
    """
    metodo = corpo.get("method")
    ident = corpo.get("id")

    if metodo == "initialize":
        return _resposta(ident, {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "hsos-relatorios", "version": "1.0.0"},
        })
    if metodo == "tools/list":
        return _resposta(ident, {"tools": _FERRAMENTAS})
    if metodo != "tools/call":
        return _resposta(ident, erro={"code": -32601, "message": f"método {metodo}"})

    args = (corpo.get("params") or {}).get("arguments") or {}
    nome = (corpo.get("params") or {}).get("name")

    if nome == "publicar_pagina":
        return await _publicar_pagina(ident, args)

    if nome != "relatorio_vendedores":
        return _resposta(ident, erro={"code": -32602, "message": "ferramenta desconhecida"})

    dias = int(args.get("dias") or gerador.DIAS_PADRAO)
    async with sessao(role="service_role") as conn:
        dono = None
        pedido = (args.get("solicitante") or "").strip()
        if pedido:
            dono = await conn.fetchval(
                "SELECT id::text FROM public.profiles WHERE id = $1::uuid", pedido
            )
        if not dono:
            dono = await conn.fetchval(
                "SELECT p.id::text FROM public.profiles p "
                " JOIN public.user_roles r ON r.user_id = p.id "
                " WHERE r.role = 'administrador' ORDER BY p.created_at LIMIT 1"
            )
    if not dono:
        return _resposta(ident, {"content": [{"type": "text",
            "text": "Não há administrador cadastrado para guardar o arquivo."}],
            "isError": True})

    try:
        r = await _gerar_e_guardar(dono, dias, "atlas")
    except HTTPException as e:
        return _resposta(ident, {"content": [{"type": "text",
            "text": f"Não consegui gerar: {e.detail}"}], "isError": True})

    texto = (f"Planilha **{r.nome}** pronta e guardada em Documentos.\n\n"
             f"- {r.vendedores} vendedores na janela de {r.dias} dias\n"
             f"- {r.cards_parados} cards parados no total\n"
             f"- {r.tamanho_bytes // 1024} KB\n\n"
             "Ela está em **Documentos**, no HS.OS — não é link público.")
    return _resposta(ident, {"content": [{"type": "text", "text": texto}]})
