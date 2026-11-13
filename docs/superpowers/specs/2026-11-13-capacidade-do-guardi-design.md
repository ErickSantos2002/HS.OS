# "Capacidade" do Guardi — design (13/11/2026)

## Intenção

O Guardi já fala com seis sistemas (TaskHS, DataCore, DocsHS, GestorHS,
HSGrowth, TalentHS), mais e-mail, agenda e memória. Ninguém sabe ao certo o que
ele alcança — nem o Erick. A pessoa pergunta algo que o Guardi poderia fazer e
não pergunta o que ele faria; ou pede o que ele não pode e acha que quebrou.

Um botão **"Capacidade"**, ao lado de "Conversas anteriores", abre a lista dos
sistemas que o Guardi dela alcança **agora**; clicar num sistema mostra, abaixo,
**o que ele consegue fazer ali com o login dela** — consultar e fazer (com
confirmação).

## Decisões do Erick (13/11/2026)

1. **Só o que o login da pessoa consegue**, sistema por sistema — não a lista
   completa com "depende da sua função".
2. **Quem diz o que o login pode é cada sistema** (caminho recomendado): cada um
   ganha uma rota que responde, com a mesma regra que já aplica, o que aquele
   login pode fazer pelo Guardi. O HS.OS só junta. Uma tabela de permissão
   copiada aqui divergiria em silêncio — é a duplicação que todas as
   integrações evitaram.

## O contrato com cada sistema

```
GET /agente/capacidades          (com o token de agente de sempre: aud do sistema, sub = e-mail do dono)
→ 200 { "papel": "<texto do papel lá, para exibir>",
        "rotas": [ ["GET", "/absences/my"], ["POST", "/absences/request"], … ] }
```

- `rotas` = os pares (método, template) **do allowlist de agente daquele
  sistema** que **este** login consegue usar, avaliados pela mesma regra de
  papel/função das rotas. Template literal (`/absences/{request_id}/approve`),
  igual ao allowlist.
- A rota entra no próprio allowlist (GET). Usuário sem conta ou inativo → 401,
  como o resto.
- **Onde a regra não é só de papel** (ex.: GestorHS avança caixa conforme a
  fase; HSGrowth só escreve em card do dono), a rota entra se o papel permite
  **em algum caso**; o detalhe continua sendo conferido na hora, como hoje.
- Cada sistema decide como avaliar (ex.: uma tabela rota → papéis ao lado do
  allowlist, testada contra os `require_*` das rotas). A spec de cada sistema
  é a seção "Para o <sistema>" abaixo.

## Do lado do HS.OS

### Rota `GET /bots/capacidade/{agent_id}`

- Só o **dono** do Guardi (`agent_profiles.dono_id = usuário`); qualquer outro,
  inclusive administrador, recebe 404 — o retorno descreve as permissões de
  uma pessoa nos sistemas dela.
- Para cada sistema em `sistemas_ligados`, em paralelo, timeout de 6 s cada:
  chama `/agente/capacidades` com o token de agente do dono.
- Cruza a resposta com **os nossos catálogos** (cada consulta/ação já tem
  método e template): uma consulta ou ação aparece se o par dela está em
  `rotas`. O texto exibido sai do catálogo (a descrição da consulta, o verbo
  da ação) — escrito para quem usa.
- Itens do próprio HS.OS, sem sistema externo: **Memória** (`lembrar`),
  **Agenda e lembretes** (`agenda_*`), **E-mail** (só com `email_ligado`:
  ler, preparar, enviar para si, marcar lido; agenda do Outlook se concedida).
- Resposta:
  ```
  { "sistemas": [ { "sistema": "talenths", "nome": "TalentHS", "papel": "Colaborador",
                    "estado": "ok" | "sem_conta" | "fora_do_ar" | "sem_resposta_de_capacidade",
                    "consultar": [ {"rotulo": "…", "exemplo": "…"} ],
                    "fazer":     [ {"rotulo": "…", "exemplo": "…"} ] } ] }
  ```
- **Sistema que ainda não tem `/agente/capacidades`** (404 nessa rota):
  `estado: "sem_resposta_de_capacidade"` — a tela mostra o sistema com "ainda
  não sei dizer o que o seu login permite aqui; pergunte ao Guardi". Nunca a
  lista completa: seria afirmar o que pode não valer.
- `sem_conta` (401) e `fora_do_ar` (timeout/5xx) aparecem como tais.
- Cache em memória por (agent_id) de 5 min, invalidado quando muda
  `sistemas_ligados` ou `email_ligado`. Botão "atualizar" na tela ignora o
  cache.
- `exemplo`: frase curta do que dizer ao Guardi ("quais férias eu pedi?",
  "pede folga na terça"). Fica no catálogo, ao lado da descrição — campo novo,
  opcional; sem ele, só o rótulo.

### Tela

- **Desktop:** botão "Capacidade" no cabeçalho da conversa com o Guardi, ao lado
  de "Conversas anteriores" (`ChatPage.tsx`), só quando o agente é o Guardi
  **do usuário**. Abre um `Sheet` lateral, como `ConversasAnteriores`.
- **Celular:** item "Capacidade" no ⋮ da conversa (`TelaConversaAgente.tsx`),
  abrindo como painel (`painel=capacidade` na pilha da URL).
- Conteúdo: lista de sistemas (nome, papel lá, quantas coisas consulta / faz);
  clicar expande abaixo duas seções — **Consultar** e **Fazer (com sua
  confirmação)** — com os rótulos e, quando houver, o exemplo. Estados
  `sem_conta`, `fora_do_ar` e `sem_resposta_de_capacidade` com uma linha de
  explicação. Sistemas do HS.OS (memória, agenda, e-mail) num grupo
  "No HS.OS".
- Componente compartilhado entre desktop e celular (a regra do repo: lógica
  compartilhada, não copiada).

### Segunda versão: por assunto (13/11/2026)

O Erick abriu a primeira versão e o TalentHS de um colaborador saía com 42
linhas cruas de "Consultar" — descrições escritas para o agente, com passos
intermediários ("Uma pessoa pelo user_id", "Os ciclos de metas"). Pedido: "mais
organizado, melhor separado, fácil de entender, e colorido".

- Cada item de cada catálogo tem um **assunto** e uma **frase curta escrita à
  mão**, ou a marca `INTERNO` (id, ciclo, tipo, "quem você é", lista de
  referência). Tudo em `backend/app/capacidade_assuntos.py`, um arquivo para a
  tela inteira — os catálogos seguem sendo texto do agente. Interno não aparece,
  mas conta como pré-requisito de quem o declara em `requer` (sem os ciclos,
  "a sua avaliação" não aparece). Teste falha se item novo de catálogo não
  tiver assunto nem marca.
- Resposta, por sistema: `{sistema, nome, papel, estado, assuntos: [{chave,
  titulo, icone, cor, ve: [...], faz: [...], na_hora: [...], exemplos: [...]}]}`.
  Assunto só aparece com ao menos um item liberado; exemplo só de item
  liberado; `na_hora` = o que sai sem cartão (só no HS.OS). O HS.OS vira um
  grupo só, "Memória, lembretes e e-mail".
- Tela: cada sistema é um cartão com os ícones coloridos dos assuntos; aberto,
  um bloco por assunto (faixa e ícone na cor dele), com "Vê" em texto corrido,
  "Faz" em chips e "Experimente: …".

### Arquivos

- `app/capacidade.py` (puro, testado): cruza `rotas` × catálogos e monta a
  resposta; os catálogos ganham, onde faltar, o par (método, template) de cada
  item.
- `routers/bots_pessoais.py` ou `routers/meu_bot.py`: a rota.
- `frontend/src/components/guardi/Capacidade.tsx` + hook
  `use-capacidade-do-guardi.ts`; botão no `ChatPage`, item no celular.
- Changelog.

## Para cada sistema (na sessão dele)

Igual para os seis, com o nome do allowlist de cada um:

1. `GET /agente/capacidades`, só para token de agente (login normal → 403 ou
   404, a critério), devolvendo `{papel, rotas}` como no contrato.
2. A avaliação usa a **mesma** regra das rotas. Recomendação: declarar, ao lado
   do allowlist, os papéis de cada rota, e um teste que percorre o allowlist e
   confere, para cada papel, que a rota declarada como permitida não devolve
   403 e a não permitida devolve — a tabela fica presa ao código.
3. A rota entra no próprio allowlist (GET).
4. Changelog e deploy.

Particularidades conhecidas:
- **TaskHS:** sem papel nas ferramentas do Guardi — todas as rotas do
  allowlist, exceto as que o `bloquear_token_de_agente` barra.
- **DocsHS:** as 6 consultas da Qualidade só para `admin_qualidade` e
  `administrador`.
- **GestorHS:** escritas por `require_funcao`; fase de caixa entra se a função
  avança **alguma** fase.
- **HSGrowth:** vendas para `salesperson` (e quem mais o allowlist aceite);
  Serviços para `service`.
- **DataCore:** o papel de cada rota do allowlist de agente.
- **TalentHS:** `user` × `manager`/`master_admin` (as "só o RH").

## Ordem

Não precisa esperar os seis: o HS.OS sobe primeiro (todo sistema aparece como
`sem_resposta_de_capacidade`), e cada sistema passa a aparecer completo quando
o deploy dele subir. Sugestão: TalentHS e DocsHS (regra simples) primeiro;
GestorHS e HSGrowth por último.

## Não-objetivos

- Mostrar capacidade do Guardi de outra pessoa (nem ao administrador).
- Especialistas (`nina`, `iris`…): só o Guardi.
- Ligar/desligar sistema pela tela — continua por script.

## Anti-objetivos

- **A tela prometer o que o login não faz** (lista completa por falta de
  resposta): por isso `sem_resposta_de_capacidade`.
- **Regra de permissão copiada no HS.OS.**
- **Vazar permissões de uma pessoa a outra** — a rota é só do dono.

## Conferência

1. `erick-bot` (`user` no TalentHS): TalentHS mostra ausências próprias, sem
   "aprovar ausência"; Guardi da Lidisay mostra "aprovar ausência".
2. Sistema fora do ar → linha "fora do ar agora", o resto aparece.
3. Outra pessoa chamando `/bots/capacidade/erick-bot` → 404.

## Decisões minhas (Claude), revisáveis

- Contrato em pares (método, template), a moeda que o allowlist já usa.
- Cache de 5 min com "atualizar".
- Rota só do dono, sem exceção para administrador.
- Sistema sem a rota nova aparece sem lista, nunca com a lista completa.
