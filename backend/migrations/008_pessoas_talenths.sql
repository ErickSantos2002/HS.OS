-- 008_pessoas_talenths.sql — o quadro de pessoal da empresa, para os agentes
--
-- ⚠️ **ESTA MIGRATION É NO BANCO `talenths-banco`, NÃO no `hsos`.** É a única
--    do diretório que sai de casa. Está aqui porque o consumidor é o HS.OS e
--    porque migration versionada é melhor que SQL solto no histórico do Konsole.
--
-- ── O problema que ela resolve ────────────────────────────────────────────────
--
-- Em 17/08/2026 o Nicholson perguntou ao `atlas` quantas reuniões cada SDR marcou
-- no mês. O `atlas` tinha os números — 40 reuniões, com nome de quem marcou — e
-- respondeu que **não podia dizer quem era SDR**:
--
--     "O diretório da empresa só tem TI, Financeiro e Diretoria cadastrados —
--      não há departamento COMERCIAL nem papéis de SDR. Sem o mapeamento oficial
--      de quem exerce função de SDR, eu não posso rotular ninguém."
--
-- Ele estava olhando o `banco-diretorio-hs-os`, que é a `public.diretorio` do
-- `hsos` — as **contas de login da plataforma**, três pessoas. O cadastro real da
-- empresa está aqui, com 28 pessoas e setor, e `COMERCIAL-SDR` tem exatamente as
-- três pessoas que ele havia acabado de listar como quem mais marcou reunião.
--
-- ⚠️ **Não dá para resolver dando o `banco-talenths` aos outros agentes.** Aquele
--    conector usa o usuário `leitura`, que enxerga `profiles.current_salary`,
--    `cpf`, `birth_date` e a tabela `employee_benefits`. Hoje só uma linha tem
--    salário preenchido; no dia em que o RH preencher o resto, seria a folha
--    inteira ao alcance de quem conversasse com o agente de vendas. O acesso
--    restrito do `bruce` (specific_users, duas pessoas) existe por causa disso e
--    seria contornado por fora.
--
-- A resposta é a mesma da `006_diretorio.sql`: uma view estreita e um usuário que
-- só enxerga ela.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** (cria role e view sobre tabela de outro dono):
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:9632/talenths-banco' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/008_pessoas_talenths.sql
--
--    Depois, defina a senha do usuário e leve-a para a tela de Conectores:
--
--      ALTER ROLE talenths_pessoas PASSWORD 'a-senha-escolhida';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A view
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O crachá, e só o crachá: nome, e-mail de trabalho, setor, cargo, senioridade.
--
-- ⚠️ **O que fica de fora é a razão de existir desta view**, então está escrito:
--    `cpf`, `current_salary`, `birth_date` e `phone` NÃO entram. Aniversário e
--    remuneração são domínio do `bruce`, que tem acesso restrito a duas pessoas;
--    trazê-los para cá desfaria essa restrição por um caminho lateral.
--
-- `hire_date` também fica de fora. É tentador ("tempo de casa"), mas combinado
-- com nome e cargo vira dado de RH, e nenhuma pergunta do dia a dia precisa dele
-- para saber quem é SDR.

CREATE OR REPLACE VIEW public.pessoas AS
    SELECT p.name                                   AS nome,
           p.email,
           COALESCE(d.name, 'SEM SETOR')            AS setor,
           NULLIF(TRIM(COALESCE(p.job_title, '')), '') AS cargo,
           p.seniority                              AS senioridade,
           p.job_family                             AS familia
      FROM public.profiles p
      LEFT JOIN public.departments d ON d.id = p.department_id;

COMMENT ON VIEW public.pessoas IS
    'Quadro de pessoal da Health & Safety para os agentes do HS.OS: nome, setor '
    'e cargo, sem CPF, salário, telefone nem data de nascimento. É o ÚNICO '
    'objeto que o usuário `talenths_pessoas` alcança — ver 008 para o porquê.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O usuário que só vê o quadro
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A senha NÃO está aqui, de propósito: este arquivo é versionado. É definida por
-- quem aplica e vai para o conector pela tela de Conectores.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talenths_pessoas') THEN
        CREATE ROLE talenths_pessoas LOGIN;
    END IF;
END
$$;

-- Recusa escrita antes de olhar permissão — pega até o que GRANT nenhum cobriria.
ALTER ROLE talenths_pessoas SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE "talenths-banco" TO talenths_pessoas;
GRANT USAGE   ON SCHEMA public              TO talenths_pessoas;

-- Primeiro tira tudo, depois concede só a view. A ordem importa: fazer o REVOKE
-- depois do GRANT apagaria a única permissão que este usuário deve ter.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM talenths_pessoas;
GRANT SELECT ON public.pessoas TO talenths_pessoas;

-- E que ele não herde nada de tabela criada daqui para a frente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM talenths_pessoas;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conferência (rodar como o próprio usuário, depois de definir a senha)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   psql 'postgresql://talenths_pessoas:SENHA@62.72.11.28:9632/talenths-banco' \
--        -c 'SELECT setor, count(*) FROM public.pessoas GROUP BY 1 ORDER BY 2 DESC;'
--
-- Esperado: 28 pessoas, COMERCIAL-VENDAS 4, COMERCIAL-SERVIÇOS 3, TI 3,
-- COMERCIAL-SDR 3, EXPEDIÇÃO 3, e por aí.
--
-- E o que TEM que falhar — se qualquer um destes devolver linha, a migration não
-- fez o que promete:
--
--   SELECT current_salary FROM public.profiles LIMIT 1;   -- permission denied
--   SELECT * FROM public.employee_benefits LIMIT 1;       -- permission denied
