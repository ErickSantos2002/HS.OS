-- 006_diretorio.sql — quem é quem, para os agentes, e só isso
--
-- Todo agente precisa responder "quem está falando comigo". A chave de sessão
-- já carrega a resposta — `agent:<agente>:hsos-<user_id>`, e o agente **enxerga
-- a própria chave** (comprovado perguntando à `nina` em 14/08/2026, que citou
-- a chave inteira sem que ninguém a tivesse mandado no texto). Falta só ele
-- poder trocar esse id por um nome.
--
-- ⚠️ **Não dá para resolver isso dando o banco inteiro a cada agente.** A
--    credencial de leitura da plataforma tem `pg_read_all_data` e `BYPASSRLS`,
--    e com ela qualquer agente leria:
--
--      · as conversas e DMs de todas as pessoas
--      · `integrations.credentials`, onde estão as senhas dos NOVE bancos
--        cadastrados, em texto puro
--
--    Um agente de vendas não precisa da senha do DataCore para saber que quem
--    escreveu foi a coordenadora do RH. E basta uma injeção de prompt vinda
--    cliente para transformar esse acesso num vazamento.
--
-- Aqui a resposta é uma view estreita e um usuário que só enxerga ela.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** (cria role e view sobre tabela do
--    `administrador`):
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/006_diretorio.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A view
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Só o que serve para identificar uma pessoa no trabalho. Nada de `status`,
-- `last_seen_at`, `custom_status` — presença é dado de tela, não de crachá, e
-- saber quem está online agora não ajuda o agente a atender ninguém.
--
-- ⚠️ **`security_invoker` fica FALSE (o padrão), e é o ponto.** A view roda com
--    a permissão do dono (`administrador`), então ela atravessa as 191 policies
--    de RLS sem que o usuário que consulta precise de `BYPASSRLS`. É o que
--    permite dar o diretório sem dar o resto — inverter isso aqui devolveria
--    zero linhas e alguém "consertaria" concedendo BYPASSRLS, que é justamente
--    o que esta migration existe para evitar.

CREATE OR REPLACE VIEW public.diretorio AS
    SELECT p.id,
           p.full_name   AS nome,
           p.email,
           p.departamento,
           p.cargo,
           COALESCE(r.role::text, 'sem_papel') AS papel
      FROM public.profiles p
      LEFT JOIN public.user_roles r ON r.user_id = p.id;

COMMENT ON VIEW public.diretorio IS
    'Diretório de pessoas para os agentes resolverem o `hsos-<user_id>` da '
    'chave de sessão em nome, cargo e departamento. É o ÚNICO objeto que o '
    'usuário `hsos_diretorio` alcança — ver 006_diretorio.sql para o porquê.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O usuário que só vê o diretório
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem `pg_read_all_data`, sem `BYPASSRLS`, sem GRANT em tabela nenhuma. O único
-- privilégio é SELECT nesta view — e como não há GRANT em `public.profiles`,
-- tentar ler a tabela direto é negado mesmo sabendo o nome dela.
--
-- A senha NÃO está aqui, de propósito: este arquivo é versionado. É definida
-- fora, por quem aplica, e vai para o conector pela tela de Conectores.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsos_diretorio') THEN
        CREATE ROLE hsos_diretorio LOGIN;
    END IF;
END
$$;

-- Recusa escrita antes de olhar permissão — a mesma trava do usuário `leitura`,
-- e a que pega o que GRANT nenhum cobriria (CREATE TEMP TABLE, por exemplo).
ALTER ROLE hsos_diretorio SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE hsos TO hsos_diretorio;
GRANT USAGE  ON SCHEMA public  TO hsos_diretorio;
GRANT SELECT  ON public.diretorio TO hsos_diretorio;

-- Cinto e suspensório: se um dia alguém rodar um `GRANT ... ON ALL TABLES` sem
-- pensar, este REVOKE não impede — mas o `default_transaction_read_only` e a
-- ausência de BYPASSRLS continuam valendo, e as policies passam a filtrar.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hsos_diretorio;
GRANT SELECT ON public.diretorio TO hsos_diretorio;

COMMIT;
