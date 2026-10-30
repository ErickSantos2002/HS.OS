-- 021_canal_so_alguns_escrevem.sql — canal de avisos, igual ao grupo do WhatsApp
-- em que só o Nicholson e o RH mandam mensagem (spec 2026-10-30).
--
-- `channels.so_alguns_escrevem` liga o modo; `channel_members.pode_escrever`
-- marca quem foi escolhido — na linha do membro, para sair junto com ele.
-- Administrador sempre escreve.
--
-- ⚠️ A trava é a policy de INSERT de `channel_messages`. O backend confere antes
-- só para a recusa sair com nome; quem entra pelo banco esbarra aqui. Mensagem
-- de agente é gravada como `service_role` e não passa pela policy.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-021.py

BEGIN;

ALTER TABLE public.channels
    ADD COLUMN IF NOT EXISTS so_alguns_escrevem boolean NOT NULL DEFAULT false;
ALTER TABLE public.channel_members
    ADD COLUMN IF NOT EXISTS pode_escrever boolean NOT NULL DEFAULT false;

-- ⚠️ `_user_id` é TEXT, como em `is_channel_member`: `channel_members.user_id`
-- guarda agent_id também. O cast para uuid só acontece depois do regex.
CREATE OR REPLACE FUNCTION public.pode_escrever_no_canal(_channel_id uuid, _user_id text)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.channel_members m
      JOIN public.channels c ON c.id = m.channel_id
     WHERE m.channel_id = _channel_id AND m.user_id = _user_id
       AND (NOT c.so_alguns_escrevem
            OR m.pode_escrever
            OR (_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                AND public.has_role(_user_id::uuid, 'administrador')))
  )
$$;
GRANT EXECUTE ON FUNCTION public.pode_escrever_no_canal(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Send channel messages" ON public.channel_messages;
CREATE POLICY "Send channel messages" ON public.channel_messages
    FOR INSERT TO authenticated
    WITH CHECK (public.pode_escrever_no_canal(channel_id, (auth.uid())::text));

-- Escolher quem escreve é UPDATE em `channel_members`, que até aqui não tinha
-- policy de UPDATE nenhuma. Só o administrador — é ele quem configura o canal.
DROP POLICY IF EXISTS "Admin escolhe quem escreve" ON public.channel_members;
CREATE POLICY "Admin escolhe quem escreve" ON public.channel_members
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'administrador'))
    WITH CHECK (public.has_role(auth.uid(), 'administrador'));
GRANT UPDATE (pode_escrever) ON public.channel_members TO authenticated;

COMMIT;
