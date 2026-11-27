-- 047_mensagem_encaminhada.sql — marca de mensagem encaminhada (27/11/2026).
-- Spec docs/superpowers/specs/2026-11-27-encaminhar-mensagem-design.md.
--
-- Uma coluna, não texto no conteúdo: o selo "↪ Encaminhada" escrito dentro da
-- mensagem entraria na busca e seria lido pelos agentes como se fosse do autor.
-- Também é a coluna que o push consulta para NÃO honrar `@todos`/`@Nome` de
-- texto encaminhado (`app/encaminhamento.conteudo_para_mencao`).
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-047.py
-- ⚠️ ANTES do deploy: `_COLUNAS_MSG` e o push passam a selecionar a coluna, e
-- sem ela toda leitura de mensagem de canal estoura (a lição do `seq_depois`).

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS encaminhada boolean NOT NULL DEFAULT false;
