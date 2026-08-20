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
import re
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
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
    usuario: Usuario = Depends(usuario_atual),
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
async def limpar_sessao(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
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


async def _ultimo_seq(cliente, chave_completa: str) -> int:
    """Maior `seq` já presente na sessão, para saber o que é novo depois."""
    try:
        r = await cliente.chamar(
            "chat.history", {"sessionKey": chave_completa, "limit": _JANELA_ULTIMO_SEQ}
        )
    except ErroGateway:
        return 0
    msgs = r.get("messages") or []
    return max((m.get("__openclaw") or {}).get("seq") or 0 for m in msgs) if msgs else 0


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


@router.post("/{agent_id}/recuperar", response_model=list[MensagemOut])
async def recuperar(
    agent_id: str,
    usuario: Usuario = Depends(usuario_atual),
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
            "chat.history", {"sessionKey": _chave_sessao(agent_id, usuario.id), "limit": 60}
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
                " ORDER BY created_at DESC LIMIT 60",
                usuario.id, agent_id,
            )
        ]

        recuperadas = []
        for fim_ms, msgs in janelas:
            if fim_ms and fim_ms <= corte_ms:
                continue
            texto = _texto_da_resposta(msgs, 0)
            if not texto or _ja_esta_la(texto, existentes):
                continue
            linha = await conn.fetchrow(
                f"""
                INSERT INTO public.conversations (agent_id, user_id, role, content, created_at)
                VALUES ($1, $2::uuid, 'agent', $3, to_timestamp($4::bigint / 1000.0))
                RETURNING {_COLUNAS}
                """,
                agent_id, usuario.id, texto, fim_ms or 0,
            )
            existentes.append(texto)
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
    usuario: Usuario = Depends(usuario_atual),
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
            status.HTTP_502_BAD_GATEWAY, f"O agente não pôde ser acionado: {e}"
        )

    _SEQ_DO_RUN[run_id] = (agent_id, chave, seq_antes)
    logger.info("Envio para %s por %s: run %s", agent_id, usuario.id, run_id)
    return EnvioOut(run_id=run_id)


# ⚠️ **Uma trava por `run_id`, e a resposta já gravada.**
#
# A tela chama `/reply` em laço e a espera segura 20 segundos, então duas
# chamadas do MESMO run ficam em voo ao mesmo tempo. Como o `pop` do
# `_SEQ_DO_RUN` só acontecia depois do INSERT, as duas passavam pela conferência,
# esperavam juntas e **gravavam a mesma resposta duas vezes**. Aconteceu com o
# CEO em 20/08/2026: duas mensagens idênticas de 776 caracteres, no mesmo
# segundo.
#
# A trava serializa; a memória do que já foi gravado faz a segunda chamada
# devolver a MESMA mensagem em vez de inserir outra. As duas são memória de
# processo, como o `_SEQ_DO_RUN` — reinício do backend perde e a tela reenvia.
_TRAVA_DO_RUN: dict[str, asyncio.Lock] = {}
_RESPOSTA_DO_RUN: dict[str, "MensagemOut"] = {}

# Memória de processo: qual era o `seq` da sessão quando cada run começou. Cabe
# aqui porque só vive entre o envio e a resposta, que é questão de segundos.
# Se o backend reiniciar no meio, a espera devolve `erro` e a tela reenvia — o
# custo de perder isto é baixo, e uma tabela para dado de segundos não se paga.
_SEQ_DO_RUN: dict[str, tuple[str, str, int]] = {}

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
    usuario: Usuario = Depends(usuario_atual),
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
    usuario: Usuario = Depends(usuario_atual),
):
    """Espera a resposta do agente e grava quando ela vier.

    Devolve `executando` quando o tempo de espera acaba antes do agente — é o
    sinal para a tela chamar de novo. Chamar repetidamente é o uso normal.
    """
    # Já respondida por outra chamada em voo? Devolve a mesma, sem gravar de novo.
    if (pronta := _RESPOSTA_DO_RUN.get(run_id)) is not None:
        return RespostaOut(status="pronta", message=pronta)

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

    # A trava serializa as chamadas do mesmo run; a conferência de dentro pega
    # quem entrou na fila antes de a primeira gravar.
    async with _TRAVA_DO_RUN.setdefault(run_id, asyncio.Lock()):
        if (pronta := _RESPOSTA_DO_RUN.get(run_id)) is not None:
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
        saida = _para_saida(linha)
        _RESPOSTA_DO_RUN[run_id] = saida
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
    usuario: Usuario = Depends(usuario_atual),
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
async def abrir_dm(dados: DmIn, usuario: Usuario = Depends(exige_papel("administrador"))):
    """Devolve o canal de DM com a pessoa, criando-o se ainda não existir.

    ⚠️ **Conversa entre pessoas saiu do produto em 17/08/2026.** O HS.OS deixou
    de ser lugar de gente falar com gente: o foco é a pessoa falando com o
    agente. A tela de Chat não lista mais pessoas, e esta rota ficaria alcançável
    por quem chamasse a API direto — esconder na tela e deixar a rota aberta é o
    padrão que este repositório passou a semana corrigindo.

    Restrita a `administrador` em vez de removida: a função `find_or_create_dm` e
    os canais `type='dm'` continuam servindo às conversas com **agente**, e
    apagar a rota agora fecharia a porta para um caminho de suporte antes de
    existir outro. Quando a decisão assentar, o certo é remover as duas coisas
    juntas.

    Nada foi perdido ao esconder: os dois canais de DM entre pessoas que
    existiam tinham **zero** mensagens.

    A decisão de achar-ou-criar fica na função `find_or_create_dm` do banco, e é
    onde tem que ficar: dois cliques quase simultâneos em "conversar" criariam
    dois canais se a verificação e a criação fossem passos separados aqui.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        canal = await conn.fetchval(
            "SELECT public.find_or_create_dm($1::uuid, $2)",
            dados.target_user_id, dados.target_name,
        )
    if canal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Não foi possível abrir a conversa.")
    return {"channel_id": str(canal)}
