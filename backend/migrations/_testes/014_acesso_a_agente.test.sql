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

-- ⚠️ `allowed_user_ids` é `uuid[] DEFAULT '{}'::uuid[] NOT NULL` no schema
--    (001_initial_schema.sql) — a coluna nunca é NULL de verdade numa linha
--    real, então o caso 7 usa lista VAZIA (`'{}'::uuid[]`), não NULL. A função
--    trata as duas igual via COALESCE, e o resultado esperado é o mesmo: nega.
INSERT INTO public.agent_profiles (agent_id, name, access_type, allowed_user_ids) VALUES
    ('restrito', 'Restrito', 'specific_users',
        ARRAY['22222222-2222-2222-2222-222222222222']::uuid[]),
    ('aberto',   'Aberto',   'all',          '{}'::uuid[]),
    ('so_admin', 'So Admin', 'admins_only',  '{}'::uuid[]),
    ('sem_lista','Sem Lista','specific_users', '{}'::uuid[]);
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
    -- 7. `specific_users` com lista vazia recusa
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
