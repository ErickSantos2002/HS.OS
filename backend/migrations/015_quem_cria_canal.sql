-- 015_quem_cria_canal.sql — canal de grupo é do administrador
--
-- Decisão do Erick, 01/09/2026, junto com a volta da conversa entre pessoas: DM
-- é livre entre todos, canal de grupo só o admin cria. Com 26 pessoas dentro, o
-- que se evita é canal morto se multiplicando — e, junto com a 014, mantém sob
-- controle de quem entende dela a regra de qual agente pode entrar onde.
--
-- ⚠️ **Fechar só o endpoint não fecha nada** — é o padrão que este repositório
--    corrigiu a semana inteira em agosto. A rota vira `exige_papel` no mesmo
--    commit, e aqui fica a outra metade.
--
-- ⚠️ **O DM continua nascendo.** O `find_or_create_dm` é SECURITY DEFINER e
--    insere em `channels` como dono, sem passar por esta policy. Isso está
--    provado em `_testes/015_quem_cria_canal.test.sql`, e é o teste que
--    importa deste arquivo: se um dia ele reprovar, o chat do colaborador
--    parou.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 015_quem_cria_canal.sql

BEGIN;

DROP POLICY IF EXISTS "Authenticated users create channels" ON public.channels;

CREATE POLICY "Only admins create channels"
    ON public.channels
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'administrador'));

COMMIT;
