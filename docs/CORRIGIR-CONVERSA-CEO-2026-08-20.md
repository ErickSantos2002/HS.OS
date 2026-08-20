# O que quebrou na conversa do Nicholson com o Atlas — 20/08/2026

Levantado da conversa inteira (`conversations`, usuário `np@`), do histórico da
sessão no gateway e da `config.get`. **Sete defeitos**, três já corrigidos e
quatro em aberto.

A conversa foi produtiva: ele pediu oportunidades paradas, recebeu um quadro bom
por vendedor, e a partir daí tudo o que deu errado foi **entrega e infraestrutura
de conversa**, não análise.

---

## Já corrigido em `33fbf37`

### 1. A mesma resposta gravada duas vezes ✅

Duas mensagens idênticas de 776 caracteres, no mesmo segundo (10:56:42 e :43), e
de novo às 10:59.

A tela chama `/reply` em laço e a espera segura 20 s, então duas chamadas do
mesmo run ficavam em voo; o `pop` do `_SEQ_DO_RUN` só acontecia **depois** do
INSERT. Agora há trava por `run_id` e memória do que já foi gravado.

### 2. Texto de controle do gateway virando mensagem ✅

O CEO leu, dentro da conversa:

> *"This is a pre-compaction memory flush. Let me capture durable memories to
> disk."* · *"Memória registrada. Nada mais a reportar nesta sessão."* ·
> *"Nothing new to add beyond what's already captured"* · o token **`NO_REPLY`**,
> que é justamente o sinal de **não** responder.

⚠️ Filtrar por frase não funciona — três redações em dois turnos, em dois
idiomas. O sinal é estrutural: o gateway insere `role: "system"` com
`"Compaction"`, depois um **usuário sintético** (`"Continue the OpenClaw runtime
event."`) e o agente responde a esse pedido interno. As duas coisas entraram no
corte de fronteira.

### 3. Os avisos voltavam depois de apagados ✅

O `/recuperar` tratava o usuário sintético como pergunta de gente e abria uma
janela para ele. Cada abertura da tela reimportava o texto de compactação.

---

## Em aberto

### 4. ⚠️ O agente entrega arquivo num caminho que ninguém alcança

Pedido: *"gere um HTML desse resultado com um link"*. Resposta:

```
**MEDIA:/root/.openclaw/workspace-atlas/relatorio_oportunidades_paradas.html**
```

Isso é o disco da **VPS do gateway**. O CEO não tem acesso, a tela não renderiza
`MEDIA:` como anexo, e o agente **acredita que anexou** — escreveu *"o arquivo
está pronto e anexado aqui na conversa — é só baixar pelo anexo"*.

Ele repetiu com o PDF às 10:58 e de novo às 10:59.

**O caminho certo já existe e ele não sabe usar.** Construímos em 19/08 o
`generated-documents` (bucket privado, registro em `generated_documents`,
aparece em Documentos) e o agente só tem a ferramenta `relatorio_vendedores`,
que gera **uma** planilha específica. Falta uma ferramenta genérica: *"salve este
conteúdo como documento de quem pediu"*.

Ele chegou a **oferecer isso**: *"Registrar em Documentos no HS.OS — posso fazer
agora, é só confirmar"*. Não pode. Prometeu o que não tem.

### 5. ⚠️ Dois turnos perdidos por compactação

Às 11:11 e 11:13, a duas perguntas diferentes:

> *"Auto-compaction could not recover this turn. Please try again, use /compact,
> or use /new to start a fresh session. To prevent this, increase your compaction
> buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or
> higher."*

O gateway **disse o que fazer** e ninguém fez: `agents.defaults.compaction`
**não está configurado** — conferido no `config.get`. O `atlas` herda o padrão.

Ele teve que repetir a pergunta. E a mensagem pede ao CEO que digite `/compact`
ou `/new`, comandos de terminal que não fazem sentido para quem está numa tela —
foi assim que ele digitou `/new to start a fresh session` como mensagem em 15/08.

### 6. ⚠️ O agente tentou instalar pacote no sistema

> *"Não tenho permissão para instalar pacotes no sistema."*

Ele tentou resolver o PDF instalando algo na VPS do gateway. A recusa veio do
sistema, não de uma regra nossa. Vale decidir se isso deve ser **proibido no
arquivo dele**, porque hoje só não aconteceu por falta de permissão.

### 7. Uma limitação real do CRM que ele reportou bem

> *"O CRM não registra reunião como tipo de atividade — os tipos usados são todos
> de sistema. Reunião é medida pela entrada do card na Aquisição."*

E: **canal "Indicação" existe no cadastro e tem 0 registros** em agosto —
Inbound 65, Base 18, Outbound 10. Não é defeito do agente; é dado que o comercial
talvez queira olhar.

---

## Ordem sugerida para a próxima sessão

1. **Ferramenta de documento genérica** (item 4) — é o que o CEO pediu três vezes
   e recebeu não três vezes. Reusa tudo que já existe.
2. **`compaction.reserveTokensFloor`** (item 5) — uma linha de config, e o
   gateway já disse qual é.
3. Decidir sobre instalar pacote (item 6).
4. Levar o canal "Indicação" (item 7) para o Nicholson ou o comercial.

## Notas relacionadas

- [`CONFERIR-NA-VOLTA.md`](CONFERIR-NA-VOLTA.md) — o placar do que ele já pediu
- [`ROADMAP-AGENTES-2026-08-19.md`](ROADMAP-AGENTES-2026-08-19.md)
