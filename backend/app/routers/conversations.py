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

import asyncio
import json
import logging
import re
from datetime import datetime
from uuid import uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, agente_visivel, exige_papel, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente, obter_cliente_de_espera
from app.integracoes import exige_segredo
from app.realtime import hub, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])

# A tela carrega esta quantidade ao abrir e usa o mesmo número para decidir se
# há mais páginas — `INITIAL_PAGE_SIZE` do `chat-persistence.ts`.
_PAGINA_INICIAL = 50
_LIMITE_MAXIMO = 200

_COLUNAS = """
    id::text AS id, agent_id, role, content, media,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
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


async def _ultimo_reset(conn, user_id: str, agent_id: str):
    """Quando esta pessoa pediu para recomeçar a conversa com este agente.

    ⚠️ **É filtro de tela, não exclusão.** `conversations` guarda tudo; o que a
    marca faz é dizer a partir de onde mostrar. Auditar é consultar a tabela sem
    este filtro — ver `009_limpar_sessao.sql`.
    """
    return await conn.fetchval(
        "SELECT max(created_at) FROM public.conversation_resets "
        " WHERE user_id = $1::uuid AND agent_id = $2",
        user_id, agent_id,
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


@router.get("/minhas/respostas", response_model=list[MensagemOut])
async def minhas_respostas(
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=500, ge=1, le=1000),
):
    """Tudo que os agentes já responderam a esta pessoa, de todos eles juntos.

    A aba de artefatos varre essas respostas atrás de blocos de código, e por
    isso precisa cruzar agentes — o histórico por agente não serve.

    ⚠️ **Precisa vir antes de `GET /{agent_id}`**, senão "minhas" é lido como
    nome de agente e esta rota nunca é alcançada.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""
            SELECT {_COLUNAS}
              FROM public.conversations
             WHERE user_id = $1::uuid AND role = 'agent'
             ORDER BY created_at DESC
             LIMIT $2
            """,
            usuario.id, limite,
        )
    return [_para_saida(l) for l in linhas]


@router.get("/ultimas/por-agente")
async def ultimas_por_agente(
    usuario: Usuario = Depends(usuario_atual),
    agent_ids: str = Query(default="", description="Ids separados por vírgula."),
):
    """A última mensagem de cada agente na minha conversa — a prévia da lista.

    ⚠️ **Antes de `GET /{agent_id}`**, senão "ultimas" vira id de agente.

    A agregação continua na função `get_agents_last_activity` do banco: ela já
    existia e reimplementá-la aqui criaria duas versões da mesma conta.
    """
    ids = [a.strip() for a in agent_ids.split(",") if a.strip()]
    if not ids:
        return []
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.get_agents_last_activity($1::text[], $2::uuid)",
            ids, usuario.id,
        )
    return json.loads(json.dumps([dict(l) for l in linhas], default=str))


@router.get("/{agent_id}/respostas", response_model=list[MensagemOut])
async def respostas_do_agente(
    agent_id: str,
    usuario: Usuario = Depends(agente_visivel),
    depois: str | None = Query(default=None, description="Só o que veio depois deste instante."),
    com_codigo: bool = Query(default=False, description="Só as que contêm bloco de código."),
    limite: int = Query(default=200, ge=1, le=500),
):
    """As respostas deste agente para mim, em ordem cronológica.

    Dois usos, e por isso os dois filtros:

    - o `chat-sender` pergunta "veio algo **depois** deste instante?" enquanto
      espera a resposta — daí o `depois`
    - a aba de artefatos procura mensagens com bloco de código — daí o
      `com_codigo`, que era um `.or()` com cinco `ilike` do lado do cliente

    ⚠️ **Antes de `GET /{agent_id}`** não é preciso: "respostas" é o segundo
    segmento, e `/{agent_id}` só casa com um. Mas vale lembrar que
    `/{agent_id}/algo` **casaria** com uma rota `/{a}/{b}` declarada antes.
    """
    condicoes = ["user_id = $1::uuid", "agent_id = $2", "role = 'agent'"]
    args: list = [usuario.id, agent_id]
    async with sessao(role="authenticated", user_id=usuario.id) as _c:
        _reset = await _ultimo_reset(_c, usuario.id, agent_id)
    if _reset is not None:
        args.append(_reset)
        condicoes.append(f"created_at > ${len(args)}")
    if depois:
        args.append(depois)
        condicoes.append(f"created_at > ${len(args)}::text::timestamptz")
    if com_codigo:
        # Os cinco tipos que a tela sabe renderizar como artefato.
        condicoes.append(
            "(content ILIKE '%```html%' OR content ILIKE '%```svg%' "
            " OR content ILIKE '%```jsx%' OR content ILIKE '%```tsx%' "
            " OR content ILIKE '%```react%')"
        )

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM public.conversations "
            f" WHERE {' AND '.join(condicoes)} ORDER BY created_at "
            f" LIMIT ${len(args) + 1}",
            *args, limite,
        )
    return [_para_saida(l) for l in linhas]


@router.delete("/mensagem/{mensagem_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_mensagem(mensagem_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Apaga uma mensagem da minha conversa.

    O `user_id` entra no WHERE: apagar mensagem de outra pessoa responde 404 em
    vez de depender de a policy estar escrita como se espera.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.conversations WHERE id = $1::uuid AND user_id = $2::uuid",
            mensagem_id, usuario.id,
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada.")


@router.get("/{agent_id}", response_model=PaginaOut)
async def historico(
    agent_id: str,
    usuario: Usuario = Depends(agente_visivel),
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
    # ⚠️ A tela mostra só o que veio depois do último "Limpar". As mensagens
    # anteriores continuam na tabela — ver `_ultimo_reset`.
    async with sessao(role="authenticated", user_id=usuario.id) as _c:
        _reset = await _ultimo_reset(_c, usuario.id, agent_id)
    if _reset is not None:
        args.append(_reset)
        condicoes.append(f"created_at > ${len(args)}")
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
    usuario: Usuario = Depends(agente_visivel),
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
            VALUES ($1, $2::uuid, $3, $4, $5::text::jsonb, COALESCE($6, now()))
            RETURNING {_COLUNAS}
            """,
            agent_id, usuario.id, dados.role, dados.content,
            json.dumps(dados.media) if dados.media else None,
            _instante(dados.created_at, "created_at"),
        )
    return _para_saida(linha)


class LimpezaOut(BaseModel):
    mensagens_arquivadas: int
    sessao_zerada: bool
    detalhe: str | None = None


@router.post("/{agent_id}/limpar", response_model=LimpezaOut)
async def limpar_sessao(agent_id: str, usuario: Usuario = Depends(agente_visivel)):
    """Encerra a conversa atual e começa outra — **sem apagar nada**.

    ⚠️ **Este endpoint faz o oposto do que o antigo fazia, e é essa a correção.**
    Até 19/08/2026 o botão "Limpar" apagava `conversations` para sempre e
    **não** tocava na sessão do gateway. O comentário de lá dizia que limpar a
    tela não deveria fazer o agente esquecer. Na prática: sumia o que interessa
    guardar (o histórico, para auditoria) e mantinha o que a pessoa quer zerar
    (a memória do agente). Quem clicava para recomeçar continuava conversando
    com alguém que lembrava de tudo.

    Agora são dois movimentos:

    1. **Marca o ponto de recomeço** em `conversation_resets`. A tela passa a
       mostrar só o que vier depois; a tabela `conversations` continua inteira.
    2. **Derruba a sessão no gateway** (`sessions.delete`), que é o que faz o
       agente de fato começar do zero. O gateway ainda arquiva a sessão do lado
       dele antes de remover.

    ⚠️ **Falha no gateway não impede o recomeço, mas é registrada.** Sem isso,
    "limpei e ele continua lembrando" viraria mistério; com o `sessao_zerada`
    em `false` a resposta já diz o que houve.
    """
    chave = _chave_sessao(agent_id, usuario.id)

    zerada, detalhe = False, None
    try:
        c = await cfg.carregar()
        if c.configurado:
            await obter_cliente(c.url, c.token).chamar("sessions.delete", {"key": chave})
            zerada = True
        else:
            detalhe = "Gateway não configurado — o agente não esqueceu a conversa."
    except (ErroGateway, OSError) as e:
        detalhe = f"A sessão do agente não pôde ser encerrada: {e}"
        logger.warning("sessions.delete falhou em %s: %s", chave, e)

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        quantas = await conn.fetchval(
            "SELECT count(*) FROM public.conversations "
            " WHERE agent_id = $1 AND user_id = $2::uuid",
            agent_id, usuario.id,
        ) or 0
        await conn.execute(
            "INSERT INTO public.conversation_resets "
            "  (user_id, agent_id, mensagens, sessao_zerada) VALUES ($1::uuid,$2,$3,$4)",
            usuario.id, agent_id, quantas, zerada,
        )

    logger.info("Conversa %s/%s recomeçada — %d mensagem(ns) arquivada(s), sessão zerada=%s",
                usuario.id, agent_id, quantas, zerada)
    return LimpezaOut(mensagens_arquivadas=quantas, sessao_zerada=zerada, detalhe=detalhe)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_de_vez(
    agent_id: str,
    user_id: str = Query(description="De quem é a conversa a apagar."),
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Apaga a conversa **de verdade**, e por isso é do administrador.

    ⚠️ **Não é o que o botão "Limpar" faz** — aquele agora usa `POST /limpar`, que
    preserva tudo. Esta rota existe para exclusão real (pedido de remoção de
    dado, limpeza de teste) e destrói o histórico sem recuperação: o gateway
    também já não tem a sessão se ela foi encerrada antes.
    """
    async with sessao(role="service_role") as conn:
        marca = await conn.execute(
            "DELETE FROM public.conversations WHERE agent_id = $1 AND user_id = $2::uuid",
            agent_id, user_id,
        )
    logger.warning("Conversa %s/%s APAGADA definitivamente (%s)", user_id, agent_id, marca)


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
    run_id: str


class RespostaOut(BaseModel):
    # executando | pronta | erro
    status: str
    message: MensagemOut | None = None
    detalhe: str | None = None


def _texto_da_resposta(mensagens: list, desde_seq: int) -> str:
    """O texto do agente depois do nosso envio — **só o turno final**.

    O histórico do gateway traz `toolCall` e `toolResult` junto, e nada disso vai
    para a tela. Mas filtrar por `role == assistant` não bastava, e essa era a
    diferença entre o que este docstring prometia e o que o código fazia.

    ⚠️ **O agente escreve entre uma ferramenta e outra, e tudo isso era gravado
    como se fosse a resposta.** Em 17/08/2026 o CEO leu, dentro das respostas,
    "deixa eu checar o schema das propostas", "o operador `~~*` não funciona com
    enum" e "minha query estava invertida". Não é o agente sendo indiscreto: são
    mensagens `assistant` legítimas, uma por rodada de ferramenta, que este
    juntador concatenava.

    Tentei consertar pelos arquivos do agente **duas vezes** — instrução no
    `AGENTS.md` e depois no `SOUL.md`, com as frases proibidas listadas. Segurou
    no caminho curto e vazou de novo assim que uma consulta falhou no meio: o
    modelo trata "explicar o tropeço" como transparência. Instrução não alcança
    esse instante; a costura, sim.

    O corte é o `seq` da última mensagem de ferramenta: o que veio depois dela é
    a resposta, o que veio antes é bastidor. Num caso real do `flow`, isso
    descartou 4 das 5 narrações (as de seq 2, 5, 8 e 11) e manteve a resposta.

    ⚠️ **Com recuo para o comportamento antigo se o turno final não tiver
    texto.** Agente que responde e só depois chama uma ferramenta é raro, mas
    engolir a resposta dele seria pior que mostrar bastidor.
    """
    # ⚠️ **O turno do agente carrega texto de controle, e ele vazou para o CEO.**
    #
    # Em 20/08/2026 o Nicholson recebeu, dentro da conversa:
    #   · "This is a pre-compaction memory flush. Let me capture durable
    #      memories to disk." — em inglês, no meio de um pedido de PDF;
    #   · "Memória registrada. Nada mais a reportar nesta sessão."
    #   · o token "NO_REPLY", que é justamente o sinal de NÃO responder.
    #
    # São efeitos da compactação de contexto do gateway: ele pede ao agente que
    # salve memória, e a resposta a esse pedido interno vira mensagem na tela.
    # Nenhuma delas é resposta a quem perguntou.
    #
    # O `NO_REPLY` é removido do texto em vez de descartar o bloco inteiro:
    # em 10:59:31 ele veio COLADO na resposta de verdade, e jogar fora o bloco
    # levaria a resposta junto.
    # ⚠️ **Padrão, não frase fixa.** A primeira versão listava a frase em inglês
    # e escapou a variante em português ("Este é um novo turning de memória
    # pre-compaction"), que chegou ao CEO no turno seguinte. O que é estável nas
    # duas é o termo `pre-compaction`; a redação em volta muda com o modelo.
    _CONTROLE = re.compile(
        r"pre-?compaction|memory flush|durable memories"
        r"|mem[oó]ria registrada\.\s*nada mais a reportar",
        re.I)

    def _limpar_controle(t: str) -> str:
        limpo = "\n".join(l for l in t.splitlines() if l.strip() != "NO_REPLY")
        # Bloco que é SÓ controle sai; bloco que mistura controle e conteúdo
        # perde apenas as linhas de controle — em 10:59:31 o artefato veio
        # colado na resposta de verdade, e descartar o bloco levaria a resposta.
        linhas = [l for l in limpo.splitlines() if not _CONTROLE.search(l)]
        return "\n".join(linhas).strip()

    def _texto(m) -> list[str]:
        conteudo = m.get("content")
        if isinstance(conteudo, str):
            return [conteudo]
        return [b["text"] for b in (conteudo or [])
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text")]

    def _seq(m) -> int | None:
        return (m.get("__openclaw") or {}).get("seq")

    novas = [m for m in mensagens
             if (s := _seq(m)) is not None and s > desde_seq]

    # O corte é a última fronteira: ferramenta, compactação ou pedido do runtime.
    #
    # ⚠️ **A compactação de contexto tem forma fixa e é ela que vazava.** O
    # gateway insere `role: "system"` com "Compaction", depois um usuário
    # SINTÉTICO — "Continue the OpenClaw runtime event." — e o agente responde
    # a esse pedido interno. Essa resposta não é para quem perguntou, e foi o
    # que o CEO leu em 20/08/2026: "pre-compaction memory flush", "Memória
    # registrada. Nada mais a reportar", "Nothing new to add beyond what's
    # already captured".
    #
    # Filtrar por frase não funciona — três redações diferentes em dois turnos,
    # em dois idiomas. A fronteira é estrutural e não muda.
    _SINTETICO = "continue the openclaw runtime event"

    def _fronteira(m) -> bool:
        if m.get("role") in ("toolCall", "toolResult", "system"):
            return True
        if m.get("role") == "user":
            c = m.get("content")
            t = c if isinstance(c, str) else " ".join(
                b.get("text", "") for b in (c or []) if isinstance(b, dict))
            return _SINTETICO in (t or "").strip().lower()
        return False

    corte = max(((_seq(m) or 0) for m in novas if _fronteira(m)), default=0)

    def _juntar(msgs) -> str:
        partes = [_limpar_controle(t) for m in msgs for t in _texto(m)]
        return "\n\n".join(p for p in partes if p)

    assistentes = [m for m in novas if m.get("role") == "assistant"]
    return _juntar([m for m in assistentes if (_seq(m) or 0) > corte]) or _juntar(assistentes)


# ⚠️ **`chat.history` com `limit=1` NÃO devolve a mensagem mais nova.** Medido em
# 19/08/2026 na sessão do `atlas`: 52 mensagens numeradas de 1 a 52, sem buracos,
# e `limit=1` respondeu a de `seq=41`. Com `limit=3` vieram 50, 51 e 52,
# corretas. Nas sessões curtas de `nina`, `iris` e `flow` o `limit=1` acertava —
# por isso o defeito passou despercebido: ele só aparece com histórico longo.
#
# A consequência era grave e visível. `_ultimo_seq` dizia 41, o `/reply` gravava
# tudo com `seq > 41`, e a resposta saía com **onze mensagens do turno anterior
# coladas na frente**. Foi o que o CEO leu em 17/08/2026 às 13h59: a resposta
# das 13h57 repetida palavra por palavra antes do conteúdo novo.
_JANELA_ULTIMO_SEQ = 5

# Quantas mensagens o `/recuperar` lê do gateway — e, obrigatoriamente, quantas
# linhas nossas ele compara para não regravar.
#
# ⚠️ **Os dois números são o mesmo de propósito.** Ler mais do gateway do que se
# compara do nosso lado reimportaria como "órfã" a resposta antiga que já está na
# tela. Estava em 60 contra 60 por coincidência; agora não pode divergir.
#
# 60 não alcançava a sessão real: de 24 a 30/08/2026 a do `atlas` chegou a 177
# mensagens e a da `iris` a 113. Resposta órfã mais antiga que a janela não era
# recuperável — e o reset apagava a sessão antes de alguém notar.
_JANELA_RECUPERAR = 200


async def _ultima_pergunta(mensagens: list) -> str:
    """A última pergunta de gente na sessão — a que precisa ser refeita.

    Ignora o usuário sintético do runtime (`Continue the OpenClaw runtime
    event.`), que não é pergunta de ninguém.
    """
    for m in reversed(mensagens or []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        t = c if isinstance(c, str) else " ".join(
            b.get("text", "") for b in (c or []) if isinstance(b, dict))
        t = (t or "").strip()
        if t and "continue the openclaw runtime event" not in t.lower():
            return t
    return ""


async def _compactar_e_reenviar(cliente, agent_id: str, chave: str,
                                hist: dict, user_id: str) -> str | None:
    """Manda `/compact` e refaz a pergunta. Devolve o `runId` novo, ou `None`.

    ⚠️ **A pergunta vem do histórico do gateway, não do nosso banco.** É a mesma
    sessão que falhou, então é ali que está o texto exato que o agente recebeu —
    e assim funciona também quando a mensagem do usuário não chegou a ser gravada
    do nosso lado.
    """
    pergunta = await _ultima_pergunta(hist.get("messages") or [])
    if not pergunta:
        return None
    try:
        # ⚠️ **`sessions.compact` (RPC) compacta; a mensagem `/compact` não.**
        # Até 20/08/2026 este trecho mandava "/compact" como mensagem, esperava
        # três segundos e refazia a pergunta. Medido naquele dia na sessão do
        # CEO: o `totalTokens` ficou em 182.161 antes e depois da mensagem, e
        # caiu na primeira chamada do RPC. A mensagem era um turno como outro
        # qualquer — que, numa sessão estourada, nem chegava a rodar.
        #
        # ⚠️ **E não há segunda compactação.** Sessão já compactada devolve
        # `{"ok": false, "compacted": false, "reason": "Already compacted"}` e
        # continua do mesmo tamanho. Sem tratar isso, a pergunta era reenviada
        # para a mesma sessão estourada e voltava o mesmo erro, em laço, até a
        # tela desistir — foi o que o CEO viu três vezes em 20/08, tendo que
        # redigitar a pergunta.
        #
        # Quando não dá mais para compactar, arquivar a sessão do gateway é o
        # conserto, e é barato **aqui**: o que a pessoa lê na tela vem do nosso
        # Postgres, não do gateway. Ela continua vendo a conversa inteira; quem
        # perde a memória é o agente, que é o preço combinado.
        r = await cliente.chamar("sessions.compact", {"key": chave})
        corpo = r.get("payload") or r
        if not corpo.get("compacted"):
            await cliente.chamar("sessions.delete", {"key": chave})
            logger.warning("Sessão %s não compactava mais (%s); arquivei e refiz a pergunta.",
                           chave, corpo.get("reason"))
        # Deixa o gateway assentar antes de refazer a pergunta.
        await asyncio.sleep(2)
        seq = await _ultimo_seq(cliente, chave, piso=await _piso_do_seq(chave, user_id))
        novo = f"hsos-{uuid4()}"
        await cliente.chamar("chat.send", {
            "agentId": agent_id, "sessionKey": chave,
            "message": pergunta, "idempotencyKey": novo})
    except (ErroGateway, OSError) as e:
        logger.warning("Não consegui compactar %s: %s", chave, e)
        return None
    await _guardar_run(novo, agent_id, chave, seq, user_id)
    return novo


async def _ultimo_seq(cliente, chave_completa: str, piso: int = 0) -> int:
    """Maior `seq` já presente na sessão, para saber o que é novo depois.

    ⚠️ **`piso` existe porque a janela acima não é confiável, e subir o número
    não resolve.** Em 19/08/2026 a correção foi trocar `limit=1` por `limit=5`,
    tratando o sintoma: se uma janela de 1 erra aos 52, uma de 5 erra mais
    adiante. Errou — de 24 a 30/08 a sessão do `atlas` chegou a 177 mensagens e
    voltaram 12 respostas duplicadas na conversa do CEO.

    Subestimar o corte é o que duplica: o `/reply` grava tudo com `seq >` ele, e
    o que vem antes é turno anterior colado na frente da resposta. O `seq` de uma
    sessão só cresce, então **o que já vimos é piso**, e o nosso `agent_runs` é
    quem o guarda. Tomar o maior entre os dois nunca superestima — e superestimar
    seria pior, engoliria a resposta nova.
    """
    try:
        r = await cliente.chamar(
            "chat.history", {"sessionKey": chave_completa, "limit": _JANELA_ULTIMO_SEQ}
        )
    except ErroGateway:
        # Gateway fora não é motivo para o corte cair a zero: isso regravaria a
        # sessão inteira como se fosse nova.
        return piso
    msgs = r.get("messages") or []
    do_gateway = (
        max((m.get("__openclaw") or {}).get("seq") or 0 for m in msgs) if msgs else 0
    )
    return max(piso, do_gateway)


async def _piso_do_seq(chave: str, user_id: str) -> int:
    """O maior `seq` que já registramos para esta sessão, do nosso lado."""
    async with sessao(role="authenticated", user_id=user_id) as conn:
        v = await conn.fetchval(
            "SELECT max(seq_antes) FROM public.agent_runs WHERE session_key = $1",
            chave,
        )
    return int(v or 0)


def _janelas_por_pergunta(mensagens: list) -> list[tuple[int, list]]:
    """Fatia o histórico do gateway em (fim_ms, mensagens) por pergunta.

    Cada janela vai de uma mensagem `user` até a próxima. É a unidade que vira
    uma linha em `conversations`, e é a mesma que o `/reply` grava no caminho
    normal — só que aqui reconstruída depois do fato.
    """
    # ⚠️ **Usuário SINTÉTICO não abre janela.** O gateway insere
    # "Continue the OpenClaw runtime event." depois de cada compactação, e ele
    # tem `role: "user"` como qualquer pergunta. Tratado como pergunta de gente,
    # ele abria uma janela própria — e a resposta do agente àquele pedido
    # interno virava uma mensagem sozinha na conversa. Foi assim que os avisos
    # de compactação voltaram ao histórico do CEO três vezes, mesmo depois de
    # apagados: o `/recuperar` os reimportava a cada abertura da tela.
    #
    # Somado ao pedido, ele fica na janela anterior e o corte por fronteira
    # (ver `_texto_da_resposta`) o descarta junto com o resto do bastidor.
    def _sintetico(m) -> bool:
        c = m.get("content")
        t = c if isinstance(c, str) else " ".join(
            b.get("text", "") for b in (c or []) if isinstance(b, dict))
        return "continue the openclaw runtime event" in (t or "").strip().lower()

    grupos: list[list] = []
    atual: list = []
    for m in mensagens:
        if m.get("role") == "user" and not _sintetico(m):
            if atual:
                grupos.append(atual)
            atual = []
            continue
        atual.append(m)
    if atual:
        grupos.append(atual)

    return [
        (max(((m.get("__openclaw") or {}).get("recordTimestampMs") or 0) for m in g), g)
        for g in grupos
    ]


def _ja_esta_la(texto: str, existentes: list[str]) -> bool:
    """A resposta já foi gravada?

    ⚠️ **Comparação por conteúdo, e por CONTENÇÃO nos dois sentidos.** Igualdade
    exata não serve: as linhas gravadas antes de 19/08/2026 trazem também a
    narração de bastidor que o `_texto_da_resposta` passou a cortar, então o
    mesmo turno tem texto diferente de cada lado. Sem a contenção, cada abertura
    da conversa duplicaria as respostas antigas.
    """
    alvo = " ".join(texto.split())
    if not alvo:
        return True
    for e in existentes:
        outro = " ".join((e or "").split())
        if alvo in outro or outro in alvo:
            return True
    return False


def _texto_a_recuperar(texto: str, existentes: list[str]) -> str | None:
    """O que a janela do gateway vira em `conversations` — ou `None` se nada.

    ⚠️ **O `/reply` recusa o aviso de compactação e o `/recuperar` o reimportava.**
    O caminho normal trata esse texto como manutenção nossa (ver
    `_FALHA_DE_COMPACTACAO` no `/reply`): compacta, refaz a pergunta e nunca o
    grava. A recuperação não tinha essa trava e o trazia de volta do gateway a
    cada abertura da tela — foi assim que o CEO leu três vezes, em inglês, um
    pedido para rodar `/compact`, comando que não existe no HS.OS.

    ⚠️ **E é aqui que o bastidor entra, não pelo webhook.** Sondando a produção
    em 31/08/2026, `POST /conversations/webhook/resposta` responde **503**: o
    `AGENT_REPLY_WEBHOOK_SECRET` não está em `integration_secrets` nem no
    ambiente, e o `exige_segredo` falha fechado. Quem escreve é esta rota — das
    140 bolhas de agente da semana de 24/08, 74 vieram sem `message_id` em
    `agent_runs`, e das 25 de bastidor, 20.

    ⚠️ **Aparar ANTES de comparar, não depois.** A bolha que o `/reply` gravou
    chega sem a narração; comparar a nossa ainda com bastidor faz a contenção
    não casar, e a mesma resposta entra duas vezes com textos ligeiramente
    diferentes. Foi metade das duplicatas daquela semana.
    """
    if not texto:
        return None
    if _FALHA_DE_COMPACTACAO.search(texto):
        return None
    aparado = _aparar_bastidor(texto)
    if not aparado or _ja_esta_la(aparado, existentes):
        return None
    return aparado


@router.post("/{agent_id}/recuperar", response_model=list[MensagemOut])
async def recuperar(
    agent_id: str,
    usuario: Usuario = Depends(agente_visivel),
):
    """Traz para `conversations` a resposta que ficou só no gateway.

    ⚠️ **Isto conserta perda de resposta observada em produção, não hipótese.**
    Em 17 e 18/08/2026 o CEO fez cinco perguntas que "não foram respondidas". O
    `usage_events` dizia que o agente rodou; o `chat.history` do gateway mostrou
    que ele **respondeu** — "Bom dia! Sou a Nina, orquestradora…" para o "ola", e
    1.023 caracteres de faturamento na `iris`. Nada disso chegou à tela, porque a
    gravação só acontece enquanto o navegador está perguntando em `/reply`. Ele
    mandou outra mensagem antes de a primeira voltar, e a resposta ficou órfã.

    `docs/DECISAO-RECONCILIADOR.md` previu exatamente este buraco, disse que o
    conserto certo era este — comparar o histórico do gateway com o nosso ao
    abrir a conversa — e definiu o sinal que reabriria a decisão: "resposta que
    some depois de fechar a aba, com uso real". O sinal chegou.

    **Não é a `turn-reconciler`**: sem agendador, sem tabela nova, sem escrever
    no gateway. Roda quando a tela abre a conversa, e é idempotente.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")

    try:
        hist = await obter_cliente(c.url, c.token).chamar(
            "chat.history",
            {"sessionKey": _chave_sessao(agent_id, usuario.id),
             "limit": _JANELA_RECUPERAR},
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Não consegui ler o histórico: {e}")

    janelas = _janelas_por_pergunta(hist.get("messages") or [])
    if not janelas:
        return []

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        # ⚠️ **Nada anterior ao último "Limpar" volta.** Sem esta trava, abrir a
        # conversa depois de recomeçar reimportaria do gateway justamente o que a
        # pessoa acabou de encerrar. Hoje o `sessions.delete` já esvazia o
        # histórico de lá, mas isso é coincidência de implementação, não garantia.
        reset = await _ultimo_reset(conn, usuario.id, agent_id)
        corte_ms = int(reset.timestamp() * 1000) if reset else 0
        # Só o que já existe do lado de cá, para não regravar.
        existentes = [
            r["content"] for r in await conn.fetch(
                "SELECT content FROM public.conversations "
                " WHERE user_id = $1::uuid AND agent_id = $2 AND role = 'agent' "
                " ORDER BY created_at DESC LIMIT $3",
                usuario.id, agent_id, _JANELA_RECUPERAR,
            )
        ]

        recuperadas = []
        for fim_ms, msgs in janelas:
            if fim_ms and fim_ms <= corte_ms:
                continue
            texto = _texto_a_recuperar(_texto_da_resposta(msgs, 0), existentes)
            if texto is None:
                continue
            # ⚠️ **A conferência em Python não protege de corrida, e a corrida
            # acontece.** Medido em 24/08/2026 às 16h33 na conversa do CEO: o
            # mesmo texto de 7.715 caracteres gravado duas vezes, uma pelo
            # `/reply` (tem `message_id` em `agent_runs`) e outra por aqui (não
            # tem). Das 140 bolhas de agente daquela semana, 74 vieram sem run.
            #
            # A sequência é clássica: a tela abre e chama `/recuperar`, que lê a
            # lista de `existentes`; o `/reply` da pergunta em curso insere logo
            # depois; e o `/recuperar`, com a lista velha na mão, insere de novo.
            # Ler e depois escrever, com outro escritor no meio.
            #
            # Por isso a última palavra é do banco, na mesma instrução: só grava
            # se não houver mensagem igual do mesmo agente para a mesma pessoa na
            # última meia hora. `NULL` quando alguém chegou primeiro — e aí não é
            # erro, é o caso bom.
            linha = await conn.fetchrow(
                f"""
                INSERT INTO public.conversations (agent_id, user_id, role, content, created_at)
                SELECT $1, $2::uuid, 'agent', $3, to_timestamp($4::bigint / 1000.0)
                 WHERE NOT EXISTS (
                       SELECT 1 FROM public.conversations
                        WHERE user_id = $2::uuid AND agent_id = $1 AND role = 'agent'
                          AND created_at > now() - interval '30 minutes'
                          AND content = $3
                 )
                RETURNING {_COLUNAS}
                """,
                agent_id, usuario.id, texto, fim_ms or 0,
            )
            existentes.append(texto)
            if linha is None:
                continue
            recuperadas.append(_para_saida(linha))

    if recuperadas:
        logger.info(
            "Recuperadas %d resposta(s) órfã(s) de %s para %s",
            len(recuperadas), agent_id, usuario.id,
        )
    return recuperadas


@router.post("/{agent_id}/send", response_model=EnvioOut, status_code=status.HTTP_201_CREATED)
async def enviar(
    agent_id: str,
    dados: EnvioIn,
    usuario: Usuario = Depends(agente_visivel),
):
    """Dispara o agente. **Não grava a mensagem do usuário.**

    Quem grava é o `POST /conversations/{agent_id}`, chamado pela tela antes
    deste — ela precisa da linha persistida de volta para trocar pela bolha
    otimista. Gravar aqui também duplicaria a mensagem na conversa.

    A ordem importa e é a que a tela já usava: persistir primeiro, disparar
    depois. Se o gateway estiver fora, o que a pessoa escreveu continua lá para
    reenviar.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado."
        )

    chave = _chave_sessao(agent_id, usuario.id)
    cliente = obter_cliente(c.url, c.token)
    seq_antes = await _ultimo_seq(
        cliente, chave, piso=await _piso_do_seq(chave, usuario.id)
    )

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
            status.HTTP_502_BAD_GATEWAY, f"O agente não pôde ser acionado: {e}"
        )

    await _guardar_run(run_id, agent_id, chave, seq_antes, usuario.id)
    _podar(_TRAVA_DO_RUN)
    logger.info("Envio para %s por %s: run %s", agent_id, usuario.id, run_id)
    return EnvioOut(run_id=run_id)


# ⚠️ **Uma trava por `run_id`, e a resposta já gravada.**
#
# A tela chama `/reply` em laço e a espera segura 20 segundos, então duas
# chamadas do MESMO run ficam em voo ao mesmo tempo. Sem serializar, as duas
# passavam pela conferência, esperavam juntas e **gravavam a mesma resposta duas
# vezes**. Aconteceu com o CEO em 20/08/2026: duas mensagens idênticas de 776
# caracteres, no mesmo segundo.
#
# ⚠️ **Esta trava é de processo, e isso basta para ela — mas não bastava para o
# resto.** Com `--workers 2` (`backend/Dockerfile:70`) são dois processos sem
# memória compartilhada: a trava do worker A não segura o worker B. Quem impede
# a gravação dupla entre workers é a reserva do `message_id` em
# `public.agent_runs`, no INSERT — a trava aqui só evita o trabalho repetido
# dentro do mesmo processo, que é o caso comum.
_TRAVA_DO_RUN: dict[str, asyncio.Lock] = {}

# ⚠️ **Memória de processo precisa de teto.** Uma entrada por envio e nada a
# limpa. Podar por idade exigiria carimbar cada uma; a ordem de inserção do dict
# já resolve, e o que interessa é sempre o envio recente.
_TETO_DE_MEMORIA = 500


def _podar(d) -> None:
    while len(d) > _TETO_DE_MEMORIA:
        d.pop(next(iter(d)), None)


# ─────────────────────────────────────────────────────────────────────────────
# O estado de um envio mora no banco, não na memória — ver `012_runs_no_banco.sql`
# ─────────────────────────────────────────────────────────────────────────────
#
# ⚠️ **"Envio desconhecido" quase nunca foi reinício do servidor.** A mensagem
# dizia isso, e o CEO a recebeu no meio de um pedido em 20/08/2026, tendo que
# redigitar. O que havia era um dicionário de módulo lido por dois processos:
# o `POST /enviar` registrava no worker A e o `GET /reply` caía no worker B, que
# não conhecia o run. Some com deploy, some com o teto acima, e some quando o
# poll troca de worker — três causas, uma mensagem, e a mensagem culpava a
# única das três que quase não acontecia.


async def _guardar_run(run_id: str, agent_id: str, chave: str,
                       seq_antes: int, user_id: str) -> None:
    """Registra o envio. `ON CONFLICT DO NOTHING` porque o `runId` é o nosso
    `idempotencyKey`: reenvio do mesmo id é o mesmo envio, não um novo."""
    async with sessao(role="authenticated", user_id=user_id) as conn:
        await conn.execute(
            """INSERT INTO public.agent_runs
                   (run_id, agent_id, session_key, seq_antes, user_id)
               VALUES ($1, $2, $3, $4, $5::uuid)
               ON CONFLICT (run_id) DO NOTHING""",
            run_id, agent_id, chave, seq_antes, user_id)


async def _seguir_run(run_id: str, user_id: str):
    """A linha do run que de fato responde, seguindo a seta da compactação.

    `visitados` não é zelo teórico: `redireciona_para` é escrito por nós e um
    ciclo travaria o pedido em laço dentro de uma conexão do pool.
    """
    visitados: set[str] = set()
    async with sessao(role="authenticated", user_id=user_id) as conn:
        while run_id and run_id not in visitados:
            visitados.add(run_id)
            linha = await conn.fetchrow(
                """SELECT run_id, agent_id, session_key, seq_antes,
                          redireciona_para, ja_compactou, message_id
                     FROM public.agent_runs WHERE run_id = $1""", run_id)
            if linha is None:
                return None
            if linha["redireciona_para"]:
                run_id = linha["redireciona_para"]
                continue
            return linha
    return None


async def _mensagem_gravada(message_id, user_id: str):
    """A mensagem que outra chamada já gravou para este run."""
    async with sessao(role="authenticated", user_id=user_id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS} FROM public.conversations WHERE id = $1", message_id)
    return _para_saida(linha) if linha else None


async def _reservar_compactacao(run_id: str, user_id: str) -> bool:
    """Uma tentativa de compactar por pergunta, valendo entre os workers.

    O `WHERE ja_compactou = false` faz a reserva ser atômica: quem perder a
    corrida recebe `False` e não entra no laço de compactar e reenviar.
    """
    async with sessao(role="authenticated", user_id=user_id) as conn:
        return await conn.fetchval(
            """UPDATE public.agent_runs SET ja_compactou = true
                WHERE run_id = $1 AND ja_compactou = false
            RETURNING true""", run_id) or False


async def _apontar_run(run_id: str, destino: str, user_id: str) -> None:
    async with sessao(role="authenticated", user_id=user_id) as conn:
        await conn.execute(
            "UPDATE public.agent_runs SET redireciona_para = $2 WHERE run_id = $1",
            run_id, destino)


class _JaGravado(Exception):
    """Outra chamada gravou a resposta primeiro; desfaz o INSERT desta."""


_FALHA_DE_COMPACTACAO = re.compile(
    r"auto-?compaction could not recover|não foi possível recuperar.*compacta", re.I)

# Quanto o gateway segura a conexão por chamada. 20s dá resposta quase imediata
# na maioria dos turnos e ainda deixa o navegador refazer o pedido antes de
# qualquer proxy considerar a conexão ociosa.
_ESPERA_MS = 20_000


class ComandoIn(BaseModel):
    comando: str = Field(min_length=1)


@router.post("/{agent_id}/comando", status_code=status.HTTP_202_ACCEPTED)
async def comando(
    agent_id: str,
    dados: ComandoIn,
    usuario: Usuario = Depends(agente_visivel),
):
    """Manda um comando de barra (`/stop`, `/new`, `/compact`) para a sessão.

    **Não há lista de comandos permitidos, e é de propósito.** Quem interpreta
    a barra é o próprio OpenClaw; uma allowlist aqui só criaria uma segunda
    lista para manter em dia e faria comando novo do gateway nascer bloqueado.
    O que se exige é que comece com `/` — texto normal tem caminho próprio, e
    passar por aqui pularia a persistência da conversa.

    Vai para a **mesma sessão** do chat da pessoa, senão o `/stop` pararia uma
    sessão que não é a que está rodando na tela.

    Dispara e devolve 202 sem esperar: o `/stop` só vale se chegar depressa, e
    a tela não usa a resposta para nada — ela observa o efeito na conversa.
    """
    texto = dados.comando.strip()
    if not texto.startswith("/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Isto não é um comando. Comando começa com barra, ex.: /stop.",
        )

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado."
        )

    try:
        await obter_cliente(c.url, c.token).chamar(
            "chat.send",
            {
                "agentId": agent_id,
                "sessionKey": _chave_sessao(agent_id, usuario.id),
                "message": texto,
                "idempotencyKey": f"cmd-{uuid4()}",
            },
        )
    except ErroGateway as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"O comando não chegou ao agente: {e}"
        )

    logger.info("Comando %s em %s por %s", texto.split()[0], agent_id, usuario.id)
    return {"ok": True}


@router.get("/{agent_id}/reply", response_model=RespostaOut)
async def resposta(
    agent_id: str,
    run_id: str = Query(),
    usuario: Usuario = Depends(agente_visivel),
):
    """Espera a resposta do agente e grava quando ela vier.

    Devolve `executando` quando o tempo de espera acaba antes do agente — é o
    sinal para a tela chamar de novo. Chamar repetidamente é o uso normal.
    """
    # A tela continua perguntando pelo run que ela conhece; se houve compactação
    # no meio, seguimos a seta até o run que está de fato respondendo.
    registro = await _seguir_run(run_id, usuario.id)
    if registro is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Não encontrei este envio. Mande a mensagem de novo.",
        )
    run_id = registro["run_id"]

    # Já respondida por outra chamada em voo? Devolve a mesma, sem gravar de novo.
    if registro["message_id"] and (pronta := await _mensagem_gravada(
            registro["message_id"], usuario.id)):
        return RespostaOut(status="pronta", message=pronta)

    agente_do_run, chave, seq_antes = (
        registro["agent_id"], registro["session_key"], registro["seq_antes"])
    if agente_do_run != agent_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este envio é de outro agente.")

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")

    # A trava serializa as chamadas do mesmo run; a conferência de dentro pega
    # quem entrou na fila antes de a primeira gravar.
    async with _TRAVA_DO_RUN.setdefault(run_id, asyncio.Lock()):
        de_novo = await _seguir_run(run_id, usuario.id)
        if de_novo is not None and de_novo["message_id"] and (
                pronta := await _mensagem_gravada(de_novo["message_id"], usuario.id)):
            return RespostaOut(status="pronta", message=pronta)

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

        # ⚠️ **A falha de compactação não é resposta: é manutenção nossa.**
        # Compacta, reenvia a mesma pergunta e aponta este run para o novo. A
        # tela segue perguntando pelo run antigo e recebe a resposta de verdade.
        if (texto and _FALHA_DE_COMPACTACAO.search(texto)
                and await _reservar_compactacao(run_id, usuario.id)):
            novo = await _compactar_e_reenviar(cliente, agent_id, chave, hist, usuario.id)
            if novo:
                await _apontar_run(run_id, novo, usuario.id)
                logger.info("Compactei %s e reenviei a pergunta (run %s → %s)",
                            chave, run_id, novo)
                return RespostaOut(status="executando")
            # Não conseguiu compactar: melhor dizer que não deu do que colar na
            # conversa um texto que manda a pessoa digitar /compact.
            return RespostaOut(
                status="erro",
                detalhe="A conversa ficou grande demais e eu não consegui reduzi-la "
                        "sozinho. Comece uma nova conversa no botão acima.",
            )

        if not texto:
            return RespostaOut(
                status="erro",
                detalhe="O agente terminou sem produzir texto. Pode ter respondido só com "
                "ferramentas, ou a resposta ficou vazia.",
            )

        # ⚠️ **A reserva do `message_id` é o que impede a resposta dobrada entre
        # workers.** O INSERT e a reserva vão na MESMA transação: quem perder a
        # corrida encontra `message_id` já preenchido, levanta `_JaGravado`, e o
        # rollback desfaz o INSERT — em vez de deixar na conversa uma segunda
        # mensagem idêntica, que foi o que o CEO recebeu em 20/08.
        try:
            async with sessao(role="authenticated", user_id=usuario.id) as conn:
                async with conn.transaction():
                    linha = await conn.fetchrow(
                        f"""
                        INSERT INTO public.conversations (agent_id, user_id, role, content)
                        VALUES ($1, $2::uuid, 'agent', $3)
                        RETURNING {_COLUNAS}
                        """,
                        agent_id, usuario.id, texto,
                    )
                    ganhou = await conn.fetchval(
                        """UPDATE public.agent_runs SET message_id = $2
                            WHERE run_id = $1 AND message_id IS NULL
                        RETURNING true""",
                        run_id, linha["id"])
                    if not ganhou:
                        raise _JaGravado
        except _JaGravado:
            outra = await _seguir_run(run_id, usuario.id)
            pronta = await _mensagem_gravada(outra["message_id"], usuario.id) if outra else None
            if pronta:
                logger.info("Outra chamada já gravou o run %s; devolvendo a dela.", run_id)
                return RespostaOut(status="pronta", message=pronta)
            return RespostaOut(status="executando")

        saida = _para_saida(linha)
        # Vai para o próprio usuário: é ele quem tem a conversa aberta, e assim uma
        # segunda aba do mesmo dono também recebe a resposta.
        hub.publicar(topico_usuario(usuario.id), "resposta-agente",
                     {"agent_id": agent_id, "message": saida.model_dump()})
        logger.info("Resposta de %s gravada (run %s, %d chars)", agent_id, run_id, len(texto))
        return RespostaOut(status="pronta", message=saida)


# ─────────────────────────────────────────────────────────────────────────────
# Resposta que chega por conta própria — portado de `agent-reply-webhook`
# ─────────────────────────────────────────────────────────────────────────────
#
# O agente empurra a resposta quando termina, em vez de esperar alguém buscar.
# Continua fazendo sentido depois da portagem do chat: o `/reply` só grava
# quando a tela está aberta perguntando. Se o usuário fechou a aba durante uma
# tarefa longa, é este webhook que salva a resposta.


class RespostaDoAgenteIn(BaseModel):
    agent_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    # Uma string ou várias — o agente pode quebrar a resposta em pedaços.
    content: str | list[str] = ""
    status: str = "completed"
    error: str | None = None


# Emojis que abrem mensagem de andamento ("🔄 Analisando…"). São status, não
# resposta: gravá-los como mensagem enche a conversa de ruído.
_HEARTBEAT = re.compile(
    r"^\s*(?:🔄|✅|⏳|🔍|⚙️|📥|📤|🎬|📝|🎯|🧠|🟢|🟡|🔴|▶️|⏱️|🚀|📊|💾|🔎|📡|⌛|✨|🛠️|🧪)"
)


# ⚠️ **Bastidor em texto puro passava pelo `_HEARTBEAT`, que só olha emoji.**
#
# Medido na conversa do CEO de 24 a 30/08/2026: 1,8 bolha de agente por
# pergunta, 22 delas só preâmbulo ("Vou consultar…") e 15 falando dele em
# terceira pessoa — *"O CEO pergunta sobre a origem dos leads"*. Ele estava
# lendo o agente pensar sobre ele.
#
# ⚠️ **Descartar a mensagem inteira seria errado, e foi medido.** Das 24 que
# começam com monólogo, 5 trazem a resposta no mesmo bloco: *"O CEO pergunta
# quem está melhor no mês. […] Vou responder direto. / Nicholson, o destaque do
# mês é o Eduardo Luna."* Por isso a regra apara parágrafos do começo em vez de
# julgar o bloco. Rodada contra as 137 respostas da semana: 41 seriam aparadas,
# 25 são bastidor puro e **nenhuma perde texto com R$ ou tabela**.
#
# Só no começo, de propósito: "Vou consultar setembro se você quiser" no fim é
# o agente falando com quem perguntou — isso é resposta.
_BASTIDOR = re.compile(r"""^\s*(
    o\s+ceo\b | o\s+pedido\s*[:é] | a\s+pergunta\s+(é|foi)\b |
    vou\s+(verificar\s+quem|montar\s+a\s+resposta|come[çc]ar|abrir\s+a\s+skill
           |consultar|buscar|apurar|olhar|rodar|medir|ver\b) |
    deixa?\s+eu\s+(entender|ver|conferir|abrir|come[çc]ar|pegar) |
    entendi\s+a\s+r[ée]gua | preciso\s+entender | primeiro,?\s+deixa
)""", re.I | re.X)


def _aparar_bastidor(texto: str) -> str:
    """Tira a narração de bastidor do começo. Vazio = o bloco era só bastidor."""
    paragrafos = [p for p in re.split(r"\n\s*\n", texto or "") if p.strip()]
    i = 0
    while i < len(paragrafos) and _BASTIDOR.match(paragrafos[i]):
        i += 1
    return "\n\n".join(paragrafos[i:]).strip()


@router.post("/webhook/resposta", status_code=status.HTTP_201_CREATED)
async def resposta_do_agente(
    dados: RespostaDoAgenteIn,
    _: None = Depends(exige_segredo("AGENT_REPLY_WEBHOOK_SECRET")),
):
    """Grava a resposta que o agente empurrou.

    Falha vira mensagem visível com ⚠️, não silêncio: o usuário precisa saber
    que a tarefa terminou mal, e uma conversa que simplesmente para é pior que
    um erro explícito.
    """
    if dados.status == "failed":
        partes = [f"⚠️ {(dados.error or '').strip() or 'Não foi possível concluir a tarefa.'}"]
    else:
        bruto = dados.content if isinstance(dados.content, list) else [dados.content]
        partes = [p.strip() for p in bruto if isinstance(p, str) and p.strip()]
        # Mensagem de andamento não vira linha na conversa.
        partes = [p for p in partes if not _HEARTBEAT.match(p)]
        # Nem a narração de bastidor — e quando ela é o bloco todo, some.
        partes = [x for p in partes if (x := _aparar_bastidor(p))]

    if not partes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Sem conteúdo para gravar (vazio, ou só mensagens de andamento).",
        )

    async with sessao(role="service_role") as conn:
        gravadas = []
        for i, texto in enumerate(partes):
            # Milissegundos crescentes: sem isso as partes teriam o mesmo
            # `created_at` e a tela poderia mostrá-las fora de ordem.
            linha = await conn.fetchrow(
                f"""
                INSERT INTO public.conversations (agent_id, user_id, role, content, created_at)
                VALUES ($1, $2::uuid, 'agent', $3, now() + ($4 || ' milliseconds')::interval)
                RETURNING {_COLUNAS}
                """,
                dados.agent_id, dados.user_id, texto, str(i),
            )
            gravadas.append(_para_saida(linha))

    for m in gravadas:
        hub.publicar(topico_usuario(dados.user_id), "resposta-agente",
                     {"agent_id": dados.agent_id, "message": m.model_dump()})
    logger.info("Webhook gravou %d mensagem(ns) de %s", len(gravadas), dados.agent_id)
    return {"gravadas": len(gravadas)}


# ─────────────────────────────────────────────────────────────────────────────
# Pergunta avulsa — a Arena
# ─────────────────────────────────────────────────────────────────────────────


class PerguntaAvulsaIn(BaseModel):
    pergunta: str = Field(min_length=1)
    persona: str | None = Field(default=None, description="Instrução de papel para esta pergunta.")


class PerguntaAvulsaOut(BaseModel):
    resposta: str


@router.post("/{agent_id}/pergunta-avulsa", response_model=PerguntaAvulsaOut)
async def pergunta_avulsa(
    agent_id: str,
    dados: PerguntaAvulsaIn,
    usuario: Usuario = Depends(agente_visivel),
):
    """Pergunta única, fora de qualquer conversa. É o que a Arena usa.

    **Sessão descartável a cada chamada**, não a do chat da pessoa. Na Arena o
    mesmo agente responde várias vezes com personas diferentes, e memória entre
    elas contaminaria a comparação — que é justamente o ponto da tela. O preço é
    não haver histórico: cada pergunta parte do zero.

    A persona vai **junto da mensagem**, não como system prompt: o `chat.send`
    do gateway manda texto para um agente já configurado, não monta um prompt.
    É mais fraco que o `messages[{role:"system"}]` que a edge usava contra o
    `/v1/chat/completions` — que nesta versão do gateway não existe mais.

    Espera a resposta em vez de devolver um `run_id`: a Arena roda uma rodada de
    debate inteira e a tela precisa dos textos juntos para comparar.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")

    chave = f"arena:{usuario.id}:{uuid4()}"
    run_id = f"hsos-{uuid4()}"
    texto = f"{dados.persona.strip()}\n\n---\n\n{dados.pergunta}" if dados.persona else dados.pergunta

    cliente = obter_cliente(c.url, c.token)
    try:
        await cliente.chamar(
            "chat.send",
            {
                "agentId": agent_id,
                "sessionKey": chave,
                "message": texto,
                "idempotencyKey": run_id,
            },
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"O agente não pôde ser acionado: {e}")

    espera = obter_cliente_de_espera(c.url, c.token)
    try:
        r = await espera.chamar("agent.wait", {"runId": run_id, "timeoutMs": _ESPERA_MS})
        if r.get("status") == "timeout":
            raise HTTPException(
                status.HTTP_504_GATEWAY_TIMEOUT,
                "O agente demorou demais para responder. Tente de novo.",
            )
        hist = await cliente.chamar("chat.history", {"sessionKey": chave, "limit": 20})
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Falha ao obter a resposta: {e}")

    resposta = _texto_da_resposta(hist.get("messages") or [], 0)
    if not resposta:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "O agente respondeu vazio.")
    return PerguntaAvulsaOut(resposta=resposta)


class DmIn(BaseModel):
    target_user_id: str
    target_name: str = ""


@router.post("/dm/abrir")
async def abrir_dm(dados: DmIn, usuario: Usuario = Depends(usuario_atual)):
    """Devolve o canal de DM com a pessoa, criando-o se ainda não existir.

    ⚠️ **Aberta de novo em 01/09/2026.** Esta rota exigiu `administrador` entre
    17/08 e 01/09, quando a conversa entre pessoas tinha saído do produto — o
    chefe voltou atrás e a empresa inteira entrou. DM é livre entre todas as
    pessoas; o que é do administrador é criar canal de grupo (ver a 015).

    A decisão de achar-ou-criar fica na função `find_or_create_dm` do banco, e é
    onde tem que ficar: dois cliques quase simultâneos em "conversar" criariam
    dois canais se a verificação e a criação fossem passos separados aqui.
    """
    # Import local: `channels.py` importa `_texto_da_resposta` deste módulo no
    # topo do arquivo, e um `from app.routers.channels import traduzir_hs001`
    # aqui em cima criaria import circular (confirmado tentando — quebra o
    # `import app.routers.conversations` sozinho, antes de qualquer rota).
    from app.routers.channels import traduzir_hs001

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            canal = await conn.fetchval(
                "SELECT public.find_or_create_dm($1::uuid, $2)",
                dados.target_user_id, dados.target_name,
            )
        except asyncpg.PostgresError as erro:
            # ⚠️ O `find_or_create_dm` é SECURITY DEFINER e insere em
            # `channel_members` direto, então o trigger da 014 alcança ele.
            # Sem esta tradução, abrir DM com agente sem acesso viraria 500.
            traduzido = traduzir_hs001(erro)
            if traduzido is not None:
                raise traduzido from erro
            raise
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Não foi possível abrir a conversa.")
    return {"channel_id": str(canal)}
