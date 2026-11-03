-- 023_push_enviados.sql — o servidor passa a enviar push (spec 2026-11-03, Frente B)
--
-- Até aqui o backend tinha inscrição e envio de Web Push, e NENHUM chamador no
-- servidor: só a tela chamava `/push/enviar` (teste e lembrete de status). O
-- elo antigo era um trigger no `notifications` chamando a edge `send-push` do
-- Supabase da dn.ia — morto em silêncio (ver `026`).
--
-- O disparo nasce da MENSAGEM, não do sininho (esclarecimento 1 da spec): parte
-- das linhas de `notifications` vem de uma rota que o próprio cliente chama, e
-- "marcar como não lida" não deve virar push.
--
-- ⚠️ Pelo banco, igual ao recibo da `020`: são 2 workers e vários caminhos que
-- gravam mensagem (`channels.py`, `broadcast.py`, `/reply`, `/recuperar`, o
-- webhook, o coletor de respostas). Enviar de dentro de cada rota obrigaria a
-- lembrar de todos; o banco vê todos.
--
-- ⚠️ O aviso leva só `{tabela, id}` — nunca conteúdo (limite de 8000 bytes do
-- `pg_notify`, e o mesmo motivo de segurança da `003`). O backend relê a linha.
--
-- `push_enviados` é a reserva entre os 2 workers: os dois recebem o NOTIFY, e
-- envia quem fizer o `INSERT … ON CONFLICT DO NOTHING` primeiro. Fica de rastro.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-023.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_enviados (
    mensagem_id uuid        NOT NULL,
    user_id     uuid        NOT NULL,
    enviado_em  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mensagem_id, user_id)
);
CREATE INDEX IF NOT EXISTS push_enviados_enviado_em_idx
    ON public.push_enviados (enviado_em);

-- Sem policy para `authenticated`: só o backend (service_role) lê e escreve.
ALTER TABLE public.push_enviados ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_enviados TO service_role;

-- ⚠️ Nunca pode impedir a mensagem: push é acessório.
CREATE OR REPLACE FUNCTION public.avisar_push() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    PERFORM pg_notify('push_pendente', json_build_object(
        'tabela', TG_TABLE_NAME, 'id', NEW.id)::text);
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'avisar_push(%): %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_pendente ON public.channel_messages;
CREATE TRIGGER trg_push_pendente
    AFTER INSERT ON public.channel_messages
    FOR EACH ROW EXECUTE FUNCTION public.avisar_push();

-- Só a resposta do agente: a pergunta da pessoa não notifica ninguém.
DROP TRIGGER IF EXISTS trg_push_pendente ON public.conversations;
CREATE TRIGGER trg_push_pendente
    AFTER INSERT ON public.conversations
    FOR EACH ROW WHEN (NEW.role = 'agent')
    EXECUTE FUNCTION public.avisar_push();

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT to_regclass('public.push_enviados');                 -- push_enviados
--   SELECT tgrelid::regclass, tgname FROM pg_trigger
--    WHERE tgname = 'trg_push_pendente' ORDER BY 1;             -- 2 linhas
