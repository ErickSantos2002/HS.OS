-- 025_silenciar_canal.sql — silenciar canal, por pessoa (spec 2026-11-03)
--
-- Silenciar corta push, som e notificação local daquele canal — e só isso: o
-- sininho e o contador de não lidas continuam (esclarecimento 5). Menção
-- nominal e `@todos` furam o silenciar no push.
--
-- Quem grava é o backend (`PUT /channels/{id}/silenciar`), como service_role e
-- filtrando pelo usuário do token — por isso não há policy de UPDATE nova.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-025.py

BEGIN;

ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS silenciado boolean NOT NULL DEFAULT false;

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT count(*) FILTER (WHERE silenciado) AS silenciados, count(*)
--     FROM public.channel_members;                               -- 0 | N
