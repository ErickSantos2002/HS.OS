# Varreduras de 31/08/2026

Rodadas depois de fechar o roadmap dos agentes, procurando o que ninguém tinha
perguntado. Fica escrito para **não se refazer o que já deu limpo** e para as
réguas ficarem disponíveis — os scripts estão em `backend/scripts/`.

⚠️ **Varredura limpa não é sistema correto.** Cada uma abaixo diz o que cobre e,
mais importante, o que não cobre. Duas delas deram limpo por fraqueza do método,
não por saúde do código, e isso está anotado.

## O que achou

### Furo de acesso no `/storage/privado/` ✅ corrigido

`GET /storage/documento/{id}` conferia dono e entregava uma URL que **qualquer
pessoa autenticada** conseguia abrir. A conferência gate descobrir o caminho, não
ler o arquivo — e o caminho é `{user_id}/{doc_id}.{tipo}`, adivinhável. O
conteúdo é a planilha de vendedores, com nome de cliente, valor e link do CRM.

A forma do erro é o que vale guardar: o comentário afirmava que a segurança era
"a mesma — melhor, até" que a URL assinada do Supabase. A URL assinada valia para
**um arquivo**; o token vale para **o bucket**. Trocar escopo de recurso por
escopo de sessão parece equivalente e não é.

### A régua do CLAUDE.md para achar tela morta ✅ corrigida

O comando que o arquivo dava como "a conferência que funciona" devolvia 11 de 21
páginas vivas: só casava `element={<X />}` numa linha, e as rotas reais são
multilinha com guarda. Erra para o lado pior — faz página em uso parecer órfã.

### Skill publicada sem ponteiro ⛔ decisão do Erick

`relatorio-vendedores` está no gateway e **não é citada em nenhum dos sete
arquivos** de nenhum agente. É o estado que o `CLAUDE.md` documenta como tendo
custado um número 48% errado em 14/08 ("skill publicada não é skill usada").

Hoje não está falhando: os quatro documentos gerados caíram no dono certo, então
o `solicitante` vem correto. É risco latente, e as regras que ela guarda são
justamente as que já falharam antes — não montar o relatório na mão, e não
prometer anexo. **Não editei `AGENTS.md` de agente em produção**: é escrita que
muda comportamento e a regra da casa é combinar antes.

### O cron do incidente de 25/08 ainda existe ⛔ decisão do Erick

"Verificar Iris - compradores bafometro sem calibracao", do laço que a `nina`
criou para si e rodou 560 vezes. Está **desligado** — o disjuntor funcionou — mas
segue listado, e a tela mostra botão de religar para job desligado. Só pode
acontecer uma coisa com ele daqui para frente, e não é boa.

### `openclaw models list` quebra no gateway ⛔ decisão do Erick

`Cannot read properties of undefined (reading 'input')`. Isolado por bisecção
contra **cópias** da config (`OPENCLAW_CONFIG_PATH`), sem tocar na viva:
`anthropic/claude-sonnet-5` em `agents.defaults.models` é a causa. Remover só ele
faz o comando voltar; tirar o `alias` sem tirar o id não resolve; mover o alias
para um modelo válido também não.

O modelo **resolve** — aparece na lista com `Auth yes` — mas este gateway não sabe
precificá-lo, e o CLI lê `cost.input`. É a mesma razão de a `usage_events` ter
74.915 tokens dele custando **US$ 0,00**.

⚠️ **Só o CLI quebra, e isso muda o tamanho do achado.** O RPC `models.list`, que
é o que o backend usa, responde normal — 123 chamadas com ✓ no log de hoje. O
produto não é afetado. O que se perde é diagnóstico na VPS, que fez falta
justamente hoje. Nenhum agente usa o modelo; os cinco estão em `deepseek-chat`.

Script pronto em `~/hsos-tirar-sonnet5-do-catalogo.sh`. **Não é urgente** — cabe
na próxima vez que a config for tocada.

⚠️ **E confirmou por que não ler a chave do gateway** (ver o conserto do
`/llm/descobrir`): o `models status` mostra que a credencial efetiva do DeepSeek
vem do `models.json` do agente, **não** do `models.providers.deepseek.apiKey` do
`openclaw.json` — cujos 21 caracteres são resto.

## Também apareceu

- **`claude-cli` com OAuth expirado** (`expires in 0m`). Não é o provedor em uso e
  nada depende dele hoje; fica anotado antes que alguém troque um agente para ele
  e leve meia hora para entender a recusa.

## O que deu limpo, e com que força

| varredura | resultado | força |
|---|---|---|
| Deriva migrações × banco (tabelas) | 71 tabelas, 0 divergências | **alta** — comparação direta |
| Deriva migrações × banco (colunas) | 674 colunas, 0 sem migração | **alta** |
| Proteção das 247 rotas | 6 sem auth, todas deliberadas | **alta** — lê a assinatura |
| Skills repo × gateway | 7 skills, md5 idêntico | **alta** |
| Agentes: nosso banco × gateway | modelo e workspace batem nos 5 | **alta** |
| Crons órfãos | 10 jobs, todos com agente existente | **alta** |
| Base de conhecimento | 66 docs, 5/dia; os 197 do laço já saíram | **alta** |
| `DELETE /push/inscricao` sem auth | deliberado e correto | **alta** — o endpoint do push É a credencial |
| Rotas sem chamador | 26 de 247, quase todas MCP/webhook | **média** — o front monta caminho por template |
| Campo do front sem correspondência | 0 | ⚠️ **baixa** — o conjunto de nomes conhecidos tem 1.328 entradas e engole quase tudo. Para valer, rodar `scripts/conferir-contratos.py` com backend de pé e token |

## As réguas

| script | o que responde |
|---|---|
| `backend/scripts/auditar_auth_das_rotas.py` | como cada rota é protegida |
| `backend/scripts/auditar_rotas_sem_chamador.py` | rota do backend que o front não chama |
| `backend/scripts/auditar_deriva_schema.py` | coluna no banco sem migração |
| `backend/scripts/auditar_rls.py` | query que depende de RLS para escopo |
| `scripts/conferir-contratos.py` | campo declarado × campo devolvido (**precisa de backend e token**) |
