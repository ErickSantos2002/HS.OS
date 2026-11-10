-- 035_conversa_pessoal.sql — a conversa consigo mesmo (10/11/2026)
--
-- Pedido do time ao sair do Teams, onde o "chat comigo mesmo" era o bloco de
-- notas de todo mundo. Spec: docs/superpowers/specs/2026-11-10-conversa-
-- consigo-mesmo-design.md.
--
-- **Tipo próprio (`pessoal`), não DM com uma pessoa só.** O sistema inteiro
-- assume que `dm` tem duas pessoas — interlocutores, War Room, aviso a todos,
-- as guardas de membro — e cada lugar viraria uma exceção esquecível. Com tipo
-- próprio, o que filtra por `dm`/`public`/`private` simplesmente não a vê.
--
-- **Uma por pessoa** (índice único parcial) e **nasce sob demanda** por
-- `minha_conversa_pessoal()`: a tela chama ao carregar, então para a pessoa
-- ela "existe desde sempre". A função repõe a membresia quando a acha sem ela
-- — desativar a conta apaga as membresias (`profiles.py`), e quem é reativado
-- ganharia de volta uma conversa que não consegue ler.
--
-- **Só a dona/o dono.** A leitura já era por membresia (RLS). O que muda:
-- o administrador deixa de poder renomear, apagar e mexer nos membros da
-- conversa pessoal de outra pessoa — as policies herdadas davam a ele todo
-- canal. E ninguém insere membro nela por policy: quem põe a dona lá dentro é
-- a função, que é SECURITY DEFINER.
--
-- ⚠️ `ADD VALUE` não pode ser usado na transação que o cria: a primeira parte
--    roda sozinha (autocommit), a segunda numa transação. `~/aplicar-hsos-035.py`
--    separa pelo marcador abaixo.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO.**

ALTER TYPE public.channel_type ADD VALUE IF NOT EXISTS 'pessoal';

-- ==== parte 2 ====

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS channels_pessoal_um_por_pessoa
    ON public.channels (created_by) WHERE type = 'pessoal';

CREATE OR REPLACE FUNCTION public.minha_conversa_pessoal() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    _eu uuid := auth.uid();
    _canal uuid;
BEGIN
    IF _eu IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    INSERT INTO channels (name, description, type, created_by)
    VALUES ('Anotações', NULL, 'pessoal', _eu)
    ON CONFLICT (created_by) WHERE type = 'pessoal' DO NOTHING;

    SELECT id INTO _canal FROM channels WHERE created_by = _eu AND type = 'pessoal';

    INSERT INTO channel_members (channel_id, user_id, member_type)
    SELECT _canal, _eu::text, 'human'
     WHERE NOT EXISTS (SELECT 1 FROM channel_members
                        WHERE channel_id = _canal AND user_id = _eu::text);

    RETURN _canal;
END;
$$;

-- Regra da 034: SECURITY DEFINER nova não fica com EXECUTE para PUBLIC.
REVOKE EXECUTE ON FUNCTION public.minha_conversa_pessoal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minha_conversa_pessoal() TO authenticated, service_role;

DROP POLICY IF EXISTS "Channel creator or admin can update" ON public.channels;
CREATE POLICY "Channel creator or admin can update" ON public.channels
    FOR UPDATE TO authenticated
    USING ((created_by = auth.uid())
           OR (has_role(auth.uid(), 'administrador'::app_role) AND type <> 'pessoal'));

DROP POLICY IF EXISTS "Channel creator or admin can delete" ON public.channels;
CREATE POLICY "Channel creator or admin can delete" ON public.channels
    FOR DELETE TO authenticated
    USING ((created_by = auth.uid())
           OR (has_role(auth.uid(), 'administrador'::app_role) AND type <> 'pessoal'));

DROP POLICY IF EXISTS "Channel managers remove members" ON public.channel_members;
CREATE POLICY "Channel managers remove members" ON public.channel_members
    FOR DELETE TO authenticated
    USING ((user_id = (auth.uid())::text)
           OR EXISTS (SELECT 1 FROM channels c
                       WHERE c.id = channel_members.channel_id
                         AND c.type <> 'pessoal'
                         AND (c.created_by = auth.uid()
                              OR has_role(auth.uid(), 'administrador'::app_role))));

DROP POLICY IF EXISTS "Users join allowed channels" ON public.channel_members;
CREATE POLICY "Users join allowed channels" ON public.channel_members
    FOR INSERT TO authenticated
    WITH CHECK (((user_id = (auth.uid())::text) AND is_public_channel(channel_id))
                OR EXISTS (SELECT 1 FROM channels c
                            WHERE c.id = channel_members.channel_id
                              AND c.type <> 'pessoal'
                              AND (c.created_by = auth.uid()
                                   OR has_role(auth.uid(), 'administrador'::app_role))));

COMMIT;
