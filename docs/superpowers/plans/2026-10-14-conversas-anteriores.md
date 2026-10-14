# Conversas anteriores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro da conversa com um agente, listar as conversas encerradas por "Nova conversa", abrir uma só para leitura e copiar ou citar um trecho na conversa atual.

**Architecture:** Sem migração. Uma conversa anterior é o trecho de `conversations` entre dois `conversation_resets` do mesmo par pessoa × agente; o recorte é uma função pura no backend. Duas rotas de leitura em `routers/conversations.py`; a busca global ganha `conversa_anterior`. No front, um `Sheet` com lista e leitura, citação no campo de digitar e abertura direta pela busca.

**Tech Stack:** FastAPI + asyncpg, React + Vite + Vitest, shadcn `Sheet`.

**Spec:** `docs/superpowers/specs/2026-10-14-conversas-anteriores-design.md`

## Global Constraints

- Português em código, comentários e textos; testes com docstring do custo do defeito.
- **Sem migração.** Sessão `authenticated` em todas as leituras (RLS `dono_le` em `conversations` e `conversation_resets`); `Depends(agente_visivel)` nas rotas.
- Identificador da conversa anterior = **uuid do reset** que a encerrou, nunca o horário.
- Título: primeira pergunta com **mais de 3 palavras**, senão a primeira pergunta, senão "Conversa sem pergunta"; espaços colapsados; **80 caracteres** com `…`.
- Teto de **500** mensagens por conversa aberta.
- Só leitura: nenhum caminho do painel escreve nem fala com o gateway.
- Backend: `cd backend && .venv/bin/python -m pytest tests -q`. Front: `cd frontend && npx vitest run`, lint sem erro novo, `npm run build`.

## Review Focus

- Dois "Nova conversa" seguidos (trecho vazio) → não aparece item vazio na lista. Teste em Task 1.
- `reset_id` de outra pessoa ou de outro agente → 404, não as mensagens. Coberto pela consulta com `user_id` + `agent_id` (Task 2) e conferido no rascunho (Task 5).
- Mensagem exatamente no instante do reset → pertence ao trecho que o reset encerrou (o `/limpar` grava o reset depois da última mensagem); recorte usa `created_at <= reset`. Teste em Task 1.
- Citar com rascunho já digitado → acrescenta, não apaga. Teste em Task 3.
- Resultado de busca da conversa atual → continua abrindo o chat como hoje. Teste em Task 3.

---

### Task 1: Recorte e título (`app/conversas_anteriores.py`)

**Files:**
- Create: `backend/app/conversas_anteriores.py`
- Test: `backend/tests/test_conversas_anteriores.py`

**Interfaces:**
- Produces:
  - `recortar_conversas(resets: list[dict], mensagens: list[dict]) -> list[dict]` — `resets` = `[{id: str, created_at: datetime}]` em ordem crescente; `mensagens` = `[{role, content, created_at}]` em ordem crescente, **todas anteriores ou iguais ao último reset**; devolve `[{id, ate, inicio, titulo, mensagens}]` **do mais novo para o mais antigo**, sem trechos vazios. `ate`/`inicio` são `datetime`.
  - `titulo_da_conversa(mensagens: list[dict]) -> str`
  - `limites_do_trecho(resets: list[dict], reset_id: str) -> tuple[datetime | None, datetime] | None` — `(depois_de, ate)` do trecho que `reset_id` encerra; `None` se o id não está na lista.
  - `trecho_da_mensagem(resets: list[dict], instante: datetime) -> str | None` — id do primeiro reset com `created_at >= instante`; `None` se não há (conversa atual).

- [ ] **Step 1: testes que falham**

```python
"""Conversas anteriores com o agente (spec 2026-10-14).

Uma conversa anterior é o trecho entre dois "Nova conversa". Errar o recorte
mostra a pessoa a conversa errada — ou mistura duas — justamente quando ela
voltou para pegar um número de lá.
"""
from datetime import datetime, timedelta, timezone

from app.conversas_anteriores import (limites_do_trecho, recortar_conversas,
                                      titulo_da_conversa, trecho_da_mensagem)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def t(min_):
    return T0 + timedelta(minutes=min_)


def m(min_, role="user", content="uma pergunta com bastante palavra"):
    return {"role": role, "content": content, "created_at": t(min_)}


RESETS = [{"id": "r1", "created_at": t(10)}, {"id": "r2", "created_at": t(20)},
          {"id": "r3", "created_at": t(21)}]


def test_recorta_entre_resets_do_mais_novo_ao_mais_antigo_e_pula_vazio():
    """r3 veio um minuto depois de r2, sem mensagem no meio: item vazio na
    lista seria uma conversa que abre em branco."""
    msgs = [m(1), m(2, "agent", "resposta"), m(12), m(13, "agent", "outra")]
    saida = recortar_conversas(RESETS, msgs)
    assert [c["id"] for c in saida] == ["r2", "r1"]
    assert saida[0]["mensagens"] == 2 and saida[0]["inicio"] == t(12) and saida[0]["ate"] == t(20)
    assert saida[1]["mensagens"] == 2 and saida[1]["inicio"] == t(1)


def test_mensagem_no_instante_do_reset_pertence_ao_trecho_que_ele_fecha():
    """O `/limpar` grava o reset depois da última mensagem; empate de relógio
    não pode jogar a última resposta para a conversa seguinte."""
    saida = recortar_conversas([{"id": "r1", "created_at": t(10)}], [m(1), m(10, "agent", "fim")])
    assert saida[0]["mensagens"] == 2


def test_sem_reset_nao_ha_conversa_anterior():
    assert recortar_conversas([], [m(1)]) == []


def test_titulo_pula_pergunta_generica():
    msgs = [m(1, content="oi"), m(2, "agent", "Olá!"), m(3, content="planilha com os eventos (atestado e declaração)")]
    assert titulo_da_conversa(msgs) == "planilha com os eventos (atestado e declaração)"


def test_titulo_recua_para_a_primeira_pergunta_e_depois_para_o_padrao():
    assert titulo_da_conversa([m(1, content="olha os arquivos")]) == "olha os arquivos"
    assert titulo_da_conversa([m(1, "agent", "só o agente falou")]) == "Conversa sem pergunta"


def test_titulo_colapsa_espaco_e_corta_em_80():
    longo = "palavra " * 30
    titulo = titulo_da_conversa([m(1, content="  linha um\n\nlinha   dois três quatro " + longo)])
    assert titulo.startswith("linha um linha dois três quatro")
    assert len(titulo) == 80 and titulo.endswith("…")


def test_limites_do_trecho():
    assert limites_do_trecho(RESETS, "r1") == (None, t(10))
    assert limites_do_trecho(RESETS, "r2") == (t(10), t(20))
    assert limites_do_trecho(RESETS, "nao-existe") is None


def test_trecho_da_mensagem():
    """É o que leva a busca global à conversa certa."""
    assert trecho_da_mensagem(RESETS, t(5)) == "r1"
    assert trecho_da_mensagem(RESETS, t(10)) == "r1"
    assert trecho_da_mensagem(RESETS, t(15)) == "r2"
    assert trecho_da_mensagem(RESETS, t(30)) is None
```

- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_conversas_anteriores.py -q` → FAIL (`No module named app.conversas_anteriores`).

- [ ] **Step 3: implementação**

```python
"""Conversas anteriores com o agente — o recorte, sem banco (spec 2026-10-14).

"Nova conversa" (`/limpar`) não apaga: grava um marco em `conversation_resets`
e a tela passa a mostrar só o que veio depois. Uma conversa anterior é o trecho
de `conversations` que um marco ENCERROU — do marco anterior (exclusivo) até
ele (inclusivo). O que vem depois do último marco é a conversa atual.

⚠️ O identificador é o uuid do reset, nunca o horário: a API devolve
milissegundos e o banco guarda microssegundos.
"""
import re
from bisect import bisect_left

_TETO_TITULO = 80
_SEM_PERGUNTA = "Conversa sem pergunta"


def _limpar(texto: str) -> str:
    return re.sub(r"\s+", " ", texto or "").strip()


def titulo_da_conversa(mensagens: list[dict]) -> str:
    perguntas = [_limpar(m.get("content")) for m in mensagens if m.get("role") == "user"]
    perguntas = [p for p in perguntas if p]
    if not perguntas:
        return _SEM_PERGUNTA
    titulo = next((p for p in perguntas if len(p.split()) > 3), perguntas[0])
    if len(titulo) > _TETO_TITULO:
        titulo = titulo[: _TETO_TITULO - 1].rstrip() + "…"
        titulo = titulo if len(titulo) == _TETO_TITULO else titulo.ljust(_TETO_TITULO - 1) + "…"
    return titulo


def _indice_do_trecho(instantes: list, instante) -> int:
    """Índice do primeiro reset com `created_at >= instante`."""
    return bisect_left(instantes, instante)


def recortar_conversas(resets: list[dict], mensagens: list[dict]) -> list[dict]:
    if not resets:
        return []
    instantes = [r["created_at"] for r in resets]
    grupos: dict[int, list[dict]] = {}
    for msg in mensagens:
        i = _indice_do_trecho(instantes, msg["created_at"])
        if i < len(resets):
            grupos.setdefault(i, []).append(msg)
    saida = []
    for i in sorted(grupos, reverse=True):
        msgs = grupos[i]
        saida.append({
            "id": resets[i]["id"],
            "ate": resets[i]["created_at"],
            "inicio": msgs[0]["created_at"],
            "titulo": titulo_da_conversa(msgs),
            "mensagens": len(msgs),
        })
    return saida


def limites_do_trecho(resets: list[dict], reset_id: str):
    for i, r in enumerate(resets):
        if r["id"] == reset_id:
            return (resets[i - 1]["created_at"] if i else None, r["created_at"])
    return None


def trecho_da_mensagem(resets: list[dict], instante) -> str | None:
    instantes = [r["created_at"] for r in resets]
    i = _indice_do_trecho(instantes, instante)
    return resets[i]["id"] if i < len(resets) else None
```

(O corte do título: simplificar para `titulo[:79].rstrip() + "…"` e, se o `rstrip` encurtar, ainda passar — o teste exige `len == 80`, então cortar em `titulo[:79] + "…"` **sem** `rstrip`. Usar a forma simples e ajustar o teste só se a regra de 80 exatos atrapalhar a leitura — registrar ruling.)

- [ ] **Step 4:** testes → PASS; suíte inteira → PASS.
- [ ] **Step 5:** `git commit -m "feat(conversas-anteriores): recorte e título das conversas encerradas"`

---

### Task 2: Rotas e busca

**Files:**
- Modify: `backend/app/routers/conversations.py` (duas rotas; declarar **antes** de `@router.get("/{agent_id}")`)
- Modify: `backend/app/routers/chat_extras.py` (`ResultadoBusca.conversa_anterior`, cálculo na `busca`)
- Test: `backend/tests/test_conversas_anteriores.py` (acrescentar)

**Interfaces:**
- Consumes: Task 1.
- Produces (HTTP):
  - `GET /conversations/{agent_id}/anteriores` → `list[ConversaAnteriorOut]` com `{id: str, ate: str ISO Z, inicio: str ISO Z, titulo: str, mensagens: int}`.
  - `GET /conversations/{agent_id}/anteriores/{reset_id}` → `list[MensagemOut]` crescente, até 500; 404 se `reset_id` não é uuid ou não é reset da pessoa com o agente.
  - `ResultadoBusca.conversa_anterior: str | None`.
- Produces (Python): `SQL_RESETS` (`id::text, created_at` do par, crescente), `def _iso(dt) -> str` (`YYYY-MM-DDTHH:MM:SS.mmmZ` UTC).

- [ ] **Step 1: testes que falham** — acrescentar:
  - `_iso` de um `datetime` UTC com microssegundos → string com milissegundos e `Z`.
  - `SQL_RESETS` filtra `user_id` **e** `agent_id` (assert no texto) — docstring: sem o `agent_id`, o reset de outra conversa recortaria esta.
  - `ConversaAnteriorOut(**{...})` aceita o dicionário do recorte depois de `_iso`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar.**
  - Em `conversations.py`, perto de `_ultimo_reset`:

```python
SQL_RESETS = (
    "SELECT id::text AS id, created_at FROM public.conversation_resets "
    " WHERE user_id = $1::uuid AND agent_id = $2 ORDER BY created_at"
)


def _iso(dt) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


class ConversaAnteriorOut(BaseModel):
    id: str
    ate: str
    inicio: str
    titulo: str
    mensagens: int
```

  - Rotas (declaradas antes de `historico`):

```python
@router.get("/{agent_id}/anteriores", response_model=list[ConversaAnteriorOut])
async def conversas_anteriores(agent_id: str, usuario: Usuario = Depends(agente_visivel)):
    """As conversas que "Nova conversa" encerrou, da mais nova à mais antiga.

    Só leitura e só da própria pessoa — o RLS de `conversations` e de
    `conversation_resets` garante. Ver `app/conversas_anteriores.py`.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        resets = [dict(r) for r in await conn.fetch(SQL_RESETS, usuario.id, agent_id)]
        if not resets:
            return []
        msgs = [dict(r) for r in await conn.fetch(
            "SELECT role, content, created_at FROM public.conversations "
            " WHERE agent_id = $1 AND user_id = $2::uuid AND created_at <= $3 "
            " ORDER BY created_at",
            agent_id, usuario.id, resets[-1]["created_at"])]
    return [ConversaAnteriorOut(id=c["id"], ate=_iso(c["ate"]), inicio=_iso(c["inicio"]),
                                titulo=c["titulo"], mensagens=c["mensagens"])
            for c in recortar_conversas(resets, msgs)]


@router.get("/{agent_id}/anteriores/{reset_id}", response_model=list[MensagemOut])
async def conversa_anterior(agent_id: str, reset_id: str,
                            usuario: Usuario = Depends(agente_visivel)):
    """As mensagens de uma conversa encerrada, em ordem, até 500."""
    if not eh_uuid(reset_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        resets = [dict(r) for r in await conn.fetch(SQL_RESETS, usuario.id, agent_id)]
        limites = limites_do_trecho(resets, reset_id)
        if limites is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        depois_de, ate = limites
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM public.conversations "
            " WHERE agent_id = $1 AND user_id = $2::uuid "
            "   AND created_at <= $3 AND ($4::timestamptz IS NULL OR created_at > $4) "
            " ORDER BY created_at LIMIT 500",
            agent_id, usuario.id, ate, depois_de)
    return [_para_saida(l) for l in linhas]
```

  - `chat_extras.py`: `ResultadoBusca` ganha `conversa_anterior: str | None = None`. Na `busca`, depois de buscar `conversas`, para cada `agent_id` distinto buscar `SQL_RESETS` (importar de `routers.conversations` gera ciclo? — conferir; se gerar, mover `SQL_RESETS` para `app/conversas_anteriores.py` e importar dos dois) e calcular `trecho_da_mensagem(resets, created_at)`. A consulta de `conversas` passa a trazer também `created_at AS criado_bruto` (o atual é string).

- [ ] **Step 4:** suíte → PASS.
- [ ] **Step 5:** `git commit -m "feat(conversas-anteriores): rotas de leitura e conversa certa na busca"`

---

### Task 3: Front — regras puras (`lib/conversas-anteriores.ts`)

**Files:**
- Create: `frontend/src/lib/conversas-anteriores.ts`
- Test: `frontend/src/lib/conversas-anteriores.test.ts`

**Interfaces:**
- Produces:
  - `citarTrecho(texto: string): string` — cada linha com `> ` (linha vazia vira `>`), termina com `\n\n`.
  - `acrescentarCitacao(rascunho: string, texto: string): string` — rascunho vazio → só a citação; senão `rascunho` + (`\n\n` se não terminar em quebra) + citação.
  - `destinoDaBusca(r: { origem: string; id: string; conversa_anterior?: string | null }): string` — com `conversa_anterior`: `/chat?agent=<origem>&anterior=<reset>&message=<id>`; sem: `/chat?agent=<origem>&message=<id>` (o de hoje).
  - `export interface ConversaAnterior { id: string; ate: string; inicio: string; titulo: string; mensagens: number }`

- [ ] **Step 1: testes que falham** — um por regra, incluindo: citar texto com linha em branco no meio; acrescentar a rascunho que já termina com `\n`; destino da conversa atual igual ao de hoje (docstring: busca da conversa atual não pode mudar de lugar).
- [ ] **Step 2:** `npx vitest run src/lib/conversas-anteriores.test.ts` → FAIL.
- [ ] **Step 3: implementar** (funções diretas, `encodeURIComponent` nos três parâmetros).
- [ ] **Step 4:** PASS; lint.
- [ ] **Step 5:** `git commit -m "feat(conversas-anteriores): citar e destino da busca"`

---

### Task 4: Front — painel, ChatPage e busca

**Files:**
- Create: `frontend/src/components/chat/ConversasAnteriores.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx` (botão nos dois cabeçalhos; estado do painel; citar; parâmetro `anterior`)
- Modify: `frontend/src/components/GlobalSearch.tsx` (`target` via `destinoDaBusca`; tipo do achado com `conversa_anterior`)

**Interfaces:**
- Consumes: Task 2 (HTTP), Task 3.
- Produces: `<ConversasAnteriores agentId open onOpenChange abrirConversa?: string | null destacarMensagem?: string | null onCitar={(texto) => void} />`.

- [ ] **Step 1: teste que falha** — `ConversasAnteriores.test.tsx`: com `api` mockado devolvendo uma lista e depois mensagens, renderizar aberto, clicar no título, ver a faixa "só leitura" e o botão "Citar na conversa atual"; clicar chama `onCitar` com o conteúdo da mensagem.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar.**
  - Componente: `Sheet` (`side="right"`, largura `sm:max-w-lg`), título "Conversas anteriores". Estado `lista | null`, `aberta: ConversaAnterior | null`, `mensagens | null`, `erro`. Ao abrir: `GET /conversations/${agentId}/anteriores`. Ao escolher: `GET .../anteriores/${id}`. `abrirConversa` (vindo da URL) escolhe direto quando a lista chega; `destacarMensagem` rola até `[data-msg-id=...]` e realça por 2s.
  - Lista: botão por item com `titulo` (truncate), `format(inicio, "dd/MM/yyyy")` e "N mensagens". Vazia: "Ainda não há conversas anteriores com este agente." Erro: "Não consegui carregar as conversas anteriores."
  - Leitura: faixa `Conversa encerrada em dd/MM — só leitura` + "Voltar"; mensagens com `MarkdownMessageContent` (de `components/chat/MessageContent`), bolha à direita para `user` e à esquerda para `agent`, horário `HH:mm`; em cada uma, botões "Copiar" (`copyToClipboard` usado no `ChannelChat` — conferir o import) e "Citar na conversa atual".
  - `ChatPage`: estado `anterioresAberto`; botão `History` "Conversas anteriores" junto do "Nova conversa" (desktop) e no cabeçalho mobile (só ícone, com `title`). `onCitar = (texto) => { setAnterioresAberto(false); syncToDraft(acrescentarCitacao(inputLocalRef.current, texto)); requestAnimationFrame(() => { const ta = inputRef.current; if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }); }`. Ler `searchParams.get("anterior")` e `get("message")`: se `anterior` vier, abrir o painel com `abrirConversa=anterior` e `destacarMensagem=message`, e **não** usar o `message` para rolar a conversa atual (conferir o efeito que hoje lê `message`).
  - `GlobalSearch`: tipo do achado ganha `conversa_anterior?: string | null`; `target: destinoDaBusca(item)`.
- [ ] **Step 4:** vitest + lint (sem erro novo) + build.
- [ ] **Step 5:** `git commit -m "feat(conversas-anteriores): painel de conversas anteriores, citar e abrir pela busca"`

---

### Task 5: Verificação no rascunho, documentação, revisão e merge

**Files:**
- Modify: `CLAUDE.md` (parágrafo curto: o que é conversa anterior, identificador uuid, só leitura)
- Modify: `docs/CONTINUAR-AQUI.md` (item feito)

- [ ] **Step 1:** banco de rascunho (`NOME=hsos-rascunho-anteriores PORTA=5448 bash scripts/banco-rascunho.sh`), semear pessoa A e B, duas conversas encerradas e uma atual de A com `nina`, uma de B. Backend local na 8002 com `DATABASE_URL` do rascunho e gateway apontando para porta morta. Conferir por HTTP: lista de A (2 itens, títulos certos), abrir cada uma, `reset_id` de B → 404, `reset_id` de A com outro agente → 404, busca de um termo antigo traz `conversa_anterior`.
- [ ] **Step 2:** na tela (Playwright, token de A): abrir o painel, abrir conversa, citar, ver o trecho no campo; busca global → clicar resultado antigo → painel abre na conversa certa.
- [ ] **Step 3:** docs; commit.
- [ ] **Step 4:** revisor novo no branch inteiro; corrigir Critical/Important com teste; merge na `main` + push; derrubar rascunho e servidores **por PID**.
