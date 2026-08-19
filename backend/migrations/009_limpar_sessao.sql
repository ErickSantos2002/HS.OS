-- 009_limpar_sessao.sql — limpar a conversa sem perder o que foi conversado
--
-- O botão "Limpar" da tela de chat fazia exatamente o contrário do que se espera
-- dele, e o comentário no código dizia isso com todas as letras:
--
--     "Não toca na sessão do gateway: são históricos separados, e limpar a tela
--      não deveria fazer o agente esquecer o que conversaram."
--
-- Ou seja: **apagava do banco para sempre o que interessa guardar, e mantinha a
-- memória do agente, que é justamente o que a pessoa quer zerar.** Quem clicava
-- para "começar do zero" continuava conversando com um agente que lembrava de
-- tudo, e perdia o histórico para auditoria.
--
-- Decisão do Erick em 19/08/2026, antes de devolver o sistema ao Nicholson para
-- novo teste: inverter os dois. A sessão do gateway é zerada de verdade; as
-- mensagens **ficam no banco**.
--
-- ⚠️ **A tela passa a mostrar só o que veio depois do último reset.** Nada é
--    apagado: `public.conversations` continua com tudo, e a auditoria é uma
--    consulta sem filtro. O que existe aqui é a marca de onde recomeçar.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não tem CREATE em `public`:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/009_limpar_sessao.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.conversation_resets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL,
    agent_id     text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Quantas mensagens ficaram para trás. Não é usado para filtrar nada: é para
    -- a auditoria saber, sem contar linha, o tamanho do que foi encerrado.
    mensagens    integer     NOT NULL DEFAULT 0,
    -- A sessão do gateway foi mesmo derrubada? Best effort: se o gateway estiver
    -- fora, a tela ainda limpa, e este campo registra que o agente **não**
    -- esqueceu. Sem isso, "limpei e ele continua lembrando" vira mistério.
    sessao_zerada boolean    NOT NULL DEFAULT false
);

COMMENT ON TABLE public.conversation_resets IS
    'Marca onde o usuário pediu para recomeçar a conversa com um agente. A tela '
    'mostra só o que veio depois da marca mais recente; `conversations` guarda '
    'tudo. Ver 009_limpar_sessao.sql.';

-- A consulta quente é sempre "qual foi o último reset deste par".
CREATE INDEX IF NOT EXISTS conversation_resets_ultimo
    ON public.conversation_resets (user_id, agent_id, created_at DESC);

ALTER TABLE public.conversation_resets ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho de `conversations`: cada um enxerga e cria o seu.
DROP POLICY IF EXISTS dono_le ON public.conversation_resets;
CREATE POLICY dono_le ON public.conversation_resets
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS dono_cria ON public.conversation_resets;
CREATE POLICY dono_cria ON public.conversation_resets
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ⚠️ **Sem policy de UPDATE e sem policy de DELETE, de propósito.** A marca é um
--    registro de auditoria: apagá-la faria reaparecer conversa que a pessoa
--    tinha encerrado, e editá-la moveria o corte. Quem precisar desfazer usa o
--    `service_role`, e isso fica no log.

GRANT SELECT, INSERT ON public.conversation_resets TO authenticated;
GRANT ALL ON public.conversation_resets TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoria: o que foi encerrado, e o que ainda está lá
-- ─────────────────────────────────────────────────────────────────────────────
--
--   SELECT p.full_name, r.agent_id, r.created_at, r.mensagens, r.sessao_zerada
--     FROM public.conversation_resets r
--     JOIN public.profiles p ON p.id = r.user_id
--    ORDER BY r.created_at DESC;
--
-- E as mensagens de uma sessão encerrada continuam aqui, inteiras:
--
--   SELECT created_at, role, content
--     FROM public.conversations
--    WHERE user_id = :pessoa AND agent_id = :agente
--      AND created_at < :momento_do_reset
--    ORDER BY created_at;
