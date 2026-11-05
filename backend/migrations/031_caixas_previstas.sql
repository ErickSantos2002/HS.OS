-- 031_caixas_previstas.sql — caixas compartilhadas informadas pelo admin, à
-- espera de conferência (05/11/2026).
--
-- O Graph não descobre quais caixas a pessoa abre, e a conferência (leitura
-- de teste) precisa do token DELA — que só existe depois de ela clicar em
-- "Conectar e-mail". A lista do Erick entra aqui; o callback da OAuth confere
-- cada uma e move para `email_caixas` as que abrirem.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO — ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-031.py

BEGIN;
CREATE TABLE IF NOT EXISTS public.email_caixas_previstas (
    user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endereco  text NOT NULL,
    PRIMARY KEY (user_id, endereco)
);
ALTER TABLE public.email_caixas_previstas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_caixas_previstas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_caixas_previstas TO service_role;
COMMIT;
