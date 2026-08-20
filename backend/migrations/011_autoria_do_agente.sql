-- 011_autoria_do_agente.sql — quem escreveu o documento foi o agente, não a pessoa
--
-- O briefing da manhã aparecia na base de conhecimento como
-- **"Editado por Erick Santos"**. Não foi ele: foi o `flow` às 07h30 e a `iris`
-- às 07h35, por cron. A tela dizia o nome dele porque:
--
--   · o cron roda **sem solicitante** — não há pessoa pedindo;
--   · a ferramenta MCP cai no administrador cadastrado quando não recebe um;
--   · e não havia onde guardar "quem de fato escreveu".
--
-- ⚠️ **Num documento com número de faturamento, a assinatura importa.** Daqui a
--    um mês, quem abrir vai achar que o Erick apurou aquilo à mão — e vai
--    cobrar dele uma conta que quem fez foi a Iris, por uma régua escrita.
--
-- `created_by` continua sendo a pessoa: é dono do espaço, é quem a RLS usa, e é
-- NOT NULL. O que entra é **quem redigiu**.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não altera tabela nem função:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/011_autoria_do_agente.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quem escreveu
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nulo quer dizer "foi uma pessoa, pela tela" — que é o caso de todo documento
-- anterior a hoje e de tudo que for escrito no editor.

ALTER TABLE public.wiki_documents
    ADD COLUMN IF NOT EXISTS agent_id text;

COMMENT ON COLUMN public.wiki_documents.agent_id IS
    'Agente que redigiu o documento (`flow`, `iris`…). NULO = escrito por gente '
    'na tela. `created_by` continua sendo a pessoa dona, para a RLS. Ver 011.';

-- Os que já existem e sabemos de quem são. O briefing tem título estável, e é o
-- único caso: os demais foram escritos por pessoa ou a pedido de uma.
UPDATE public.wiki_documents SET agent_id = 'flow'
 WHERE agent_id IS NULL AND title LIKE 'Operação — briefing de %';
UPDATE public.wiki_documents SET agent_id = 'iris'
 WHERE agent_id IS NULL AND title LIKE 'Faturamento — briefing de %';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O gatilho para de mentir a data
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ **Ele carimbava `now()` em QUALQUER update**, inclusive num que já trazia
--    `updated_at` explícito. Em 20/08/2026 uma conversão de formato — markdown
--    para HTML, sem uma vírgula de texto alterada — fez os três briefings
--    aparecerem como "editado há 4 minutos" por quem não os tocou. Tentar
--    devolver a data com `SET updated_at = created_at` não funcionava: o gatilho
--    sobrescrevia de novo.
--
-- Agora ele só carimba quando quem escreve **não** disse a data. Manutenção de
-- formato deixa de virar edição; edição de verdade continua marcada sozinha.

CREATE OR REPLACE FUNCTION public.wiki_documents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at = now();
    END IF;
    RETURN NEW;
END;
$function$;

-- Desfaz o carimbo daquela conversão: nenhum destes foi editado por gente.
UPDATE public.wiki_documents SET updated_at = created_at
 WHERE agent_id IS NOT NULL AND updated_at > created_at;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conferência
-- ─────────────────────────────────────────────────────────────────────────────
--
--   SELECT title, agent_id, created_at = updated_at AS intocado
--     FROM public.wiki_documents ORDER BY created_at DESC;
--
-- Esperado: os briefings com `flow`/`iris` e `intocado = true`.
