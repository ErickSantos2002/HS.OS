# Conversa entre pessoas e a empresa inteira como membros — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Devolver ao HS.OS a conversa entre pessoas (DM, canais de grupo e agente dentro do canal) e abrir o sistema para os 26 funcionários da Health & Safety, sem que isso abra caminho lateral para um agente que a pessoa não pode ver.

**Architecture:** A regra de acesso a agente passa a existir uma vez, como função SQL (`public.pode_ver_agente`), e um trigger em `channel_members` a impõe nas duas direções — agente só entra em canal onde todos os humanos o veem, e humano só entra em canal cujos agentes ele vê. O Python valida antes só para produzir mensagem humana. O front religa o caminho até o `ChannelChat`, que já existe e já renderiza DM. As contas nascem por um script que é cliente da API, não do banco.

**Tech Stack:** FastAPI + asyncpg + Postgres 17 (produção) · React 18 + Vite + TanStack Query · pytest 9 (backend) · psql para o teste de migração · Playwright MCP para a conferência no navegador.

**Spec:** [`docs/superpowers/specs/2026-09-01-chat-entre-pessoas-e-membros-design.md`](../specs/2026-09-01-chat-entre-pessoas-e-membros-design.md)

## Global Constraints

- **Idioma:** código, comentários, documentação e mensagens de erro em **português**. É a convenção do repositório.
- **Branch:** `chat-entre-pessoas`. Nada vai para `main` antes da conferência da Tarefa 8.
- **Migrations nunca são editadas depois de aplicadas.** A próxima livre é a `014`. A `008` é a única do diretório que se aplica noutro banco (`talenths-banco`) — **todo script que percorre o diretório precisa pulá-la**.
- **Backend roda na porta 8002** nesta máquina (8000 é do TaskHS, 8001 do GestorHS).
- **Testes do backend:** `cd backend && ./.venv/bin/python -m pytest tests -q`. Os testes existentes são funções puras com objeto falso — **nenhum teste do backend toca banco**. O que precisa de banco é testado por script SQL num banco de rascunho (Tarefa 1), não por pytest.
- **Nada é testado contra o banco de produção.** O banco de rascunho da Tarefa 1 é onde SQL se prova.
- **Não rodar `sudo` nesta sessão.** O que exigir superusuário do Postgres de produção vira script para o Erick rodar no Konsole.
- **Papéis do sistema são `administrador` e `colaborador`** — e não são hierarquia da empresa: o CEO é `colaborador`.
- **`channel_members.user_id` é `text`** e guarda tanto uuid de pessoa quanto `agent_id`; quem separa é `member_type` (`'human'` / `'agent'`). `agent_profiles.allowed_user_ids` é `uuid[]`.
- **Ao deployar, subir front e back juntos** no EasyPanel: são serviços separados e deployar um só descasa as versões (tela branca em 01/09/2026).

---

### Task 1: A regra de acesso a agente vira função SQL, e um trigger a impõe

**Files:**
- Create: `backend/migrations/014_acesso_a_agente.sql`
- Create: `backend/migrations/_testes/014_acesso_a_agente.test.sql`
- Create: `backend/migrations/_testes/README.md`
- Create: `scripts/banco-rascunho.sh`
- Create: `scripts/conferir-acesso-canais.sql`

**Interfaces:**
- Produces: `public.pode_ver_agente(_user_id uuid, _agent_id text) RETURNS boolean` — usada pelas Tarefas 2 e 3 e pelo trigger.
- Produces: trigger `exige_acesso_ao_agente_no_canal_trigger` em `public.channel_members`, que levanta exceção com `SQLSTATE = 'HS001'`. A Tarefa 2 traduz esse código para HTTP 403.
- Produces: `scripts/banco-rascunho.sh` — usado pelas Tarefas 3 e 8 para provar SQL sem tocar produção.

- [ ] **Step 1: Escrever o script do banco de rascunho**

Sem ele não há onde o teste rodar. Postgres **17**, que é a versão de produção (`PostgreSQL 17.10`), não a 18 do `pg-teste` — trigger e função são iguais nas duas, mas banco de teste que não é a versão de produção é uma diferença de graça que um dia cobra.

Criar `scripts/banco-rascunho.sh`:

```bash
#!/usr/bin/env bash
# Sobe um Postgres 17 descartável e aplica as migrations do `hsos` em ordem.
#
# Existe porque o schema do HS.OS não cabe num teste de unidade: trigger, policy
# de RLS e função SQL só se provam num banco de verdade. Este é descartável de
# propósito — ele é recriado do zero a cada execução, e portanto nada que se
# faça nele precisa de cuidado.
#
#   bash scripts/banco-rascunho.sh          # recria e aplica tudo
#   psql "$(bash scripts/banco-rascunho.sh --url)" -f arquivo.sql
#
# ⚠️ A `008_pessoas_talenths.sql` NÃO é deste banco — ela se aplica no
#    `talenths-banco`. Aplicá-la aqui falharia em `public.departments`, que não
#    existe no schema do HS.OS.
set -euo pipefail

NOME=${NOME:-hsos-rascunho}
PORTA=${PORTA:-5433}
SENHA=rascunho
URL="postgresql://postgres:${SENHA}@127.0.0.1:${PORTA}/postgres"

if [ "${1:-}" = "--url" ]; then echo "$URL"; exit 0; fi

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" \
    -e POSTGRES_PASSWORD="$SENHA" \
    -p "${PORTA}:5432" postgres:17 >/dev/null

echo "esperando o banco subir…"
until docker exec "$NOME" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done

cd "$RAIZ/backend/migrations"
for f in [0-9][0-9][0-9]_*.sql; do
    case "$f" in
        008_*) echo "pulando $f (é do talenths-banco)"; continue ;;
    esac
    echo "aplicando $f"
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo
echo "pronto: $URL"
```

- [ ] **Step 2: Escrever o teste SQL, que falha porque a função não existe**

Criar `backend/migrations/_testes/README.md`:

```markdown
# Testes de migração

SQL que se prova em SQL. Rodam num banco de rascunho descartável, nunca em
produção:

```bash
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
```

Cada arquivo abre uma transação, cria os dados de que precisa e termina em
`ROLLBACK` — o banco fica como estava. Um `ASSERT` que falha aborta com
`ON_ERROR_STOP`, e é assim que o teste reprova.

⚠️ **A tabela de casos da `014` está escrita duas vezes de propósito**: aqui e
em `backend/tests/test_acesso_agente.py`, que exercita o `_pode_ver` do Python.
São a mesma regra em duas linguagens, e a duplicação é o que faz uma divergência
quebrar um teste em vez de passar despercebida. Ao mexer numa, mexa na outra.
```

Criar `backend/migrations/_testes/014_acesso_a_agente.test.sql`:

```sql
-- Testes da 014: a função de acesso e o trigger que a impõe.
--
-- ⚠️ Roda num banco de rascunho (`scripts/banco-rascunho.sh`). Termina em
--    ROLLBACK: nada aqui persiste.

\set ON_ERROR_STOP on

BEGIN;

-- ── Dados ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@teste'),
    ('22222222-2222-2222-2222-222222222222', 'dentro@teste'),
    ('33333333-3333-3333-3333-333333333333', 'fora@teste');

INSERT INTO public.profiles (id, email, full_name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@teste',  'Admin'),
    ('22222222-2222-2222-2222-222222222222', 'dentro@teste', 'Quem Pode'),
    ('33333333-3333-3333-3333-333333333333', 'fora@teste',   'Quem Nao Pode');

INSERT INTO public.user_roles (user_id, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'administrador'),
    ('22222222-2222-2222-2222-222222222222', 'colaborador'),
    ('33333333-3333-3333-3333-333333333333', 'colaborador');

INSERT INTO public.agent_profiles (agent_id, name, access_type, allowed_user_ids) VALUES
    ('restrito', 'Restrito', 'specific_users',
        ARRAY['22222222-2222-2222-2222-222222222222']::uuid[]),
    ('aberto',   'Aberto',   'all',          NULL),
    ('so_admin', 'So Admin', 'admins_only',  NULL),
    ('sem_lista','Sem Lista','specific_users', NULL);
-- `sem_perfil` não é inserido de propósito: agente que o gateway conhece e o
-- banco não é caso real, e a regra herdada é liberar.

-- ── A função ─────────────────────────────────────────────────────────────────
-- ⚠️ Esta é a tabela de casos. A gêmea dela está em
--    `backend/tests/test_acesso_agente.py`. Mudou uma, muda a outra.
DO $$
BEGIN
    -- 1. admin passa por cima de `specific_users` sem estar na lista
    ASSERT public.pode_ver_agente('11111111-1111-1111-1111-111111111111', 'restrito'),
        'admin deveria ver agente restrito';
    -- 2. colaborador na lista
    ASSERT public.pode_ver_agente('22222222-2222-2222-2222-222222222222', 'restrito'),
        'quem está na lista deveria ver';
    -- 3. colaborador fora da lista
    ASSERT NOT public.pode_ver_agente('33333333-3333-3333-3333-333333333333', 'restrito'),
        'quem está fora da lista NÃO deveria ver';
    -- 4. `all` libera colaborador
    ASSERT public.pode_ver_agente('33333333-3333-3333-3333-333333333333', 'aberto'),
        'access_type=all deveria liberar';
    -- 5. `admins_only` recusa colaborador
    ASSERT NOT public.pode_ver_agente('33333333-3333-3333-3333-333333333333', 'so_admin'),
        'admins_only deveria recusar colaborador';
    -- 6. `admins_only` libera admin
    ASSERT public.pode_ver_agente('11111111-1111-1111-1111-111111111111', 'so_admin'),
        'admins_only deveria liberar admin';
    -- 7. `specific_users` com lista NULA recusa
    ASSERT NOT public.pode_ver_agente('33333333-3333-3333-3333-333333333333', 'sem_lista'),
        'specific_users sem lista deveria recusar';
    -- 8. agente sem linha em agent_profiles libera
    ASSERT public.pode_ver_agente('33333333-3333-3333-3333-333333333333', 'sem_perfil'),
        'agente sem perfil deveria liberar (regra herdada)';
END $$;

-- ── O trigger ────────────────────────────────────────────────────────────────
INSERT INTO public.channels (id, name, type, created_by) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'canal', 'private',
     '11111111-1111-1111-1111-111111111111');

-- 9. humano entra num canal vazio: passa
INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222', 'human');

-- 10. agente que esse humano PODE ver entra: passa
INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'restrito', 'agent');

-- 11. humano que NÃO pode ver o agente do canal: recusado
DO $$
BEGIN
    INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001',
         '33333333-3333-3333-3333-333333333333', 'human');
    ASSERT false, 'deveria ter recusado o humano sem acesso ao agente do canal';
EXCEPTION WHEN SQLSTATE 'HS001' THEN
    NULL;  -- é o que se espera
END $$;

-- 12. agente que um humano do canal NÃO pode ver: recusado
INSERT INTO public.channels (id, name, type, created_by) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000002', 'outro', 'private',
     '11111111-1111-1111-1111-111111111111');
INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000002',
     '33333333-3333-3333-3333-333333333333', 'human');
DO $$
BEGIN
    INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000002', 'restrito', 'agent');
    ASSERT false, 'deveria ter recusado o agente que um membro não vê';
EXCEPTION WHEN SQLSTATE 'HS001' THEN
    NULL;
END $$;

-- 13. DM entre duas pessoas continua passando (não tem agente no meio).
--     Este é o caminho do `find_or_create_dm`, que é SECURITY DEFINER e insere
--     direto — o trigger pega ele também, e é aqui que se prova que não quebrou.
INSERT INTO public.channels (id, name, type, created_by) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000003', 'dm', 'dm',
     '22222222-2222-2222-2222-222222222222');
INSERT INTO public.channel_members (channel_id, user_id, member_type) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000003',
     '22222222-2222-2222-2222-222222222222', 'human'),
    ('aaaaaaaa-0000-0000-0000-000000000003',
     '33333333-3333-3333-3333-333333333333', 'human');

ROLLBACK;

\echo 'OK — 014 passou'
```

- [ ] **Step 3: Rodar o teste e confirmar que ele reprova**

```bash
cd ~/github/HS.OS
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
```

Esperado: **FALHA** com `function public.pode_ver_agente(uuid, text) does not exist`.

⚠️ Se em vez disso falhar antes, numa das linhas de `INSERT` dos dados, o problema é o schema e não o teste — leia a mensagem antes de mexer no SQL da migração.

- [ ] **Step 4: Escrever a migração**

Criar `backend/migrations/014_acesso_a_agente.sql`:

```sql
-- 014_acesso_a_agente.sql — quem pode ver um agente, dito uma vez só
--
-- ── O problema ───────────────────────────────────────────────────────────────
--
-- Em 01/09/2026 a conversa entre pessoas voltou ao produto e a empresa inteira
-- entrou: de 4 contas para 27. Com 26 pessoas dentro, um canal de grupo com
-- agente vira caminho lateral para o `allowed_user_ids` — quem não pode ver a
-- `iris` lê as respostas dela do mesmo jeito, bastando estar no canal.
--
-- Pior: `POST /channels/{id}/members` não tinha checagem NENHUMA. Qualquer
-- pessoa autenticada adicionava qualquer pessoa ou agente a qualquer canal.
-- Com 4 pessoas de confiança isso nunca teve consequência.
--
-- ── A regra ──────────────────────────────────────────────────────────────────
--
-- Agente só entra em canal onde TODOS os humanos podem vê-lo; humano só entra
-- em canal cujos agentes ele pode ver. Nas duas direções, porque fechar uma só
-- deixa a outra como porta.
--
-- ⚠️ **Por que no banco e não só no Python.** A regra tem que valer para rota
--    que ainda não foi escrita. O `find_or_create_dm` é SECURITY DEFINER e
--    insere em `channel_members` direto, sem passar por endpoint nenhum — e é
--    esse o tipo de caminho que se esquece. O Python continua validando antes,
--    mas para dar mensagem humana, não para ser a defesa.
--
-- ⚠️ **Esta migração NÃO revoga acesso de quem já está em canal.** O trigger
--    vale na entrada. Tirar o acesso de alguém depois não a remove de canal
--    nenhum — para isso existe `scripts/conferir-acesso-canais.sql`, que é para
--    rodar depois de mexer em acesso.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 014_acesso_a_agente.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A regra
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Tradução literal do `_pode_ver` de `backend/app/routers/agents.py`, que
-- continua existindo porque `GET /agents` filtra uma lista já carregada e
-- chamar o banco por agente seriam N idas e voltas. A tabela de casos das duas
-- está escrita nos dois testes — ver `_testes/README.md`.
--
-- SECURITY DEFINER porque o trigger a chama de dentro de uma sessão
-- `authenticated`, que sob RLS não enxerga `agent_profiles` de todo mundo.

CREATE OR REPLACE FUNCTION public.pode_ver_agente(_user_id uuid, _agent_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'administrador') THEN true
    ELSE COALESCE((
      SELECT CASE COALESCE(p.access_type, 'all')
               WHEN 'all'            THEN true
               WHEN 'admins_only'    THEN false
               WHEN 'specific_users' THEN
                    _user_id = ANY(COALESCE(p.allowed_user_ids, '{}'::uuid[]))
               ELSE true
             END
        FROM public.agent_profiles p
       WHERE p.agent_id = _agent_id
    ), true)
  END
$$;

COMMENT ON FUNCTION public.pode_ver_agente(uuid, text) IS
    'Se a pessoa pode ver o agente. Admin passa por cima; `all` libera; '
    '`admins_only` recusa; `specific_users` exige estar em allowed_user_ids; '
    'agente sem perfil libera. Espelho do _pode_ver do agents.py — ver 014.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.exige_acesso_ao_agente_no_canal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    _pessoa text;
    _agente text;
BEGIN
    IF NEW.member_type = 'agent' THEN
        SELECT m.user_id INTO _pessoa
          FROM public.channel_members m
         WHERE m.channel_id = NEW.channel_id
           AND m.member_type = 'human'
           AND NOT public.pode_ver_agente(m.user_id::uuid, NEW.user_id)
         LIMIT 1;

        IF _pessoa IS NOT NULL THEN
            RAISE EXCEPTION
                'Alguém neste canal não tem acesso ao agente %.', NEW.user_id
                USING ERRCODE = 'HS001',
                      DETAIL  = format('pessoa=%s;agente=%s', _pessoa, NEW.user_id);
        END IF;

    ELSIF NEW.member_type = 'human' THEN
        SELECT m.user_id INTO _agente
          FROM public.channel_members m
         WHERE m.channel_id = NEW.channel_id
           AND m.member_type = 'agent'
           AND NOT public.pode_ver_agente(NEW.user_id::uuid, m.user_id)
         LIMIT 1;

        IF _agente IS NOT NULL THEN
            RAISE EXCEPTION
                'Esta pessoa não tem acesso ao agente % deste canal.', _agente
                USING ERRCODE = 'HS001',
                      DETAIL  = format('pessoa=%s;agente=%s', NEW.user_id, _agente);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ⚠️ Só INSERT. `UPDATE` de linha de membro não existe no código — quem sai é
--    removido — e cobrir UPDATE convidaria a mudar `member_type` no lugar.

CREATE TRIGGER exige_acesso_ao_agente_no_canal_trigger
    BEFORE INSERT ON public.channel_members
    FOR EACH ROW EXECUTE FUNCTION public.exige_acesso_ao_agente_no_canal();

COMMIT;
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd ~/github/HS.OS
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
```

Esperado: termina com `OK — 014 passou` e sem nenhuma linha `ERROR`.

⚠️ **Não aceite "rodou sem erro" como prova de que o trigger pega.** Os casos 11 e 12 falham *silenciosamente* se o trigger nunca disparar — o `ASSERT false` é justamente o que os salva. Confirme que o teste é capaz de reprovar: comente a linha `CREATE TRIGGER`, aplique de novo num rascunho novo e veja o teste acusar `deveria ter recusado`. Depois descomente.

- [ ] **Step 6: Escrever a consulta de conferência**

Criar `scripts/conferir-acesso-canais.sql`:

```sql
-- Quem está hoje em canal com agente que já não pode ver?
--
-- O trigger da 014 valida na ENTRADA. Tirar o acesso de alguém depois não a
-- remove dos canais em que ela já está — e foi esse tipo de dado velho que
-- virou 11 ids órfãos em `allowed_user_ids` em agosto de 2026.
--
-- Rodar depois de mexer em acesso de agente. Leitura pura.
--
--   psql "$DATABASE_URL" -f scripts/conferir-acesso-canais.sql

SELECT c.name                                   AS canal,
       c.type                                   AS tipo,
       COALESCE(p.full_name, p.email, h.user_id) AS pessoa,
       COALESCE(ap.name, a.user_id)             AS agente
  FROM public.channel_members h
  JOIN public.channel_members a  ON a.channel_id = h.channel_id
                                AND a.member_type = 'agent'
  JOIN public.channels        c  ON c.id = h.channel_id
  LEFT JOIN public.profiles   p  ON p.id::text = h.user_id
  LEFT JOIN public.agent_profiles ap ON ap.agent_id = a.user_id
 WHERE h.member_type = 'human'
   AND NOT public.pode_ver_agente(h.user_id::uuid, a.user_id)
 ORDER BY canal, pessoa;
```

- [ ] **Step 7: Commit**

```bash
cd ~/github/HS.OS
git add backend/migrations/014_acesso_a_agente.sql \
        backend/migrations/_testes/ \
        scripts/banco-rascunho.sh scripts/conferir-acesso-canais.sql
git commit -m "A regra de quem vê um agente passa a ser do banco, e vale para rota que não existe ainda

Agente só entra em canal onde todos os humanos podem vê-lo, e humano só entra em
canal cujos agentes ele vê. Nas duas direções, porque fechar uma deixa a outra
como porta.

Está no banco e não só no Python porque o find_or_create_dm é SECURITY DEFINER e
insere em channel_members sem passar por endpoint nenhum. Esse é o tipo de
caminho que se esquece.

O trigger valida na entrada, então tirar acesso depois não tira ninguém de canal
nenhum — daí a consulta de conferência junto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: O backend passa a impor o invariante, com mensagem que a pessoa entende

**Files:**
- Modify: `backend/app/routers/channels.py` (helpers novos; `adicionar_membros` em `:932-948`; `criar` em `:152-205`; `acionar_agente` em `:679-723`)
- Modify: `backend/app/routers/conversations.py:1441-1470` (traduzir o erro do trigger)
- Create: `backend/tests/test_acesso_agente.py`

**Interfaces:**
- Consumes: `public.pode_ver_agente(uuid, text)` e o `SQLSTATE 'HS001'` da Tarefa 1.
- Produces: `channels._primeiro_par_sem_acesso(conn, channel_id, user_ids, agent_ids) -> tuple[str, str] | None` e `channels.traduzir_hs001(erro) -> HTTPException | None` — o segundo é importado por `conversations.py` nesta mesma tarefa, e é o tradutor que qualquer rota futura que insira membro deve usar.

- [ ] **Step 1: Escrever o teste espelho do `_pode_ver`, que falha**

O `_pode_ver` do Python e a `pode_ver_agente` do SQL são a mesma regra em duas linguagens. A duplicação é deliberada — o que a torna segura é a tabela de casos aparecer nos dois testes.

Criar `backend/tests/test_acesso_agente.py`:

```python
"""A regra de quem vê um agente, do lado do Python.

⚠️ **Esta tabela de casos é gêmea da que está em
`backend/migrations/_testes/014_acesso_a_agente.test.sql`.** São a mesma regra
escrita duas vezes: o SQL porque o trigger precisa dela no banco, o Python
porque `GET /agents` filtra uma lista já carregada e perguntar ao banco por
agente seriam N idas e voltas.

Mudou uma, muda a outra — é essa duplicação que faz uma divergência quebrar um
teste em vez de passar despercebida.
"""
from app.routers.agents import _pode_ver

DENTRO = "22222222-2222-2222-2222-222222222222"
FORA = "33333333-3333-3333-3333-333333333333"

RESTRITO = {"access_type": "specific_users", "allowed_user_ids": [DENTRO]}
ABERTO = {"access_type": "all", "allowed_user_ids": None}
SO_ADMIN = {"access_type": "admins_only", "allowed_user_ids": None}
# ⚠️ Duas formas de "sem lista", e as duas acontecem. No banco a coluna é
# `NOT NULL DEFAULT '{}'`, então de lá vem sempre a lista vazia; o `None` vem do
# `.get()` quando a chave nem existe no dicionário. A gêmea SQL usa `'{}'::uuid[]`.
SEM_LISTA_VAZIA = {"access_type": "specific_users", "allowed_user_ids": []}
SEM_LISTA_NULA = {"access_type": "specific_users", "allowed_user_ids": None}
SEM_PERFIL: dict = {}


def test_admin_passa_por_cima_de_specific_users():
    assert _pode_ver(RESTRITO, FORA, is_admin=True)


def test_quem_esta_na_lista_ve():
    assert _pode_ver(RESTRITO, DENTRO, is_admin=False)


def test_quem_esta_fora_da_lista_nao_ve():
    assert not _pode_ver(RESTRITO, FORA, is_admin=False)


def test_all_libera_colaborador():
    assert _pode_ver(ABERTO, FORA, is_admin=False)


def test_admins_only_recusa_colaborador():
    assert not _pode_ver(SO_ADMIN, FORA, is_admin=False)


def test_admins_only_libera_admin():
    assert _pode_ver(SO_ADMIN, FORA, is_admin=True)


def test_specific_users_com_lista_vazia_recusa():
    """É esta a forma que vem do banco: a coluna é NOT NULL DEFAULT '{}'."""
    assert not _pode_ver(SEM_LISTA_VAZIA, FORA, is_admin=False)


def test_specific_users_sem_a_chave_recusa():
    assert not _pode_ver(SEM_LISTA_NULA, FORA, is_admin=False)


def test_agente_sem_perfil_libera():
    """Regra herdada do código do remix: sem perfil no banco, não há restrição."""
    assert _pode_ver(SEM_PERFIL, FORA, is_admin=False)
```

- [ ] **Step 2: Rodar e ver o resultado**

```bash
cd ~/github/HS.OS/backend && ./.venv/bin/python -m pytest tests/test_acesso_agente.py -q
```

Esperado: **PASSA** — o `_pode_ver` já existe e já se comporta assim. Este teste não é para fazer código novo passar; é o **contrato** que trava a regra do Python contra a do SQL. Se algum caso reprovar aqui, a divergência já existe e ela é o achado — pare e leia o `_pode_ver` antes de seguir.

- [ ] **Step 3: Escrever os dois helpers no `channels.py`**

Adicionar logo depois dos imports de `backend/app/routers/channels.py`:

```python
import asyncpg


def traduzir_hs001(erro: Exception) -> HTTPException | None:
    """O erro do trigger da 014, virado 403 com o texto que ele já traz.

    O trigger é a defesa e o Python é a cortesia: quando a validação daqui
    deixa passar um caminho que ninguém previu, é este tradutor que evita a
    pessoa receber um 500 com SQL dentro.
    """
    if isinstance(erro, asyncpg.PostgresError) and getattr(erro, "sqlstate", None) == "HS001":
        return HTTPException(status.HTTP_403_FORBIDDEN, str(erro))
    return None


async def _primeiro_par_sem_acesso(
    conn, channel_id: str, user_ids: list[str], agent_ids: list[str]
) -> tuple[str, str] | None:
    """O primeiro par (pessoa, agente) do canal que não fecha, com nomes.

    O par pode ser entre quem entra e quem JÁ está no canal — por isso a
    consulta une as duas listas com os membros de hoje antes de cruzar. Validar
    só quem entra deixaria passar exatamente o caso que motivou a regra.
    """
    linha = await conn.fetchrow(
        """
        WITH humanos AS (
            SELECT user_id FROM public.channel_members
             WHERE channel_id = $1::uuid AND member_type = 'human'
            UNION
            SELECT unnest($2::text[])
        ), agentes AS (
            SELECT user_id FROM public.channel_members
             WHERE channel_id = $1::uuid AND member_type = 'agent'
            UNION
            SELECT unnest($3::text[])
        )
        SELECT COALESCE(p.full_name, p.email, h.user_id) AS pessoa,
               COALESCE(ap.name, a.user_id)              AS agente
          FROM humanos h
          CROSS JOIN agentes a
          LEFT JOIN public.profiles p ON p.id::text = h.user_id
          LEFT JOIN public.agent_profiles ap ON ap.agent_id = a.user_id
         WHERE NOT public.pode_ver_agente(h.user_id::uuid, a.user_id)
         LIMIT 1
        """,
        channel_id, user_ids, agent_ids,
    )
    return (linha["pessoa"], linha["agente"]) if linha else None
```

- [ ] **Step 4: Fechar o `adicionar_membros`**

Substituir o corpo de `adicionar_membros` (hoje em `backend/app/routers/channels.py:932-948`) por:

```python
@router.post("/{channel_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def adicionar_membros(
    channel_id: str,
    dados: MembrosIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Acrescenta pessoas e agentes ao canal. Quem já está é ignorado.

    ⚠️ **Até 01/09/2026 esta rota não tinha checagem NENHUMA.** Qualquer pessoa
    autenticada adicionava qualquer pessoa ou agente a qualquer canal — com 4
    pessoas de confiança nunca teve consequência; com 26 dentro, é o caminho
    mais curto para furar o `allowed_user_ids`: basta me pôr num canal onde o
    agente está.

    Três guardas, e as três importam:

    - **ser membro do canal** — quem está fora não mexe em quem está dentro;
    - **administrador para canal que não é DM** — canal de grupo é do admin
      (decisão do Erick, 01/09/2026), e quem cria também é quem chama;
    - **o invariante** — nenhum par pessoa×agente sem acesso, contando quem já
      está no canal.
    """
    membros = [(u, "human") for u in dados.user_ids] + [(a, "agent") for a in dados.agent_ids]
    if not membros:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum membro informado.")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        tipo = await conn.fetchval(
            "SELECT c.type::text FROM public.channels c WHERE c.id = $1::uuid", channel_id
        )
        if tipo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")

        sou_membro = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM public.channel_members "
            " WHERE channel_id = $1::uuid AND user_id = $2 AND member_type = 'human')",
            channel_id, usuario.id,
        )
        if not sou_membro:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Só quem está no canal adiciona alguém a ele."
            )

        if tipo != "dm" and usuario.papel != "administrador":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Só o administrador adiciona pessoas a um canal.",
            )

        par = await _primeiro_par_sem_acesso(conn, channel_id, dados.user_ids, dados.agent_ids)
        if par is not None:
            pessoa, agente = par
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"{pessoa} não tem acesso ao agente {agente}. "
                "Libere o acesso na tela do agente antes de juntar os dois no mesmo canal.",
            )

        try:
            for membro_id, tipo_membro in membros:
                await conn.execute(
                    "INSERT INTO public.channel_members (channel_id, user_id, member_type) "
                    "VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING",
                    channel_id, membro_id, tipo_membro,
                )
        except asyncpg.PostgresError as erro:
            traduzido = traduzir_hs001(erro)
            if traduzido is not None:
                raise traduzido from erro
            raise
```

⚠️ **É `usuario.papel`, não `usuario.is_admin`.** O `Usuario` de `backend/app/dependencies.py:23` guarda `id`, `email`, `papel` e `nome` — não há atributo booleano de admin, e criar um aqui seria um segundo jeito de perguntar a mesma coisa.

- [ ] **Step 5: Fechar o `criar` e o `acionar_agente`**

Em `criar` (`backend/app/routers/channels.py:152`), depois do `INSERT` do canal e **antes** de inserir os membros, e ainda dentro do `async with conn.transaction():`, envolver as inserções de membro com a tradução:

```python
            # ⚠️ O trigger da 014 recusa canal que nasce com pessoa e agente
            # incompatíveis. A transação inteira volta atrás — que é o
            # comportamento certo: canal criado pela metade foi o defeito que
            # esta função foi escrita para evitar.
            try:
                ...  # as inserções de membro que já existem aqui
            except asyncpg.PostgresError as erro:
                traduzido = traduzir_hs001(erro)
                if traduzido is not None:
                    raise traduzido from erro
                raise
```

Em `acionar_agente` (`backend/app/routers/channels.py:679`), logo depois de resolver `channel_id` e `agent_id` e antes de acionar o gateway:

```python
        pode = await conn.fetchval(
            "SELECT public.pode_ver_agente($1::uuid, $2)", usuario.id, agent_id
        )
        if not pode:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Você não tem acesso a este agente."
            )
```

⚠️ Isto é sobre **quem aciona**, e não substitui o invariante: o trigger garante que todo mundo no canal pode ver o agente, e esta linha garante que quem apertou o botão também pode. São perguntas diferentes e as duas precisam de resposta.

- [ ] **Step 6: Traduzir o erro no `conversations.abrir_dm`**

Em `backend/app/routers/conversations.py:1464`, envolver a chamada de `find_or_create_dm`:

```python
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
```

Importar `traduzir_hs001` de `app.routers.channels` no topo do arquivo, junto dos outros imports.

- [ ] **Step 7: Rodar a suíte inteira**

```bash
cd ~/github/HS.OS/backend && ./.venv/bin/python -m pytest tests -q
```

Esperado: tudo verde. Nenhum teste existente toca estas rotas, então uma reprovação aqui é regressão de verdade — leia antes de seguir.

- [ ] **Step 8: Commit**

```bash
cd ~/github/HS.OS
git add backend/app/routers/channels.py backend/app/routers/conversations.py \
        backend/tests/test_acesso_agente.py
git commit -m "Adicionar membro a canal deixa de ser rota sem checagem nenhuma

POST /channels/{id}/members aceitava qualquer pessoa autenticada adicionando
qualquer um a qualquer canal. Agora exige ser membro, exige admin fora de DM, e
recusa o par pessoa×agente sem acesso — contando quem já está no canal, porque
validar só quem entra deixa passar o caso que motivou a regra.

O erro do trigger vira 403 com texto legível em vez de 500 com SQL dentro, e o
abrir_dm também traduz: o find_or_create_dm é SECURITY DEFINER e o trigger
alcança ele.

O teste do _pode_ver não faz código novo passar — ele trava a regra do Python
contra a gêmea que agora vive no banco.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A porta que reabre e a que fecha

**Files:**
- Create: `backend/migrations/015_quem_cria_canal.sql`
- Create: `backend/migrations/_testes/015_quem_cria_canal.test.sql`
- Modify: `backend/app/routers/conversations.py:1441-1442` (guarda da rota)
- Modify: `backend/app/routers/channels.py:152-153` (guarda da rota)

**Interfaces:**
- Consumes: `scripts/banco-rascunho.sh` (Tarefa 1).
- Produces: `POST /conversations/dm/abrir` aberto a qualquer pessoa autenticada — a Tarefa 4 depende disso para o botão funcionar.

- [ ] **Step 1: Escrever o teste da policy, que falha**

A pergunta que este teste responde é a única coisa não óbvia da tarefa: **fechar a criação de canal na RLS quebra o DM?** O `find_or_create_dm` insere em `channels` como SECURITY DEFINER, e a resposta depende de o dono da função ser dono da tabela. Isso se descobre medindo.

Criar `backend/migrations/_testes/015_quem_cria_canal.test.sql`:

```sql
-- Testes da 015: só admin cria canal — e o DM continua nascendo.
--
-- ⚠️ Roda num banco de rascunho (`scripts/banco-rascunho.sh`). Termina em
--    ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@teste'),
    ('44444444-4444-4444-4444-444444444444', 'colab@teste'),
    ('55555555-5555-5555-5555-555555555555', 'outro@teste');

INSERT INTO public.profiles (id, email, full_name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@teste', 'Admin'),
    ('44444444-4444-4444-4444-444444444444', 'colab@teste', 'Colaborador'),
    ('55555555-5555-5555-5555-555555555555', 'outro@teste', 'Outro');

INSERT INTO public.user_roles (user_id, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'administrador'),
    ('44444444-4444-4444-4444-444444444444', 'colaborador'),
    ('55555555-5555-5555-5555-555555555555', 'colaborador');

-- ── Como o backend fala com o banco: role `authenticated` + o id na sessão ──
SET LOCAL ROLE authenticated;
SET LOCAL app.current_user_id = '44444444-4444-4444-4444-444444444444';

-- 1. colaborador NÃO cria canal
DO $$
BEGIN
    INSERT INTO public.channels (name, type, created_by)
    VALUES ('proibido', 'private', '44444444-4444-4444-4444-444444444444');
    ASSERT false, 'colaborador não deveria conseguir criar canal';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- é o que se espera: a policy recusou
END $$;

-- 2. ⚠️ mas o DM entre pessoas CONTINUA nascendo — este é o teste que importa.
--    O `find_or_create_dm` é SECURITY DEFINER; se ele parar de funcionar aqui,
--    fechar a policy quebrou o chat inteiro do colaborador.
DO $$
DECLARE _canal uuid;
BEGIN
    _canal := public.find_or_create_dm(
        '55555555-5555-5555-5555-555555555555', 'Outro');
    ASSERT _canal IS NOT NULL, 'o DM entre pessoas precisa continuar nascendo';
END $$;

RESET ROLE;

-- 3. admin cria canal
SET LOCAL ROLE authenticated;
SET LOCAL app.current_user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.channels (name, type, created_by)
VALUES ('permitido', 'private', '11111111-1111-1111-1111-111111111111');
RESET ROLE;

ROLLBACK;

\echo 'OK — 015 passou'
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd ~/github/HS.OS
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/015_quem_cria_canal.test.sql
```

Esperado: **FALHA** no caso 1, com `colaborador não deveria conseguir criar canal` — porque a policy de hoje (`Authenticated users create channels`) libera geral.

- [ ] **Step 3: Escrever a migração**

Criar `backend/migrations/015_quem_cria_canal.sql`:

```sql
-- 015_quem_cria_canal.sql — canal de grupo é do administrador
--
-- Decisão do Erick, 01/09/2026, junto com a volta da conversa entre pessoas: DM
-- é livre entre todos, canal de grupo só o admin cria. Com 26 pessoas dentro, o
-- que se evita é canal morto se multiplicando — e, junto com a 014, mantém sob
-- controle de quem entende dela a regra de qual agente pode entrar onde.
--
-- ⚠️ **Fechar só o endpoint não fecha nada** — é o padrão que este repositório
--    corrigiu a semana inteira em agosto. A rota vira `exige_papel` no mesmo
--    commit, e aqui fica a outra metade.
--
-- ⚠️ **O DM continua nascendo.** O `find_or_create_dm` é SECURITY DEFINER e
--    insere em `channels` como dono, sem passar por esta policy. Isso está
--    provado em `_testes/015_quem_cria_canal.test.sql`, e é o teste que
--    importa deste arquivo: se um dia ele reprovar, o chat do colaborador
--    parou.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 015_quem_cria_canal.sql

BEGIN;

DROP POLICY IF EXISTS "Authenticated users create channels" ON public.channels;

CREATE POLICY "Only admins create channels"
    ON public.channels
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'administrador'));

COMMIT;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd ~/github/HS.OS
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/015_quem_cria_canal.test.sql
```

Esperado: `OK — 014 passou` e `OK — 015 passou`.

⚠️ **Se o caso 2 reprovar** — o DM parou de nascer — **não force a policy**. Significa que o dono do `find_or_create_dm` não é dono da tabela, e a saída é `ALTER TABLE public.channels ... ` ou dar `BYPASSRLS` ao dono da função. Pare e traga a mensagem de erro: escolher entre essas saídas é decisão, não conserto.

- [ ] **Step 5: Trocar as duas guardas de rota**

Em `backend/app/routers/conversations.py:1442`, trocar a dependência e reescrever a docstring, que hoje descreve a decisão revertida:

```python
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
```

Em `backend/app/routers/channels.py:153`, trocar a dependência de `criar`:

```python
async def criar(dados: CanalIn, usuario: Usuario = Depends(exige_papel("administrador"))):
```

E acrescentar ao começo da docstring dela:

```
    ⚠️ **Só administrador cria canal** (decisão do Erick, 01/09/2026). A outra
    metade da regra está na policy da `015` — fechar só aqui deixaria o banco
    aberto a quem chamasse por fora.
```

⚠️ **O `exige_papel` NÃO está importado no `channels.py`** — a linha 25 hoje é `from app.dependencies import Usuario, usuario_atual`. Trocar por:

```python
from app.dependencies import Usuario, exige_papel, usuario_atual
```

- [ ] **Step 6: Rodar os testes do backend**

```bash
cd ~/github/HS.OS/backend && ./.venv/bin/python -m pytest tests -q
```

Esperado: tudo verde.

- [ ] **Step 7: Commit**

```bash
cd ~/github/HS.OS
git add backend/migrations/015_quem_cria_canal.sql \
        backend/migrations/_testes/015_quem_cria_canal.test.sql \
        backend/app/routers/conversations.py backend/app/routers/channels.py
git commit -m "DM entre pessoas reabre; criar canal passa a ser do administrador

A rota de abrir DM exigiu administrador por duas semanas porque a conversa entre
pessoas tinha saído do produto. Voltou, e com ela a empresa inteira.

Canal de grupo é do admin, na rota e na policy — fechar só a rota é o erro que
este repositório passou agosto corrigindo.

O teste que importa da 015 não é o que recusa o colaborador: é o que prova que o
find_or_create_dm continua nascendo por cima da policy. Se ele reprovar um dia, o
chat do colaborador parou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: As pessoas voltam à lista lateral do Chat

**Files:**
- Create: `frontend/src/components/chat/NovaConversaDialog.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx:2431-2455` (o `unifiedDmList`)
- Modify: `frontend/src/pages/ChatPage.tsx` (botão que abre o diálogo, no cabeçalho da aba DM)

**Interfaces:**
- Consumes: `POST /conversations/dm/abrir` reaberto (Tarefa 3); `usePeople()` de `@/hooks/use-people` (já existe, devolve `Person[]` com `full_name`, `email`, `departamento`, `cargo`, `avatar_url`); `handleOpenPersonDm(person: Person)` e `openingDm: string | null`, que já existem no `ChatPage` em `:2215-2230`.
- Produces: `<NovaConversaDialog aberto={boolean} onFechar={() => void} pessoas={Person[]} onEscolher={(p: Person) => void} />`.

- [ ] **Step 1: Devolver as pessoas ao `unifiedDmList`**

Em `frontend/src/pages/ChatPage.tsx`, substituir o bloco de comentário que hoje ocupa `:2438-2446` (o que começa em `// ⚠️ **Pessoa não entra mais nesta lista.**`) por:

```tsx
    // ⚠️ **Pessoa voltou a esta lista em 01/09/2026**, revertendo a decisão de
    // 17/08 — a conversa entre pessoas voltou ao produto e a empresa inteira
    // entrou (27 contas, contra 4).
    //
    // Só entra quem JÁ tem conversa. Com 26 pessoas, listar todas empurraria os
    // agentes — que são o foco do produto — para baixo da dobra logo na
    // primeira semana, quando ainda não existe conversa nenhuma. Começar uma
    // conversa nova é o botão "Nova conversa", que busca por nome e por setor.
    for (const person of people) {
      if (person.id === user?.id) continue;
      const canalId = peerIdToChannelId[person.id];
      if (!canalId) continue;
      const quando = dmLastActivity[canalId];
      items.push({
        kind: "person",
        person,
        lastActivity: quando ? new Date(quando).getTime() : 0,
      });
    }
```

- [ ] **Step 2: Ver na tela que a pessoa aparece**

Com o backend local na 8002 e o front em `npm run dev`, abra `/chat` com uma conta que tenha um DM com outra pessoa.

Esperado: a pessoa aparece na aba DM, abaixo dos agentes ou acima deles conforme a última atividade.

⚠️ **Ainda não é possível criar uma conversa nova pela tela** — é a Etapa 3. Se não houver nenhum DM entre pessoas para ver, crie um pela API:

```bash
curl -s -X POST localhost:8002/conversations/dm/abrir \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"target_user_id":"<uuid da outra pessoa>","target_name":"Fulana"}'
```

- [ ] **Step 3: Escrever o diálogo de nova conversa**

Arquivo próprio, e não mais uma seção no `ChatPage` — ele já tem 3.359 linhas, e busca com filtro é uma responsabilidade inteira.

Criar `frontend/src/components/chat/NovaConversaDialog.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Person } from "@/hooks/use-people";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  pessoas: Person[];
  /** Chamado com quem foi escolhido. Quem abre o DM é o `ChatPage`. */
  onEscolher: (pessoa: Person) => void;
}

/** Escolher com quem começar uma conversa.
 *
 * Existe porque a lista lateral só mostra quem já tem conversa: com 26 pessoas
 * na empresa, listar todas na barra empurraria os agentes para baixo da dobra.
 * Aqui a busca casa nome, e-mail e **setor** — "quem é do comercial mesmo?" é a
 * pergunta real de quem acabou de entrar no sistema.
 */
export default function NovaConversaDialog({ aberto, onFechar, pessoas, onEscolher }: Props) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? pessoas.filter((p) =>
          [p.full_name, p.email, p.departamento, p.cargo]
            .some((campo) => (campo || "").toLowerCase().includes(termo)),
        )
      : pessoas;
    return [...lista].sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email),
    );
  }, [pessoas, busca]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) { setBusca(""); onFechar(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Buscar por nome, e-mail ou setor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <ScrollArea className="h-80 -mx-2">
          {filtradas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Ninguém com esse nome.
            </p>
          ) : (
            filtradas.map((pessoa) => (
              <button
                key={pessoa.id}
                onClick={() => { setBusca(""); onEscolher(pessoa); }}
                className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition-colors"
              >
                <div className="text-sm font-medium text-foreground truncate">
                  {pessoa.full_name || pessoa.email}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[pessoa.cargo, pessoa.departamento].filter(Boolean).join(" · ") || pessoa.email}
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Ligar o diálogo no `ChatPage`**

No `frontend/src/pages/ChatPage.tsx`, importar no topo:

```tsx
import NovaConversaDialog from "@/components/chat/NovaConversaDialog";
```

Junto dos outros `useState` do componente (perto de `openingDm`, em `:2215`):

```tsx
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);
  // Eu mesmo não entro na lista de com quem conversar.
  const pessoasParaConversar = useMemo(
    () => people.filter((p) => p.id !== user?.id),
    [people, user?.id],
  );
```

Renderizar o diálogo junto dos outros diálogos do componente:

```tsx
      <NovaConversaDialog
        aberto={novaConversaAberta}
        onFechar={() => setNovaConversaAberta(false)}
        pessoas={pessoasParaConversar}
        onEscolher={(pessoa) => {
          setNovaConversaAberta(false);
          const canalId = peerIdToChannelId[pessoa.id];
          const existente = canalId ? channels.find((c) => c.id === canalId) : null;
          // Conversa que já existe é seleção, não criação — o
          // `find_or_create_dm` devolveria o mesmo canal, mas passar pela rede
          // para descobrir o que a tela já sabe é volta à toa.
          if (existente) setSelection({ type: "channel", channel: existente });
          else void handleOpenPersonDm(pessoa);
        }}
      />
```

E, no cabeçalho da aba DM da barra lateral, um botão que o abre:

```tsx
              <button
                onClick={() => setNovaConversaAberta(true)}
                className="text-xs text-primary hover:underline"
              >
                Nova conversa
              </button>
```

- [ ] **Step 5: Conferir na tela, com duas contas**

Rodar `npm run lint` e `npm run build` primeiro — o projeto tem cobertura de teste ~zero e o compilador é a rede que sobra:

```bash
cd ~/github/HS.OS/frontend && npm run lint && npm run build
```

Depois, no navegador: abrir "Nova conversa", buscar por setor (ex.: `comercial`), escolher alguém, mandar uma mensagem, e **abrir a outra conta em janela anônima** para ver a mensagem chegando.

⚠️ **Isto não é opcional e não é substituível por olhar a tabela.** O ramo `kind: "person"` da lista nunca rodou uma vez desde que foi escrito — os dois DMs que existiam tinham zero mensagens. Conte a mensagem na tela das duas contas, não no banco.

- [ ] **Step 6: Commit**

```bash
cd ~/github/HS.OS
git add frontend/src/pages/ChatPage.tsx frontend/src/components/chat/NovaConversaDialog.tsx
git commit -m "As pessoas voltam à lista do Chat, e começar conversa é uma busca

O ramo kind:'person' estava no ChatPage como código morto desde 17/08 e nunca
tinha rodado — os dois DMs que existiam tinham zero mensagens. Ele volta
exercitado, não confiado.

Só entra na lista quem já tem conversa: com 26 pessoas, listar todas empurraria
os agentes para baixo da dobra na primeira semana. Começar conversa nova é um
diálogo próprio, que busca por nome, e-mail e setor — 'quem é do comercial
mesmo?' é a pergunta de quem acabou de entrar.

Arquivo separado de propósito: o ChatPage tem 3.359 linhas e busca com filtro é
uma responsabilidade inteira.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Criar canal some para quem não é administrador, e a recusa explica

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx:2200-2214` (o `handleCreateChannel` e o botão que o chama)
- Modify: `frontend/src/hooks/use-channels.ts:81-110` (o `createChannel` propaga a mensagem do backend)

**Interfaces:**
- Consumes: `POST /channels` com `exige_papel("administrador")` e o 403 do invariante (Tarefas 2 e 3); o papel da pessoa, que já vem no contexto de autenticação usado pelo `ProtectedRoute`.

- [ ] **Step 1: Fazer o erro do backend chegar à tela**

Hoje `handleCreateChannel` mostra `"Erro ao criar canal."` para qualquer falha (`ChatPage.tsx:2210`) — e a mensagem que importa é justamente a que o backend escreveu ("Fulana não tem acesso ao agente Iris"). Trocar por:

```tsx
    } catch (erro) {
      // A mensagem do backend é o conteúdo, não o rótulo: ela nomeia a pessoa e
      // o agente que não fecham. Trocá-la por "Erro ao criar canal" obriga quem
      // esbarrou a adivinhar o que fazer.
      toast.error(erro instanceof Error ? erro.message : "Erro ao criar canal.");
    }
```

✅ **Conferido: o `api()` já entrega o texto certo.** O `extrairMensagem` em `frontend/src/lib/api.ts:76` lê o `detail` do FastAPI, string ou lista de erro de validação. A mensagem do backend chega inteira ao `catch` — o que a estava perdendo era só o `toast` fixo.

- [ ] **Step 2: Esconder o botão de quem não pode**

São **dois** botões "Criar canal" no `ChatPage`, um por layout: `:2893` (mobile) e `:3092` (desktop). Os dois chamam `setCreateOpen(true)` e os dois precisam da checagem.

O papel vem do contexto, como o resto da tela já faz (`BottomNav.tsx:29`, `AppSidebar.tsx:136`). Em `ChatPage.tsx:650`, trocar:

```tsx
  const { user, profile, role } = useAuthContext();
```

E envolver cada um dos dois botões:

```tsx
        {role === "administrador" && (
          <button onClick={() => setCreateOpen(true)} /* … resto igual … */ title="Criar canal">
            {/* o ícone que já está lá */}
          </button>
        )}
```

⚠️ **Esconder não é fechar, e por isso esta etapa vem depois da Tarefa 3.** Quem fecha é o `exige_papel` mais a policy; isto aqui é só não oferecer o que vai ser recusado.

- [ ] **Step 3: Conferir na tela**

```bash
cd ~/github/HS.OS/frontend && npm run lint && npm run build
```

Com conta de colaborador: o botão não aparece. Com conta de admin: aparece, e criar um canal juntando uma pessoa e um agente que ela não pode ver mostra o nome dos dois na mensagem de recusa.

- [ ] **Step 4: Commit**

```bash
cd ~/github/HS.OS
git add frontend/src/pages/ChatPage.tsx frontend/src/hooks/use-channels.ts
git commit -m "Criar canal some para o colaborador, e a recusa diz quem com quem

O toast dizia 'Erro ao criar canal' para qualquer falha, inclusive para a única
que a pessoa consegue resolver: a que nomeia quem não tem acesso a qual agente.

Esconder o botão não fecha nada — quem fecha é o exige_papel e a policy da 015,
que já estão de pé. Isto é só não oferecer o que vai ser recusado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: O script que traz a empresa para dentro

**Files:**
- Create: `backend/scripts/carregar_pessoas.py`
- Create: `backend/tests/test_carregar_pessoas.py`

**Interfaces:**
- Consumes: `POST /profiles` (já existe, `exige_papel("administrador")`, aceita `email`, `nome`, `senha`, `role`, `departamento`, `cargo`); a view `public.pessoas` do banco `talenths` (colunas `nome`, `email`, `setor`, `cargo`, `senioridade`, `familia`).
- Produces: `quem_falta(quadro, existentes) -> list[dict]` e `senha_forte() -> str`, testados sem rede.

- [ ] **Step 1: Escrever o teste da parte pura, que falha**

Só a decisão é testável sem rede — e é ela que erra. Criar `backend/tests/test_carregar_pessoas.py`:

```python
"""A parte do carregamento que decide, separada da que fala com a rede.

O script cria contas em produção; o que dá para provar antes é quem ele
escolhe. `Bruce` e `Carlos` são cadastro de teste no TalentHS e não podem virar
conta; quem já tem conta não pode virar segunda conta.
"""
from scripts.carregar_pessoas import quem_falta, senha_forte

QUADRO = [
    {"nome": "Erick Santos Dantas", "email": "ti@healthsafetytech.com",
     "setor": "TI", "cargo": "Coordenador de Dados Pleno"},
    {"nome": "Beltrano de Tal", "email": "beltrano@exemplo.test",
     "setor": "RECURSOS HUMANOS", "cargo": "Coordenadora de RH Junior"},
    {"nome": "Bruce", "email": "bruce@healthsafetytech.com",
     "setor": "SEM SETOR", "cargo": None},
    {"nome": "Carlos", "email": "carlos@healthsafetytech.com",
     "setor": "SEM SETOR", "cargo": None},
]


def test_descarta_quem_ja_tem_conta():
    falta = quem_falta(QUADRO, {"ti@healthsafetytech.com"})
    assert [p["email"] for p in falta] == ["beltrano@exemplo.test"]


def test_descarta_o_cadastro_de_teste():
    """Bruce e Carlos não são gente — ver a view `pessoas` do TalentHS."""
    falta = quem_falta(QUADRO, set())
    assert "bruce@healthsafetytech.com" not in [p["email"] for p in falta]
    assert "carlos@healthsafetytech.com" not in [p["email"] for p in falta]


def test_e_mail_repetido_no_quadro_vira_uma_conta_so():
    quadro = QUADRO + [dict(QUADRO[1])]
    falta = quem_falta(quadro, set())
    assert len(falta) == 2  # Erick e Beltrano, uma vez cada


def test_comparacao_de_e_mail_ignora_caixa_e_espaco():
    quadro = [{"nome": "Alguém", "email": "  TI@HealthSafetyTech.com ",
               "setor": "TI", "cargo": None}]
    assert quem_falta(quadro, {"ti@healthsafetytech.com"}) == []


def test_senha_forte_nao_se_repete_e_tem_tamanho():
    """`POST /profiles` exige no mínimo 8 caracteres."""
    a, b = senha_forte(), senha_forte()
    assert len(a) >= 16 and a != b
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd ~/github/HS.OS/backend && ./.venv/bin/python -m pytest tests/test_carregar_pessoas.py -q
```

Esperado: **FALHA** com `ModuleNotFoundError: No module named 'scripts.carregar_pessoas'`.

- [ ] **Step 3: Escrever o script**

Criar `backend/scripts/carregar_pessoas.py`:

```python
"""Cria no HS.OS as contas dos funcionários que ainda não têm uma.

O quadro de pessoal da Health & Safety mora no TalentHS, na view `pessoas` — que
é o crachá e só o crachá (nome, e-mail, setor, cargo), sem CPF, salário nem
telefone. Ver `backend/migrations/008_pessoas_talenths.sql` para o porquê.

⚠️ **Este script NÃO toca o banco do HS.OS.** Ele é cliente de `POST /profiles`,
que já cria `auth.users`, `profiles` e `user_roles` numa transação e registra no
log de acesso. Reimplementar isso em SQL seria um segundo caminho para a mesma
coisa, e o segundo caminho é o que envelhece.

⚠️ **A senha aparece UMA vez, na saída.** Ela vai para o FortiPAM, que é onde a
credencial da HS mora — colaborador não troca a própria senha (decisão de
14/08/2026). Não há como recuperá-la depois: o backend guarda o hash.

Rodar no Konsole:

    cd ~/github/HS.OS/backend
    ./.venv/bin/python scripts/carregar_pessoas.py --conferir   # não cria nada
    ./.venv/bin/python scripts/carregar_pessoas.py

Precisa de duas coisas no ambiente:

    HSOS_API=https://hsosapi.healthsafetytech.com
    HSOS_TOKEN=<token de um administrador>
"""
import argparse
import os
import secrets
import string
import sys

import httpx

# Cadastro de teste no TalentHS: não são funcionários e não viram conta.
NAO_SAO_GENTE = {"bruce@healthsafetytech.com", "carlos@healthsafetytech.com"}

ALFABETO = string.ascii_letters + string.digits + "!@#$%&*?"


def senha_forte() -> str:
    """16 caracteres sorteados. `POST /profiles` exige no mínimo 8."""
    return "".join(secrets.choice(ALFABETO) for _ in range(16))


def normalizar(email: str | None) -> str:
    return (email or "").strip().lower()


def quem_falta(quadro: list[dict], existentes: set[str]) -> list[dict]:
    """Do quadro do TalentHS, quem ainda não tem conta no HS.OS.

    Descarta o cadastro de teste, quem já tem conta e e-mail repetido dentro do
    próprio quadro — as três formas de criar conta duplicada.
    """
    ja_vistos = {normalizar(e) for e in existentes}
    falta = []
    for pessoa in quadro:
        email = normalizar(pessoa.get("email"))
        if not email or email in NAO_SAO_GENTE or email in ja_vistos:
            continue
        ja_vistos.add(email)
        falta.append({**pessoa, "email": email})
    return falta


def ler_quadro() -> list[dict]:
    """A view `pessoas` do TalentHS, pelo cadastro único de bancos."""
    sys.path.insert(0, os.path.expanduser("~/projetos/bancos"))
    import bancos  # noqa: E402

    df = bancos.consultar("talenths", "SELECT nome, email, setor, cargo FROM public.pessoas")
    return df.to_dict("records")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--conferir", action="store_true",
                    help="só mostra quem seria criado; não cria nada")
    args = ap.parse_args()

    api = os.environ.get("HSOS_API")
    token = os.environ.get("HSOS_TOKEN")
    if not api or not token:
        print("Defina HSOS_API e HSOS_TOKEN.", file=sys.stderr)
        return 2

    cliente = httpx.Client(base_url=api, headers={"Authorization": f"Bearer {token}"},
                           timeout=30)

    perfis = cliente.get("/profiles")
    perfis.raise_for_status()
    existentes = {normalizar(p.get("email")) for p in perfis.json()}

    falta = quem_falta(ler_quadro(), existentes)
    print(f"{len(existentes)} contas hoje · {len(falta)} a criar\n")

    if args.conferir:
        for p in falta:
            print(f"  {p['email']:<38} {p['nome']}  ({p.get('setor') or '—'})")
        return 0

    criadas, falhas = [], []
    for pessoa in falta:
        senha = senha_forte()
        r = cliente.post("/profiles", json={
            "email": pessoa["email"],
            "nome": pessoa["nome"],
            "senha": senha,
            "role": "colaborador",
            "departamento": pessoa.get("setor"),
            "cargo": pessoa.get("cargo"),
        })
        if r.status_code == 201:
            criadas.append((pessoa["email"], senha))
        else:
            falhas.append((pessoa["email"], r.status_code, r.text[:120]))

    # ⚠️ Só aqui a senha existe em texto. Leve para o FortiPAM agora.
    print("\n── senhas · levar para o FortiPAM ──")
    for email, senha in criadas:
        print(f"{email}\t{senha}")

    if falhas:
        print("\n── falhas ──", file=sys.stderr)
        for email, codigo, corpo in falhas:
            print(f"{email}\t{codigo}\t{corpo}", file=sys.stderr)

    print(f"\n{len(criadas)} criadas · {len(falhas)} falhas")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd ~/github/HS.OS/backend && ./.venv/bin/python -m pytest tests/test_carregar_pessoas.py -q
```

Esperado: 5 testes verdes.

- [ ] **Step 5: Rodar em modo conferência contra produção**

Leitura pura — não cria nada:

```bash
cd ~/github/HS.OS/backend
HSOS_API=https://hsosapi.healthsafetytech.com HSOS_TOKEN=<token de admin> \
  ./.venv/bin/python scripts/carregar_pessoas.py --conferir
```

Esperado: `4 contas hoje · 23 a criar`, e a lista **não** deve conter `ti@`, `np@`, `financeiro01@` (já têm conta), nem `bruce@`/`carlos@`.

⚠️ **Se o número não for 23, pare.** Ou o quadro do TalentHS mudou — o que é informação, não erro — ou a comparação de e-mail está falhando. Descubra qual antes de criar conta nenhuma.

- [ ] **Step 6: Commit**

```bash
cd ~/github/HS.OS
git add backend/scripts/carregar_pessoas.py backend/tests/test_carregar_pessoas.py
git commit -m "O quadro da empresa vira conta, pelo caminho que já estava testado

O script é cliente de POST /profiles, não do banco: aquela rota já cria
auth.users, profiles e user_roles numa transação e registra no log de acesso.
Reimplementar isso em SQL seria um segundo caminho para a mesma coisa, e é o
segundo caminho que envelhece.

Testado o que dá para testar sem rede, que é justamente o que erra: quem entra.
Bruce e Carlos são cadastro de teste no TalentHS, quem já tem conta não pode
virar segunda, e e-mail repetido dentro do próprio quadro também não.

A senha aparece uma vez e vai para o FortiPAM — colaborador não troca a própria
senha, e o backend só guarda o hash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Aplicar em produção e trazer as pessoas

**Files:**
- Create: `~/aplicar-hsos-014-015.sh` (fora do repositório: leva credencial de superusuário)

**Interfaces:**
- Consumes: as migrações `014` e `015` (Tarefas 1 e 3) e o `carregar_pessoas.py` (Tarefa 6).

⚠️ **Esta tarefa é a primeira que toca produção.** Tudo antes dela se provou em rascunho. O Claude monta os comandos; **quem roda é o Erick, no Konsole** — as migrações exigem superusuário do Postgres, e o `admin.toml` não é lido por esta sessão.

- [ ] **Step 1: Montar o script de aplicação**

Criar `~/aplicar-hsos-014-015.sh` (fora do repositório, porque a URL do banco leva senha):

```bash
#!/usr/bin/env bash
# Aplica as migrações 014 e 015 do HS.OS em produção.
#
# ⚠️ Rodar no Konsole. Pede a URL de superusuário do banco `hsos` — a mesma do
#    bloco [hsos] em ~/.config/bancos/admin.toml.
set -euo pipefail

read -rsp "URL do Postgres (superusuário) do hsos: " URL; echo
cd ~/github/HS.OS/backend/migrations

echo "── antes: canais com gente que não vê o agente do canal ──"
psql "$URL" -f ~/github/HS.OS/scripts/conferir-acesso-canais.sql || true
echo "(se a consulta falhar aqui é esperado: a função ainda não existe)"

for f in 014_acesso_a_agente.sql 015_quem_cria_canal.sql; do
    echo "── aplicando $f"
    psql "$URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "── depois: a mesma conferência, agora com a função no ar ──"
psql "$URL" -f ~/github/HS.OS/scripts/conferir-acesso-canais.sql
```

- [ ] **Step 2: Erick roda o script**

```
bash ~/aplicar-hsos-014-015.sh
```

⚠️ **A conferência do fim pode voltar com linhas, e isso não é erro** — é o retrato de quem já está em canal com agente que não vê. Com os canais de hoje (três, todos com zero mensagens) o esperado é vir vazia. Se vier com linha, leia antes de seguir: é dado da instalação, não falha da migração.

- [ ] **Step 3: Limpar os dois canais órfãos**

Um DM com o Erick sozinho e um da Adriana, que não tem conta. Zero mensagens nos dois. Acrescentar ao Konsole:

```bash
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- Confere antes de apagar: só canal `dm` com ZERO mensagens.
SELECT c.id, c.name, c.type,
       (SELECT count(*) FROM public.channel_messages m WHERE m.channel_id = c.id) AS msgs
  FROM public.channels c
 WHERE c.id IN ('4d2b6991-1a50-4119-9390-7020a207a564',
                'a3c509eb-ce7a-4c5e-9213-586266ecd98d');
-- Se as duas linhas vieram com msgs = 0, siga; senão, ROLLBACK.
DELETE FROM public.channels
 WHERE id IN ('4d2b6991-1a50-4119-9390-7020a207a564',
              'a3c509eb-ce7a-4c5e-9213-586266ecd98d')
   AND NOT EXISTS (SELECT 1 FROM public.channel_messages m WHERE m.channel_id = channels.id);
COMMIT;
SQL
```

⚠️ O `NOT EXISTS` no `DELETE` não é redundância com o `SELECT` de cima: o `SELECT` é para os olhos e o `NOT EXISTS` é a garantia. Apagar canal com mensagem dentro não tem desfazer.

- [ ] **Step 4: Deployar backend e frontend, os dois**

Pelo EasyPanel, os dois serviços.

⚠️ **Deployar um só descasa as versões** — foi o que deu tela branca em 01/09/2026. O front chama rotas que só existem no back novo, e o back recusa chamadas que só o front velho faz.

- [ ] **Step 5: Criar as 23 contas**

```bash
cd ~/github/HS.OS/backend
HSOS_API=https://hsosapi.healthsafetytech.com HSOS_TOKEN=<token de admin> \
  ./.venv/bin/python scripts/carregar_pessoas.py --conferir
# conferindo a lista, rodar de novo sem --conferir
```

Guardar a saída de senhas no FortiPAM **antes de fechar o terminal**. Ela não é recuperável.

- [ ] **Step 6: Conferir por leitura**

```bash
cd ~/projetos/bancos && .venv/bin/python -c "
import bancos
print(bancos.consultar('hsos', 'select count(*) as contas from public.profiles').to_string())
print(bancos.consultar('hsos', '''
  select departamento, count(*) from public.diretorio
   group by departamento order by 2 desc''').to_string())
print(bancos.consultar('hsos', '''
  select count(*) as sem_setor from public.profiles
   where departamento is null or departamento = '' ''').to_string())
"
```

Esperado: **27** contas, setores batendo com o TalentHS, e `sem_setor = 0`.

⚠️ **Contar linha não é conferir dado** — a régua da casa. Além do total, olhe três nomes na tela de Usuários e veja setor e cargo preenchidos. Já aconteceu aqui de a contagem fechar com campo chumbado dentro.

---

### Task 8: A prova de que funciona

**Files:**
- Create: `docs/CONFERENCIA-CHAT-PESSOAS.md`

**Interfaces:**
- Consumes: tudo que as tarefas anteriores entregaram, no ar.

Esta tarefa não muda comportamento — ela mede. A conversa entre pessoas **nunca teve uma mensagem sequer** neste sistema, então nada em produção comprova que aquele caminho funciona.

- [ ] **Step 1: Bater em cada rota que mudou com token de colaborador**

É como as restrições foram conferidas em agosto, e é o que pega "escondi na tela mas deixei a rota aberta". Emitir o token na mão, como o repositório já faz:

```bash
cd ~/github/HS.OS/backend
./.venv/bin/python -c "
from app.auth.security import emitir_token
# emitir_token(user_id, papel, email) -> (token, segundos_ate_expirar)
token, _ = emitir_token('<uuid de um colaborador>', 'colaborador', 'fulana@healthsafetytech.com')
print(token)
"
```

Com esse token, contra a API de produção, e anotando o código de cada resposta:

| chamada | esperado |
|---|---|
| `POST /channels` (criar canal) | **403** |
| `POST /conversations/dm/abrir` com outra pessoa | **200** e um `channel_id` |
| `POST /channels/{canal alheio}/members` | **403** (não é membro) |
| `POST /channels/{canal dele}/members` com pessoa | **403** (não é admin, canal não é DM) |
| `GET /channels/dms/interlocutores` | **200** |

- [ ] **Step 2: Provar o invariante nas duas direções, e nos dois sentidos**

Com token de **administrador**, num canal de teste:

| tentativa | esperado |
|---|---|
| juntar pessoa e agente que ela **pode** ver | **204** |
| adicionar ao canal uma pessoa que **não** pode ver o agente que já está lá | **403**, e a mensagem nomeia a pessoa e o agente |
| adicionar ao canal um agente que um membro **não** pode ver | **403**, idem |
| abrir DM com agente que a pessoa **não** pode ver | **403**, não 500 |

⚠️ **Os dois casos que devem PASSAR valem tanto quanto os que devem falhar.** Uma regra que recusa tudo passa em qualquer teste que só procure recusa.

- [ ] **Step 3: Provar que é o trigger segurando, não só o Python**

No banco de rascunho, `INSERT` direto em `channel_members`, sem passar por endpoint nenhum:

```bash
cd ~/github/HS.OS
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
```

Se só a API for exercitada, não se sabe qual das duas camadas está segurando — e a que precisa estar de pé é a de baixo.

- [ ] **Step 4: A conversa, no navegador, com duas contas de verdade**

Duas janelas, duas contas. Trocar mensagem nos dois sentidos, num DM e num canal de grupo, e acionar um agente dentro do canal.

Conferir: a mensagem aparece **na tela** da outra conta sem recarregar (o realtime roteia por `canal:<id>`), o "está digitando" acende, e o não-lidas conta.

⚠️ Dois defeitos da War room em 01/09 só apareceram assim — nenhum teste unitário os teria pego.

- [ ] **Step 5: Escrever a conferência**

Criar `docs/CONFERENCIA-CHAT-PESSOAS.md` com: o que foi batido e com qual código de resposta, o que passou, o que falhou, e o que **não** foi conferido. A última seção é a que vale mais daqui a um mês.

⚠️ Escreva o que ficou de fora com o mesmo cuidado do que passou. O `docs/VARREDURAS-2026-08-31.md` registra duas varreduras que "deram limpo por fraqueza do método" — é esse tipo de honestidade que impede alguém de confiar numa conferência que não conferiu.

- [ ] **Step 6: Commit e integração**

```bash
cd ~/github/HS.OS
git add docs/CONFERENCIA-CHAT-PESSOAS.md
git commit -m "A conferência da volta do chat entre pessoas, inclusive o que não foi conferido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Depois, decidir a integração do branch `chat-entre-pessoas` com a skill `superpowers:finishing-a-development-branch`.

---

## Ordem e dependências

```
Tarefa 1 (função + trigger)
   ├──► Tarefa 2 (backend impõe)
   │        └──► Tarefa 3 (rotas e policy) ──► Tarefa 4 (front: pessoas) ──► Tarefa 5 (front: canal)
   └──► Tarefa 3
Tarefa 6 (script de carga) — independente das outras; pode ser feita a qualquer momento
Tarefa 7 (produção) — depende de 1, 3, 4, 5, 6
Tarefa 8 (conferência) — depende de 7
```

A Tarefa 6 não depende de nenhuma outra: o script conversa com `POST /profiles`, que já existe hoje. Ela pode rodar em paralelo com o caminho 1→5.
