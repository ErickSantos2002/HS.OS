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
import json
import logging
import uuid
from datetime import datetime, timezone

import anyio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app import anexos as ax
from app import armazenamento as arm
from app.anexos_escrita import montar_arquivo
from app.anexos_leitura import conteudo_legivel
from app.database import sessao
from app.dependencies import normalizar_agent_id
from app.integracoes import exige_segredo, ler_segredo
from app.relatorios import ponto
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


# ⚠️ A description NÃO promete "só desta conversa": o gateway não repassa ao MCP
# qual sessão nem qual pessoa chama (ver mcp_alerta.py, 14/08/2026). O que o
# código garante é o escopo do AGENTE — anexo de conversa com ele, ou de canal
# de que ele é membro — e, desde 13/10/2026, que a pessoa dona do anexo (ou o
# destino do envio) esteja com um turno em curso com ele. Prometer mais seria
# mentir ao próprio agente.
_FERRAMENTAS = [{
    "name": "ler_anexo",
    "description": (
        "Lê um arquivo que a pessoa anexou nesta conversa. Use o id que aparece em "
        "[anexo: … id=…]. Planilha volta por páginas de 200 linhas com o cabeçalho "
        "repetido; leia todas as páginas antes de concluir qualquer total. Só abre "
        "anexo de uma conversa com você (ou de canal em que você está): id de outra "
        "conversa é recusado, e não adianta tentar de novo. Anexo de conversa só abre "
        "enquanto a pessoa que o enviou está conversando com você agora. Use apenas ids "
        "que apareceram nesta conversa."
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
}, {
    "name": "enviar_arquivo",
    "description": (
        "Envia um arquivo para uma pessoa, que aparece como anexo na conversa dela com "
        "você e na Documentos. Você escreve TEXTO: CSV (separado por ;) para csv/xlsx, "
        "Markdown (# título, ## seção, **negrito**) para md/docx/pdf. O servidor monta "
        "o arquivo. `para` é o id da pessoa, o mesmo que aparece na sua sessão "
        "(hsos-<id>); só funciona para quem já conversa com você e está conversando com "
        "você agora."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "para": {"type": "string", "description": "Id (uuid) da pessoa que recebe."},
            "nome": {"type": "string", "description": "Nome do arquivo, sem precisar da extensão."},
            "formato": {"type": "string", "enum": ["csv", "xlsx", "md", "docx", "pdf"]},
            "conteudo": {"type": "string", "description": "CSV ou Markdown, conforme o formato."},
        },
        "required": ["para", "nome", "formato", "conteudo"],
    },
}, {
    "name": "relatorio_ponto",
    "description": (
        "Monta o controle de jornada do mês (Grupo A: A1–A6) a partir dos CSV do Flash que "
        "a pessoa anexou. Passe em `ids` os ids de 2 ou 3 anexos, em qualquer ordem: "
        "marcações (MarcacoesOriginaisJustificadas) e eventos (Eventos) são OBRIGATÓRIOS; "
        "banco de horas (BancoHoras) é opcional. Sem o de eventos não há denominador: peça "
        "o arquivo, não calcule sem ele. O servidor calcula com a régua do RH, confere o "
        "fechamento, compara com o mês anterior e envia a planilha à pessoa na conversa e "
        "na Documentos; você recebe só o resumo, sem nomes. NÃO conte eventos, batidas ou "
        "ocorrências por conta própria nem reescreva os números: repasse o resumo e diga que "
        "a planilha chegou. NUNCA publique página (publicar_pagina) com dado de ponto: os "
        "detalhes por pessoa ficam só na planilha, que é privada."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "ids": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3,
                    "description": "Os ids dos anexos (marcações, eventos e, se veio, banco de "
                                   "horas), como vieram em [anexo: … id=…]."},
        },
        "required": ["ids"],
    },
}]

# Ferramenta que só alguns agentes enxergam. A identidade vem da URL assinada,
# então esconder no `tools/list` e recusar no `tools/call` é uma fronteira de
# verdade — não depende do agente se declarar.
_FERRAMENTAS_RESTRITAS = {"relatorio_ponto": frozenset({"bruce"})}


def ferramentas_de(agent_id: str) -> list[dict]:
    return [f for f in _FERRAMENTAS
            if agent_id in _FERRAMENTAS_RESTRITAS.get(f["name"], {agent_id})]


def _resposta(ident, resultado=None, erro=None):
    corpo = {"jsonrpc": "2.0", "id": ident}
    corpo["error" if erro else "result"] = erro or resultado
    return JSONResponse(corpo)


def _texto(ident, texto: str, erro: bool = False):
    return _resposta(ident, {"content": [{"type": "text", "text": texto}], "isError": erro})


# ─────────────────────────────────────────────────────────────────────────────
# A amarra ao turno em curso — decisão do Erick, 13/10/2026
# ─────────────────────────────────────────────────────────────────────────────
#
# O gateway não diz ao MCP qual sessão nem qual pessoa chama. Sem amarra, o
# agente lia qualquer anexo de conversa com ele e enviava arquivo a qualquer
# pessoa que um dia falou com ele: um id de anexo de B que vazasse para a
# sessão de A (MEMORY.md do agente, a sessão `main`, uma delegação da nina)
# abria o arquivo de B para A — sempre. Com a amarra, só enquanto B tem um
# turno em curso com aquele agente.
#
# "Turno em curso" é um run do `/send` ainda sem `message_id` (a resposta não
# foi gravada) e criado há menos de `JANELA_TURNO_S`. A janela existe porque
# run sem `/reply` (a pessoa fechou a aba) e o run original de uma compactação
# (que aponta para o novo por `redireciona_para` e nunca recebe `message_id`)
# ficam abertos para sempre — sem teto, a amarra voltaria a ser "sempre".
JANELA_TURNO_S = 30 * 60

SQL_RUNS_RECENTES = """
    SELECT message_id, extract(epoch FROM now() - criado_em)::float AS idade_s
      FROM public.agent_runs
     WHERE regexp_replace(lower(btrim(agent_id)), '^openclaw:', '') = $1
       AND user_id = $2::uuid
       AND criado_em > now() - make_interval(secs => $3)
     ORDER BY criado_em DESC
     LIMIT 50
"""


def algum_turno_aberto(linhas) -> bool:
    """A decisão, sem banco: algum run sem resposta gravada e dentro da janela.

    A idade é conferida aqui de novo, e não só no `WHERE`, para a regra inteira
    ficar num lugar que o teste alcança."""
    return any(l["message_id"] is None and float(l["idade_s"]) < JANELA_TURNO_S
               for l in linhas)


async def turno_em_curso(conn, agent_id: str, user_id) -> bool:
    """A pessoa está conversando com este agente agora?

    ⚠️ O `agent_id` em `agent_runs` é o da URL do `/send`, gravado cru; o SQL
    normaliza a coluna como `normalizar_agent_id` normaliza o argumento.
    """
    try:
        pessoa = str(uuid.UUID(str(user_id)))
    except (ValueError, AttributeError, TypeError):
        return False
    linhas = await conn.fetch(SQL_RUNS_RECENTES, normalizar_agent_id(agent_id),
                              pessoa, float(JANELA_TURNO_S))
    return algum_turno_aberto(linhas)


_FORA_DO_TURNO_LER = ("Este anexo só pode ser lido enquanto a pessoa que o enviou está "
                      "conversando com você agora. Peça a ela para mandar a mensagem de novo.")
_FORA_DO_TURNO_ENVIAR = "Só posso enviar arquivo para quem está conversando comigo agora."


async def _ler_anexo(agent_id: str, args: dict) -> tuple[str, bool]:
    anexo_id = str(args.get("id") or "").strip()
    try:
        pagina = int(args.get("pagina") or 1)
        if pagina < 1:
            raise ValueError
    except (ValueError, TypeError):
        return "pagina deve ser um número inteiro a partir de 1.", True
    try:
        async with sessao(role="service_role") as conn:
            anexo = await buscar_anexo(conn, anexo_id)
            no_canal = bool(anexo and anexo.contexto == "canal"
                            and await membro_do_canal(conn, anexo.channel_id, agent_id, "agent"))
            pode = anexo is not None and ax.agente_pode_ler(anexo, agent_id, no_canal)
            # Canal não passa por `agent_runs`: lá vale a regra de membro, e só ela.
            no_turno = pode and (anexo.contexto != "conversa_agente"
                                 or await turno_em_curso(conn, agent_id, anexo.dono_conversa))
        if not pode:
            logger.warning("ler_anexo recusado: agente %s, anexo %s", agent_id, anexo_id)
            return ("Este anexo não pertence a uma conversa sua. Não tente de novo; "
                    "peça à pessoa para anexar o arquivo aqui."), True
        if not no_turno:
            logger.warning("ler_anexo fora do turno: agente %s, anexo %s", agent_id, anexo_id)
            return _FORA_DO_TURNO_LER, True
        dados = await arm.ler(arm.chave("anexos", anexo.caminho))
    except Exception:  # noqa: BLE001
        # Erro de banco ou de R2 não pode virar 500 cru para o gateway: o agente
        # precisa de uma resposta MCP válida. A causa fica no log.
        logger.exception("ler_anexo: falha interna (agente %s, anexo %s)", agent_id, anexo_id)
        return "Falha interna ao ler o anexo; avise o administrador.", True
    if dados is None:
        return "O arquivo deste anexo não está mais no armazenamento.", True
    try:
        # Numa thread: parsing de planilha é pesado e síncrono; no loop ele
        # travaria o worker (chat, /ws, /reply).
        texto = await anyio.to_thread.run_sync(
            lambda: conteudo_legivel(anexo.nome, anexo.mime, dados,
                                     aba=args.get("aba"), pagina=pagina))
    except Exception as e:  # noqa: BLE001
        logger.warning("ler_anexo: %s não pôde ser lido: %s", anexo.nome, e)
        return f"Não consegui ler {anexo.nome}: o arquivo parece corrompido ou protegido por senha.", True
    logger.info("ler_anexo: %s leu %s (%s)", agent_id, anexo.id, anexo.nome)
    return f"{anexo.nome}\n{texto}", False


async def _relatorio_ponto(agent_id: str, args: dict) -> tuple[str, bool]:
    ids = args.get("ids")
    if (not isinstance(ids, list) or not 2 <= len(ids) <= 3
            or not all(isinstance(i, str) and i.strip() for i in ids)):
        return ("Passe `ids` com os ids de 2 ou 3 anexos do Flash: marcações e eventos "
                "(obrigatórios) e, se veio, banco de horas."), True
    ids = [i.strip() for i in ids]
    if len(set(ids)) != len(ids):
        return ("Há id repetido. Preciso de arquivos diferentes: o CSV de marcações, o de "
                "eventos e, se veio, o de banco de horas."), True
    try:
        async with sessao(role="service_role") as conn:
            anexos = []
            for anexo_id in ids:
                anexo = await buscar_anexo(conn, anexo_id)
                # Só anexo de conversa com este agente: planilha de RH em canal
                # não é o caso de uso, e canal não tem dono a quem entregar.
                if (anexo is None or anexo.contexto != "conversa_agente"
                        or not ax.agente_pode_ler(anexo, agent_id, False)):
                    logger.warning("relatorio_ponto recusado: agente %s, anexo %s", agent_id, anexo_id)
                    return ("Este anexo não pertence a uma conversa sua. Não tente de novo; "
                            "peça à pessoa para anexar os arquivos aqui."), True
                anexos.append(anexo)
            if len({a.dono_conversa for a in anexos}) != 1:
                return "Os anexos têm que ser da mesma pessoa, na conversa com você.", True
            dono = str(anexos[0].dono_conversa)
            if not await turno_em_curso(conn, agent_id, dono):
                return _FORA_DO_TURNO_LER, True
        arquivos = []
        for anexo in anexos:
            dados = await arm.ler(arm.chave("anexos", anexo.caminho))
            if dados is None:
                return f"O arquivo {anexo.nome} não está mais no armazenamento.", True
            arquivos.append((anexo.nome, dados))
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: falha interna (agente %s)", agent_id)
        return "Falha interna ao ler os anexos; avise o administrador.", True

    try:
        # Numa thread: CSV + openpyxl são síncronos; no loop travariam o worker.
        relatorio = await anyio.to_thread.run_sync(lambda: ponto.gerar(arquivos))
    except ponto.ErroPonto as e:
        return str(e), True
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: falha ao calcular (agente %s)", agent_id)
        return "Não consegui montar a planilha com estes arquivos; avise o administrador.", True

    atual = ponto.historico(relatorio, datetime.now(timezone.utc).isoformat())
    relatorio.comparacao = await _comparar_com_o_mes_anterior(atual)

    try:
        xlsx = await anyio.to_thread.run_sync(lambda: ponto.montar_xlsx(relatorio))
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: falha ao montar o xlsx (agente %s)", agent_id)
        return "Não consegui montar a planilha com estes arquivos; avise o administrador.", True

    texto, erro = await _entregar(
        agent_id, dono, ponto.nome_do_arquivo(relatorio), xlsx,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if erro:
        return texto, True
    nota = await _gravar_historico(atual)
    logger.info("relatorio_ponto: %s montou %s para %s", agent_id, ponto.nome_do_arquivo(relatorio), dono)
    return f"{ponto.resumo(relatorio)}\n\n{texto}{nota}", False


# ─────────────────────────────────────────────────────────────────────────────
# Histórico mensal da régua de ponto — bucket `ponto-historico`, só o servidor
# ─────────────────────────────────────────────────────────────────────────────
#
# Montar e comparar é puro (`app/relatorios/ponto.py`); aqui só se lê e grava.
# Falhar aqui NÃO impede a entrega: a planilha do mês vale sozinha, e a pessoa
# fica sabendo que a comparação ou o registro não saíram.

async def _comparar_com_o_mes_anterior(atual: dict) -> "ponto.Comparacao":
    alvo = ponto.periodo_anterior(atual["periodo"])
    try:
        itens = await arm.listar(arm.chave(_BUCKET_HISTORICO, alvo) + "/", recursivo=True)
        anteriores = []
        for item in itens:
            if not item["nome"].endswith(".json"):
                continue
            dados = await arm.ler(item["chave"])
            try:
                anteriores.append(json.loads(dados or b"null"))
            except ValueError:
                logger.warning("relatorio_ponto: histórico ilegível em %s", item["chave"])
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: não consegui ler o histórico de %s", alvo)
        return ponto.Comparacao("indisponivel", alvo,
                                "Não consegui ler o histórico do mês anterior; sem comparação desta vez.")
    return ponto.comparar(atual, anteriores)


async def _gravar_historico(atual: dict) -> str:
    try:
        await arm.gravar(arm.chave(_BUCKET_HISTORICO, ponto.caminho_historico(atual)),
                         json.dumps(atual, ensure_ascii=False).encode(), "application/json")
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: não consegui gravar o histórico de %s", atual["periodo"])
        return ("\n(O histórico deste mês não foi gravado: o próximo mês sai sem comparação. "
                "Avise o administrador.)")
    return ""


_BUCKET_HISTORICO = "ponto-historico"


async def _ja_conversa(conn, agent_id: str, pessoa: str) -> bool:
    """Só se envia a quem já abriu conversa com este agente.

    Push é menos grave que pull, mas a planilha do RH mandada ao CEO por engano
    é vazamento do mesmo jeito.
    """
    try:
        uuid.UUID(str(pessoa))
    except (ValueError, AttributeError):
        return False
    return bool(await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM public.conversations "
        "WHERE agent_id = $1 AND user_id = $2::uuid AND role = 'user')",
        agent_id, pessoa,
    ))


async def _enviar_arquivo(agent_id: str, args: dict) -> tuple[str, bool]:
    para = str(args.get("para") or "").strip()
    if para.startswith("hsos-"):
        para = para[len("hsos-"):]
    try:
        # UUID aceita chaves, urn: e sem hífen; o valor cru iria para o caminho.
        para = str(uuid.UUID(para))
    except (ValueError, AttributeError):
        return "`para` deve ser o id (uuid) da pessoa, como aparece em hsos-<id>.", True
    try:
        # Destino primeiro: montar PDF de 2M caracteres para quem nem pode receber
        # seria trabalho (e thread) jogados fora.
        async with sessao(role="service_role") as conn:
            if not await _ja_conversa(conn, agent_id, para):
                return ("Só posso enviar arquivo para quem já conversa com você. "
                        "Não tente outro destino; responda na conversa em curso."), True
            if not await turno_em_curso(conn, agent_id, para):
                logger.warning("enviar_arquivo fora do turno: agente %s, destino %s", agent_id, para)
                return _FORA_DO_TURNO_ENVIAR, True
    except Exception:  # noqa: BLE001
        logger.exception("enviar_arquivo: falha interna (agente %s, destino %s)", agent_id, para)
        return "Falha interna ao enviar o arquivo; avise o administrador.", True
    try:
        # Numa thread: reportlab/docx/openpyxl são síncronos e pesados; no
        # loop travariam o worker (chat, /ws, /reply).
        dados, mime, nome = await anyio.to_thread.run_sync(
            lambda: montar_arquivo(str(args.get("formato") or ""),
                                   str(args.get("nome") or ""), str(args.get("conteudo") or "")))
    except ValueError as e:
        return str(e), True
    except Exception:  # noqa: BLE001
        # Ex.: caractere de controle no CSV → IllegalCharacterError do openpyxl.
        # Sem isto o gateway recebe 500 cru, e erro repetido pausa o servidor MCP.
        logger.exception("enviar_arquivo: falha ao montar (agente %s, destino %s)", agent_id, para)
        return "Falha interna ao enviar o arquivo; avise o administrador.", True
    return await _entregar(agent_id, para, nome, dados, mime)


async def _entregar(agent_id: str, para: str, nome: str, dados: bytes, mime: str) -> tuple[str, bool]:
    """Grava o arquivo como anexo da conversa com `para` e na Documentos dele.

    Quem chama já conferiu o destino. Usada pelo `enviar_arquivo` e pelo
    `relatorio_ponto`: as duas entregas têm que ser idênticas, senão uma delas
    aparece na conversa e some da Documentos (ou o contrário).
    """
    anexo_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    gravados: list[str] = []
    try:
        caminho = ax.caminho_do_anexo(anexo_id, "conversa_agente", agent_id, nome)
        ext = nome.rsplit(".", 1)[-1]
        caminho_doc = f"{para}/{doc_id}.{ext}"
        chave_anexo = arm.chave("anexos", caminho)
        chave_doc = arm.chave("generated-documents", caminho_doc)
        mime = ax.mime_normalizado(mime)
        gravados.append(chave_anexo)
        await arm.gravar(chave_anexo, dados, mime)
        gravados.append(chave_doc)
        await arm.gravar(chave_doc, dados, mime)

        media = [{"type": "file", "id": anexo_id, "name": nome, "size": len(dados),
                  "mimeType": mime, "url": "", "base64": ""}]
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """
                INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_agent,
                                           contexto, agent_id, dono_conversa)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, 'conversa_agente', $6, $7::uuid)
                """,
                anexo_id, caminho, nome, mime, len(dados), agent_id, para,
            )
            await conn.execute(
                """
                INSERT INTO public.generated_documents
                    (id, user_id, agent_id, title, doc_type, storage_path, size_bytes)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
                """,
                doc_id, para, agent_id, nome, ext, caminho_doc, len(dados),
            )
            await conn.execute(
                """
                INSERT INTO public.conversations (agent_id, user_id, role, content, media)
                VALUES ($1, $2::uuid, 'agent', $3, $4::text::jsonb)
                """,
                agent_id, para, f"📎 {nome}", json.dumps(media),
            )
    except Exception:  # noqa: BLE001
        logger.exception("enviar_arquivo: falha interna (agente %s, destino %s)", agent_id, para)
        # Sem linha no banco o objeto no R2 é órfão: recolhe o que já subiu.
        for chave in gravados:
            try:
                await arm.apagar(chave)
            except Exception:  # noqa: BLE001
                logger.exception("enviar_arquivo: não consegui recolher %s", chave)
        return "Falha interna ao enviar o arquivo; avise o administrador.", True

    # ⚠️ Sem hub.publicar aqui: a entrega ao vivo vem do trigger de `conversations`
    # (003_realtime.sql -> escuta_banco.py), que o ChatPage já assina em
    # `usuario:<id>` filtrando tabela === "conversations". O tipo "resposta-agente"
    # não tem consumidor no front.
    logger.info("enviar_arquivo: %s enviou %s (%d bytes) a %s", agent_id, nome, len(dados), para)
    return (f"Enviado: {nome} ({ax.tamanho_legivel(len(dados))}). Aparece como anexo na conversa "
            "e na Documentos — diga isso à pessoa."), False


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
    if not isinstance(corpo, dict):
        return _resposta(None, erro={"code": -32600, "message": "Requisição inválida: esperado um objeto."})
    metodo, ident, params = corpo.get("method"), corpo.get("id"), corpo.get("params") or {}

    if ident is None:
        return JSONResponse({}, status_code=status.HTTP_202_ACCEPTED)
    if metodo == "initialize":
        return _resposta(ident, {"protocolVersion": _PROTOCOLO, "capabilities": {"tools": {}},
                                 "serverInfo": {"name": "hsos-anexos", "version": "1.0.0"}})
    if metodo == "tools/list":
        return _resposta(ident, {"tools": ferramentas_de(agent_id)})
    if metodo == "tools/call":
        nome, args = params.get("name"), params.get("arguments") or {}
        if nome not in {f["name"] for f in ferramentas_de(agent_id)}:
            return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
        if nome == "ler_anexo":
            texto, erro = await _ler_anexo(agent_id, args)
            return _texto(ident, texto, erro)
        if nome == "enviar_arquivo":
            texto, erro = await _enviar_arquivo(agent_id, args)
            return _texto(ident, texto, erro)
        if nome == "relatorio_ponto":
            texto, erro = await _relatorio_ponto(agent_id, args)
            return _texto(ident, texto, erro)
        return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
    return _resposta(ident, erro={"code": -32601, "message": f"Método não suportado: {metodo}"})
