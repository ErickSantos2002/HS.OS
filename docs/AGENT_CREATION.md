# AGENT_CREATION.md — como criar um agente no HS.OS

Este é o padrão. Quem cria agentes aqui é a orquestradora, e é este documento
que ela segue — não a memória dela, não o que deu certo da última vez.

> **Para quem lê isto sendo a orquestradora:** você recebe um briefing por
> mensagem quando alguém pede um agente novo pela tela. O briefing traz os
> dados daquele agente; este documento traz o procedimento.

## ⚠️ Isto ainda não está entregue à orquestradora

**Rascunho, em 12/08/2026.** O conteúdo vale; o formato vai mudar.

Não dá para pôr este arquivo no workspace dela: o gateway só escreve os sete
nomes canônicos (testado — `agents.files.set` recusa qualquer outro), e mesmo
que entrasse por shell, **não carregaria sozinho** no contexto. Seria o mesmo
defeito do `COMPANY.md`.

O caminho certo, confirmado com quem opera a plataforma de origem, é **uma
skill**: o procedimento fica numa skill que o agente carrega só quando vai
criar, e o contexto dele leva apenas uma linha — *"para criar agente, use a
skill X"*. Custo zero enquanto não usa.

⚠️ **Enquanto a skill não existe, o briefing aponta para este arquivo e ele não
está no workspace dela.** Se alguém criar um agente antes disso, ela vai
improvisar. Converter isto em skill é o primeiro item de 13/08.

---

## Antes de começar: o que já foi feito por você

Quando o briefing chega, **o agente já existe**. A API do HS.OS chamou
`agents.create` no gateway antes de te avisar, e isso já:

- criou o diretório do workspace;
- registrou o agente no gateway, com id, nome, modelo e workspace;
- semeou os sete arquivos com o **template em branco do OpenClaw**, em inglês.

Então **não** crie o workspace e **não** reinicie o gateway. Os dois passos
aparecem em briefings antigos e são resquício: o primeiro é redundante, o
segundo derruba o túnel e as sessões abertas de todo mundo.

Seu trabalho é **substituir o template** pelos arquivos de verdade.

Como saber se um agente ainda está com o template: o `SOUL.md` dele começa com
`# SOUL.md - Who You Are`. Se começa assim, ninguém escreveu nada ainda.

---

## Os sete arquivos

O OpenClaw carrega **exatamente estes sete nomes**, sozinho, em toda sessão.
Arquivo com outro nome no workspace **não entra no contexto** — só é lido se
alguém mandar o agente abrir. Por isso, tudo que o agente precisa saber sempre
tem que caber aqui dentro.

| Arquivo | O que vai dentro |
|---|---|
| `SOUL.md` | Quem ele é: identidade, forma de ser, tom, limites |
| `IDENTITY.md` | O que ele faz: missão, especialidade, exemplos de resposta |
| `AGENTS.md` | Como ele opera: inicialização, memória, o time, regras da casa |
| `TOOLS.md` | A que ele tem acesso: sistemas, credenciais, schema do banco |
| `USER.md` | Com quem ele fala: as pessoas e como cada uma prefere ser atendida |
| `MEMORY.md` | O que ele aprendeu. Nasce com o cabeçalho e a data de criação |
| `HEARTBEAT.md` | O que verificar periodicamente. Enxuto — cada linha custa token |

**Escreva todos os sete em português.** O template vem em inglês; não deixe
sobrar nenhum pedaço dele.

---

## O que todo agente herda

Estes blocos são iguais em todos. Copie-os, não reinvente — é o que faz a frota
ser uma frota, e não cinco agentes parecidos.

### Bloco da empresa (vai no `AGENTS.md`)

Quem somos, o que vendemos, para quem, e o tom. **Curto** — o detalhe
(CNAE, endereço fiscal, tabela completa de produtos) fica no `COMPANY.md`, que
o agente lê sob demanda quando o assunto aparecer. No `AGENTS.md` entra só o
que precisa estar presente em toda resposta.

### Regras da casa (vão no `AGENTS.md`)

- Confirme antes de apagar, sobrescrever ou executar o que não tem volta
- Nunca invente dado de sistema — sem acesso, diga que não tem
- Dado sensível de cliente ou financeiro não sai sem necessidade clara
- Ação externa (e-mail, integração pública) sempre pede confirmação
- **Token é dinheiro:** antes de explorar por tentativa e erro, pergunte —
  o time construiu os sistemas e sabe o caminho

### Hierarquia (vai no `SOUL.md`)

O agente reporta à orquestradora. Decisão estrutural sobe para o Erick.

---

## O que muda em cada agente

Aqui é onde você pensa, e é o que justifica ser você a criar em vez de um
molde automático:

- **Domínio** — o que ele faz **e o que está fora do escopo dele**. A segunda
  metade é a que evita agente respondendo o que não sabe.
- **Sistemas** — a que banco ou API ele tem acesso, e com que permissão.
- **Tom** — calibrado a quem ele atende. Quem fala com diretoria não escreve
  como quem fala com o time técnico.
- **Limites** — o que ele nunca faz sem confirmar.
- **Formato de resposta** — o que se espera de volta.

---

## Acesso a dados

⚠️ **Nunca escreva credencial de superusuário no `TOOLS.md`.** Esses arquivos
entram no contexto do modelo em toda sessão, saem em toda exportação e ficam em
todo backup. Em 12/08/2026 encontramos a senha do superusuário de dois bancos
de produção em texto puro num agente — ele tinha poder de apagar tabela e a
credencial circulava a cada conversa.

O padrão é: **usuário só-leitura, por agente, por banco.** Se ainda não existir
para o banco em questão, **pare e peça** — não use a credencial da aplicação
"só para testar".

Quando o agente consulta banco direto, o `TOOLS.md` dele leva também **o mapa
do schema** das tabelas do domínio dele: nome, colunas e para que serve cada
tabela. Sem isso ele escreve consulta por adivinhação.

⚠️ Schema muda. Quando mudar, o `TOOLS.md` precisa mudar junto — senão o agente
consulta coluna que não existe mais e conclui que não há dados, que é pior do
que dar erro.

---

## Ao terminar

1. Releia os sete arquivos. Se sobrou inglês do template, refaça.
2. Confirme que o `SOUL.md` não começa mais com `# SOUL.md - Who You Are`.
3. Responda a quem pediu **listando cada arquivo com o caminho completo** e um
   resumo do que ficou configurado.

⚠️ **Execute as ferramentas. Não descreva o que faria.** Este aviso existe
porque já aconteceu: o briefing foi entregue, veio de volta um plano bem
escrito, e nenhum arquivo tinha sido criado. Um agente com o template em branco
fica na lista parecendo pronto, e quem for conversar com ele descobre do pior
jeito.

---

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado da plataforma
- [`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md) — como a resposta do agente chega hoje
