# O que o Nicholson pediu — placar de 19/08/2026

Levantado das **23 mensagens** dele com os agentes (17 e 18/08), das **dez fotos**
do documento de visão e dos **quatro áudios** de hoje. Serve para a conferência
de "já ajustamos tudo?" sem reabrir cada fonte.

## As perguntas que ele fez e voltaram erradas ou vazias

| pergunta | estado |
|---|---|
| Faturamento do mês | ✅ régua da skill · agosto até 19: R$ 528.564,80 |
| Quanto falta para a meta | ✅ 77,0% do trimestre · faltam R$ 728.204,97 |
| Faturamento **por vendedor** | ✅ com o aviso de que serviços não têm vendedor |
| Quantas propostas abertas · por vendedor | ✅ já respondia em 17/08 |
| Reuniões que os **SDR** marcaram | ✅ Miguel 9 · Claudia 8 · Karolaine 5 |
| O que está parado >48h no TaskHS | ✅ pelo `audit_log` · 104 em Correios, 16,2 dias |
| Clientes que compraram o **Phoebus** | ✅ na skill, com a régua |
| As 4 respostas que se perderam | ✅ recuperadas no histórico dele |
| "Nova conversa" | ✅ limpa a sessão e preserva o banco |

## O documento de visão (as dez fotos)

| pedido | estado |
|---|---|
| `fato → causa → impacto → recomendação → confiança` | ✅ nos cinco |
| Briefing proativo de manhã | ⚠️ **existe e ele não vê** — está na Base de Conhecimento, e ele teria que ir lá. Fazer aparecer ao abrir é mudança de tela. |
| Flow medindo tempo por etapa | ⚠️ só TaskHS. A cadeia dele (Venda→Financeiro→Estoque→Lab→Expedição→Instalação→CS) **cruza sistemas** e ninguém mede ponta a ponta |
| Nina: gargalo com **capacidade vs demanda** | ⚠️ gargalo sim; capacidade instalada **não existe em base nenhuma** |
| Iris como radar cruzando tudo | ❌ ela só vê o DataCore |
| Pipeline ponderado | ❌ o GrowthHS não tem probabilidade por etapa — precisa de régua definida por gente |
| Central de Comando (4 indicadores) | ❌ adiado por decisão |
| Cadeia dos 5 agentes | ❌ adiado por decisão |

⚠️ **Os papéis do documento não são os da nossa frota** (lá o `atlas` orquestra e
o `bruce` é comercial). É conhecido: ele passa informação parcial para outra IA e
volta divergente. Mantemos a frota e ajustamos aos poucos.

## Os quatro áudios de hoje

| pedido | estado |
|---|---|
| Quem tem Phoebus **ativo**, com segmento e contato | ✅ 140 ativas · 84% com segmento · 77% com telefone |
| Quem comprou **mais de 5 iBlow** | ✅ 137 privadas (7 órgãos públicos separados) |
| Reativar quem está atrasado | ✅ **885 privadas**, R$ 3,2 mi de histórico — ele estimava cinco |
| Planilha de vendedores pelo agente | ✅ o `atlas` gera e guarda em Documentos |
| Custo por lead · campanhas · marketing | ❌ nenhuma base conectada |

## O que ficou em aberto, e é decisão dele ou de gente

1. **22 empresas usam o Phoebus e não têm CNPJ identificado** — nenhum aparelho
   delas foi achado no GestorHS pelo número de série.
2. **18 empresas usam o Phoebus e não existem no CRM** — precisa criar cadastro,
   não só preencher setor.
3. **O segundo maior segmento é "Outros"** com 13 empresas e 2,48 milhões de
   testes, a InterCement sozinha com 1,44 milhão. É classificação, não segmento.
4. **Nove registros com data impossível** (2030, 2031, 2036, 2037) — relógio de
   aparelho errado em CCR BA, Emal, Fidens, SEKA, São Bernardo Ambiental e
   Trivia Trens.
5. **A HelpHS não está no ar** e não tem campo de satisfação. O agente `help`
   segue adiado.

## Dívida técnica que sobrou do dia

- A `iris` **recusa o que não é dela sem encaminhar** para quem é. Ajuste de uma
  linha nos arquivos dela.
- A regra de **escrever sempre em português** foi escrita hoje e ainda não foi
  reconferida numa conversa nova.
- **Trocar os segredos** que apareceram no log de build do EasyPanel — senha do
  Postgres, `JWT_SECRET`, `OPENCLAW_ADMIN_TOKEN`, chave da OpenAI e
  `GUARDRAILS_API_TOKEN`. A da OpenAI primeiro.
- `POST /agents/{id}/crons` **não agenda nada** — grava só na nossa tabela e
  nunca chama o gateway. A tela sugere o contrário.

## Notas relacionadas

- [`ROADMAP-AGENTES-2026-08-19.md`](ROADMAP-AGENTES-2026-08-19.md) — os cinco blocos do dia
- [`fotos_doc/`](fotos_doc/) — o documento de visão
