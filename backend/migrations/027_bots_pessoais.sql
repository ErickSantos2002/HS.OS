-- 027_bots_pessoais.sql — o dono do bot pessoal
--
-- Desde 05/11/2026 cada colaborador ganha um agente próprio, `<nome>-bot`
-- (spec `docs/superpowers/specs/2026-11-05-bots-pessoais-cascas-design.md`).
-- `dono_id IS NOT NULL` é a DEFINIÇÃO de "bot pessoal" no sistema inteiro: o
-- roster da orquestradora, a war-room e os seletores de canal o leem. Não se
-- deduz pelo sufixo `-bot` do id — um nome não é uma permissão.
--
-- Um bot por pessoa (índice único parcial).
--
-- ⚠️ `ON DELETE RESTRICT`, não `SET NULL`. NULL aqui quer dizer "especialista":
-- um bot que perdesse o dono passaria a ser tratado como agente do time —
-- entraria no roster da orquestradora e no anel da war-room. Falha fechada:
-- o perfil só sai depois de o bot ser desmontado. (Na prática ninguém apaga
-- perfil; quem sai é desativado em `auth.users.is_active`.)
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-027.py

BEGIN;

ALTER TABLE public.agent_profiles
  ADD COLUMN IF NOT EXISTS dono_id uuid NULL;

-- Recriada sempre: a primeira aplicação (05/11/2026) saiu com SET NULL.
ALTER TABLE public.agent_profiles DROP CONSTRAINT IF EXISTS agent_profiles_dono_id_fkey;
ALTER TABLE public.agent_profiles
  ADD CONSTRAINT agent_profiles_dono_id_fkey
  FOREIGN KEY (dono_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_um_bot_por_dono
  ON public.agent_profiles (dono_id) WHERE dono_id IS NOT NULL;

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT EXISTS(SELECT 1 FROM information_schema.columns
--    WHERE table_name = 'agent_profiles' AND column_name = 'dono_id');   -- t
--   SELECT EXISTS(SELECT 1 FROM pg_indexes
--    WHERE indexname = 'agent_profiles_um_bot_por_dono');                -- t
--   SELECT confdeltype FROM pg_constraint
--    WHERE conname = 'agent_profiles_dono_id_fkey';                       -- r
