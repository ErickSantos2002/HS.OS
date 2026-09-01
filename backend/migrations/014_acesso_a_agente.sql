-- 014_acesso_a_agente.sql — quem pode ver um agente, dito uma vez só
--
-- ── O problema ───────────────────────────────────────────────────────────────
--
-- Em 01/09/2026 a conversa entre pessoas voltou ao produto e a empresa inteira
-- entrou: de 4 contas para 27. Com 26 pessoas dentro, um canal de grupo com
-- agente vira caminho lateral para o `allowed_user_ids` — quem não pode ver a
-- `iris` lê as respostas dela do mesmo jeito, bastando estar no canal.
--
-- Pior: `POST /channels/{id}/members` não tinha checagem NENHUMA. Qualquer
-- pessoa autenticada adicionava qualquer pessoa ou agente a qualquer canal.
-- Com 4 pessoas de confiança isso nunca teve consequência.
--
-- ── A regra ──────────────────────────────────────────────────────────────────
--
-- Agente só entra em canal onde TODOS os humanos podem vê-lo; humano só entra
-- em canal cujos agentes ele pode ver. Nas duas direções, porque fechar uma só
-- deixa a outra como porta.
--
-- ⚠️ **Por que no banco e não só no Python.** A regra tem que valer para rota
--    que ainda não foi escrita. O `find_or_create_dm` é SECURITY DEFINER e
--    insere em `channel_members` direto, sem passar por endpoint nenhum — e é
--    esse o tipo de caminho que se esquece. O Python continua validando antes,
--    mas para dar mensagem humana, não para ser a defesa.
--
-- ⚠️ **Esta migração NÃO revoga acesso de quem já está em canal.** O trigger
--    vale na entrada. Tirar o acesso de alguém depois não a remove de canal
--    nenhum — para isso existe `scripts/conferir-acesso-canais.sql`, que é para
--    rodar depois de mexer em acesso.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 014_acesso_a_agente.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A regra
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Tradução literal do `_pode_ver` de `backend/app/routers/agents.py`, que
-- continua existindo porque `GET /agents` filtra uma lista já carregada e
-- chamar o banco por agente seriam N idas e voltas. A tabela de casos das duas
-- está escrita nos dois testes — ver `_testes/README.md`.
--
-- SECURITY DEFINER porque o trigger a chama de dentro de uma sessão
-- `authenticated`, que sob RLS não enxerga `agent_profiles` de todo mundo.

CREATE OR REPLACE FUNCTION public.pode_ver_agente(_user_id uuid, _agent_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'administrador') THEN true
    ELSE COALESCE((
      SELECT CASE COALESCE(p.access_type, 'all')
               WHEN 'all'            THEN true
               WHEN 'admins_only'    THEN false
               WHEN 'specific_users' THEN
                    _user_id = ANY(COALESCE(p.allowed_user_ids, '{}'::uuid[]))
               ELSE true
             END
        FROM public.agent_profiles p
       WHERE p.agent_id = _agent_id
    ), true)
  END
$$;

COMMENT ON FUNCTION public.pode_ver_agente(uuid, text) IS
    'Se a pessoa pode ver o agente. Admin passa por cima; `all` libera; '
    '`admins_only` recusa; `specific_users` exige estar em allowed_user_ids; '
    'agente sem perfil libera. Espelho do _pode_ver do agents.py — ver 014.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.exige_acesso_ao_agente_no_canal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    _pessoa text;
    _agente text;
BEGIN
    IF NEW.member_type = 'agent' THEN
        SELECT m.user_id INTO _pessoa
          FROM public.channel_members m
         WHERE m.channel_id = NEW.channel_id
           AND m.member_type = 'human'
           AND NOT public.pode_ver_agente(m.user_id::uuid, NEW.user_id)
         LIMIT 1;

        IF _pessoa IS NOT NULL THEN
            RAISE EXCEPTION
                'Alguém neste canal não tem acesso ao agente %.', NEW.user_id
                USING ERRCODE = 'HS001',
                      DETAIL  = format('pessoa=%s;agente=%s', _pessoa, NEW.user_id);
        END IF;

    ELSIF NEW.member_type = 'human' THEN
        SELECT m.user_id INTO _agente
          FROM public.channel_members m
         WHERE m.channel_id = NEW.channel_id
           AND m.member_type = 'agent'
           AND NOT public.pode_ver_agente(NEW.user_id::uuid, m.user_id)
         LIMIT 1;

        IF _agente IS NOT NULL THEN
            RAISE EXCEPTION
                'Esta pessoa não tem acesso ao agente % deste canal.', _agente
                USING ERRCODE = 'HS001',
                      DETAIL  = format('pessoa=%s;agente=%s', NEW.user_id, _agente);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ⚠️ Só INSERT. `UPDATE` de linha de membro não existe no código — quem sai é
--    removido — e cobrir UPDATE convidaria a mudar `member_type` no lugar.

CREATE TRIGGER exige_acesso_ao_agente_no_canal_trigger
    BEFORE INSERT ON public.channel_members
    FOR EACH ROW EXECUTE FUNCTION public.exige_acesso_ao_agente_no_canal();

COMMIT;
