# Vistos por mensagem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ✓ / ✓✓ cinza / ✓✓ azul em cada mensagem minha, em DM, grupo e conversa com agente, com "Dados da mensagem" em DM e grupo.

**Architecture:** Tabela `recibos_mensagem` (uma linha por mensagem de canal × membro humano destinatário), criada por trigger no `INSERT` de `channel_messages`. "Entregue" é marcado pelo servidor quando a pessoa tem `/ws` aberto; "lida" por `POST /channels/{id}/lido`. Um trigger por statement no `UPDATE` dos recibos avisa o canal pelo `pg_notify` existente. No agente, o estado é derivado de `conversations` + `agent_runs.pergunta_id`, sem tabela nova.

**Tech Stack:** FastAPI + asyncpg, Postgres 18, React + Vite + Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-14-vistos-por-mensagem-design.md`

## Global Constraints

- Código, comentários e textos em **português**; testes com docstring dizendo o que o defeito custaria.
- Migração nova é `020_recibos.sql`; **não editar a `001`**. Aplicar com `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-020.py`, que confere o efeito ao final.
- `recibos_mensagem` segue o padrão da `017_anexos`: RLS ligado, **sem policy**, `GRANT ALL ... TO service_role`; a autorização é Python, testada.
- `channel_members.user_id` é **`text`**; `recibos_mensagem.user_id` é `uuid`.
- O trigger de criação **nunca** pode impedir o `INSERT` da mensagem (recibo é acessório).
- Agente não é destinatário de recibo. Só membros `member_type = 'human'`, exceto o autor.
- O agregado considera só os **membros atuais** do canal.
- Horário sempre do servidor (`now()`).
- Backend: `cd backend && .venv/bin/python -m pytest tests -q`. Front: `cd frontend && npx vitest run`, `npm run lint`, `npm run build`.
- Fim: merge local na `main` e `git push` (push não faz deploy).

## Review Focus

- Membro com `user_id` não-uuid em `channel_members` (lixo herdado) → o trigger não pode derrubar o envio da mensagem. Coberto no `DO` de verificação da migração (Task 2).
- Duas abas do mesmo destinatário em workers diferentes → marcar entregue duas vezes não pode mudar o horário já gravado (`WHERE entregue_em IS NULL`). Coberto no teste do SQL de entrega (Task 4).
- Resposta do agente gravada pelo `/recuperar` (run sem `message_id`) → tem que dar azul, não ⚠. Coberto em `test_recibos.py` (Task 1) e `vistos.test.ts` (Task 6).
- Pessoa que saiu do grupo → não trava o azul. Coberto pela consulta só com membros atuais (Task 3) e pelo teste da regra (Task 1).
- Bolha otimista do agente (`id` ainda não-uuid) não pode ir como `pergunta_id` → filtrada por regex no front (Task 8) e o backend ignora valor não-uuid (Task 5).

---

### Task 1: Regras puras de estado (`app/recibos.py`)

**Files:**
- Create: `backend/app/recibos.py`
- Test: `backend/tests/test_recibos.py`

**Interfaces:**
- Produces:
  - `estado_no_canal(destinatarios: int, entregues: int, lidas: int) -> str` → `"enviada" | "entregue" | "lida"`
  - `estado_no_agente(tem_resposta_depois: bool, run_criado_em: datetime | None, agora: datetime) -> str` → `"enviada" | "entregue" | "lida" | "falhou"`
  - `JANELA_DO_RUN = timedelta(minutes=30)`
  - `eh_uuid(valor: object) -> bool`

- [ ] **Step 1: testes que falham** — `tests/test_recibos.py`:

```python
"""Regras do visto por mensagem (spec 2026-10-14).

O estado que a bolha mostra é decidido aqui, sem banco. Errar aqui é mentir
para quem mandou a mensagem — o caso mais caro é o azul que nunca acende.
"""
from datetime import datetime, timedelta, timezone

from app.recibos import JANELA_DO_RUN, eh_uuid, estado_no_agente, estado_no_canal

AGORA = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def test_canal_sem_destinatario_e_enviada():
    """Canal só comigo, ou só com agentes: não há quem receba, e "lida" seria mentira."""
    assert estado_no_canal(0, 0, 0) == "enviada"


def test_canal_todos_leram_e_lida():
    assert estado_no_canal(3, 3, 3) == "lida"


def test_canal_azul_so_quando_todos_leram():
    """No grupo, uma pessoa que não leu segura o azul — igual ao WhatsApp."""
    assert estado_no_canal(3, 3, 2) == "entregue"


def test_canal_cinza_so_quando_todos_receberam():
    assert estado_no_canal(3, 2, 0) == "enviada"


def test_canal_lida_implica_entregue_mesmo_com_contagem_inconsistente():
    """Lida sem entregue não deveria existir, mas se existir o azul vence."""
    assert estado_no_canal(2, 1, 2) == "lida"


def test_agente_com_resposta_depois_e_lida_mesmo_sem_run():
    """⚠️ O `/recuperar` grava a resposta sem preencher o run. Pela regra antiga
    (azul = run com message_id), 74 de 140 respostas de uma semana ficariam ⚠."""
    assert estado_no_agente(True, None, AGORA) == "lida"
    assert estado_no_agente(True, AGORA - timedelta(hours=5), AGORA) == "lida"


def test_agente_run_recente_sem_resposta_e_entregue():
    assert estado_no_agente(False, AGORA - timedelta(minutes=2), AGORA) == "entregue"


def test_agente_run_velho_sem_resposta_falhou():
    assert estado_no_agente(False, AGORA - JANELA_DO_RUN - timedelta(seconds=1), AGORA) == "falhou"


def test_agente_sem_run_e_enviada():
    """Gravou mas o `/send` não chegou ao gateway (ou é anterior à migração)."""
    assert estado_no_agente(False, None, AGORA) == "enviada"


def test_eh_uuid():
    assert eh_uuid("6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10")
    assert not eh_uuid("m1739999-fileop")
    assert not eh_uuid(None)
```

- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_recibos.py -q` → FAIL (`No module named app.recibos`).

- [ ] **Step 3: implementação** — `app/recibos.py`:

```python
"""Visto por mensagem — as regras, sem banco (spec 2026-10-14).

Canal: uma linha em `recibos_mensagem` por mensagem × membro humano destinatário
(o autor e os agentes não entram). Agente: derivado de `conversations` e de
`agent_runs.pergunta_id` — não há tabela de recibo para ele.
"""
import re
from datetime import datetime, timedelta

# Mesma janela de `turno_em_curso`: run sem resposta passado disso é dado como
# perdido.
JANELA_DO_RUN = timedelta(minutes=30)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def eh_uuid(valor: object) -> bool:
    return isinstance(valor, str) and bool(_UUID.match(valor))


def estado_no_canal(destinatarios: int, entregues: int, lidas: int) -> str:
    """O visto de uma mensagem de canal, a partir dos membros ATUAIS.

    Sem destinatário é "enviada": não há quem leia, e azul seria mentira.
    """
    if destinatarios <= 0:
        return "enviada"
    if lidas >= destinatarios:
        return "lida"
    if entregues >= destinatarios:
        return "entregue"
    return "enviada"


def estado_no_agente(tem_resposta_depois: bool, run_criado_em: datetime | None,
                     agora: datetime) -> str:
    """O visto de uma pergunta ao agente.

    ⚠️ Azul é "há resposta do agente depois", NÃO "o run tem `message_id`": o
    `/recuperar` grava resposta sem preencher o run.
    """
    if tem_resposta_depois:
        return "lida"
    if run_criado_em is None:
        return "enviada"
    if agora - run_criado_em > JANELA_DO_RUN:
        return "falhou"
    return "entregue"
```

- [ ] **Step 4:** rodar o teste → PASS; rodar a suíte inteira → PASS.
- [ ] **Step 5:** `git commit -m "feat(recibos): regras puras do visto por mensagem"`

---

### Task 2: Migração `020_recibos.sql` + aplicar

**Files:**
- Create: `backend/migrations/020_recibos.sql`
- Create: `~/aplicar-hsos-020.py` (fora do repo, como os anteriores)
- Modify: `backend/migrations/README.md` (linha da 020, no padrão das outras)

**Interfaces:**
- Produces: tabela `public.recibos_mensagem(message_id uuid, user_id uuid, entregue_em timestamptz, lida_em timestamptz)`, coluna `agent_runs.pergunta_id uuid`, evento `pg_notify('hsos_mudancas', {tabela:'recibos_mensagem', op:'UPDATE', id:null, channel_id})` uma vez por canal por statement de `UPDATE`.

- [ ] **Step 1: escrever a migração**

```sql
-- 020_recibos.sql — visto por mensagem, igual ao WhatsApp (spec 2026-10-14)
--
-- Uma linha por mensagem de canal × membro HUMANO destinatário (o autor e os
-- agentes não entram — agente não "abre" canal e travaria o azul para sempre).
-- `entregue_em`: o navegador da pessoa estava conectado (`/ws`) — marcado pelo
-- servidor. `lida_em`: a pessoa abriu o canal (`POST /channels/{id}/lido`).
--
-- Sem policy para `authenticated`, de propósito, como na `017_anexos`: toda
-- leitura passa pelo backend como `service_role`, e quem decide é o Python.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-020.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.recibos_mensagem (
    message_id  uuid NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL,
    entregue_em timestamptz,
    lida_em     timestamptz,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS recibos_pendentes_idx
    ON public.recibos_mensagem (user_id) WHERE lida_em IS NULL;

ALTER TABLE public.recibos_mensagem ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.recibos_mensagem TO service_role;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS pergunta_id uuid;
CREATE INDEX IF NOT EXISTS agent_runs_pergunta_idx
    ON public.agent_runs (pergunta_id) WHERE pergunta_id IS NOT NULL;

-- ─── Criar os recibos de uma mensagem nova ─────────────────────────────────
-- ⚠️ Nunca pode impedir a mensagem: recibo é acessório. Qualquer erro vira
-- WARNING e a mensagem é gravada sem recibo.
-- ⚠️ `channel_members.user_id` é TEXT; o filtro por regex evita que um id
-- herdado fora do formato estoure o cast.
CREATE OR REPLACE FUNCTION public.criar_recibos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.author_type::text <> 'human' AND NEW.author_type::text <> 'agent' THEN
        RETURN NULL;
    END IF;
    INSERT INTO public.recibos_mensagem (message_id, user_id)
    SELECT NEW.id, cm.user_id::uuid
      FROM public.channel_members cm
     WHERE cm.channel_id = NEW.channel_id
       AND cm.member_type = 'human'
       AND cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND cm.user_id <> NEW.author_id
    ON CONFLICT DO NOTHING;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'criar_recibos(%): %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_criar_recibos ON public.channel_messages;
CREATE TRIGGER trg_criar_recibos
    AFTER INSERT ON public.channel_messages
    FOR EACH ROW EXECUTE FUNCTION public.criar_recibos();

-- ─── Avisar o canal quando um recibo muda ──────────────────────────────────
-- Por STATEMENT: marcar 50 mensagens como lidas vira um aviso por canal, não
-- cinquenta. Só UPDATE: o INSERT é "enviada", que quem mandou já sabe.
-- O formato é o do `notificar_mudanca` (003), para o `escuta_banco` rotear
-- pelo `channel_id` sem mudança.
CREATE OR REPLACE FUNCTION public.notificar_recibos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    canal uuid;
BEGIN
    FOR canal IN
        SELECT DISTINCT m.channel_id
          FROM novas n JOIN public.channel_messages m ON m.id = n.message_id
    LOOP
        PERFORM pg_notify('hsos_mudancas', json_build_object(
            'tabela', 'recibos_mensagem', 'op', 'UPDATE', 'id', NULL,
            'user_id', NULL, 'channel_id', canal, 'agent_id', NULL)::text);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_recibos ON public.recibos_mensagem;
CREATE TRIGGER trg_notificar_recibos
    AFTER UPDATE ON public.recibos_mensagem
    REFERENCING NEW TABLE AS novas
    FOR EACH STATEMENT EXECUTE FUNCTION public.notificar_recibos();

-- ─── Retroativo ────────────────────────────────────────────────────────────
-- Mensagens já existentes ganham recibo dos membros humanos atuais. Lida e
-- entregue no horário do `dm_reads` quando ele já passou da mensagem.
INSERT INTO public.recibos_mensagem (message_id, user_id, entregue_em, lida_em)
SELECT m.id, cm.user_id::uuid,
       CASE WHEN d.last_read_at >= m.created_at THEN d.last_read_at END,
       CASE WHEN d.last_read_at >= m.created_at THEN d.last_read_at END
  FROM public.channel_messages m
  JOIN public.channel_members cm
    ON cm.channel_id = m.channel_id AND cm.member_type = 'human'
   AND cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND cm.user_id <> m.author_id
  LEFT JOIN public.dm_reads d
    ON d.channel_id = m.channel_id AND d.user_id = cm.user_id::uuid
ON CONFLICT DO NOTHING;

COMMIT;
```

Antes de escrever, conferir no banco o tipo de `channel_messages.author_id` e os valores do enum `author_type` (`SELECT unnest(enum_range(NULL::public.author_type))`). Se `author_id` não for `text`, ajustar a comparação `cm.user_id <> NEW.author_id` para `cm.user_id <> NEW.author_id::text`. O `IF` de `author_type` existe só para não criar recibo de tipos que não sejam pessoa/agente (ex.: `system`); se o enum só tiver `human`/`agent`, remover o `IF`.

- [ ] **Step 2: script de aplicar** — `~/aplicar-hsos-020.py`, no molde do `aplicar-hsos-019.py`. Depois do `execute` + `commit`, conferir e imprimir:
  - `to_regclass('public.recibos_mensagem')` não nulo;
  - triggers `trg_criar_recibos` e `trg_notificar_recibos` existem (`pg_trigger`);
  - coluna `agent_runs.pergunta_id` existe;
  - retroativo: `count(*)` de `recibos_mensagem` == número esperado, calculado pela mesma junção `channel_messages × channel_members humanos ≠ autor`;
  - **o trigger não derruba INSERT**: dentro de uma transação com `ROLLBACK` no fim, inserir uma `channel_messages` no canal existente e conferir que gerou recibo, depois `ROLLBACK` (nada fica gravado).
  - imprimir `✅ aplicada e conferida` ou `❌ NÃO bateu`.

- [ ] **Step 3:** rodar `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-020.py` → `✅`.
- [ ] **Step 4:** linha da 020 no `backend/migrations/README.md`; `git commit -m "feat(recibos): migração 020 — recibos por mensagem e pergunta_id do run"`

---

### Task 3: Rotas de canal — lido, estados e "Dados da mensagem"

**Files:**
- Create: `backend/app/routers/recibos.py`
- Modify: `backend/app/main.py` (importar e `include_router` junto dos outros)
- Modify: `backend/app/routers/chat_extras.py` (docstring do módulo: `dm_reads` aposentado; as rotas `/dm-reads` **ficam** até a Task 7 tirar o último chamador, e são removidas lá)
- Test: `backend/tests/test_recibos_rotas.py`

**Interfaces:**
- Consumes: `estado_no_canal` (Task 1).
- Produces (HTTP):
  - `POST /channels/{channel_id}/lido` → `204`. 404 se não for membro.
  - `GET /channels/{channel_id}/recibos` → `{"<message_id>": "enviada"|"entregue"|"lida", ...}` das minhas mensagens humanas, não apagadas, últimos 90 dias, até 500.
  - `GET /channels/{channel_id}/messages/{message_id}/recibos` → `[{user_id, nome, entregue_em, lida_em}]`, membros humanos atuais ≠ autor, ordenado por `lida_em NULLS LAST, entregue_em NULLS LAST, nome`. 404 se eu não for o autor.
- Produces (Python): `SQL_MARCAR_LIDO`, `SQL_ESTADOS`, `SQL_DETALHE`, `async def _membro(conn, channel_id, user_id) -> bool`, `def _mapa_de_estados(linhas) -> dict[str, str]`.

- [ ] **Step 1: testes que falham** — no padrão do repo (sem banco): testar `_mapa_de_estados` com linhas falsas (`{"id":..., "destinatarios":..., "entregues":..., "lidas":...}`) e que `SQL_ESTADOS` **filtra por membro atual** (assert de que o texto do SQL contém `channel_members` e `member_type = 'human'`), e que `SQL_MARCAR_LIDO` usa `COALESCE(entregue_em, now())` e `lida_em IS NULL`. Docstring: membro que saiu travaria o azul; marcar lido sem entregar deixaria lida sem entregue.

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: implementar** `routers/recibos.py`:

```python
"""Visto por mensagem nos canais — lido, estados e "Dados da mensagem".

Substitui o `/dm-reads` (um horário por pessoa e canal). Ver spec
2026-10-14-vistos-por-mensagem-design.md e `app/recibos.py`.

Tudo como `service_role`, como nos anexos: a tabela não tem policy, e a regra
de quem vê o quê está aqui — membro do canal; o detalhe, só o autor.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.recibos import estado_no_canal

router = APIRouter(prefix="/channels", tags=["chat"])

SQL_MEMBRO = """SELECT 1 FROM public.channel_members
                 WHERE channel_id = $1::uuid AND user_id = $2 LIMIT 1"""

SQL_MARCAR_LIDO = """
    UPDATE public.recibos_mensagem r
       SET lida_em = now(), entregue_em = COALESCE(r.entregue_em, now())
      FROM public.channel_messages m
     WHERE r.message_id = m.id AND m.channel_id = $1::uuid
       AND r.user_id = $2::uuid AND r.lida_em IS NULL
"""

# Só membros ATUAIS contam: quem saiu do grupo não pode travar o azul.
SQL_ESTADOS = """
    SELECT m.id::text AS id,
           count(r.user_id)                                   AS destinatarios,
           count(r.user_id) FILTER (WHERE r.entregue_em IS NOT NULL) AS entregues,
           count(r.user_id) FILTER (WHERE r.lida_em IS NOT NULL)     AS lidas
      FROM public.channel_messages m
      LEFT JOIN public.recibos_mensagem r
        ON r.message_id = m.id
       AND EXISTS (SELECT 1 FROM public.channel_members cm
                    WHERE cm.channel_id = m.channel_id AND cm.member_type = 'human'
                      AND cm.user_id = r.user_id::text)
     WHERE m.channel_id = $1::uuid AND m.author_id = $2
       AND m.author_type::text = 'human' AND m.deleted_at IS NULL
       AND m.created_at > now() - interval '90 days'
     GROUP BY m.id, m.created_at
     ORDER BY m.created_at DESC
     LIMIT 500
"""

SQL_DETALHE = """
    SELECT r.user_id::text AS user_id,
           COALESCE(NULLIF(p.full_name, ''), p.email, 'Sem nome') AS nome,
           to_char(r.entregue_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS entregue_em,
           to_char(r.lida_em     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS lida_em
      FROM public.recibos_mensagem r
      JOIN public.channel_members cm
        ON cm.channel_id = $1::uuid AND cm.member_type = 'human' AND cm.user_id = r.user_id::text
      LEFT JOIN public.profiles p ON p.id = r.user_id
     WHERE r.message_id = $2::uuid
     ORDER BY r.lida_em NULLS LAST, r.entregue_em NULLS LAST, nome
"""


def _mapa_de_estados(linhas) -> dict[str, str]:
    return {l["id"]: estado_no_canal(l["destinatarios"], l["entregues"], l["lidas"])
            for l in linhas}


async def _membro(conn, channel_id: str, user_id: str) -> bool:
    return bool(await conn.fetchval(SQL_MEMBRO, channel_id, user_id))
```

Rotas: cada uma abre `sessao(role="service_role")`, chama `_membro` e levanta `404 "Canal não encontrado."` se falso (404, não 403: não revelar que o canal existe). O detalhe confere `SELECT author_id FROM channel_messages WHERE id=$1 AND channel_id=$2` == `usuario.id`, senão `404 "Mensagem não encontrada."`. O `p.email` do `SQL_DETALHE`: conferir se `profiles` tem `email`; se não, usar só `full_name`. Ajustar o teste do Step 1 ao que ficar.

- [ ] **Step 4:** suíte inteira → PASS. Subir o backend local (`uvicorn app.main:app --port 8002`) e conferir as três rotas no `/docs` contra o banco, com o token de dev.
- [ ] **Step 5:** `git commit -m "feat(recibos): lido, estados e dados da mensagem nos canais"`

---

### Task 4: Entregue — marcar pelo `/ws`

**Files:**
- Create: `backend/app/recibos_entrega.py`
- Modify: `backend/app/realtime.py` (método `usuarios_conectados`)
- Modify: `backend/app/routers/ws.py` (marcar pendentes ao conectar)
- Modify: `backend/app/escuta_banco.py` (no `INSERT` de `channel_messages`, disparar a marcação)
- Test: `backend/tests/test_recibos_entrega.py`

**Interfaces:**
- Produces:
  - `Hub.usuarios_conectados(self) -> set[str]` — ids com tópico `usuario:<id>` assinado **neste processo**.
  - `recibos_entrega.SQL_ENTREGAR_PENDENTES` (por `$1::uuid` usuário), `SQL_ENTREGAR_MENSAGEM` (por `$1::uuid` mensagem e `$2::uuid[]` usuários), ambos com `WHERE entregue_em IS NULL`.
  - `async def entregar_pendentes(user_id: str) -> None` e `async def entregar_mensagem(message_id: str) -> None` — nunca levantam; erro vira `logger.warning`.
  - `def disparar(coro) -> None` — `asyncio.get_running_loop().create_task` guardando referência num `set` (sem isso o GC pode matar a task), com `add_done_callback(discard)`.

- [ ] **Step 1: testes que falham:**
  - `Hub().usuarios_conectados()` devolve só os ids de tópicos `usuario:` (assinar `["usuario:a", "canal:x"]` → `{"a"}`), e some depois do `cancelar`.
  - `SQL_ENTREGAR_*` contêm `entregue_em IS NULL` (docstring: duas abas em workers diferentes marcariam de novo e o horário do "Dados da mensagem" andaria).
  - `entregar_mensagem` sem ninguém conectado **não abre conexão** (monkeypatch de `sessao` que falha se chamado).

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: implementar.**

`realtime.py`, na classe `Hub`:

```python
    def usuarios_conectados(self) -> set[str]:
        """Quem tem `/ws` aberto NESTE processo. São 2 workers: cada um sabe
        dos seus, e é assim que o "entregue" dispensa registro de presença."""
        prefixo = topico_usuario("")
        return {t[len(prefixo):] for t in self._filas if t.startswith(prefixo)}
```

`recibos_entrega.py`:

```python
"""Marca "entregue" — o navegador da pessoa estava conectado (spec 2026-10-14).

Quem marca é o servidor, não um "recebi" do navegador: a tela não precisa
estar no canal, e o cliente não precisa lembrar de confirmar. Cada worker
marca para quem está ligado nele; o `entregue_em IS NULL` torna repetir inócuo.
"""
import asyncio
import logging

from app.database import sessao
from app.realtime import hub

logger = logging.getLogger(__name__)

SQL_ENTREGAR_PENDENTES = """
    UPDATE public.recibos_mensagem SET entregue_em = now()
     WHERE user_id = $1::uuid AND entregue_em IS NULL
"""

SQL_ENTREGAR_MENSAGEM = """
    UPDATE public.recibos_mensagem SET entregue_em = now()
     WHERE message_id = $1::uuid AND user_id = ANY($2::uuid[]) AND entregue_em IS NULL
"""

_TAREFAS: set[asyncio.Task] = set()


def disparar(coro) -> None:
    try:
        tarefa = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _TAREFAS.add(tarefa)
    tarefa.add_done_callback(_TAREFAS.discard)


async def entregar_pendentes(user_id: str) -> None:
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(SQL_ENTREGAR_PENDENTES, user_id)
    except Exception as e:  # noqa: BLE001 — recibo é acessório
        logger.warning("Recibo: entregar pendentes de %s falhou: %s", user_id, e)


async def entregar_mensagem(message_id: str) -> None:
    conectados = [u for u in hub.usuarios_conectados() if _eh_uuid(u)]
    if not conectados:
        return
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(SQL_ENTREGAR_MENSAGEM, message_id, conectados)
    except Exception as e:  # noqa: BLE001
        logger.warning("Recibo: entregar %s falhou: %s", message_id, e)
```

(com `from app.recibos import eh_uuid as _eh_uuid`).

`ws.py`: logo depois de `fila = hub.assinar(topicos)`, `recibos_entrega.disparar(recibos_entrega.entregar_pendentes(user_id))`.

`escuta_banco._ao_receber`: depois das publicações, `if tabela == "channel_messages" and op == "INSERT" and ident: recibos_entrega.disparar(recibos_entrega.entregar_mensagem(ident))`. O callback do asyncpg roda no loop, então `get_running_loop` funciona; o `try` amplo já existente cobre o resto.

- [ ] **Step 4:** suíte → PASS.
- [ ] **Step 5:** `git commit -m "feat(recibos): entregue marcado pelo servidor quando a pessoa está conectada"`

---

### Task 5: Agente — `pergunta_id` no envio e `recibo` no histórico

**Files:**
- Modify: `backend/app/routers/conversations.py` (`MensagemOut`, `EnvioIn`, `_guardar_run`, `enviar`, `historico`)
- Test: `backend/tests/test_conversations.py` (acrescentar)

**Interfaces:**
- Consumes: `estado_no_agente`, `eh_uuid` (Task 1).
- Produces: `MensagemOut.recibo: str | None = None` (preenchido só em `role="user"` no `GET /conversations/{agent_id}`); `EnvioIn.pergunta_id: str | None = None`; `_guardar_run(..., pergunta_id: str | None = None)`; `def _recibos_do_agente(linhas, runs: dict[str, datetime], agora) -> dict[str, str]`.

- [ ] **Step 1: teste que falha** — `_recibos_do_agente` com uma lista em ordem decrescente (como o `historico` busca): `[agent t3, user t2, user t1]` + `runs={}` → `t2` e `t1` são `"lida"` (há agente depois); `[user t2, agent t1]` com run de 1 min para `t2` → `"entregue"`; mesmo com run de 40 min → `"falhou"`. Docstring: a regra precisa olhar o que vem DEPOIS na conversa, e a página vem invertida.

⚠️ A página pode terminar numa pergunta cuja resposta é mais nova que a página? Não: a página é decrescente a partir do mais novo (ou de `antes_de`); para a paginação para trás, a mais nova da página pode ter resposta fora dela. Por isso a consulta do Step 3 usa `EXISTS` no banco para a mensagem mais nova da página, e `_recibos_do_agente` recebe `resposta_apos_a_pagina: bool`. Incluir no teste: `[user t5]`, `resposta_apos_a_pagina=True` → `"lida"`.

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: implementar.**

```python
def _recibos_do_agente(linhas, runs: dict, agora, resposta_apos_a_pagina: bool) -> dict[str, str]:
    """Visto de cada pergunta da página. `linhas` vem DECRESCENTE."""
    saida: dict[str, str] = {}
    resposta_depois = resposta_apos_a_pagina
    for l in linhas:
        if l["role"] == "agent":
            resposta_depois = True
            continue
        saida[l["id"]] = estado_no_agente(resposta_depois, runs.get(l["id"]), agora)
    return saida
```

`historico`: depois do `fetch`, se houver linhas `user`, numa sessão `authenticated`:
  - `runs`: `SELECT pergunta_id::text, criado_em FROM public.agent_runs WHERE pergunta_id = ANY($1::uuid[])` (o RLS `dono_le` já restringe ao dono).
  - `resposta_apos_a_pagina`: `SELECT EXISTS(SELECT 1 FROM public.conversations WHERE agent_id=$1 AND user_id=$2::uuid AND role='agent' AND created_at > $3)` com o `created_at` da mais nova da página — mas **só** quando `antes_de` veio (sem ele a página já começa no mais novo; poupar a consulta). O `created_at` de `_COLUNAS` é string; buscar o `created_at` cru numa coluna extra (`created_at AS criado_bruto`) ou converter com `datetime.fromisoformat(s.replace("Z", "+00:00"))`.
  - montar `MensagemOut(..., recibo=mapa.get(id))`.

`enviar`: `pergunta = dados.pergunta_id if eh_uuid(dados.pergunta_id) else None` e passar a `_guardar_run`, que grava `pergunta_id` (`$6::uuid`). Valor não-uuid é ignorado em silêncio (bolha otimista).

- [ ] **Step 4:** suíte → PASS.
- [ ] **Step 5:** `git commit -m "feat(recibos): visto na conversa com agente (pergunta_id no run)"`

---

### Task 6: Front — `VistoDaMensagem` e as regras de exibição

**Files:**
- Create: `frontend/src/lib/vistos.ts`
- Create: `frontend/src/components/chat/VistoDaMensagem.tsx`
- Test: `frontend/src/lib/vistos.test.ts`

**Interfaces:**
- Produces:
  - `export type EstadoDoVisto = "pendente" | "enviada" | "entregue" | "lida" | "falhou";`
  - `export function estadoNoCanal(msgId: string, recibos: Record<string, string>): EstadoDoVisto` — `optimistic-*` → `pendente`; senão `recibos[msgId]` válido, senão `"enviada"`.
  - `export function estadoNoAgente(msgs: ChatMessage[], indice: number, agenteTrabalhando: boolean): EstadoDoVisto` — id não-uuid → `pendente`; mensagem `agent` posterior sem `isError` → `lida`; `isError` posterior antes de qualquer resposta → `falhou`; é a última `user` e `agenteTrabalhando` → `entregue`; senão `msg.recibo ?? "enviada"`.
  - `export const UUID_RE: RegExp`
  - `<VistoDaMensagem estado={...} className? />`

- [ ] **Step 1: testes que falham** (`vistos.test.ts`), um por regra acima, incluindo: resposta posterior vence o `recibo: "falhou"` vindo do servidor (resposta via `/recuperar`); bolha `m123-fileop` é `pendente`.
- [ ] **Step 2:** `npx vitest run src/lib/vistos.test.ts` → FAIL.
- [ ] **Step 3: implementar** `vistos.ts` e o componente:

```tsx
import { AlertTriangle, Check, CheckCheck, Clock } from "lucide-react";
import type { EstadoDoVisto } from "@/lib/vistos";

const ROTULO: Record<EstadoDoVisto, string> = {
  pendente: "Enviando…", enviada: "Enviada", entregue: "Entregue",
  lida: "Lida", falhou: "Não foi entregue",
};

/** O visto do WhatsApp ao lado do horário — só em mensagem minha. */
export default function VistoDaMensagem({ estado, className = "" }: { estado: EstadoDoVisto; className?: string }) {
  const comum = `h-3.5 w-3.5 shrink-0 ${className}`;
  const icone =
    estado === "pendente" ? <Clock className={comum} /> :
    estado === "enviada" ? <Check className={comum} /> :
    estado === "entregue" ? <CheckCheck className={comum} /> :
    estado === "lida" ? <CheckCheck className={`${comum} text-sky-500`} /> :
    <AlertTriangle className={`${comum} text-destructive`} />;
  return <span role="img" aria-label={ROTULO[estado]} title={ROTULO[estado]} className="inline-flex">{icone}</span>;
}
```

`ChatMessage` (`lib/mock-data.ts`) ganha `recibo?: "enviada" | "entregue" | "lida" | "falhou";`.

- [ ] **Step 4:** vitest → PASS; `npm run lint` sem erro novo.
- [ ] **Step 5:** `git commit -m "feat(recibos): componente do visto e regras de exibição"`

---

### Task 7: Front — canais (DM, grupo, thread) e "Dados da mensagem"

**Files:**
- Create: `frontend/src/hooks/use-recibos.ts`
- Create: `frontend/src/components/chat/DadosDaMensagem.tsx`
- Modify: `frontend/src/components/chat/ChannelChat.tsx` (trocar `useDmReads`; passar `visto` ao `MessageBubble`; item de menu; remover o "Visto às" e o `lastSeenOwnIndex`)
- Modify: `frontend/src/components/chat/ThreadPanel.tsx` (visto nas minhas respostas)
- Delete: `frontend/src/hooks/use-dm-reads.ts`
- Modify: `backend/app/routers/chat_extras.py` (remover `GET/PUT /dm-reads` depois de confirmar com `grep -rn "dm-reads" frontend/src` vazio)
- Test: `frontend/src/components/chat/ChannelChat.menu.test.tsx` (acrescentar "Dados da mensagem" só em mensagem própria)

**Interfaces:**
- Consumes: `GET/POST` da Task 3; `estadoNoCanal`, `VistoDaMensagem` (Task 6); `assinar` de `@/lib/realtime`.
- Produces: `useRecibos(channelId: string | null, ativo: boolean, gatilho: number) -> { recibos: Record<string, string>; marcarLido: () => void }`; `MessageBubble` ganha props `visto?: EstadoDoVisto` e `onDadosDaMensagem?: () => void`.

- [ ] **Step 1: teste que falha** — em `ChannelChat.menu.test.tsx`, renderizar o `MessageBubble` com `msg.author_id === currentUserId` e `onDadosDaMensagem` → o menu tem "Dados da mensagem"; com mensagem de outra pessoa → não tem.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar.**
  - `use-recibos.ts`: `load()` = `api<Record<string,string>>(\`/channels/${id}/recibos\`)`; chamar no mount, quando `gatilho` (o `messages.length`) muda, e no evento `assinar(\`canal:${id}\`, (_t, d) => d?.tabela === "recibos_mensagem" && load())`. `marcarLido` com o mesmo throttle de 2s e os mesmos gatilhos do `useDmReads` (mensagens mudarem com aba visível, `visibilitychange`, `focus`), chamando `POST /channels/${id}/lido`. Erro é engolido (recibo é acessório), como hoje. Vale para **todo** canal, não só DM.
  - `ChannelChat.tsx`: remover `humanPeerId`/`useDmReads`/`lastSeenOwnIndex`/bloco "Visto às"; `const { recibos, marcarLido } = useRecibos(channel.id, true, messages.length)`; mover os dois `useEffect` de `markRead` para `marcarLido` sem a condição `isDm`. No `MessageBubble`, no rodapé `isOwn` (a `div` com o `HH:mm`, ~linha 569), acrescentar `{visto && <VistoDaMensagem estado={visto} />}` depois do horário. Em `acoesDoMenu`, dentro de `...(isOwn ? [...] : [])`, primeiro item `{ rotulo: "Dados da mensagem", icone: Info, aoEscolher: () => { onDadosDaMensagem?.(); setShowMobileMenu(false); } }`.
  - `DadosDaMensagem.tsx`: `Dialog` do shadcn; ao abrir busca `GET /channels/${channelId}/messages/${messageId}/recibos`; três seções — "Lida por" (`lida_em`), "Entregue a" (`entregue_em` sem `lida_em`), "Aguardando" (nenhum); cada linha `nome` + `format(new Date(x), "dd/MM HH:mm")`; estado de carregando e de erro ("Não consegui carregar os dados da mensagem").
  - `ThreadPanel.tsx`: receber `recibos` por prop do `ChannelChat` e mostrar `<VistoDaMensagem>` ao lado do `HH:mm` quando `isOwn` (~linha 253, com `className="text-primary-foreground/70"` no estado não-lido para contraste na bolha primária).
  - Remover as rotas `/dm-reads` do backend e atualizar a docstring do `chat_extras.py`.
- [ ] **Step 4:** vitest + lint + `npm run build` → OK; backend suíte → OK.
- [ ] **Step 5:** `git commit -m "feat(recibos): vistos e dados da mensagem nos canais"`

---

### Task 8: Front — conversa com agente

**Files:**
- Modify: `frontend/src/lib/chat-persistence.ts` (mapear `recibo` da linha para `ChatMessage.recibo`)
- Modify: `frontend/src/lib/agent-chat.ts` (`enviarParaAgente(..., perguntaId?: string)` manda `pergunta_id`)
- Modify: `frontend/src/lib/chat-sender.ts` (passar `ultima.id` quando `UUID_RE.test(ultima.id)`)
- Modify: `frontend/src/pages/ChatPage.tsx` (`despacharAoAgente` envia o histórico com a mensagem **persistida**, não a otimista; visto no rodapé `isOwn`, ~linha 569)

**Interfaces:**
- Consumes: `recibo` do `GET /conversations/{agent_id}` (Task 5); `estadoNoAgente`, `UUID_RE`, `VistoDaMensagem` (Task 6).

- [ ] **Step 1:** em `vistos.test.ts` já está a regra; aqui o teste é a integração do id: acrescentar em `vistos.test.ts` um caso documentando que `m${Date.now()}-fileop` não passa no `UUID_RE` (é o que impede mandar id otimista como `pergunta_id`).
- [ ] **Step 2:** rodar → PASS imediato é aceitável aqui (regra já existe); o que valida esta task é o Step 4 ao vivo.
- [ ] **Step 3: implementar.**
  - `chat-persistence.ts` (~linha 69, onde monta o `ChatMessage` da linha): `recibo: row.recibo ?? undefined`, e `recibo?: string | null` no tipo da linha.
  - `agent-chat.ts`: `body` ganha `...(perguntaId ? { pergunta_id: perguntaId } : {})`.
  - `chat-sender.ts` (~linha 926): `const perguntaId = ultima?.id && UUID_RE.test(ultima.id) ? ultima.id : undefined;` e passar.
  - `ChatPage.tsx` `despacharAoAgente`: guardar `persistedMessage` numa variável de fora do `try` e chamar `sendMessageInBackground(sendingAgentId, [...(messagesByAgent[sendingAgentId] ?? []), persistedMessage])`. Mesmo ajuste no handler `hsos:file-op-result` (~linha 1692) quando a persistência der certo.
  - Rodapé `isOwn` da bolha: `<VistoDaMensagem estado={estadoNoAgente(lista, index, isAgentWorking)} />` ao lado do `{time}` — conferir o nome real da lista e do índice no `map` (~linha 470).
- [ ] **Step 4:** lint + build + vitest → OK.
- [ ] **Step 5:** `git commit -m "feat(recibos): visto na conversa com agente"`

---

### Task 9: Verificação ao vivo e documentação

**Files:**
- Modify: `CLAUDE.md` (parágrafo curto em "Estado e persistência" ou seção própria: recibo por mensagem, quem marca entregue, azul do agente ≠ `message_id`, `dm_reads` aposentado)
- Modify: `docs/CONTINUAR-AQUI.md` (o lembrete de 14/10 vira "feito", com o que falta: deploy + a migração já aplicada)

- [ ] **Step 1:** backend local (8002) + `npm run dev`; duas sessões (navegador normal e anônimo) com duas pessoas numa DM:
  - enviar → ✓; com a outra aba aberta em qualquer tela → ✓✓ cinza sem recarregar;
  - a outra abre o canal → ✓✓ azul sem recarregar;
  - "Dados da mensagem" mostra o horário de entregue e de lida.
- [ ] **Step 2:** conversa com agente: relógio → ✓ → ✓✓ cinza durante a espera → ✓✓ azul quando a resposta chega; recarregar mantém o azul.
- [ ] **Step 3:** documentação; `git commit -m "docs(recibos): vistos por mensagem no CLAUDE.md e no CONTINUAR-AQUI"`
- [ ] **Step 4:** revisão do branch inteiro por um revisor novo; merge na `main` + `git push`.
