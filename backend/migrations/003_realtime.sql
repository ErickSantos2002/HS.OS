-- 003_realtime.sql — substitui o `postgres_changes` do Supabase
--
-- O front observava mudanças de tabela pelo Realtime do Supabase. Aqui a captura
-- é do próprio Postgres: cada tabela observada ganha um trigger que emite
-- `pg_notify`, e o backend escuta num canal só e republica pelo WebSocket.
--
-- ⚠️ A notificação carrega **apenas** `{tabela, op, id}`, nunca a linha. O
--    `pg_notify` tem limite de 8000 bytes por mensagem, e o `content` de
--    `channel_messages` ou `conversations` estoura isso sem esforço — a
--    notificação seria descartada em silêncio, justamente na tabela mais quente.
--    Quem busca a linha e monta o payload completo é o backend, onde não há
--    limite.
--
-- ⚠️ `usage_events` NÃO está na lista, apesar de três telas a observarem. Ela
--    recebe escrita em lote pela varredura de uso, e um evento por linha faria
--    uma tempestade de notificações. Aquelas telas recarregam por outro caminho.
--
-- O plano completo e o porquê das escolhas estão em `docs/PLANO-REALTIME.md`.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO.** O `hsos_app` não tem permissão de CREATE no
--    schema public (de propósito — é o que mantém o RLS valendo para ele), e a
--    migration falha com `permission denied for schema public`. Rodar com o
--    `administrador`:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/003_realtime.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A função de trigger — uma só para todas as tabelas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `TG_TABLE_NAME` e `TG_OP` dizem de onde veio e o que aconteceu, então não há
-- razão para uma função por tabela. Em DELETE o `NEW` é nulo, por isso o
-- COALESCE.

CREATE OR REPLACE FUNCTION public.notificar_mudanca() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    identificador text;
BEGIN
    -- `to_jsonb(...)->>'id'` em vez de `NEW.id`: nem toda tabela observada tem
    -- coluna `id` (as de junção usam chave composta), e referenciar um campo
    -- inexistente é erro de compilação do plpgsql em tempo de execução.
    identificador := COALESCE(
        to_jsonb(NEW) ->> 'id',
        to_jsonb(OLD) ->> 'id'
    );

    PERFORM pg_notify(
        'hsos_mudancas',
        json_build_object(
            'tabela', TG_TABLE_NAME,
            'op',     TG_OP,
            'id',     identificador
        )::text
    );

    -- AFTER trigger: o retorno é ignorado, mas plpgsql exige um.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.notificar_mudanca() IS
    'Avisa o backend que uma linha mudou. Carrega só tabela/op/id — a linha '
    'completa é buscada do outro lado, porque o pg_notify limita a 8000 bytes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Os gatilhos
-- ─────────────────────────────────────────────────────────────────────────────
--
-- AFTER, não BEFORE: notificar antes do commit faria o backend buscar uma linha
-- que outra conexão ainda não enxerga — a tela receberia o aviso e viria de mãos
-- vazias. (O `pg_notify` só é entregue no commit, mas o AFTER também garante que
-- a linha existe quando o trigger roda.)

DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'channel_messages', 'conversations', 'notifications',
        'agent_tasks', 'agent_results', 'agent_profiles',
        'agent_activity_log', 'agent_skills', 'agent_crons',
        'team_agents', 'skills', 'message_reactions',
        'drafts', 'dm_reads', 'channel_agent_activity', 'automations'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_notificar_%1$s ON public.%1$I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_notificar_%1$s
               AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
               FOR EACH ROW EXECUTE FUNCTION public.notificar_mudanca()', t
        );
    END LOOP;
END;
$$;

COMMIT;
