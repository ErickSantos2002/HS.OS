-- 046_avisos_decisao_ausencia.sql — a resposta do RH volta para quem pediu
-- (26/11/2026). Spec docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md,
-- "Revisão (tarde)".
--
-- Duas ausências recusadas com motivo: as pessoas só souberam porque a Lidisay
-- mandou olharem o TalentHS. Quando o pedido sai de pendente, o Guardi de quem
-- pediu recebe o recado — e esta tabela garante que seja UMA vez.
--
-- ⚠️ A PK `pedido_id` é a trava: dois workers e dois do RH lendo a mesma lista
-- tentam o mesmo INSERT ... ON CONFLICT DO NOTHING RETURNING; só um grava o
-- recado, na mesma transação. `colaborador_id` nulo = quem pediu não tem Guardi
-- (decisão tratada, sem recado — senão seria procurada a cada leitura).
--
-- RLS ligado e sem policy: só o backend, como `service_role`.
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-046.py
-- Pode ir antes do deploy: nada lê a tabela até lá.

CREATE TABLE IF NOT EXISTS public.avisos_decisao_ausencia (
  pedido_id       text PRIMARY KEY,
  colaborador_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status          text NOT NULL CHECK (status IN ('approved', 'rejected')),
  avisado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.avisos_decisao_ausencia ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.avisos_decisao_ausencia TO service_role;
