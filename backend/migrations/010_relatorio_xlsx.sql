-- 010_relatorio_xlsx.sql — planilha é documento gerado, como PDF e DOCX
--
-- O Nicholson pede ao Atlas a planilha de vendedores que o Erick vinha gerando à
-- mão (`~/projetos/relatorios-hsgrowth/vendedores.py`) e mandando por WhatsApp.
-- Para o agente conseguir entregar, o arquivo entra pelo mesmo caminho que já
-- existe para PDF e DOCX: bucket privado `generated-documents/<usuário>/`, com
-- registro em `public.generated_documents`.
--
-- Faltava só o tipo. O CHECK aceitava exatamente 'pdf' e 'docx'.
--
-- ⚠️ **Não é bucket público, e isso é escolha.** A planilha traz card a card do
--    funil com nome de cliente, valor e link — dado comercial que não deve viver
--    numa URL que qualquer um abre. O download continua conferindo o dono pelo
--    primeiro segmento do caminho, como nos outros dois formatos.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não altera constraint:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/010_relatorio_xlsx.sql

BEGIN;

ALTER TABLE public.generated_documents
    DROP CONSTRAINT IF EXISTS generated_documents_doc_type_check;

ALTER TABLE public.generated_documents
    ADD CONSTRAINT generated_documents_doc_type_check
    CHECK (doc_type = ANY (ARRAY['pdf'::text, 'docx'::text, 'xlsx'::text]));

COMMIT;
