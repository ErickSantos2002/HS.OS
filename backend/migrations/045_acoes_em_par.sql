-- 045_acoes_em_par.sql — duas ações alternativas num cartão só (26/11/2026).
--
-- O aviso de pedido de ausência mandava dois cartões (Aprovar e Recusar),
-- cada um com Cancelar/Confirmar: quatro botões para uma decisão. Agora as
-- duas pendências apontam uma para a outra e a conversa mostra um cartão com
-- Recusar | Aprovar. Confirmar uma cancela a outra (`routers/acoes.py`).
--
-- NULL = cartão comum (todos os que já existem). SET NULL ao apagar a outra.
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-045.py
-- ⚠️ ANTES do deploy: o GET/confirmar de qualquer ação passa a ler `par_id`.

ALTER TABLE public.acoes_pendentes
  ADD COLUMN IF NOT EXISTS par_id uuid REFERENCES public.acoes_pendentes(id) ON DELETE SET NULL;
