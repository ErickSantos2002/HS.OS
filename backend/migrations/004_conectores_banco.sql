-- 004_conectores_banco.sql — bancos de dados como quarto tipo de conector
--
-- Até aqui a tela de Conectores tinha três grupos: Modelos de IA, APIs e MCPs.
-- Banco de dados é o quarto, e é o que mais importa: é a ferramenta principal
-- dos agentes, e hoje o acesso a ele existe **fora** da plataforma, como
-- variável de ambiente no processo do gateway (`DATACOREHS_PASSWORD`,
-- `GROWTHHSAPI_DB_PASS`, `TALENTHS_PASSWORD`). Invisível pela tela, impossível
-- saber qual agente usa o quê, e trocar uma senha exige mexer na VPS.
--
-- ⚠️ **O modo de acesso não é uma flag nossa.** `somente_leitura` diz qual par
--    de credenciais usar, e é só isso: quem recusa um UPDATE é o Postgres do
--    outro lado, pelo usuário que a conexão carrega. Uma trava que depende do
--    agente se comportar, ou de a nossa tela mandar o parâmetro certo, não é
--    trava. O usuário de leitura do DataCore, por exemplo, é membro de
--    `pg_read_all_data` e tem `default_transaction_read_only = on`: escrita é
--    recusada antes mesmo de checar permissão.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO**, como as anteriores — o `hsos_app` não tem
--    CREATE no schema public, de propósito:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/004_conectores_banco.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Os CHECK existentes não conhecem "banco de dados"
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `integration_type` aceitava api_key/multi_key/mcp e `type` aceitava api/mcp.
-- Um conector de banco não é nenhum dos dois: tem host, porta, base e dois
-- pares de credenciais, não uma chave solta.

ALTER TABLE public.integrations
    DROP CONSTRAINT IF EXISTS integrations_integration_type_check;

ALTER TABLE public.integrations
    ADD CONSTRAINT integrations_integration_type_check
    CHECK (integration_type = ANY (ARRAY[
        'api_key'::text, 'multi_key'::text, 'mcp'::text, 'database'::text
    ]));

ALTER TABLE public.integrations
    DROP CONSTRAINT IF EXISTS integrations_type_check;

ALTER TABLE public.integrations
    ADD CONSTRAINT integrations_type_check
    CHECK (type IS NULL OR type = ANY (ARRAY[
        'api'::text, 'mcp'::text, 'database'::text
    ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Onde os dados de conexão moram
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Host, porta, base e sslmode vão em colunas próprias, e não dentro do
-- `credentials`, por um motivo prático: a tela precisa mostrá-los, e
-- `credentials` nunca sai do servidor. Enfiar host junto da senha obrigaria a
-- escolher entre expor o segredo ou esconder o endereço.
--
-- As senhas continuam em `credentials`, no mesmo formato dos outros conectores
-- (lista de pares `{key_name, value}`), e valem as mesmas regras: a listagem
-- devolve só `credential_keys`, e o PATCH mescla por chave.

ALTER TABLE public.integrations
    ADD COLUMN IF NOT EXISTS db_host    text,
    ADD COLUMN IF NOT EXISTS db_porta   integer,
    ADD COLUMN IF NOT EXISTS db_base    text,
    ADD COLUMN IF NOT EXISTS db_sslmode text NOT NULL DEFAULT 'prefer',
    -- Qual par de credenciais a conexão usa. Um banco pode ter os dois
    -- cadastrados e ser publicado só-leitura — trocar o modo é trocar de
    -- usuário, sem redigitar nada.
    ADD COLUMN IF NOT EXISTS db_somente_leitura boolean NOT NULL DEFAULT true;

-- `prefer` e `require` cobrem o que aparece na prática; `disable` existe para
-- banco em rede interna que não fala TLS. Recusar o resto evita que um valor
-- inventado vire string solta na config do gateway.
ALTER TABLE public.integrations
    DROP CONSTRAINT IF EXISTS integrations_db_sslmode_check;

ALTER TABLE public.integrations
    ADD CONSTRAINT integrations_db_sslmode_check
    CHECK (db_sslmode = ANY (ARRAY[
        'disable'::text, 'prefer'::text, 'require'::text,
        'verify-ca'::text, 'verify-full'::text
    ]));

-- Conector de banco sem endereço não conecta em lugar nenhum, e guardá-lo pela
-- metade só adia o erro para a hora em que o agente for usar.
ALTER TABLE public.integrations
    DROP CONSTRAINT IF EXISTS integrations_db_completo_check;

ALTER TABLE public.integrations
    ADD CONSTRAINT integrations_db_completo_check
    CHECK (
        integration_type <> 'database'
        OR (db_host IS NOT NULL AND db_host <> ''
            AND db_porta IS NOT NULL
            AND db_base IS NOT NULL AND db_base <> '')
    );

COMMENT ON COLUMN public.integrations.db_somente_leitura IS
    'Qual par de credenciais usar (ro/rw). NÃO é a trava: quem recusa escrita é '
    'o usuário do Postgres do outro lado.';

COMMIT;
