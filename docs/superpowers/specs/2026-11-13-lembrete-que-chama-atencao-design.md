# Lembrete que chama atenção — design (13/11/2026)

## Intenção

Em 13/11/2026 a Sandra pediu ao Guardi um lembrete às 14:00 ("retornar contato
para Hildon"). O disparo foi certo — recado gravado às 14:00:27, push enviado,
o Guardi escreveu a mensagem às 14:01 —, e ela não percebeu. Parte era
configuração do navegador dela (no app instalado do Chrome o push funciona,
conferido com o Welton). Mas o Erick apontou o que fica mesmo com tudo certo:
**uma notificação que aparece e some serve para mensagem, não para lembrete.**
O padrão é o do Teams: o lembrete fica na frente até a pessoa decidir.

## Decisão do Erick (13/11/2026): as três camadas

1. **Notificação que não some**, com **"Adiar 10 min"** e **"Feito"**.
2. **Janela de lembrete dentro do HS.OS** (app aberto): cartão no centro, com
   som, que só sai com Adiar ou Feito.
3. **Insistência**: sem Adiar nem Feito em 5 min, toca de novo **uma vez**.

Mensagem comum não muda.

## O que existe (código, 13/11/2026)

- `app/disparador_lembretes.py`, `disparar_um`: grava o recado
  `⏰ Lembrete: <título>` em `conversations` com
  `media=[{type:"lembrete", id, name}]` e depois dispara o turno do Guardi.
- O push nasce do trigger `trg_push_pendente` → `app/push_envio.py`; o payload
  de conversa com agente é `push_regras.payload_agente` (tag `agente:<id>`,
  `conversa` = `agente:<id>`).
- SW: `frontend/src/sw.ts` — `alguemOlhando` cala o push de quem está com a
  conversa aberta e em foco; ações de push já existem para canal ("Responder",
  "Marcar como lida"), e a resposta rápida usa Cache Storage + URL com id.
- Tabela `lembretes` (`032`), página `/agenda`.

## O desenho

### Estado do disparo (migração `036_lembrete_reconhecido.sql`)

Em `lembretes`: `aviso_em timestamptz` (quando o último aviso saiu),
`reconhecido_em timestamptz`, `reconhecido_como text` (`feito` | `adiado`),
`reaviso_em timestamptz` (próximo re-aviso: adiar ou insistência),
`reavisos int default 0`. Zerados a cada disparo novo (recorrente).

### Camada 1 — o push do lembrete

- O push do **recado do lembrete** (a linha com `media.type = "lembrete"`) sai
  com payload próprio (`push_regras.payload_lembrete`): `tipo: "lembrete"`,
  `lembrete_id`, `tag: "lembrete:<id>"`, título `⏰ <título>`, corpo = a
  instrução curta, e um **token de ação** (abaixo). A mensagem seguinte do
  Guardi continua sendo push comum.
- SW: para `tipo: "lembrete"` → `requireInteraction: true`, `renotify: true`,
  ações `adiar` ("Adiar 10 min") e `feito` ("Feito"); **não** passa pelo
  `alguemOlhando` (lembrete toca mesmo com a conversa aberta — quem está
  olhando também recebe a janela da camada 2; fechar uma fecha a outra).
- Clique nas ações: o SW faz `POST /lembretes/acao` com o token, **sem abrir o
  app**; clique no corpo abre `/agenda` (ou a conversa do Guardi).
- ⚠️ **Token de ação**: o SW não tem o login. O payload leva um token assinado
  (HMAC com segredo do backend), escopo `(lembrete_id, aviso_em, ação)`,
  validade 24 h, uso por lembrete+aviso (o segundo clique é inócuo). Ele só sabe
  adiar 10 min ou marcar feito **aquele** lembrete daquele aviso — nada mais.
  Mesmo padrão de cuidado da resposta rápida (`lib/resposta-rapida.ts`).
- iOS: `requireInteraction` não existe; as ações também não. Lá o comportamento
  fica o de hoje (o iOS mantém na central) — aceitar.

### Camada 2 — a janela no HS.OS

- Componente global (desktop no `AppLayout`, celular no `CascaDoApp`), que ouve
  o tempo real de `conversations`: linha nova do próprio usuário com
  `media.type = "lembrete"` → abre o cartão: título, horário, a instrução, o
  nome do Guardi, botões **Adiar 10 min**, **Feito** e "Abrir conversa".
- Som curto (arquivo em `public/sons/`), tocado uma vez; respeita o "silenciar"
  do navegador. Sem som se a aba está oculta (aí quem avisa é o push).
- Ao carregar o app, busca lembretes **avisados e não reconhecidos** das
  últimas 6 h (`GET /lembretes/pendentes`) e abre a janela — quem abriu o app
  depois do aviso também vê.
- Adiar/Feito pela janela vão por `POST /lembretes/{id}/adiar|feito` (login
  normal). Ao reconhecer, a notificação do SO com `tag: lembrete:<id>` é
  fechada (`getNotifications({tag})` → `close()`), e o tempo real fecha a
  janela nas outras abas/aparelhos.

### Camada 3 — insistência

- O disparador, na mesma passada, procura `reaviso_em <= now()` e reconhecido
  nulo (insistência) ou `reconhecido_como = 'adiado'` vencido (adiar):
  - **sem nova chamada ao Guardi** (não gasta turno nem conta no teto de 12);
  - regrava um recado `⏰ Lembrete (de novo): <título>` — que gera push e janela
    pelos mesmos caminhos — e incrementa `reavisos`;
  - insistência: `reaviso_em = aviso_em + 5 min` no primeiro aviso, e **só uma
    vez** (`reavisos` ≤ 1 para insistência);
  - adiar: `reaviso_em = now + 10 min`, ilimitado, mas cada adiamento reinicia a
    insistência de 5 min daquele novo aviso.
- `Feito` zera `reaviso_em`. Lembrete recorrente: o próximo disparo segue a
  regra normal e começa limpo.

### Página `/agenda`

O "Último disparo … · Entregue" passa a dizer o que a pessoa fez: "Feito às
14:05", "Adiado para 14:10", "Avisado de novo às 14:05 — sem resposta".

## Não-objetivos

- Mudar o comportamento de mensagens comuns.
- E-mail ou WhatsApp como canal de lembrete.
- Configurar o tempo de adiar (10 min fixo nesta fase).

## Anti-objetivos

- **Insistência que vira spam**: uma repetição só, nunca em loop.
- **Re-aviso gastando turno do Guardi**: o re-aviso é só o recado.
- **Token de ação que serve para outra coisa** ou para outra pessoa.

## Testes (o que trancar)

Backend: token (escopo, validade, outro lembrete, outro aviso, uso repetido);
adiar/feito por login e por token; regra de re-aviso (5 min uma vez; adiar 10
min; feito zera; recorrente começa limpo; sem turno do agente no re-aviso);
`payload_lembrete`. Front: SW (lembrete ignora `alguemOlhando`,
`requireInteraction` e ações), janela (abre por tempo real e por pendentes,
fecha ao reconhecer), texto da `/agenda`.

## Produção

Migração `036` (o Claude aplica com o script admin e confere o efeito) →
deploy. Conferência: lembrete de teste em 2 min no `erick-bot`; ver a
notificação persistir, Adiar → volta em 10 min; não clicar → volta em 5 min,
uma vez; Feito pela janela fecha a notificação do sistema.
