-- 042_backup_le_tudo.sql — o backup diário volta a ler o banco inteiro (26/11/2026)
--
-- O `pg_dump` do backup roda com `--role=service_role` (o `hsos_app` é
-- NOINHERIT; ver `scripts/instalar-backup.sh`). Desde que as migrações passaram
-- a ser aplicadas pelo superusuário, objeto novo nasce dono `administrador` e só
-- ganha o GRANT que a migração escreve — e para sequence ela escreve `USAGE`,
-- que dá `nextval` mas NÃO `SELECT`. O `pg_dump` lê `last_value` de toda
-- sequence e morre na primeira que não pode ler:
--
--   permission denied for sequence agente_chamadas_id_seq
--
-- ⚠️ **O que custou:** o último dump bom é de 07/09/2026. De lá até 26/11 o
-- backup falhou TODO DIA (este erro e, antes dele, o script escolhendo um
-- container `pgweb` pelo nome), deixando um arquivo de 0 byte por dia, e
-- ninguém viu. 80 dias sem backup do banco do HS.OS.
--
-- Os quatro objetos que o `service_role` não lia em 26/11, mais o privilégio
-- padrão para o próximo não repetir: sequence e tabela/view que o
-- `administrador` criar em `public` já nascem legíveis pelo `service_role`, que
-- é o papel da própria aplicação (lê tudo de qualquer jeito, por fora do RLS).
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-042.py

GRANT SELECT ON SEQUENCE public.agente_chamadas_id_seq  TO service_role;
GRANT SELECT ON SEQUENCE public.email_eventos_id_seq    TO service_role;
GRANT SELECT ON SEQUENCE public.login_tentativas_id_seq TO service_role;
GRANT SELECT ON public.diretorio TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE administrador IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE administrador IN SCHEMA public
  GRANT SELECT ON TABLES TO service_role;
