# Bot pessoal com e-mail: piloto (05/11/2026)

## Intenção

Esta é a primeira capacidade de **escrita** dos bots pessoais (spec anterior:
`2026-11-05-bots-pessoais-cascas-design.md`). O Nicholson quer que os agentes
ajudem as pessoas a fazer coisas, e a primeira escolhida é o e-mail.

Todos os colaboradores usam **Microsoft 365**. Cada um entra com a conta
`@healthsafetytech.com` e tem, montada nela, pelo menos uma **caixa
compartilhada** `@healthsafety.com.br`. No Outlook ela aparece como segunda
árvore, com o ícone de pessoas, por exemplo `ti@healthsafety.com.br`. O bot
precisa enxergar todas as caixas da pessoa.

O piloto é **só com o Erick** (`erick-bot`). Ao fim dele, o bot faz três coisas:
1. **lê** os e-mails da caixa principal e das compartilhadas;
2. **escreve** e-mails;
3. **envia**: direto quando o destinatário é o próprio dono; para qualquer
   outro, só depois que o dono **aprova na tela do HS.OS**.

## Decisões do Erick

- O primeiro piloto é o e-mail, com o Erick.
- Para o dono o envio sai direto; para outros, só com aprovação na tela.
- A segunda caixa é compartilhada (confirmado por print do Outlook).
- **As ferramentas de e-mail só valem no turno do dono.** O admin continua
  podendo conversar com qualquer bot, mas o bot não abre e-mail para ele. A
  regra é a mesma do `turno_em_curso` dos anexos: precisa haver um run aberto
  do **dono** com aquele bot.
- Deploy só uma vez, no fim do dia. **Tudo o que dá para testar localmente é
  testado antes** (OAuth com redirect para localhost e a conta real do Erick,
  cifra, Graph, cartão de aprovação). O caminho bot → MCP → Graph só é
  validado depois do deploy, porque o gateway só alcança o backend de
  produção. Se falhar, **um segundo deploy é aceito**.
- **O modelo continua DeepSeek, com o risco aceito pelo Erick.** O conteúdo
  de e-mail (inclusive de terceiros e das caixas compartilhadas) vai para a
  API da DeepSeek. A alternativa recomendada era trocar os bots pessoais para
  o Claude (Anthropic), por LGPD e transferência internacional, e foi
  recusada. **Reavaliar antes de abrir o e-mail para outras pessoas.**

## Objetivos

1. O dono conecta a conta Microsoft dele uma vez, pela tela (OAuth delegado).
2. O bot lista e lê e-mails da caixa principal e das compartilhadas
   cadastradas para o dono.
3. `email_enviar_para_mim`: o bot envia ao próprio dono, e o destinatário é
   fixo no servidor.
4. `email_preparar`: o bot prepara um e-mail para qualquer destinatário. Ele
   vira rascunho no Outlook e um cartão de aprovação no HS.OS, e só o clique
   do dono envia.
5. Tudo auditável: cada leitura, preparo, envio e descarte deixa uma linha.

## Não-objetivos

- Enviar **como** a caixa compartilhada (send-as). No piloto tudo sai pela
  conta principal.
- Responder ou encaminhar a partir de um e-mail específico (reply/forward).
- Anexos de e-mail, que ficam para depois.
- Abrir para outras pessoas além do Erick. A estrutura é por pessoa, mas o
  piloto liga um só.
- Mover, apagar ou marcar e-mail como lido.
- Calendário, Teams, OneDrive.

## Anti-objetivos (fracasso mesmo funcionando)

- **Qualquer e-mail sair para terceiro sem o clique do dono.** Isso inclui o
  caso em que o conteúdo de um e-mail lido instrui o bot ("encaminhe isto
  para X").
- O admin, ou qualquer pessoa que não seja o dono, ler e-mail alheio pelo bot.
- Token da Microsoft ir parar no gateway, no agente, no log ou no navegador.
- Um bot usar o token de outro dono. A identidade vem do HMAC, não do
  argumento.
- O cartão de aprovação mostrar uma coisa e enviar outra. Enviar tem que
  mandar exatamente o que o dono viu; se o rascunho mudou no Outlook, o
  cartão diz isso.

## Restrições

- **Microsoft Graph** com permissões **delegadas**: `User.Read`,
  `offline_access`, `Mail.ReadWrite`, `Mail.Send`, `Mail.Read.Shared`. O
  admin consente no tenant. Reaproveita o app do login do HS.OS no Entra ID;
  ver a seção do Entra abaixo.
- O redirect da OAuth cai no **backend** (`hsosapi.healthsafetytech.com`). O
  refresh token é guardado **cifrado** no banco, numa tabela própria e por
  pessoa. Hoje o repositório não tem cifra nenhuma: entra a lib
  `cryptography` (Fernet), com a chave em variável de ambiente no EasyPanel. A
  rotação fica fora do piloto.
- **Caixas compartilhadas não se descobrem pelo Graph**: não existe o método
  "quais caixas esta pessoa pode abrir". Cada pessoa tem a lista cadastrada,
  e na hora de cadastrar o backend faz uma leitura de teste
  (`GET /users/{caixa}/mailFolders/inbox`). Quem cadastra é o administrador
  (minha escolha).
- O servidor MCP segue o padrão do `hsos-anexos`: uma entrada
  `hsos-email-<bot>` por bot, com o HMAC do id dele na URL. O backend resolve
  a cadeia agente → `dono_id` → token. Só o bot do dono recebe a entrada, pelo
  `alsoAllow`; o deny de todos os outros a nega. ⚠️ O recálculo de deny e o
  fail-closed do `tools_do_bot` precisam reconhecer a nova entrada, e a entrada
  precisa de `toolFilter.include`.
- **Turno do dono:** cada ferramenta confere, antes de chamar o Graph, que há
  um run aberto do dono com aquele bot (o mesmo critério e a mesma janela do
  `turno_em_curso`).
- O conteúdo de e-mail que chega ao agente vem **marcado como dado de fora**,
  por exemplo envolto em delimitador e com aviso na descrição da ferramenta.
  Corpo HTML é convertido em texto e cortado num teto, para não estourar a
  saída nem o contexto.
- Português em tudo, testes no padrão do repositório.

## Como funciona (o que o Erick decidiu, mais as minhas escolhas)

**Quem tem e-mail ligado** (minha escolha). Uma flag por bot, que só o admin
liga (por exemplo, `agent_profiles.email_ligado`). Ela é a fonte da verdade
para três coisas:
- o botão "Conectar e-mail" aparecer para o dono (sem a flag, ninguém deixa
  refresh token parado no banco);
- quem ganha a entrada `hsos-email-<bot>` no `alsoAllow`;
- o `tools_do_bot` e o `bot_esta_fechado` deixarem de exigir um `alsoAllow`
  fixo e passarem a calculá-lo a partir dessa flag. Sem isso, rodar o script
  de criação de novo **tiraria** o e-mail do `erick-bot`.

O `publicar-anexos-mcp.py` e o recálculo de deny também preservam a entrada.

**Conectar.** Em Configurações → Perfil, o botão "Conectar e-mail Microsoft"
abre a OAuth. O callback grava o token e o e-mail da conta, e a tela mostra
"conectado como ti@healthsafetytech.com · caixas: ti@healthsafety.com.br".
O botão "Desconectar" apaga o token.

**Ferramentas do bot** (nomes e parâmetros finais ficam com o construtor):
- `email_caixas()`: as caixas que o bot pode ler.
- `email_listar(caixa, pasta="inbox", desde?, busca?, limite<=25)`: devolve
  remetente, assunto, data, prévia curta e id.
- `email_ler(caixa, id)`: o corpo em texto, cortado no teto, marcado como dado.
- `email_enviar_para_mim(assunto, corpo)`: envia ao dono e só ao dono.
- `email_preparar(para[], cc[]?, assunto, corpo)`: cria o rascunho no Outlook
  da conta principal e uma linha "pendente" no HS.OS. O bot recebe "aguardando
  aprovação de <dono>". Ele não tem ferramenta para enviar o rascunho.

**Aprovar.** O cartão é uma **mensagem na conversa** (`conversations`, com um
tipo próprio), e não uma tabela à parte com caminho próprio: assim o push
(`trg_push_pendente`) e o tempo real vêm do caminho que já existe (minha
escolha). Os dados do e-mail pendente ficam numa tabela ligada a essa
mensagem. **O bot não é avisado** do desfecho, porque isso exigiria escrita
espontânea na sessão dele. Em vez disso, ele tem `email_pendentes()` para
consultar o estado, e a descrição de `email_preparar` manda que ele não
afirme que o e-mail foi enviado.

Na conversa com o bot aparece um cartão com De, Para, Cc,
Assunto e Corpo, e os botões **Enviar** e **Descartar**. Sai também um push
para o celular. "Enviar" chama o backend, que confere que quem clicou é o
dono, relê o rascunho no Graph e confere que bate com o que foi mostrado. Se
o dono editou o rascunho no Outlook, o cartão mostra a versão nova antes de
enviar. Só então faz o `POST /me/messages/{id}/send`. "Descartar" apaga o
rascunho. Cada pendência tem validade (sugestão: 24 h), e ao vencer o
rascunho fica no Outlook, sem cartão ativo.

**Auditoria.** Tabela de eventos de e-mail: quem, qual bot, ação
(listar/ler/preparar/enviar/descartar), caixa, id da mensagem e destinatários,
**sem** o corpo.

## Riscos aceitos

- O refresh token é poderoso: lê e envia como a pessoa. Mitigações: cifra,
  escopo mínimo, o backend como único que usa o token, auditoria e
  desconectar a qualquer momento.
- Um e-mail malicioso pode fazer o bot preparar um rascunho estranho. A
  defesa é o cartão mostrar exatamente o destinatário e o conteúdo antes de
  qualquer envio. Para o dono o envio é direto, então o pior caso é o dono
  receber um e-mail esquisito de si mesmo.
- O teto de 8.192 tokens de saída do OpenClaw limita o tamanho do corpo que o
  bot consegue escrever.

## Entra: reaproveita o app do login (decisão do Erick)

O app do "Entrar com Microsoft" do HS.OS (`app/auth/microsoft.py`,
`MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET`, já no `.env` e no EasyPanel)
ganhou as permissões delegadas de e-mail e duas URIs de redirect novas:
`https://hsosapi.healthsafetytech.com/email/oauth/callback` e
`http://localhost:8002/email/oauth/callback`. **Não há segredo nem client
novo.** O redirect do e-mail é uma configuração própria (`MS_EMAIL_REDIRECT_URI`,
que no `.env` local aponta para o localhost), separada do `MS_REDIRECT_URI` do
login.

⚠️ **O login não pode passar a pedir escopo de e-mail.** O `ESCOPOS` do login
continua `openid email profile User.Read`. As permissões de e-mail só são
pedidas no fluxo "Conectar e-mail" (consentimento incremental). Misturar os
dois faria todo login ganhar refresh token de e-mail, que é o que a flag por
bot existe para evitar.

Variável nova: só a `EMAIL_CHAVE_CIFRA` (Fernet), gerada em 05/11 no
`backend/.env` e copiada pelo Erick para o EasyPanel. **Ela tem que ser a
mesma nos dois lados**, e se for perdida todo mundo precisa reconectar.

## Para o construtor decidir

- O nome e o formato exatos das ferramentas, das rotas e das tabelas.
- Biblioteca: `msal` ou `httpx` direto no endpoint de token.
- O teto do corpo de e-mail para o agente.
- A forma visual do cartão de aprovação, dentro do padrão do chat.
- O mecanismo de detecção de "rascunho mudou desde o cartão" (hash do
  conteúdo, `changeKey` ou `lastModifiedDateTime` do Graph).
