-- 020_recibos.sql — visto por mensagem, igual ao WhatsApp (spec 2026-10-14)
--
-- Uma linha por mensagem de canal × membro HUMANO destinatário (o autor e os
-- agentes não entram — agente não "abre" canal e travaria o azul para sempre).
-- `entregue_em`: o navegador da pessoa estava conectado (`/ws`) — marcado pelo
-- servidor. `lida_em`: a pessoa abriu o canal (`POST /channels/{id}/lido`).
--
-- Sem policy para `authenticated`, de propósito, como na `017_anexos`: toda
-- leitura passa pelo backend como `service_role`, e quem decide é o Python.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-020.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.recibos_mensagem (
    message_id  uuid NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL,
    entregue_em timestamptz,
    lida_em     timestamptz,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS recibos_pendentes_idx
    ON public.recibos_mensagem (user_id) WHERE lida_em IS NULL;

ALTER TABLE public.recibos_mensagem ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.recibos_mensagem TO service_role;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS pergunta_id uuid;
CREATE INDEX IF NOT EXISTS agent_runs_pergunta_idx
    ON public.agent_runs (pergunta_id) WHERE pergunta_id IS NOT NULL;

-- ─── Criar os recibos de uma mensagem nova ─────────────────────────────────
-- ⚠️ Nunca pode impedir a mensagem: recibo é acessório. Qualquer erro vira
-- WARNING e a mensagem é gravada sem recibo.
-- ⚠️ `channel_members.user_id` é TEXT; o filtro por regex evita que um id
-- herdado fora do formato estoure o cast.
CREATE OR REPLACE FUNCTION public.criar_recibos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    INSERT INTO public.recibos_mensagem (message_id, user_id)
    SELECT NEW.id, cm.user_id::uuid
      FROM public.channel_members cm
     WHERE cm.channel_id = NEW.channel_id
       AND cm.member_type = 'human'
       AND cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND cm.user_id <> NEW.author_id
    ON CONFLICT DO NOTHING;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'criar_recibos(%): %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_criar_recibos ON public.channel_messages;
CREATE TRIGGER trg_criar_recibos
    AFTER INSERT ON public.channel_messages
    FOR EACH ROW EXECUTE FUNCTION public.criar_recibos();

-- ─── Avisar o canal quando um recibo muda ──────────────────────────────────
-- Por STATEMENT: marcar 50 mensagens como lidas vira um aviso por canal, não
-- cinquenta. Só UPDATE: o INSERT é "enviada", que quem mandou já sabe.
-- O formato é o do `notificar_mudanca` (003), para o `escuta_banco` rotear
-- pelo `channel_id` sem mudança.
CREATE OR REPLACE FUNCTION public.notificar_recibos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    canal uuid;
BEGIN
    FOR canal IN
        SELECT DISTINCT m.channel_id
          FROM novas n JOIN public.channel_messages m ON m.id = n.message_id
    LOOP
        PERFORM pg_notify('hsos_mudancas', json_build_object(
            'tabela', 'recibos_mensagem', 'op', 'UPDATE', 'id', NULL,
            'user_id', NULL, 'channel_id', canal, 'agent_id', NULL)::text);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_recibos ON public.recibos_mensagem;
CREATE TRIGGER trg_notificar_recibos
    AFTER UPDATE ON public.recibos_mensagem
    REFERENCING NEW TABLE AS novas
    FOR EACH STATEMENT EXECUTE FUNCTION public.notificar_recibos();

-- ─── Retroativo ────────────────────────────────────────────────────────────
-- Mensagens já existentes ganham recibo dos membros humanos atuais. Lida e
-- entregue no horário do `dm_reads` quando ele já passou da mensagem.
INSERT INTO public.recibos_mensagem (message_id, user_id, entregue_em, lida_em)
SELECT m.id, cm.user_id::uuid,
       CASE WHEN d.last_read_at >= m.created_at THEN d.last_read_at END,
       CASE WHEN d.last_read_at >= m.created_at THEN d.last_read_at END
  FROM public.channel_messages m
  JOIN public.channel_members cm
    ON cm.channel_id = m.channel_id AND cm.member_type = 'human'
   AND cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND cm.user_id <> m.author_id
  LEFT JOIN public.dm_reads d
    ON d.channel_id = m.channel_id AND d.user_id = cm.user_id::uuid
ON CONFLICT DO NOTHING;

COMMIT;
