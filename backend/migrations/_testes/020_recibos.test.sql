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
  ('91111111-1111-1111-1111-111111111111', 'ana@recibos-020.test'),
  ('92222222-2222-2222-2222-222222222222', 'bia@recibos-020.test'),
  ('93333333-3333-3333-3333-333333333333', 'caio@recibos-020.test');

INSERT INTO public.channels (id, name, type, created_by) VALUES
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grupo-teste', 'private', '91111111-1111-1111-1111-111111111111');

INSERT INTO public.channel_members (channel_id, user_id, member_id, member_type) VALUES
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '91111111-1111-1111-1111-111111111111', '91111111-1111-1111-1111-111111111111', 'human'),
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '92222222-2222-2222-2222-222222222222', '92222222-2222-2222-2222-222222222222', 'human'),
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '93333333-3333-3333-3333-333333333333', '93333333-3333-3333-3333-333333333333', 'human');

-- 1. Mensagem de pessoa: recibo para os outros dois, não para o autor.
INSERT INTO public.channel_messages (id, channel_id, author_id, author_type, author_name, content)
VALUES ('9bbbbbbb-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '91111111-1111-1111-1111-111111111111', 'human', 'Ana', 'oi');

DO $$
DECLARE n int; autor int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE user_id = '91111111-1111-1111-1111-111111111111')
    INTO n, autor FROM public.recibos_mensagem
   WHERE message_id = '9bbbbbbb-0000-0000-0000-000000000001';
  ASSERT n = 2, format('esperava 2 recibos, veio %s', n);
  ASSERT autor = 0, 'o autor não recebe recibo da própria mensagem';
END $$;

-- 2. Membro com id fora do formato (lixo herdado) NÃO derruba a mensagem.
ALTER TABLE public.channel_members DISABLE TRIGGER USER;
INSERT INTO public.channel_members (channel_id, user_id, member_id, member_type) VALUES
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'nao-e-uuid', 'nao-e-uuid', 'human');
ALTER TABLE public.channel_members ENABLE TRIGGER USER;

INSERT INTO public.channel_messages (id, channel_id, author_id, author_type, author_name, content)
VALUES ('9bbbbbbb-0000-0000-0000-000000000002', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '92222222-2222-2222-2222-222222222222', 'human', 'Bia', 'segue de pé');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.recibos_mensagem
   WHERE message_id = '9bbbbbbb-0000-0000-0000-000000000002';
  ASSERT n = 2, format('id fora do formato: esperava 2 recibos (Ana e Caio), veio %s', n);
END $$;

-- 3. Marcar lido pelo mesmo UPDATE da rota não falha no trigger por statement.
UPDATE public.recibos_mensagem r
   SET lida_em = now(), entregue_em = COALESCE(r.entregue_em, now())
  FROM public.channel_messages m
 WHERE r.message_id = m.id AND m.channel_id = '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND r.user_id = '93333333-3333-3333-3333-333333333333' AND r.lida_em IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.recibos_mensagem
   WHERE user_id = '93333333-3333-3333-3333-333333333333'
     AND lida_em IS NOT NULL AND entregue_em IS NOT NULL;
  ASSERT n = 2, format('Caio leu as duas: esperava 2, veio %s', n);
END $$;

-- 4. Apagar a mensagem leva os recibos junto.
DELETE FROM public.channel_messages WHERE id = '9bbbbbbb-0000-0000-0000-000000000001';
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.recibos_mensagem
                      WHERE message_id = '9bbbbbbb-0000-0000-0000-000000000001'),
         'recibo órfão depois de apagar a mensagem';
END $$;

\echo '020_recibos: ok'
ROLLBACK;
