-- 017_anexos.sql — anexo de conversa vira registro, e o registro decide quem lê
--
-- Até 13/10/2026 anexo de conversa ia para o bucket PÚBLICO `agent-files`: quem
-- tivesse a URL abria, sem login. Para a planilha de ponto do RH — nome e
-- horário de cada funcionário — isso não serve. A partir daqui o anexo mora no
-- bucket lógico `anexos`, e quem pode ler é decidido por esta tabela, não pelo
-- caminho do arquivo:
--
--   contexto = 'canal'            → membro do canal (inclui DM entre pessoas)
--   contexto = 'conversa_agente'  → a pessoa da conversa (`dono_conversa`),
--                                   e o agente da conversa (`agent_id`)
--
-- Sem policy para `authenticated`, de propósito: toda leitura passa pelo
-- backend como `service_role`, e a decisão está em `app/anexos.py`, testada.
-- Uma segunda regra no RLS acabaria divergindo da primeira.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não tem CREATE em `public`.
--    python3 ~/aplicar-hsos-017.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.anexos (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket             text        NOT NULL DEFAULT 'anexos',
    caminho            text        NOT NULL UNIQUE,
    nome               text        NOT NULL,
    mime               text        NOT NULL,
    tamanho            bigint      NOT NULL CHECK (tamanho > 0),
    enviado_por_user   uuid,
    enviado_por_agent  text,
    contexto           text        NOT NULL CHECK (contexto IN ('canal', 'conversa_agente')),
    channel_id         uuid        REFERENCES public.channels(id) ON DELETE CASCADE,
    agent_id           text,
    dono_conversa      uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT anexos_campos_do_contexto CHECK (
        (contexto = 'canal' AND channel_id IS NOT NULL
             AND agent_id IS NULL AND dono_conversa IS NULL)
     OR (contexto = 'conversa_agente' AND channel_id IS NULL
             AND agent_id IS NOT NULL AND dono_conversa IS NOT NULL)
    ),
    -- Ou foi uma pessoa, ou foi um agente. Nunca os dois, nunca nenhum.
    CONSTRAINT anexos_um_remetente CHECK (
        (enviado_por_user IS NULL) <> (enviado_por_agent IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS anexos_canal_idx    ON public.anexos (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS anexos_conversa_idx ON public.anexos (agent_id, dono_conversa) WHERE agent_id IS NOT NULL;

ALTER TABLE public.anexos ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.anexos TO service_role;

-- O agente devolve arquivo à pessoa (`enviar_arquivo`) também em csv e md, e
-- registra na Documentos como os outros.
ALTER TABLE public.generated_documents
    DROP CONSTRAINT IF EXISTS generated_documents_doc_type_check;
ALTER TABLE public.generated_documents
    ADD CONSTRAINT generated_documents_doc_type_check
    CHECK (doc_type = ANY (ARRAY['pdf', 'docx', 'xlsx', 'csv', 'md']));

COMMIT;
