-- 026_remover_push_morto.sql — o trigger que chamava a edge da dn.ia
--
-- `notifications_send_push` (`001`) chamava `net.http_post` para
-- `https://zozyfhisrbkqvdcsdbfp.supabase.co/functions/v1/send-push` — o
-- Supabase de OUTRA empresa — com a prévia da notificação no corpo. Hoje não
-- faz nada porque o schema `net` não existe e o `EXCEPTION WHEN OTHERS` engole
-- o erro. No dia em que alguém instalar `pg_net`, ele passa a mandar prévia de
-- mensagem para um terceiro. O push agora nasce da mensagem (`023`).
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-026.py

BEGIN;

DROP TRIGGER IF EXISTS notifications_send_push ON public.notifications;
DROP FUNCTION IF EXISTS public.trigger_send_push_on_notification();

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT count(*) FROM pg_proc
--    WHERE proname = 'trigger_send_push_on_notification';        -- 0
--   SELECT count(*) FROM pg_trigger
--    WHERE tgname = 'notifications_send_push';                    -- 0
