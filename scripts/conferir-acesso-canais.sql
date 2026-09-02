-- Quem está hoje em canal com agente que já não pode ver?
--
-- O trigger da 014 valida na ENTRADA. Tirar o acesso de alguém depois não a
-- remove dos canais em que ela já está — e foi esse tipo de dado velho que
-- virou 11 ids órfãos em `allowed_user_ids` em agosto de 2026.
--
-- Rodar depois de mexer em acesso de agente. Leitura pura.
--
--   psql "$DATABASE_URL" -f scripts/conferir-acesso-canais.sql

SELECT c.name                                   AS canal,
       c.type                                   AS tipo,
       COALESCE(p.full_name, p.email, h.user_id) AS pessoa,
       COALESCE(ap.name, a.user_id)             AS agente
  FROM public.channel_members h
  JOIN public.channel_members a  ON a.channel_id = h.channel_id
                                AND a.member_type = 'agent'
  JOIN public.channels        c  ON c.id = h.channel_id
  LEFT JOIN public.profiles   p  ON p.id::text = h.user_id
  LEFT JOIN public.agent_profiles ap ON ap.agent_id = a.user_id
 WHERE h.member_type = 'human'
   AND NOT public.pode_ver_agente(h.user_id::uuid, a.user_id)
 ORDER BY canal, pessoa;
