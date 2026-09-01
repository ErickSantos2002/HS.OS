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
