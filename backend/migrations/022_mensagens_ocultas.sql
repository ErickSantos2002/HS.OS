-- 022_mensagens_ocultas.sql — "Apagar para mim", igual ao WhatsApp (30/10/2026)
--
-- Pedido de uma colaboradora que recebeu um GIF que não queria ver. A mensagem
-- some só para quem apagou: o autor e os outros membros continuam vendo, e
-- ninguém é avisado. Uma linha por pessoa × mensagem.
--
-- RLS: cada um enxerga, cria e desfaz só as próprias linhas — a lista de quem
-- escondeu o quê não é da conta de ninguém, nem do autor da mensagem.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-022.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.mensagens_ocultas (
    user_id    uuid NOT NULL,
    message_id uuid NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
    criado_em  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, message_id)
);

ALTER TABLE public.mensagens_ocultas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.mensagens_ocultas TO authenticated;
GRANT ALL ON public.mensagens_ocultas TO service_role;

DROP POLICY IF EXISTS "Cada um ve o que escondeu" ON public.mensagens_ocultas;
CREATE POLICY "Cada um ve o que escondeu" ON public.mensagens_ocultas
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Cada um esconde para si" ON public.mensagens_ocultas;
CREATE POLICY "Cada um esconde para si" ON public.mensagens_ocultas
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Cada um desfaz o seu" ON public.mensagens_ocultas;
CREATE POLICY "Cada um desfaz o seu" ON public.mensagens_ocultas
    FOR DELETE TO authenticated USING (user_id = auth.uid());

COMMIT;
