-- 044_avisos_ausencia.sql — quais pedidos de ausência do TalentHS já foram
-- avisados a quem (26/11/2026). Spec
-- docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md.
--
-- ⚠️ A chave primária É a trava contra aviso dobrado: são dois workers
-- rodando a mesma passada do disparador. Quem consegue o INSERT ... ON
-- CONFLICT DO NOTHING RETURNING é quem grava recado e cartões, na mesma
-- transação; o outro não recebe linha e segue. O reaviso de 24 h usa
-- compare-and-set em `ultimo_aviso_em`, pelo mesmo motivo.
--
-- `pedido_id` é texto: é o id do TalentHS, de outro banco — sem FK possível.
--
-- RLS ligado e sem policy: só o backend, como `service_role`.
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-044.py
-- Pode ir ANTES do deploy (nada lê a tabela até lá); sem ela, a etapa só
-- registra no log que está parada.

CREATE TABLE IF NOT EXISTS public.avisos_ausencia (
  destinatario_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pedido_id        text NOT NULL,
  avisado_em       timestamptz NOT NULL DEFAULT now(),
  ultimo_aviso_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destinatario_id, pedido_id)
);

ALTER TABLE public.avisos_ausencia ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.avisos_ausencia TO service_role;
