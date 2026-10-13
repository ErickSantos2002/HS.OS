-- backend/migrations/019_resumo_em_audio.sql — resumo em áudio dos agentes
--
-- Pedido do CEO (13/10/2026): toda resposta de agente sai com o agente falando
-- um resumo. Ligado por padrão; cada pessoa desliga no perfil. Ver
-- `app/voz.py` e a spec 2026-10-13-resumo-em-audio-design.md.
--
-- As vozes iniciais só preenchem quem está sem voz: não sobrescrevem escolha
-- feita depois pelo PATCH /agents/{id}.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO — python3 ~/aplicar-hsos-019.py

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS resumo_em_audio boolean NOT NULL DEFAULT true;

UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-FranciscaNeural'
 WHERE agent_id = 'nina' AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';
UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-ThalitaNeural'
 WHERE agent_id = 'iris' AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';
UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-AntonioNeural'
 WHERE agent_id IN ('atlas', 'flow', 'bruce') AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';

COMMIT;
