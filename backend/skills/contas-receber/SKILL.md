---
name: contas-receber
description: >-
  A régua de contas a receber e a pagar da Health & Safety no DataCoreHS. Use
  SEMPRE que perguntarem o que está em aberto, vencido, atrasado, inadimplência,
  quanto a empresa tem a receber ou a pagar, saldo de títulos ou fluxo de caixa.
  Contar título sem estas regras infla o vencido em ~16%.
emoji: 📉
always: false
---

# Contas a receber e a pagar — a régua da casa

⚠️ **Em 08/09/2026 o CEO recebeu "vencido em aberto: R$ 1.101.692,67 em 414
títulos", duas vezes no mesmo dia.** O número certo era **R$ 952.786,57 em 373
títulos** — 15,6% inflado. Faltavam dois filtros, e os dois estão abaixo.

## A armadilha maior, e ela não é deste assunto só

⚠️ **A API do DataCoreHS aplica defaults de régua que o banco não aplica.**
O painel lê por `https://tinyapi.healthsafetytech.com`, e o
`GET /contas_receber/` tem o parâmetro **`incluir_excluidas`, cujo default é
`false`**. Quem lê pela API é protegido de graça. **Você lê o Postgres cru pelo
`banco-datacorehs` e não recebe default nenhum** — todo filtro que a API faria
por você, você tem que fazer à mão.

Foi exatamente isso que produziu o erro de 08/09. Medido hoje, nos dois lados:

| | títulos | valor |
|---|---|---|
| API com o default da casa (o que o painel mostra) | **373** | **R$ 952.786,57** |
| API com `incluir_excluidas=true` | 410 | R$ 1.112.811,77 |

Vale para além destas tabelas: **quando o seu número divergir do painel, a
primeira suspeita é um default da API que você não reproduziu**, não a régua de
negócio.

## As três condições, todas obrigatórias

### 1. `excluida_na_origem_em IS NULL`

Conta apagada no Tiny continua na nossa tabela, com a data da exclusão nesta
coluna. **Ela não existe mais na origem e não pode ser cobrada de ninguém.**

Em **05/09/2026** um único evento de sincronização marcou **41 contas a receber**
(R$ 173.480,80, todas em aberto) e **226 a pagar**. Três dias depois elas
entraram num número entregue à diretoria como dinheiro a receber.

⚠️ **É um lote só, num dia só — então o erro não é gradual: ele aparece inteiro
de uma vez.** Um número que estava certo na semana passada pode estar errado hoje
sem que nada na sua consulta tenha mudado.

### 2. A situação, e ela tem dialeto diferente nas duas tabelas

| | em aberto | quitada |
|---|---|---|
| `contas_receber` | `aberto`, `pendente` | `recebido`, `pago` |
| `contas_pagar` | `aberto`, `pendente` | `pago` |

⚠️ **`cancelada` não é nenhuma das duas** — não entra em aberto nem em quitado.
E ⚠️ **`parcial` também não conta como em aberto**: a régua do painel é
`estaEmAberto = pendente || aberto`, e só. Hoje há 3 contas `parcial` a receber;
somá-las é o erro que eu mesmo cometi ao levantar esta skill, antes de ler o
sistema de origem.

### 3. O valor em aberto é o **`saldo`**, não o `valor`

`valor` é o título cheio; `saldo` é o que ainda falta entrar. As duas grandezas
são diferentes e **não podem ser somadas no mesmo lugar** — foi o defeito 1.1 do
painel, corrigido em 31/08/2026:

```
quitado de uma conta  =  valor − saldo     (de TODAS, quitadas ou não —
                                            recebimento parcial é dinheiro que entrou)
aberto de uma conta   =  0 se quitada, senão saldo
faturado              =  quitado + aberto
```

Numa conta de R$ 1.000 com R$ 900 já recebidos, o aberto é R$ 100 **e** o quitado
é R$ 900. Contar o valor cheio como aberto cobra de novo o que já entrou.

## As consultas

### Vencido em aberto — a pergunta que mais aparece

```sql
SELECT count(*) AS titulos,
       sum(saldo)::numeric(14,2) AS em_aberto
  FROM tiny.contas_receber
 WHERE lower(situacao) IN ('aberto', 'pendente')
   AND excluida_na_origem_em IS NULL
   AND vencimento < current_date;
```

⚠️ **`vencimento < current_date`, nunca `<=`.** Título que vence hoje não está
vencido, e o corte errado muda o número todo dia de manhã.

### Total em aberto (vencido ou não) e total já recebido

```sql
SELECT sum(CASE WHEN lower(situacao) IN ('recebido','pago') THEN 0 ELSE saldo END)
         ::numeric(14,2) AS em_aberto,
       sum(valor - saldo)::numeric(14,2) AS ja_recebido
  FROM tiny.contas_receber
 WHERE excluida_na_origem_em IS NULL;
```

Para **contas a pagar**, a mesma consulta trocando a tabela e a lista de
quitadas para `('pago')` apenas.

## Confira antes de responder

Rode a primeira consulta com `vencimento < DATE '2026-09-08'` e compare:

| resultado | leitura |
|---|---|
| **373 títulos · R$ 952.786,57** | ✅ certo — siga |
| 410 · R$ 1.112.811,77 | esqueceu `excluida_na_origem_em IS NULL` |
| 376 · R$ 957.264,07 | incluiu as `parcial` |
| 376 · R$ 968.466,57 | incluiu as `parcial` **e** somou `valor` em vez de `saldo` |
| ~414 · ~R$ 1,10 mi | é o número errado de 08/09/2026 — os enganos juntos |

**Bateu, siga. Não bateu, PARE** — não entregue o número, diga o que divergiu.

⚠️ **Esta âncora foi escolhida para exercitar exatamente o que erra.** Uma âncora
de "total geral" passaria com os dois filtros errados, porque a diferença some
dentro de R$ 50 milhões — e foi assim que o erro do `MESES_ANALISE` sobreviveu a
três conferências em agosto. Conferir outra coisa e dar certo é pior que não
conferir.

Retrato de 09/09/2026, para você saber o tamanho do que está olhando:

| | a receber | a pagar |
|---|---|---|
| títulos (não excluídos) | 9.598 | 8.361 |
| em aberto | 555 títulos · R$ 2.095.401,11 | 11 títulos · R$ 56.945,11 |
| já quitado (histórico) | R$ 50.208.778,03 | R$ 30.088.354,27 |

⚠️ **Se o seu "em aberto" a pagar der muito mais que R$ 57 mil, você contou
cancelada ou excluída.** A empresa paga em dia; o volume está todo no recebido.

## Ao responder

- **Diga a data de corte.** "Vencido" muda todo dia; sem a data o número não é
  reconferível amanhã.
- **Separe vencido de em aberto total.** São perguntas diferentes: quem pergunta
  "quanto temos a receber" quase nunca quer só o atrasado.
- **Diga quantos títulos**, não só o valor — R$ 1 milhão em 5 títulos e em 400 são
  problemas diferentes, e a ação é outra.
- Se o número divergir muito de uma resposta sua anterior, ⚠️ **verifique se não
  houve um lote de exclusão** (`select excluida_na_origem_em::date, count(*) …
  group by 1`) antes de atribuir a movimento real.
- **Não chame de inadimplência.** Vencido em aberto inclui título em negociação,
  boleto reemitido e erro de cadastro. Diga "vencido em aberto", que é o que o
  dado sustenta.

## Notas relacionadas

- A régua de **faturamento** (nota fiscal) é a skill `faturamento` e é outra
  coisa: nota emitida não é dinheiro recebido, e as duas nunca fecham entre si.
- O dialeto das duas telas está em `src/pages/ContasReceber.tsx` e
  `src/pages/ContasPagar.tsx` do DataCoreHS; as funções, em
  `src/pages/contas/contas.ts`. ⚠️ **Régua muda lá primeiro** — o sistema de
  origem é a autoridade, e ao divergir o número do painel manda.
