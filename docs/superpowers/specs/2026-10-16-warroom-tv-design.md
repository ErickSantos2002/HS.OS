# War Room na TV da empresa — design

Data: 16/10/2026 · Pedido: Nicholson (CEO), conduzido pelo Erick · Estado: aprovado
na conversa, decisões abaixo.

## Objetivo

A War Room (`/warroom`) vira o painel fixo da TV da empresa: bonito de olhar o
dia inteiro, mostrando o time — pessoas e agentes — trabalhando. Duas mudanças
de fundo:

1. **Privacidade.** A tela é pública (visitante vê; o link da TV é a
   credencial). **Nenhum conteúdo de mensagem** pode aparecer — nem de pessoa
   com agente, nem de pessoa com pessoa. Hoje vaza em dois lugares: o Fluxo
   ("Nicholson: phoebus vendido em abril qual empresa") e o rótulo embaixo de
   cada agente (`tarefa`, que é a pergunta em aberto). E o JSON do
   `/warroom/feed` carrega esse texto para quem tiver o link, então **esconder
   na tela não basta: o backend deixa de mandar**.
2. **Visual.** Com 28 pessoas os nomes se atropelam (ver a foto de 16/10). E a
   tela passa a mostrar também **conversa entre pessoas** (DM), só o fato de que
   estão conversando.

Sucesso: na TV, de longe, dá para ver quem está no escritório, quem está em
reunião, quem está conversando com quem (pessoa↔pessoa e pessoa↔agente) e o
que os agentes entregaram — sem nenhuma frase de conversa em lugar nenhum,
nem no JSON.

## Decisões (Erick, 16/10/2026)

| tema | decisão |
|---|---|
| conversa entre pessoas | **só DM.** Linha ciano liga as duas pessoas enquanto conversam. Canal de grupo **não** entra (a tela já é cheia) |
| layout | **A — constelação organizada**: núcleo e agentes no centro; pessoas num anel externo, agrupadas por setor, com o nome do setor por fora |
| Fluxo | **fica**, mas só com fatos montados de nomes e frases fixas — nunca texto de mensagem |
| rodapé | sai tokens e custo; ficam **entregas hoje** e **conversas atendidas**; entram **pessoas ativas hoje** e **conversas no time hoje** |
| estado da pessoa | **ponto colorido** no hexágono (no escritório / em reunião / ausente) e **status curto** embaixo do nome |

## Privacidade — a regra dura

**O feed é montado só de nomes, ids, horários, contagens e frases fixas.**
Nenhum campo do `/warroom/feed` é derivado de `conversations.content` ou de
`channel_messages.content`. A função que monta a resposta nem recebe essas
colunas: as consultas do router **não as selecionam**.

- `agentes[].tarefa` **sai do contrato.** O rótulo embaixo do agente passa a
  ser o estado ("conversando com Nicholson · 3 min" ou o papel).
- `eventos[].texto` sai de modelos fixos (seção Fluxo).
- **Título de documento** só aparece se for de briefing: casa
  `^(Operação|Faturamento|Vendedores|SDR|Serviços) · \d{2}/\d{2}$`. Qualquer
  outro vira "publicou um documento" — agente pode publicar documento com
  título sensível (a `nina` já publicou lista nominal de clientes perdidos).
- **Status:** pelos labels dos presets de `frontend/src/lib/user-status.ts`.
  `Em reunião` → `reuniao`, `Foco / DND` → `foco`, `Almoço` → `almoco`,
  `Ausente` → `ausente`. ⚠️ **`Doente` é dado de saúde e nunca aparece**:
  `Doente`, `Férias / Folga` e `Viajando` viram `ausente`. `Home office` e
  qualquer outro valor viram `null` — `custom_status` aceita texto livre de 200
  caracteres, e texto livre não vai para a TV.
- **Quem aparece:** só `@healthsafetytech.com`, e fora as contas cujo e-mail
  começa por `teste` (`teste.ceo@`). A consultora externa não é do time.
- Teste que tranca: o router roda com linhas falsas cujo `content` é uma frase
  sentinela, e `json.dumps(resposta)` **não pode conter** a sentinela.

## Dados — o contrato novo do `/warroom/feed`

```ts
interface Feed {
  ts: string; diasNoAr: number | null;
  setores: { nome: string; pessoas: string[] }[];   // ordem fixa; ids de pessoa
  pessoas: {
    id: string; nome: string;                       // nome curto, ver abaixo
    setor: string;
    noEscritorio: boolean;                          // presença do WA agora
    status: "reuniao" | "foco" | "almoco" | "ausente" | null;
  }[];
  agentes: {                                        // como hoje, MENOS `tarefa`
    id: string; nome: string; papel: string;
    estado: "ocioso" | "pensando" | "longo";
    desde: string | null; contexto: number | null;
    parceiroId: string | null;                      // id da pessoa (era o nome)
  }[];
  conversasTime: { a: string; b: string; ultima: string }[]; // DMs vivos (ids de pessoa)
  eventos: { ts: string; tipo: "entrega" | "agente" | "time"; texto: string }[];
  numeros: { entregas: number; atendidas: number; pessoasAtivas: number; conversasTime: number };
}
```

Saem do contrato: `agentes[].tarefa`, `filhos`, `parceiroAgente` (vazios desde
01/09 — `subagent_watch` não tem escritor), `parceiro` (nome → `parceiroId`),
`numeros.tokens`/`custo`/`cacheTaxa`.

- **Nome curto:** primeiro nome; se dois do time tiverem o mesmo, primeiro +
  último sobrenome para esses. Calculado no backend (`nome_curto`).
- **Setor:** `profiles.departamento` → setor por tabela fixa em
  `app/warroom.py`. Ordem: Diretoria, Comercial (`COMERCIAL-*` e `MARKETING`),
  Operação (`EXPEDIÇÃO`, `LABORATÓRIO`, `QUALIDADE`), Suporte (`SUPORTE
  TÉCNICO AO CLIENTE`), TI, Administrativo (`FINANCEIRO`, `RECURSOS HUMANOS`).
  Departamento fora da tabela → `Outros`, no fim. Setor vazio não é desenhado.
- **Presença:** o estado em memória de `app.escritorio.presenca` (o mesmo que
  `GET /escritorio/presenca` lê), por e-mail. Vigia desconectado → todos
  `false`, sem erro.
- **DM vivo:** canal `type = 'dm'` com exatamente dois membros humanos
  (`channel_members.user_id`) e mensagem nos últimos **10 minutos**. Some 10
  min depois da última mensagem.
- **Agente:** estado e `parceiroId` pela mesma régua de hoje
  (`estado_do_agente`: pergunta sem resposta, 8 min = longo, 2 h esquece), só
  trocando o nome pelo id.
- **Números do dia** (desde 00:00 de Recife):
  - `entregas`: documentos publicados hoje (como hoje);
  - `atendidas`: pares (pessoa, agente) com resposta do agente hoje;
  - `pessoasAtivas`: pessoas distintas que mandaram mensagem hoje, a agente
    ou em DM;
  - `conversasTime`: DMs com mensagem hoje.

## Fluxo — os modelos de frase

Do mais novo para o mais velho, 14 itens, só da janela de hoje:

| tipo | quando | texto |
|---|---|---|
| `entrega` | documento publicado | `Atlas publicou Serviços · 16/10` ou `Atlas publicou um documento` |
| `agente` | pessoa mandou mensagem a agente | `Nicholson conversou com Nina` |
| `time` | mensagem num DM | `Erick e Welton conversaram` |

Agrupamento: uma linha por (pessoa, agente) ou por DM a cada **janela de 10
min** — vinte mensagens seguidas são uma conversa, não vinte linhas. O horário
é o da última mensagem da janela. Nome do agente com inicial maiúscula
(`agent_profiles.name`).

## Layout — `frontend/src/lib/warroom-layout.ts` (função pura)

Entrada: `setores` (com as pessoas na ordem), `agentes`, tamanho do quadro.
Saída: posição de cada pessoa, cada agente, o núcleo e o rótulo de cada setor.

- Quadro fixo `1600 × 900` (16:9, a TV); o SVG escala.
- **Núcleo** no centro. **Agentes** num anel interno (elipse ~170 × 150),
  igualmente espaçados a partir do topo.
- **Pessoas** num anel externo (elipse ~640 × 340), na ordem dos setores, com
  **um vão do tamanho de uma pessoa entre setores**; rótulo do setor por fora
  do anel, no ângulo médio do grupo.
- Com mais pessoas do que cabem com folga, os raios do nó e da fonte diminuem
  — o layout devolve `escala`.
- Determinístico: mesma entrada, mesma saída (a parede não "dança").

Testes (Vitest), com 28 pessoas reais em 7 setores e com 40:
- dois nós quaisquer a ≥ 2× raio + folga;
- **rótulos de nome não se sobrepõem** (caixa aproximada por
  `largura ≈ 7 px × caracteres × escala`) — é o defeito da foto;
- tudo dentro do quadro, rótulos de setor inclusive;
- mesma entrada → mesma saída.

## Tela — `WarRoomPage.tsx`

Mantém a identidade (fundo escuro, hexágono ciano para gente, círculo para
agente, núcleo pulsando, curvas com partícula) e o `warroom.css`.

- **Cabeçalho:** marca, "AO VIVO", "time em repouso / N conversando", relógio,
  tema e tela cheia. **Sai o modo de arrastar/salvar arranjo** (botões mover,
  zoom, reorganizar, e o `warroom_layout` do `localStorage`): o layout
  automático é o produto, e um arranjo velho salvo na TV sobreporia o novo. A
  chave é apagada ao abrir.
- **Constelação (~75% da largura):** pessoas pelo layout; embaixo do nome, o
  status curto (`em reunião`, `foco`, `almoço`, `ausente`); ponto no canto do
  hexágono — âmbar = em reunião/foco, cinza = ausente/almoço, verde = no
  escritório sem status; **o status vence a presença** (em reunião dentro do
  escritório é âmbar); sem status e fora do escritório = sem ponto. Agente com o anel de contexto e,
  embaixo, `conversando com Nicholson · 3 min` quando ativo, senão o papel.
- **Linhas:** pessoa↔agente azul (como hoje); **pessoa↔pessoa ciano**, curva
  puxada para o centro, com partícula. Nó envolvido numa linha acende.
- **Fluxo (~25%):** os eventos do modelo acima.
- **Rodapé:** os quatro números.
- Polling de 15 s e o aviso "sem atualizar desde HH:MM" ficam como estão.
- `lib/warroom-feed.ts` (`normalizar`) acompanha o contrato novo e continua
  sendo a única fronteira: campo ausente vira vazio, nunca derruba a tela.

## O que não muda

Acesso (token `WARROOM_TOKEN` na URL ou sessão), rota fora do `AppLayout`, sem
migração de banco, polling em vez de `/ws` (a TV não tem JWT).

## Fora de escopo

Canal de grupo; agente↔agente (não há fonte); conteúdo de qualquer tipo; modo
voz; layout arrastável; satélites de sub-agente.

## Entrega

Backend e frontend sobem juntos (contrato novo; o `normalizar` aguenta o
descasamento enquanto um sobe antes do outro). Sem migração. Conferência em
produção: abrir `/warroom?t=…` e o JSON do feed, procurar qualquer frase de
conversa conhecida.
