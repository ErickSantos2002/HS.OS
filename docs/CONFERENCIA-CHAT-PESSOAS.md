# Conferência — a volta do chat entre pessoas (02/09/2026)

A Tarefa 8 do plano `superpowers/plans/2026-09-01-chat-entre-pessoas-e-membros.md`.
Não muda comportamento: mede. Este arquivo registra o que foi batido, com que
resultado, e — a seção que vale mais daqui a um mês — **o que não foi conferido**.

---

## 1. As migrações, em produção

Aplicadas em 02/09/2026 pelo Erick, no Konsole, com `~/aplicar-hsos-014-015.sh`.
Conferido depois por leitura no banco, com o usuário de leitura do cadastro
único:

| objeto | antes | depois |
|---|---|---|
| função `pode_ver_agente` | 0 | **1** |
| função `exige_acesso_ao_agente_no_canal` | 0 | **1** |
| trigger `exige_acesso_ao_agente_no_canal_trigger` | 0 | **1** |
| policy `Only admins create channels` | 0 | **1** |
| policy `Authenticated users create channels` (a permissiva) | 1 | **0** |
| canais | 3 | **1** (`teste 2`, zero mensagens) |

Os dois canais DM órfãos — um do Erick sozinho, um da Adriana, que não tem
conta — foram apagados no mesmo script, pela guarda que só apaga canal `dm` com
zero mensagens.

## 2. As 27 contas

Criadas em 02/09/2026 pelo Erick com `~/criar-contas-hsos.sh` (login, token,
`--conferir`, confirmação e só então a criação). Senhas para o FortiPAM: cada
uma aparece uma vez e o backend guarda só o hash.

Conferido por leitura, e **não só pela contagem** — a régua da casa é que contar
linha não é conferir dado:

- **27 perfis**, 0 sem setor, 0 sem cargo, 0 e-mail repetido
- **13 setores e 21 cargos distintos** em 27 nomes distintos — se o script
  tivesse chumbado campo, esses números viriam colados
- `user_roles`: **26 colaborador + 1 administrador**
- `auth.users`: 27, todos ativos e todos com hash de senha
- do quadro do TalentHS não sobrou ninguém sem conta

Três perfis foram abertos e olhados campo a campo (laboratório, suporte,
marketing): nome, setor e cargo batem com o TalentHS.

## 3. O invariante, provado no banco

Banco de rascunho descartável (`scripts/banco-rascunho.sh`), migrations 001→015
aplicadas do zero:

| prova | resultado |
|---|---|
| `backend/scripts/provar_invariante.py` — a consulta que a rota roda | **4/4 casos** |
| `migrations/_testes/014_acesso_a_agente.test.sql` — função e trigger | **passou** |
| `migrations/_testes/015_quem_cria_canal.test.sql` — policy, e o DM que continua nascendo | **passou** |
| `pytest` do backend | **101 passed** |

Os quatro casos do `provar_invariante.py` incluem **os dois que devem passar**
(par que fecha; canal sem agente nenhum), não só os que devem recusar — regra
que recusa tudo passa em qualquer teste que só procure recusa.

O caso 3 é o que importa mais: `INSERT` direto em `channel_members`, sem passar
por endpoint nenhum, é recusado. Quem segura é o **trigger**, não o Python.

⚠️ **Gotcha do rascunho:** a porta padrão do script (5433) estava ocupada pelo
container `docshs-banco`. Rodar com `PORTA=5439 bash scripts/banco-rascunho.sh`.

## 4. O deploy

- **Front: no ar.** O bundle de produção (`/assets/index-CUg3-1NK.js`) contém a
  string `"Buscar por nome, e-mail ou setor"`, que só existe no
  `NovaConversaDialog.tsx` desta entrega.
- **Back: NÃO confirmado.** Ver abaixo.

---

## O que NÃO foi conferido

Esta seção existe porque `docs/VARREDURAS-2026-08-31.md` registra duas varreduras
que deram limpo por fraqueza do método. Escrever o que ficou de fora é o que
impede alguém de confiar numa conferência que não conferiu.

**O backend novo está em produção? Não sei.** Comparei o `openapi.json` de
produção com o local: 195 rotas dos dois lados, nenhuma diferença. **Isso não
prova nada** — esta entrega não criou rota nenhuma, mudou o comportamento
dentro das que já existiam. A comparação de rotas era o método errado para a
pergunta. O jeito certo é o Passo 1 abaixo, que não rodou.

**Passo 1 — as rotas com token de colaborador.** Não rodou. `POST /channels`
(esperado 403), `POST /channels/{id}/members` em canal alheio (403),
`POST /conversations/dm/abrir` (200), `GET /channels/dms/interlocutores` (200).
É o teste que pega "escondi o botão na tela mas deixei a rota aberta" — e é
também o que responderia se o backend novo está no ar.

**Passo 2 — o invariante contra a API de produção, com token de admin.** Não
rodou. As quatro linhas da tabela do plano, inclusive as duas que devem dar
204.

**Passo 4 — a conversa no navegador, com duas contas.** Não rodou. Duas
janelas, DM e canal de grupo, agente acionado dentro do canal, e conferir na
tela: mensagem chegando sem recarregar, "está digitando", não-lidas contando.

⚠️ **Este é o buraco maior.** A conversa entre pessoas nunca teve uma mensagem
sequer neste sistema. Nada em produção comprova que aquele caminho funciona —
e em 01/09 dois defeitos da War room só apareceram abrindo no navegador.

**Por que os três ficaram de fora:** o classificador do auto mode do Claude Code
bloqueou as chamadas à API de produção. O bloco `autoMode.environment` do
`~/.claude/settings.json` foi corrigido em 02/09 (dizia que os repos eram
privados — são públicos — e que não havia repo confiável). Na próxima sessão,
começar por aqui.

## Achado de segurança, de brinde

A senha antiga do superusuário do Postgres — a que vazou em três repositórios
públicos em set/2026 — **não autentica mais** em `62.72.11.28:2222`. A rotação,
que a memória dava como pendente desde ago/2026, foi feita. Conferido só nesse
host, porta e banco: os outros bancos da empresa continuam por confirmar.

Efeito colateral: `backend/.env.superusuario` (fora do git) ficou com a senha
morta dentro. Vale apagar — arquivo cujo único conteúdo é uma credencial que
não serve é pior que arquivo nenhum.

## Notas relacionadas

- O plano: `docs/superpowers/plans/2026-09-01-chat-entre-pessoas-e-membros.md`
- O desenho: `docs/superpowers/specs/2026-09-01-chat-entre-pessoas-e-membros-design.md`
- A conferência anterior: `docs/CONFERENCIA-2026-09-01.md`
- O ponto de retomada: `docs/CONTINUAR-AQUI.md`
