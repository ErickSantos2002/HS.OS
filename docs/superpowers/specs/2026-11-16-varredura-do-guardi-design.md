# Varredura do Guardi e o quadro da equipe para a Nina — desenho

16/11/2026 · pedido do Nicholson, conversado com o Erick.

## Por que

O Nicholson quer Guardis **provocadores, não só consultores** (conversa de
11/11/2026): o Guardi traz "o cardápio pronto" — o que está atrasado, o que
vence, o que falta — antes de a pessoa perguntar, para **não deixar nada no
esquecimento e poder medir as metas**. A IA não decide nem executa sozinha:
toda escrita continua virando cartão que a pessoa confirma.

Por cima disso, a `nina` age como gerente: junta o que cada Guardi levantou e
entrega ao Nicholson um quadro da empresa. A imagem que ele trouxe é a da dn.ia,
com os agentes conversando entre si.

## Objetivos

- Todo Guardi (os 23, todos de uma vez) faz uma **varredura da manhã** em dias
  úteis e escreve à própria pessoa o que ela tem pendente.
- Uma **conferência da tarde** que só fala se apareceu algo novo desde a manhã.
- A varredura fica **gravada** (resumo + números por sistema), e a `nina` lê as
  do dia numa ferramenta só dela.
- A `nina` pode **pedir a um Guardi que refaça** a varredura (pessoa específica,
  resumo velho ou incompleto).
- O que acontece aparece na war-room/Fluxo: "Lara-Guardi entregou o resumo à
  Nina", "Nina pediu um resumo a Lara-Guardi".
- Uma chave que desliga tudo com um comando.

## Não-objetivos

- O Guardi **executar** qualquer coisa sozinho. A varredura só lê e, no máximo,
  oferece preparar um cartão.
- Liberar `sessions_send`/`agentToAgent` para os Guardis. A "conversa" entre
  Nina e Guardi passa pelo disparador, não pelo gateway.
- "E-mail sem resposta" (exige consulta nova ao Graph por conversa). Na v1 o
  e-mail entra como **não lidos recentes**.
- Cobrança automática de cliente (o "Guard cobrador"): é um passo seguinte, que
  pode usar a varredura como ponto de partida.

## Anti-objetivos (falha mesmo funcionando)

- Guardi que fala toda hora e vira notificação ignorada. A tarde **cala** quando
  não há nada novo.
- Varredura escondida da pessoa. Tudo que a Nina pede sobre alguém aparece na
  conversa daquela pessoa.
- Número inventado. Contagem vem de ferramenta, nunca da cabeça do modelo; se um
  sistema falhou, o resumo diz que falhou, não "0 pendências".
- Um caminho paralelo de trabalho autônomo. Tudo passa por `disparar_turno`
  (regra do CLAUDE.md: o disparador é a porta única).

## Restrições conhecidas

- O guarda do `hsos-bot-<bot>` (`_contexto`, `mcp_bot.py:591`) exige turno do
  dono aberto. Um turno disparado por `disparar_turno` é do dono, então as
  ferramentas funcionam — é por isso que o desenho é viável sem afrouxar nada.
- `disparar_turno` grava o `agent_runs` **depois** do `chat.send`; uma
  ferramenta chamada muito depressa pode ser recusada (corrida já existente nos
  lembretes).
- O fluxo do lembrete grava o recado + AVISO (Adiar/Feito, re-aviso) sempre; a
  varredura **não** pode passar por ali — é outro tipo de disparo.
- `TETO_TURNOS_DIA = 12` conta só `hsos-lembrete-%`; a varredura tem teto
  próprio e não come vaga dos lembretes.
- A `nina` só fala com o Nicholson (`access_type = specific_users`). O
  `AGENTS.md` dela está a ~500 caracteres do teto de 20.000: entra só um
  ponteiro curto; a regra mora na `description` das ferramentas.
- Hoje: 23 Guardis ativos, todos com TaskHS, GestorHS e e-mail ligados (21
  contas de e-mail conectadas); 9 com HSGrowth.
- Saída do modelo cortada em 8.192 tokens: a lista da equipe nunca é escrita
  pela Nina item a item; a ferramenta devolve já resumido.

## Abordagens consideradas

- **A. Varredura gravada, Nina lê.** Barata e previsível; a conversa entre
  agentes só "parece".
- **B. Nina conversa com cada Guardi por `sessions_send`.** Exige abrir a
  conversa entre agentes para os 23 (negada de propósito), 23 turnos de modelo
  em série, caminho em que respostas longas já se perderam, e o Guardi nem tem a
  varredura nessa sessão.
- **C. A + a Nina pode pedir de novo** (pelo disparador, em nome do dono, visível
  à pessoa). **Escolhida pelo Erick** (16/11/2026): a confiabilidade da A no dia
  a dia, e a conversa entre agentes no único ponto em que ela acrescenta algo.

## O desenho

### Dados — migração `037_varreduras.sql`

Tabela `varreduras`, uma linha por disparo:

| coluna | |
|---|---|
| `id` uuid | |
| `user_id`, `agent_id` | dono e Guardi |
| `dia` date | dia em São Paulo |
| `tipo` | `manha` · `tarde` · `pedida` · `quadro` (o turno da Nina para o Nicholson) |
| `pedida_por` | `agenda` · `nina` |
| `status` | `agendada` · `rodando` · `entregue` · `nada_novo` · `sem_registro` · `pulada` · `erro` |
| `run_id` | o `hsos-varredura-<uuid>` do turno |
| `resumo` text ≤ 4.000 | o texto que o Guardi registrou |
| `numeros` jsonb | por sistema: `{taskhs: {atrasadas, vencendo_7d, abertas}, hsgrowth: {...}, gestorhs: {...}, email: {nao_lidos_3d}}` + `falhas: [sistema]` |
| `proximo_em`, `disparando_em`, `turno_pendente_desde` | mesma mecânica de posse e adiamento dos lembretes |
| `criado_em`, `entregue_em` | |

**Detalhe — decisão do Erick (16/11/2026): tudo, inclusive e-mail.** O resumo
traz itens com nome e cliente (tarefa, card, OS) e, do e-mail, **assunto e
remetente** dos não lidos (nunca o corpo). Consequência: ⚠️ o usuário de
leitura da empresa enxerga toda tabela nova (`pg_read_all_data`, o mesmo motivo
de a `email_pendentes` não guardar assunto), então **`resumo` é gravado cifrado**
(Fernet, `EMAIL_CHAVE_CIFRA`, como o refresh token em `email_contas`) e só o
backend o abre. `numeros` fica em claro. *(A cifra é decisão do Claude.)*

Índice único `(user_id, dia, tipo)` para `manha`/`tarde` (os dois workers não
duplicam). `pedida` não entra no índice. RLS ligada sem policy, como
`lembretes` (só o backend lê). A allowlist do `hsos_agente` (033) **não** a
inclui: a Nina lê pela ferramenta, não pelo banco.

### Agendamento — dentro do disparador existente

- Uma segunda etapa em `passada` (`disparador_lembretes.py`): **semear** as
  linhas do dia (`manha` 07:30, `tarde` 13:30, dias úteis, Guardis de dono
  ativo) e **reservar** as vencidas com o mesmo lease `disparando_em`.
- Horários e a chave liga/desliga em `app_settings` (`varredura`):
  `{ligada, manha: "07:30", tarde: "13:30"}`. Desligada = não semeia nem
  dispara; o que já está rodando termina.
- Regras puras em `app/varredura/regras.py`, testadas: o que semear, quando
  está velha (manhã não rodada até 12:00 → `pulada`; tarde até 17:00), teto de
  **2 pedidas por pessoa por dia** e intervalo mínimo de 30 min entre pedidas.
- Run aberto da pessoa com o Guardi: adia em passos de 2 min até 30 min, depois
  `pulada` — igual ao lembrete.
- Disparo por `disparar_turno(agent, dono, mensagem, prefixo="hsos-varredura-")`.
  Sem recado, sem AVISO, sem push próprio: quem fala com a pessoa é a resposta
  do Guardi, que o coletor grava e o trigger de push já leva.
- **Pedida pela Nina:** antes do turno, grava na conversa da pessoa uma linha
  `role='agent'` com `media [{type: "varredura_pedida"}]`: "🔎 A Nina pediu um
  resumo das suas pendências." É a transparência do desenho. Essa linha **não
  gera push** (o tipo `varredura_pedida` sai em `push_regras.py`); quem notifica
  é a resposta do Guardi. *(Decisão do Claude.)*
- **Dias úteis** = segunda a sexta menos os feriados nacionais (fixos + móveis
  pela Páscoa), função pura em `app/varredura/regras.py`. Feriado local não
  entra na v1; nesse dia, desliga-se a chave. *(Decisão do Claude.)*

### O turno do Guardi

Mensagem (sanitizada como `_mensagem` do lembrete):
`[Varredura da manhã — <PrimeiroNome>] …` com a instrução de:

1. consultar os sistemas **ligados**: `taskhs_minhas`; `hsgrowth_consultar`
   (`minhas_tarefas`, `tarefas_atrasadas`, `meus_cards`) se ligado;
   `gestorhs_consultar` nas consultas da função da pessoa; `email_listar
   so_nao_lidos` dos últimos 3 dias úteis se `email_ligado`;
2. chamar **`varredura_registrar`** com resumo e números;
3. escrever à pessoa o cardápio do dia, curto, com no máximo uma oferta de
   preparar algo (que vira cartão como sempre).

Tarde: as mesmas consultas. **Quem decide "nada novo" é o servidor, não o
modelo** *(decisão do Claude)*: `varredura_registrar` compara os `numeros` com
os da manhã e devolve `{novidade: bool, o_que_mudou: [...]}`. Novidade = alguma
contagem subiu ou um sistema que falhou de manhã agora respondeu. Sem novidade,
grava `nada_novo` e a resposta da ferramenta manda o Guardi responder
`NO_REPLY`; o coletor, para runs `hsos-varredura-` com texto vazio ou
`NO_REPLY`, encerra o run sem gravar mensagem (hoje gravaria "terminou sem
produzir texto"). Sem manhã registrada, a tarde vale como manhã.

**Mesma sessão da pessoa, de propósito** *(decisão do Claude)*: o turno usa a
`agent:<bot>:hsos-<dono>` como os lembretes, para a pessoa responder "prepara
aquilo" e o Guardi ter o contexto. O risco das duas respostas coladas, já
catalogado nos lembretes, vale aqui; o adiamento por run aberto o reduz.

Bloco novo no `AGENTS.md` do template (`app/bots_pessoais.py`), ~1.000
caracteres (o arquivo está em ~6.100 de 20.000), levado com
`criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`.

### Ferramenta do Guardi — `varredura_registrar`

No `hsos-bot-<bot>` (entra em `FERRAMENTAS_BOT` + `publicar-bots-mcp.py
--aplicar`). Só aceita com uma varredura `rodando` daquele Guardi cujo `run_id`
é o turno aberto do dono; fora disso recusa ("não há varredura em curso"). Grava
`resumo`, `numeros`, `status` e `entregue_em`. Os números são validados
(inteiros ≥ 0, sistemas conhecidos). Varredura que termina sem registro vira
`sem_registro` quando o coletor fecha o run.

### Ferramentas da Nina — no `hsos-anexos-nina`

O único servidor com identidade de agente **assinada**; entram em
`_FERRAMENTAS_RESTRITAS` só para `nina`, e `publicar-anexos-mcp.py` leva o
`toolFilter`.

- **`pendencias_da_equipe(dia?, pessoa?)`** → por pessoa: nome, cargo, hora,
  status, números e resumo (cortado em ~600 caracteres cada); no topo, totais e
  quem **não** tem varredura do dia (e por quê). Teto de 12 mil caracteres no
  retorno; pedido de uma pessoa traz o resumo inteiro. A regra "não invente
  número; quem falhou, diga que falhou" mora na `description`.
- **`pedir_varredura(pessoa)`** → cria a `pedida`, devolve na hora
  ("pedido feito, fica pronto em ~2 min") e respeita o teto. A Nina consulta de
  novo com `pendencias_da_equipe(pessoa=…)`.

Ponteiro no `AGENTS.md` da `nina` (uma linha, medida antes de gravar):
"pendências de alguém ou da equipe → `pendencias_da_equipe`".

### O quadro das 08:30 — na conversa do Nicholson com a Nina, não na Base

⚠️ **Não vai para a Base de Conhecimento:** `wiki_documents` é legível (e
editável) por todo usuário logado (`"Auth read docs" USING (true)`), e os 23
têm login. *(Decisão do Claude, apontada pelo revisor.)*

Em dias úteis às 08:30, o próprio disparador manda um turno à `nina` **na
sessão do Nicholson com ela** (`disparar_turno("nina", <Nicholson>, …,
prefixo="hsos-varredura-")` — o destinatário vem de `agent_profiles.allowed_user_ids`
da `nina`, não fixo no código). A instrução manda chamar `pendencias_da_equipe`
e escrever o quadro. A resposta cai no chat dele com push, e ele continua a
conversa dali ("e a Lara?"). Sem cron no gateway e sem `guardiao_briefings`: a
linha em `varreduras` com `tipo = quadro` (user = Nicholson, agent = `nina`) é
a posse e o registro; `entregue` quando o coletor grava a resposta.

### War-room / Fluxo

Nova fonte em `montar_eventos` (`app/warroom.py`): `varreduras` do dia —
"<Guardi> entregou o resumo à Nina" (`entregue`/`nada_novo`) e "Nina pediu um
resumo a <Guardi>" (`pedida`). Texto fixo como os demais.

### Ordem de produção

Migração 037 (script `~/aplicar-hsos-037.py`, conferindo a tabela) → deploy →
`publicar-bots-mcp.py --aplicar` → `publicar-anexos-mcp.py` → `criar-bots-
pessoais.py --reescrever-agents-md --aplicar --todos` → ponteiro na `nina` →
**ensaio**: script `backend/scripts/varredura-agora.py --so <user_id>` dispara
uma no `erick-bot` e mostra o registrado → ligar a chave para todos (o quadro
das 08:30 vem junto). Entrada no changelog (novidade, minor).

## Deixado ao construtor

- Nome exato das consultas do GestorHS por função (lendo
  `gestorhs_consultas.py` e o `/agente/capacidades` de cada pessoa).
- Corrida `agent_runs` × primeira ferramenta: gravar o run antes do `chat.send`
  para runs `hsos-varredura-` (apagando se o envio falhar) ou repetir a guarda
  uma vez — escolher e testar.
- Formato exato do texto ao Guardi e do bloco no `AGENTS.md`.
- Testes: regras puras (semear, velha, tetos), validação de `numeros`, recusa
  fora de varredura, a ferramenta da Nina com conexão falsa, o coletor calado no
  `nada_novo`, o evento da war-room.
