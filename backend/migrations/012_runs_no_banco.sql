-- 012_runs_no_banco.sql — o envio para de morar na memória de um processo
--
-- "Envio desconhecido. Pode ter expirado com um reinício do servidor — reenvie a
-- mensagem." O CEO recebeu essa frase da `nina` em 20/08/2026, no meio de um
-- pedido, e teve que redigitar. A mensagem sugere que o servidor reiniciou. Na
-- maior parte das vezes ele não reiniciou.
--
-- O que existe é um dicionário de módulo, `_SEQ_DO_RUN`, que guarda para cada
-- envio a sessão e o `seq` de onde a resposta começa. O `POST /enviar` grava
-- nele; o `GET /reply` lê. E o backend roda com **`--workers 2`**
-- (`backend/Dockerfile:70`): são dois processos Python, sem memória compartilhada.
-- O envio registrado no worker A simplesmente **não existe** para o worker B, e
-- a tela recebe 404 com uma explicação que não é a verdadeira.
--
-- O comentário no código dizia, sobre não criar esta tabela: "se o backend
-- reiniciar no meio, a espera devolve erro e a tela reenvia — o custo de perder
-- isto é baixo, e uma tabela para dado de segundos não se paga". O raciocínio
-- está certo **para um processo só**. Com dois, não é acidente de reinício: é o
-- funcionamento normal, algumas vezes por dia.
--
-- São três causas com a mesma mensagem, e a tabela resolve as três:
--   1. o poll cai no outro worker
--   2. o backend reiniciou (deploy, e há vários por dia)
--   3. o teto de 500 entradas podou o run — teto que eu mesmo pus hoje
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não tem CREATE em `public`:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/012_runs_no_banco.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_runs (
    -- O `runId` do gateway, que é o nosso `idempotencyKey` — o gateway devolve
    -- o mesmo valor que mandamos, então ele serve de chave dos dois lados.
    run_id            text PRIMARY KEY,
    agent_id          text        NOT NULL,
    session_key       text        NOT NULL,
    -- Onde a sessão estava quando este envio começou. É o que separa "resposta
    -- nova" de "histórico antigo" na hora de ler o `chat.history`.
    seq_antes         integer     NOT NULL DEFAULT 0,
    user_id           uuid        NOT NULL,
    -- Houve compactação no meio e a pergunta foi refeita: a tela continua
    -- perguntando pelo run que conhece, e seguimos a seta até o que responde.
    redireciona_para  text,
    -- Uma tentativa de compactar por pergunta. Sem isto, sessão irrecuperável
    -- entra em laço de compactar e reenviar.
    ja_compactou      boolean     NOT NULL DEFAULT false,
    -- A resposta já gravada. É o que faz a segunda chamada em voo devolver a
    -- MESMA mensagem em vez de inserir outra: em 20/08 o CEO recebeu duas
    -- mensagens idênticas de 776 caracteres, no mesmo segundo, porque as duas
    -- chamadas passaram pela conferência antes de qualquer uma gravar.
    message_id        uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
    criado_em         timestamptz NOT NULL DEFAULT now()
);

-- Para a limpeza periódica achar o que é velho sem varrer a tabela.
CREATE INDEX IF NOT EXISTS agent_runs_criado_em_idx
    ON public.agent_runs (criado_em);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho de `conversations`: cada um enxerga o seu.
DROP POLICY IF EXISTS dono_le ON public.agent_runs;
CREATE POLICY dono_le ON public.agent_runs
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS dono_cria ON public.agent_runs;
CREATE POLICY dono_cria ON public.agent_runs
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ⚠️ **Aqui há UPDATE, ao contrário da `conversation_resets`.** Esta tabela não é
--    registro de auditoria: é o estado vivo de um envio, e ele muda três vezes
--    no caminho normal (redireciona, marca que compactou, grava a resposta).
--    O `WITH CHECK` impede que a linha mude de dono no caminho.
DROP POLICY IF EXISTS dono_atualiza ON public.agent_runs;
CREATE POLICY dono_atualiza ON public.agent_runs
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conferir depois de aplicar:
--
--   SELECT count(*) FROM public.agent_runs;                    -- 0, tabela nova
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.agent_runs'::regclass;           -- 3 policies
