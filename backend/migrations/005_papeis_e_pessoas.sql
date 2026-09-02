-- 005_papeis_e_pessoas.sql — papéis em português, e quem é cada pessoa
--
-- Duas mudanças que andam juntas porque tocam a mesma tela (Usuários) e o mesmo
-- arquivo do agente (o `USER.md` da orquestradora, que descreve com quem ela
-- fala).
--
-- ⚠️ **APLICAR JUNTO COM O CÓDIGO.** O rename quebra toda referência a
--    `'super_admin'` no mesmo instante — são 67 no backend e 62 no front. Não
--    aplique esta migration numa instância cujo código ainda não foi atualizado:
--    o login continua funcionando, mas toda checagem de papel passa a negar.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** (o `hsos_app` não é dono do tipo):
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/005_papeis_e_pessoas.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Papéis em português, e um a menos
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `RENAME VALUE` é seguro com RLS: o rótulo é guardado uma vez e as policies
-- referenciam o valor, não o texto. Testado em 14/08/2026 numa transação
-- desfeita — as 55 policies que citavam `super_admin` passaram a citar
-- `administrador` sozinhas, nenhuma ficou para trás.

ALTER TYPE public.app_role RENAME VALUE 'super_admin' TO 'administrador';
ALTER TYPE public.app_role RENAME VALUE 'member'      TO 'colaborador';

-- ⚠️ **`user` fica no enum, órfão.** O Postgres não tem `DROP VALUE`, e recriar
-- o tipo com 55 policies e uma coluna dependendo dele é cirurgia que não se
-- justifica por asseio.
--
-- E ele nunca foi papel de verdade: era o `COALESCE(role, 'user')` do código —
-- o rótulo de quem **não tem** linha em `user_roles`. Zero usuários o tiveram,
-- zero policies o citam. Ter "sem papel" com nome de papel é exatamente o que
-- fazia parecer que havia três níveis quando sempre houve dois.
--
-- No código o fallback passou a se chamar `sem_papel`, que diz o que é.
COMMENT ON TYPE public.app_role IS
    'administrador | colaborador. O valor `user` é legado e não é usado por '
    'ninguém — era o rótulo de "sem papel" antes de 14/08/2026. Não pode ser '
    'removido (Postgres não tem DROP VALUE) e não deve ser atribuído.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Departamento e cargo
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Vêm do cadastro do RH, no formato:
--   Beltrano de Tal ; beltrano@… ; RECURSOS HUMANOS ; Coordenadora de RH Junior
--
-- ⚠️ **Texto livre, e não tabela de departamentos**, por uma razão de tamanho:
-- são 27 pessoas e uma dúzia de departamentos que mudam de nome raramente. Uma
-- tabela traria FK, tela de manutenção e migração de valores — máquina demais
-- para o problema.
--
-- O risco assumido é grafia divergente ("RH" e "Recursos Humanos" virando dois
-- departamentos), e ele é mitigado na tela: o campo sugere os valores que já
-- existem, então digitar do zero é a exceção, não o caminho. Se um dia a lista
-- crescer ou precisar de hierarquia, aí a tabela se paga.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS departamento text,
    ADD COLUMN IF NOT EXISTS cargo        text;

COMMENT ON COLUMN public.profiles.departamento IS
    'Área da pessoa, como no cadastro do RH (ex.: RECURSOS HUMANOS). Texto '
    'livre; a tela sugere os valores existentes para evitar grafia divergente.';
COMMENT ON COLUMN public.profiles.cargo IS
    'Cargo da pessoa (ex.: Coordenadora de RH Junior). Serve à tela de Usuários '
    'e ao contexto que a orquestradora recebe sobre quem está falando com ela.';

-- Espaço em branco no começo ou no fim faz "RH " e "RH" virarem dois
-- departamentos na hora de agrupar, e é o erro de digitação mais comum em campo
-- colado de planilha.
UPDATE public.profiles
   SET departamento = NULLIF(btrim(departamento), ''),
       cargo        = NULLIF(btrim(cargo), '')
 WHERE departamento IS NOT NULL OR cargo IS NOT NULL;

COMMIT;
