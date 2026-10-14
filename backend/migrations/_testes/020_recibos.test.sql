-- Prova os triggers do visto por mensagem (spec 2026-10-14).
--
-- O que custa errar aqui: o `trg_criar_recibos` roda DENTRO do INSERT de toda
-- mensagem de canal. Se ele levantar, a mensagem não é gravada — trocar o
-- acessório (o visto) pelo essencial (a conversa).
--
--   psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
--        -f backend/migrations/_testes/020_recibos.test.sql

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ana@exemplo.test'),
  ('22222222-2222-2222-2222-222222222222', 'bia@exemplo.test'),
  ('33333333-3333-3333-3333-333333333333', 'caio@exemplo.test');

INSERT INTO public.channels (id, name, type, created_by) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grupo-teste', 'private', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.channel_members (channel_id, user_id, member_id, member_type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'human'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'human'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'human');

-- 1. Mensagem de pessoa: recibo para os outros dois, não para o autor.
INSERT INTO public.channel_messages (id, channel_id, author_id, author_type, author_name, content)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'human', 'Ana', 'oi');

DO $$
DECLARE n int; autor int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE user_id = '11111111-1111-1111-1111-111111111111')
    INTO n, autor FROM public.recibos_mensagem
   WHERE message_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  ASSERT n = 2, format('esperava 2 recibos, veio %s', n);
  ASSERT autor = 0, 'o autor não recebe recibo da própria mensagem';
END $$;

-- 2. Membro com id fora do formato (lixo herdado) NÃO derruba a mensagem.
ALTER TABLE public.channel_members DISABLE TRIGGER USER;
INSERT INTO public.channel_members (channel_id, user_id, member_id, member_type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'nao-e-uuid', 'nao-e-uuid', 'human');
ALTER TABLE public.channel_members ENABLE TRIGGER USER;

INSERT INTO public.channel_messages (id, channel_id, author_id, author_type, author_name, content)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222', 'human', 'Bia', 'segue de pé');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.recibos_mensagem
   WHERE message_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  ASSERT n = 2, format('id fora do formato: esperava 2 recibos (Ana e Caio), veio %s', n);
END $$;

-- 3. Marcar lido pelo mesmo UPDATE da rota não falha no trigger por statement.
UPDATE public.recibos_mensagem r
   SET lida_em = now(), entregue_em = COALESCE(r.entregue_em, now())
  FROM public.channel_messages m
 WHERE r.message_id = m.id AND m.channel_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND r.user_id = '33333333-3333-3333-3333-333333333333' AND r.lida_em IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.recibos_mensagem
   WHERE user_id = '33333333-3333-3333-3333-333333333333'
     AND lida_em IS NOT NULL AND entregue_em IS NOT NULL;
  ASSERT n = 2, format('Caio leu as duas: esperava 2, veio %s', n);
END $$;

-- 4. Apagar a mensagem leva os recibos junto.
DELETE FROM public.channel_messages WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.recibos_mensagem
                      WHERE message_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
         'recibo órfão depois de apagar a mensagem';
END $$;

\echo '020_recibos: ok'
ROLLBACK;
