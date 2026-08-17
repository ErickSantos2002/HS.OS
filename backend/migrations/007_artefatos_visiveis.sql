-- 007_artefatos_visiveis.sql — artefato de um é artefato de todos
--
-- Decisão do Erick em 17/08/2026, depois de conversar com o Nicholson: o HS.OS
-- deixou de ser plataforma da empresa inteira e virou ferramenta restrita à
-- diretoria e ao TI. Hoje são **três pessoas** no sistema, e esconder o
-- artefato de uma da outra só produz o sintoma que apareceu no mesmo dia: o
-- Nicholson criou "Fluxo de Responsabilidade" pela Nina, o Erick não conseguiu
-- ver, e pelo id vinha **404** — indistinguível de "não existe".
--
-- ⚠️ **Isto amplia leitura, e a decisão foi consciente.** Um artefato pode ter
--    dado de cliente dentro. Vale enquanto o sistema for de três pessoas de
--    confiança; se um dia voltar a ter colaborador de área, esta migration é o
--    lugar de reabrir a discussão — e não o `owner_all`, que continua sendo o
--    que garante que só o dono ESCREVE.
--
-- O que NÃO muda:
--   · escrita continua só do dono (`owner_all`, `Users update/delete own`)
--   · anônimo continua vendo só o publicado e público (`public_read`)
--   · artefato apagado (`deleted_at`) continua invisível para todos
--
-- Antes daqui, quem lia o de outra pessoa precisava do artefato **publicado**
-- (`is_published = true`). O `is_public` sozinho não fazia nada, e é por isso
-- que o do Nicholson estava com `is_public = true` sem efeito nenhum.

BEGIN;

-- ── live_artifacts ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS autenticado_le_todos ON public.live_artifacts;
CREATE POLICY autenticado_le_todos ON public.live_artifacts
    FOR SELECT
    TO authenticated
    USING (deleted_at IS NULL);

-- ── artifacts_published ──────────────────────────────────────────────────────
-- Mesma regra, tabela diferente: aqui a coluna de dono é `created_by`, não
-- `user_id`. As duas convivem desde o remix e não valia unificar agora.
DROP POLICY IF EXISTS autenticado_le_todos ON public.artifacts_published;
CREATE POLICY autenticado_le_todos ON public.artifacts_published
    FOR SELECT
    TO authenticated
    USING (true);

COMMIT;
