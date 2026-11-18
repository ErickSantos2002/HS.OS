-- 039_conversas_marcadas.sql — marcar conversa como não lida pela lista (18/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.
--
-- Pedido da Leticia: marcar uma conversa já lida como "voltarei aqui", como no
-- WhatsApp. A marca é da PESSOA sobre a conversa inteira, e some quando ela
-- abre a conversa de novo.
--
-- ⚠️ NÃO é notificação, de propósito. O "Marcar como não lida" por mensagem
-- (`POST /notificacoes/nao-lida`) criava uma linha em `notifications`, que conta
-- como não lida de verdade — e, com a conversa aberta, o re-sweep de 2 s do
-- `useConversaAtivaNasNotificacoes` a marcava como lida na hora. Tabela própria:
-- não entra no sininho, no push nem no contador, e varredura de lido não a toca.
--
-- ⚠️ A coluna é `canal_id`, NÃO `channel_id`. O trigger genérico de realtime
-- (`003`) publica no tópico do canal toda linha que tem `channel_id` — isso
-- diria aos membros do canal que alguém o marcou. Por isso o trigger é próprio e
-- só leva `{tabela, op, id, user_id}` → tópico `usuario:<id>`.
--
-- Permissões no padrão da 032: RLS ligada e SEM policy, só o backend
-- (`service_role`) acessa; quem filtra pela pessoa é a rota.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-039.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.conversas_marcadas (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    canal_id    uuid        REFERENCES public.channels(id) ON DELETE CASCADE,
    agent_id    text,
    marcada_em  timestamptz NOT NULL DEFAULT now(),
    -- Exatamente um alvo: canal (DM, grupo, canal, pessoal) OU agente.
    CONSTRAINT conversas_marcadas_um_alvo CHECK ((canal_id IS NULL) <> (agent_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS conversas_marcadas_canal_uidx
    ON public.conversas_marcadas (user_id, canal_id) WHERE canal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversas_marcadas_agente_uidx
    ON public.conversas_marcadas (user_id, agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE public.conversas_marcadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversas_marcadas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversas_marcadas TO service_role;

-- Outro aparelho da mesma pessoa acompanha. São 2 workers: `hub.publicar` só
-- alcança quem está no mesmo processo, o banco alcança os dois.
CREATE OR REPLACE FUNCTION public.notificar_conversa_marcada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    linha public.conversas_marcadas;
BEGIN
    IF TG_OP = 'DELETE' THEN
        linha := OLD;
    ELSE
        linha := NEW;
    END IF;
    PERFORM pg_notify('hsos_mudancas', json_build_object(
        'tabela', 'conversas_marcadas', 'op', TG_OP, 'id', linha.id,
        'user_id', linha.user_id)::text);
    RETURN NULL;
END;
$$;

-- Regra da 034: função nova nasce com EXECUTE para PUBLIC.
REVOKE EXECUTE ON FUNCTION public.notificar_conversa_marcada() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notificar_conversa_marcada ON public.conversas_marcadas;
CREATE TRIGGER trg_notificar_conversa_marcada
    AFTER INSERT OR DELETE ON public.conversas_marcadas
    FOR EACH ROW EXECUTE FUNCTION public.notificar_conversa_marcada();

COMMIT;

-- Conferir depois de aplicar:
--   SELECT to_regclass('public.conversas_marcadas') IS NOT NULL;                       -- t
--   SELECT has_table_privilege('service_role','public.conversas_marcadas','INSERT');  -- t
