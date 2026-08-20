# O dia do Nicholson no HS.OS — 20/08/2026

Levantado das **75 mensagens** que ele trocou com Atlas, Flow e Iris entre 10h51
e 12h27, do histórico das sessões no gateway e da `config.get`.

**Primeiro o que importa: as respostas estavam certas.** Ele recebeu oportunidades
paradas por vendedor, atividades por SDR, comparativo julho×agosto, panorama de
serviços — tudo com a régua das skills novas. **Nada do que quebrou foi análise.**
Quebrou entrega, contexto e ruído.

| agente | mensagens dele | do agente |
|---|---|---|
| Atlas | 20 | 44 |
| Flow | 4 | 5 |
| Iris | 2 | 2 |

---

## A. Contexto — a raiz de metade dos problemas

### 1. ⚠️ A sessão do Atlas tem 182 mil tokens numa janela de 65 mil

```
atlas   182.161 tokens        deepseek-chat · contexto 65.536
flow     39.286
iris     22.742
```

É **quase três vezes** o que o modelo aguenta. Por isso a compactação automática
não consegue recuperar, e o Nicholson perdeu **três turnos** — 11h11, 11h13 e
11h36 — recebendo:

> *"Auto-compaction could not recover this turn. Please try again, use /compact,
> or use /new to start a fresh session."*

Ele teve que repetir a pergunta. Numa das vezes, digitou de novo palavra por
palavra.

### 2. `agents.defaults.compaction` não está configurado

O próprio gateway diz o que fazer na mensagem de erro —
`reserveTokensFloor` para 20000 ou mais — e a seção **não existe** na config.
Conferido no `config.get`.

### 3. A mensagem de erro pede comando de terminal a quem está numa tela

`/compact` e `/new` não são coisas que se digitam num chat de navegador. Foi
exatamente assim que, em 15/08, ele digitou `/new to start a fresh session` como
mensagem — e o agente respondeu ao texto.

⚠️ **O botão "Nova conversa" já resolve isso** desde ontem, e ele não sabe que
existe nem que é para usar quando isso aparece.

---

## B. Entrega de arquivo — ele pediu três vezes e não recebeu

### 4. ⚠️ O agente entrega num caminho que ninguém alcança, e acha que anexou

```
**MEDIA:/root/.openclaw/workspace-atlas/relatorio_oportunidades_paradas.html**
```

Disco da **VPS do gateway**. A tela não renderiza `MEDIA:` como anexo. E ele
escreveu *"o arquivo está pronto e anexado aqui na conversa — é só baixar pelo
anexo"*, o que é falso.

Repetiu com o PDF às 10h58 e de novo às 10h59.

### 5. Falta a ferramenta genérica de salvar documento

O caminho certo **existe desde 19/08** — `generated-documents`, bucket privado,
aparece em Documentos. O Atlas só tem `relatorio_vendedores`, que gera **uma**
planilha específica.

Ele chegou a oferecer: *"Registrar em Documentos no HS.OS — posso fazer agora, é
só confirmar."* **Não pode.** Prometeu o que não tem.

### 6. Tentou instalar pacote na VPS do gateway

> *"Não tenho permissão para instalar pacotes no sistema."*

A recusa veio do sistema operacional, não de uma regra nossa. Hoje só não
aconteceu por falta de permissão — vale decidir se proíbe no arquivo dele.

---

## C. Ruído — metade do que ele leu era bastidor

### 7. ⚠️ 26 das 51 mensagens do dia são narração, não resposta

`"Vou consultar…"`, `"Tenho os dados. Vou consolidar…"`, `"Preciso entender
quais SDRs estão ativos…"`, `"O count por created_at deu números muito baixos…"`.

O corte de bastidor de 19/08 mantém só o turno final — mas **cada narração
intermediária está virando uma mensagem separada**, e não uma parte descartável
do mesmo turno. Por isso 20 perguntas viraram 44 respostas.

✅ **Diagnosticado e fechado em 20/08.** O suspeito que eu tinha — `agent.wait`
retornando por etapa — está **errado**: medido ao vivo, ele devolve `status: ok`
com `endedAt` na primeira chamada, esperando a execução inteira. E o front envia
uma vez só e faz polling; não reenvia.

A causa eram os **usuários sintéticos da compactação**. Cada compactação insere
`Continue the OpenClaw runtime event.` com `role: "user"`, e o `/recuperar`
tratava isso como pergunta de gente, abrindo uma janela nova. A pergunta das
11h38 veio logo depois de três compactações seguidas (11h11, 11h13, 11h36) — por
isso ela sozinha virou quatro mensagens.

Somado à duplicação do `/reply`, dá a razão de **2,0 respostas por pergunta**
medida no dia dele. Os dois consertos entraram em `33fbf37`; refeito o mesmo tipo
de pergunta pelo caminho real depois do deploy, a razão é **1:1**.

⚠️ **Não deu para reconstituir a sequência original**: a sessão do gateway já
tinha sido compactada e restaram 65 mensagens. O que sustenta o diagnóstico é a
reprodução pelo caminho real, não a arqueologia.

### 8. Ele é comentado em terceira pessoa, na frente dele

> *"O CEO quer o número de receita em que pode confiar para este mês."*
> *"O CEO pede desempenho dos vendedores. Antes de responder qualquer coisa…"*
> *"O usuário agora quer as atividades do pessoal de serviços."*

Quatro vezes hoje. A regra de não comentar sobre quem fala existe desde 19/08 e
não pegou nesse formato.

### 9 e 10. Duplicação e texto de compactação ✅ corrigidos, ⚠️ não em produção

Resposta idêntica gravada duas vezes (10h56, 10h59, 12h27) e artefatos
`NO_REPLY` / `pre-compaction` chegando à tela. **Consertados em `33fbf37`** — mas
produção está atrás, então **continuam acontecendo para ele**.

---

## D. Produção está três commits atrás

```
produção  a8ae2dc
main      d5bc7e6
```

Falta subir o backend com os consertos de duplicação e de texto de controle.
Enquanto não subir, os itens 9 e 10 seguem visíveis para ele.

---

## Ordem sugerida

1. **Deploy do backend** — dois defeitos já corrigidos esperando.
2. **`compaction.reserveTokensFloor`** — uma linha, e o gateway já disse qual.
3. **Ferramenta genérica de documento** — fecha o que ele pediu três vezes.
4. **Investigar as 44 respostas para 20 perguntas** (item 7) — é o maior ruído.
5. Contar a ele do botão "Nova conversa", e decidir sobre instalar pacote.

## O que funcionou e vale registrar

- As skills novas foram abertas e usadas: funil de vendas, de serviços e a de
  relatório. As réguas seguraram.
- O Flow respondeu quatro perguntas seguidas sobre financeiro, laboratório e
  expedição **sem um tropeço** — sessão de 39 mil tokens, um quinto da do Atlas.
- A Iris recusou responder "me fala dos vendedores" por ambiguidade legítima
  (*"que equipe? depende de…"*) em vez de chutar.

## Notas relacionadas

- [`CONFERIR-NA-VOLTA.md`](CONFERIR-NA-VOLTA.md) — o placar do que ele já pediu
