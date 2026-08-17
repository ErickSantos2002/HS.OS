---
name: faturamento
description: >-
  A régua do faturamento da Health & Safety no DataCoreHS. Use SEMPRE que
  perguntarem faturamento, receita, quanto foi vendido, quanto entrou no mês, ou
  qualquer número de dinheiro realizado — inclusive por cliente, por período ou
  comparando meses. Somar nota fiscal sem estas regras infla o número em ~50%.
emoji: 💰
always: false
---

# Faturamento — a régua da casa

⚠️ **Não some nota fiscal por conta própria.** Em 14/08/2026 o faturamento de
agosto foi respondido como **R$ 654.645,95** somando toda nota "emitida". O
número certo era **R$ 441.712,80** — 48% de inflação, entregue com cara de
dado exato para quem ia levar à diretoria.

O que inflou: remessa, retorno de comodato, importação e notas com marcador de
cancelamento. São notas de verdade, emitidas de verdade, que **não são venda**.

## Faturamento é exatamente duas coisas

| | de onde vem | o que é |
|---|---|---|
| **Vendas** | `tiny.notas_fiscais` (NF-e) | produto vendido |
| **Serviços** | `tiny.servicos` (NFS-e) | calibração, anuidade de software, outros |

**Nada mais entra.** Não existe uma terceira fonte, e nenhuma outra tabela do
DataCoreHS é faturamento.

## Vendas — as quatro condições, todas obrigatórias

1. **CFOP da NOTA está na lista de venda.** O CFOP que vale é o extraído do
   `natureza_operacao` **da nota**, não o `cfop` do item. Uma nota pode ter item
   com CFOP de venda e não ser venda.
2. **`descricao_situacao` = `Emitida DANFE`.** Qualquer outra situação está fora.
3. **`valor_nota > 0`.**
4. **Nenhum marcador da lista de inválidos** (cancelar, nf devolvida, nf
   recusada, inutilizada…).

E o valor somado é o **`valor_nota`**, nunca a soma dos itens: a nota inclui
frete e desconto, então os dois não batem — e o certo é o da nota.

⚠️ **As duas listas vêm do banco, não deste arquivo.** Elas moram em
`tiny.configuracoes`, nas chaves `CFOP_VALIDOS` e `MARCADORES_INVALIDOS`. Leia
de lá **sempre**. Se alguém mudar a régua no sistema, a sua resposta acompanha
em vez de divergir em silêncio. Hoje os CFOP são 6102, 5102, 6108 e 5108 — mas
isto aqui é referência para você reconhecer, não valor para copiar na consulta.

```sql
WITH cfg AS (
  SELECT string_to_array(lower(replace(valor, ' ', '')), ',') AS cfops
    FROM tiny.configuracoes WHERE chave = 'CFOP_VALIDOS'
), mk AS (
  SELECT string_to_array(lower(valor), ',') AS ruins
    FROM tiny.configuracoes WHERE chave = 'MARCADORES_INVALIDOS'
)
SELECT count(*) AS notas,
       sum(nf.valor_nota)::numeric(14,2) AS total
FROM tiny.notas_fiscais nf, cfg, mk
WHERE nf.data_emissao >= DATE '2026-08-01'
  AND nf.data_emissao <  DATE '2026-09-01'
  AND lower(btrim(nf.descricao_situacao)) = 'emitida danfe'
  AND nf.valor_nota > 0
  AND lower(substring(nf.natureza_operacao FROM '\d{4}')) = ANY(cfg.cfops)
  AND NOT EXISTS (
        SELECT 1 FROM tiny.marcadores m, unnest(mk.ruins) AS r(txt)
         WHERE m.id_nota = nf.id
           AND lower(m.descricao) LIKE '%' || btrim(r.txt) || '%');
```

## Serviços — duas condições

1. **`cancelada = false`.**
2. O valor é **TEXT** com formato misto e precisa virar número.

⚠️ **A conversão é `replace(valor, ',', '.')::numeric` e nada mais.** Tirar o
ponto antes (`replace('.','')`) multiplica por 10 os ~10% de registros que já
usam ponto decimal — e o erro passa despercebido porque o total só fica "maior".

```sql
SELECT count(*) AS notas,
       sum(replace("valor_dos_serviços", ',', '.')::numeric)::numeric(14,2) AS total
FROM tiny.servicos
WHERE cancelada = false
  AND "data_da_emissão_nfs_e_dsr_e" >= DATE '2026-08-01'
  AND "data_da_emissão_nfs_e_dsr_e" <  DATE '2026-09-01';
```

Os nomes das colunas têm acento e aspas duplas são obrigatórias.

Categoria, quando pedirem a abertura, sai da `discriminação_dos_serviços`:
`Desenvolvimento de Plataforma` → anuidade de software; `Calibração e
Manutenção` → calibração (a grafia varia, com e sem acento); o resto → Outros.

## Confira antes de responder

**Janeiro/2026 fecha em R$ 409.592,52 de vendas e R$ 147.333,40 de serviços.**
Esses dois números batem com a página Financeiro do DataCoreHS.

Se você mudar a consulta e quiser saber se continua certa, rode-a para janeiro
de 2026 e compare. Bateu, a régua está certa. Não bateu, **pare** — não entregue
o número, diga o que divergiu.

## Ao responder

- **Separe vendas de serviços**, e some os dois no total. Quem pergunta
  "faturamento" quase sempre quer o total, mas a abertura é o que dá confiança.
- **Diga o período** que você usou, com dia inicial e final.
- Mês corrente é **parcial**. Diga isso — "até hoje", não "de agosto".
- Se o número for muito diferente de uma resposta anterior sua, **investigue
  antes de entregar**: pode ser emissão nova, e pode ser consulta errada.

⚠️ **Nunca entregue faturamento somando nota sem estes filtros**, nem que a
pergunta pareça simples e a pressa seja grande. Número errado com aparência de
exato é pior que dizer "me dá um minuto".
