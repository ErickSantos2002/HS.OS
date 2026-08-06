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
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente, obter_cliente_de_espera

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


# ─────────────────────────────────────────────────────────────────────────────
# Envio ao agente e espera pela resposta
# ─────────────────────────────────────────────────────────────────────────────
#
# O desenho antigo era HTTP com SSE: o navegador abria `/v1/chat/completions`
# e via a resposta se formando. Essa rota é 404 no gateway atual, e o
# substituto (`chat.send`) é assíncrono — devolve `runId` e pronto.
#
# Aqui a resposta volta por **long-poll**, não por polling burro: `agent.wait`
# segura a conexão até o agente terminar ou até estourar o `timeoutMs`. Na
# prática a latência é a do agente, não a do intervalo de pergunta. O front
# chama `/reply` em laço enquanto vier `status: "executando"`.
#
# Streaming de verdade (ver o texto aparecendo token a token) exige assinar
# eventos no WebSocket e empurrar para o navegador. Fica para depois da entrega
# — é melhoria de percepção, não de capacidade.


def _chave_sessao(agent_id: str, user_id: str) -> str:
    """Uma sessão de gateway por usuário, por agente.

    ⚠️ A chave tem que vir **composta**: `agent:<agentId>:<sufixo>`. Mandar só o
    sufixo com `agentId` junto é recusado com
    `agentId "X" does not match session key "Y"` — o gateway extrai o agente da
    própria chave e confere. (Sem `agentId`, ele aceita a chave crua e assume o
    agente padrão, que é como uma sondagem acabou mandando mensagem para a
    `nina` por engano.)

    O sufixo é o id do usuário: sem isso, duas pessoas falando com o mesmo
    agente cairiam na mesma sessão e leriam o histórico uma da outra.
    """
    return f"agent:{agent_id}:hsos-{user_id}"


class EnvioIn(BaseModel):
    content: str = Field(min_length=1)
    media: list[dict] | None = None


class EnvioOut(BaseModel):
    message: MensagemOut
    run_id: str


class RespostaOut(BaseModel):
    # executando | pronta | erro
    status: str
    message: MensagemOut | None = None
    detalhe: str | None = None


def _texto_da_resposta(mensagens: list, desde_seq: int) -> str:
    """Junta o texto do que o agente disse depois do nosso envio.

    O histórico do gateway traz também `toolCall` e `toolResult` — o raciocínio
    e as ferramentas. Nada disso vai para a tela: a conversa que o usuário vê é
    só o texto final. Por isso filtra por `role == assistant` e pega apenas os
    blocos de tipo `text`.
    """
    partes: list[str] = []
    for m in mensagens:
        seq = (m.get("__openclaw") or {}).get("seq")
        if seq is None or seq <= desde_seq or m.get("role") != "assistant":
            continue
        conteudo = m.get("content")
        if isinstance(conteudo, str):
            partes.append(conteudo)
            continue
        for bloco in conteudo or []:
            if isinstance(bloco, dict) and bloco.get("type") == "text" and bloco.get("text"):
                partes.append(bloco["text"])
    return "\n\n".join(p.strip() for p in partes if p.strip())


async def _ultimo_seq(cliente, chave_completa: str) -> int:
    """Maior `seq` já presente na sessão, para saber o que é novo depois."""
    try:
        r = await cliente.chamar("chat.history", {"sessionKey": chave_completa, "limit": 1})
    except ErroGateway:
        return 0
    msgs = r.get("messages") or []
    return max((m.get("__openclaw") or {}).get("seq") or 0 for m in msgs) if msgs else 0


@router.post("/{agent_id}/send", response_model=EnvioOut, status_code=status.HTTP_201_CREATED)
async def enviar(
    agent_id: str,
    dados: EnvioIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Grava a mensagem do usuário e dispara o agente.

    A gravação vem primeiro de propósito: se o gateway estiver fora, a mensagem
    do usuário não se perde — ela fica na conversa e dá para reenviar. O
    contrário (disparar e gravar depois) perderia o que a pessoa escreveu
    justamente quando algo já está dando errado.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado."
        )

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.conversations (agent_id, user_id, role, content, media)
            VALUES ($1, $2::uuid, 'user', $3, $4::jsonb)
            RETURNING {_COLUNAS}
            """,
            agent_id, usuario.id, dados.content,
            json.dumps(dados.media) if dados.media else None,
        )

    chave = _chave_sessao(agent_id, usuario.id)
    cliente = obter_cliente(c.url, c.token)
    seq_antes = await _ultimo_seq(cliente, chave)

    # O `runId` volta igual ao `idempotencyKey` e é o que a espera usa depois.
    # Precisa ser único por envio: reaproveitar faria o gateway deduplicar e a
    # segunda mensagem sumiria em silêncio.
    run_id = f"hsos-{uuid4()}"
    try:
        await cliente.chamar(
            "chat.send",
            {
                # Explícito e obrigatório na prática: sem `agentId` o gateway
                # manda para o agente padrão, sem avisar.
                "agentId": agent_id,
                "sessionKey": chave,
                "message": dados.content,
                "idempotencyKey": run_id,
            },
        )
    except ErroGateway as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"A mensagem foi salva, mas o agente não pôde ser acionado: {e}",
        )

    _SEQ_DO_RUN[run_id] = (agent_id, chave, seq_antes)
    logger.info("Envio para %s por %s: run %s", agent_id, usuario.id, run_id)
    return EnvioOut(message=_para_saida(linha), run_id=run_id)


# Memória de processo: qual era o `seq` da sessão quando cada run começou. Cabe
# aqui porque só vive entre o envio e a resposta, que é questão de segundos.
# Se o backend reiniciar no meio, a espera devolve `erro` e a tela reenvia — o
# custo de perder isto é baixo, e uma tabela para dado de segundos não se paga.
_SEQ_DO_RUN: dict[str, tuple[str, str, int]] = {}

# Quanto o gateway segura a conexão por chamada. 20s dá resposta quase imediata
# na maioria dos turnos e ainda deixa o navegador refazer o pedido antes de
# qualquer proxy considerar a conexão ociosa.
_ESPERA_MS = 20_000


@router.get("/{agent_id}/reply", response_model=RespostaOut)
async def resposta(
    agent_id: str,
    run_id: str = Query(),
    usuario: Usuario = Depends(usuario_atual),
):
    """Espera a resposta do agente e grava quando ela vier.

    Devolve `executando` quando o tempo de espera acaba antes do agente — é o
    sinal para a tela chamar de novo. Chamar repetidamente é o uso normal.
    """
    registro = _SEQ_DO_RUN.get(run_id)
    if registro is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Envio desconhecido. Pode ter expirado com um reinício do servidor — reenvie a mensagem.",
        )
    agente_do_run, chave, seq_antes = registro
    if agente_do_run != agent_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este envio é de outro agente.")

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")

    espera = obter_cliente_de_espera(c.url, c.token)
    try:
        r = await espera.chamar("agent.wait", {"runId": run_id, "timeoutMs": _ESPERA_MS})
    except ErroGateway as e:
        return RespostaOut(status="erro", detalhe=str(e))

    if r.get("status") == "timeout":
        # `timeoutPhase: queue` com `providerStarted: false` significa que o
        # gateway nem começou — pode ser fila ou run que já não existe. Nos dois
        # casos a tela pergunta de novo; o limite de tentativas é dela.
        return RespostaOut(status="executando")

    cliente = obter_cliente(c.url, c.token)
    try:
        hist = await cliente.chamar("chat.history", {"sessionKey": chave, "limit": 40})
    except ErroGateway as e:
        return RespostaOut(status="erro", detalhe=str(e))

    texto = _texto_da_resposta(hist.get("messages") or [], seq_antes)
    if not texto:
        return RespostaOut(
            status="erro",
            detalhe="O agente terminou sem produzir texto. Pode ter respondido só com "
            "ferramentas, ou a resposta ficou vazia.",
        )

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.conversations (agent_id, user_id, role, content)
            VALUES ($1, $2::uuid, 'agent', $3)
            RETURNING {_COLUNAS}
            """,
            agent_id, usuario.id, texto,
        )
    _SEQ_DO_RUN.pop(run_id, None)
    logger.info("Resposta de %s gravada (run %s, %d chars)", agent_id, run_id, len(texto))
    return RespostaOut(status="pronta", message=_para_saida(linha))
