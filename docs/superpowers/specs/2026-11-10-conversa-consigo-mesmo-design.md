# Conversa consigo mesmo — design (10/11/2026)

## Por quê

A Health & Safety saiu do Teams para o HS.OS. No Teams o pessoal usava o "chat
comigo mesmo" como bloco de notas: mandar mensagem para si, colar link, guardar
arquivo, e ter o histórico depois. No HS.OS isso não existe — DM é sempre entre
duas pessoas. O pedido veio do time, trazido pelo Erick.

**Sucesso:** cada pessoa abre o HS.OS e encontra, no topo das conversas, uma
conversa só dela, onde escreve, anexa e reencontra o que anotou — no
computador e no celular — sem ninguém mais ver.

## Decidido com o Erick

- **Fixa no topo** da lista de conversas, no desktop e no celular, para todo
  mundo, desde o primeiro acesso — sem botão de "criar".
- **Nome na tela: `<Nome da pessoa> (você)`**, como no Teams (ex.: "Erick
  Santos (você)"), com a própria foto. Segue o nome atual do perfil: renomear
  a pessoa renomeia a conversa.
- **O Guardi NÃO lê** essas anotações nesta entrega. Dar acesso é outra
  entrega, com ferramenta e regras próprias.

## Objetivos

- Mandar texto, Markdown, anexo, imagem e áudio, como numa DM.
- Editar, apagar, reagir, copiar, "Responder" (citação) e buscar — o que a DM
  já tem e faz sentido sozinho.
- Histórico permanente, igual a qualquer canal.
- Só a dona/o dono lê. Nem administrador, pela aplicação.

## Fora do escopo

- Guardi/agentes lendo ou escrevendo nas anotações.
- Revisar o acesso dos outros conectores de banco (só o `HsOs` aponta para o
  banco do próprio HS.OS).
- Pastas, etiquetas, fixar mensagem, lembrete a partir de anotação.
- Mais de uma conversa pessoal por pessoa.

## Anti-objetivos (falharia mesmo "funcionando")

- **Outra pessoa conseguir ler** — por API, busca global, prévia, War Room,
  push ou contagem. É a regra que não pode falhar.
- **Aparecer como canal de grupo** (`#Anotações` na lista de canais) ou como DM
  sem interlocutor ("Conversa", sem nome).
- **Notificar alguém** — som, push, sininho, "não lida" — por uma anotação.
- **Duas conversas pessoais** para a mesma pessoa (dois cliques simultâneos no
  primeiro acesso).
- Mostrar coisas sem sentido sozinho: ✓✓ de visto, "fulano está digitando",
  painel de membros com "adicionar pessoa".

## Restrições (do repositório)

- Postgres próprio; mudança de schema vai em migração nova (`033_…`), aplicada
  por script admin (`~/aplicar-hsos-NNN.py`, ver `CLAUDE.md`) que **confere o
  efeito** contra o banco. Deploy não aplica schema.
- Leitura de canal é por RLS (`is_channel_member`); toda rota roda como
  `authenticated` com o usuário da sessão. Nada de atalho para administrador.
- O `find_or_create_dm(target, nome)` atual **não serve** para alvo = eu: a
  busca casa `cm1` e `cm2` na MESMA linha e devolveria qualquer DM minha. A
  rota de DM (`POST` em `conversations.py:~2045`) deve **recusar** alvo igual a
  quem chama, com teste — hoje a tela não oferece, mas a API aceita.
- Testes: backend com pytest puro (padrão do repo, docstring dizendo o que o
  defeito custaria); frontend com Vitest nos módulos puros.
- Changelog obrigatório (`frontend/src/data/changelog.ts`, no topo).

## Como (decisões minhas — o Erick pode revisar)

1. **Tipo próprio de canal, não DM com flag.** Novo valor `pessoal` no enum
   `channel_type`. Motivo: o sistema inteiro assume que `dm` tem duas pessoas
   (interlocutores, War Room, `forceNotifyAll`, guardas de membros) e cada um
   desses lugares viraria uma exceção esquecível. Com tipo próprio, o que filtra
   por `dm` ou por `public/private` simplesmente não o vê; o trabalho é fazê-lo
   aparecer onde deve, não escondê-lo de onde não deve.
   - ⚠️ `ALTER TYPE … ADD VALUE` não pode ser usado na mesma transação que o
     cria: a migração cria o valor e o índice; quem usa é a rota.
   - Índice único parcial: **uma por pessoa** — `UNIQUE (created_by) WHERE
     type = 'pessoal'`.
   - `POST /channels` (criar canal) continua recusando `pessoal` (`_TIPOS`).
2. **Nasce sob demanda, por rota idempotente:** `GET /channels/pessoal` acha
   ou cria a conversa de quem chama (canal `pessoal` + a pessoa como única
   membro humana) e devolve o canal. Corrida resolvida pelo índice único
   (`ON CONFLICT` / reler). A tela chama ao carregar a lista; para a pessoa,
   "existe desde sempre". A criação passa pela policy `Only admins create
   channels` — o builder decide entre função `SECURITY DEFINER` estreita (só
   cria `pessoal` para `auth.uid()`) ou policy específica; não abrir a criação
   de canal em geral.
3. **Nome:** o banco guarda `name = 'Anotações'` (fixo, nunca exibido como
   `#Anotações`); a tela monta "`<full_name> (você)`".
4. **Na tela da conversa** (desktop `ChannelChat`, celular
   `TelaConversaCanal`): sem vistos, sem "digitando", sem painel de membros /
   adicionar / sair / apagar canal, sem o selo de canal de avisos. Placeholder
   do campo: algo como "Anote algo para você…". Ficam: anexos, áudio, editar,
   apagar, apagar-para-mim (ou retirar — redundante aqui, decisão do builder),
   reagir, copiar, Responder, busca.
5. **Lista:** desktop (`ChatPage`) e celular (`TelaInicio` / `use-lista.ts` /
   `AppCelular`) mostram a conversa pessoal **fixa no topo**, antes de DMs e
   canais, com a foto da pessoa, a prévia da última anotação
   (`GET /channels/previas`) e sem contador de não lidas.
6. **Fora de tudo que mede ou mostra conversa entre pessoas:** War Room
   (`routers/warroom.py`), uso/coletor (`coletor_uso.py`, `routers/uso.py`),
   relatórios por DM (`routers/agents.py:~2601`), push
   (`push_regras.py` — não há destinatário, mas confirmar que não quebra com o
   tipo novo), recibos (`trg_criar_recibos` — sem destinatário, nada a criar;
   confirmar). O builder faz um `grep` por `'dm'` e `type` em `app/` e
   `migrations/` e confere cada consulta.
7. **Conta desativada:** a rotina que tira gente de canal ao desativar
   (30/10/2026) não precisa tratar a pessoal; se ela remover a membresia, a
   conversa fica órfã e invisível — aceitável (ninguém mais lê).

## Corte de acesso da `nina` ao banco (decidido com o Erick, 10/11)

Achado na revisão da spec: a RLS não é a única porta. O conector **`HsOs`**
(o `banco-hsos` da `nina`) entra com o usuário **`leitura`**, que tem
`BYPASSRLS` e `pg_read_all_data` — o mesmo do `~/.config/bancos/leitura.toml`
do Erick. Com ele a `nina` lê **toda DM entre pessoas** hoje, leria as
anotações e lê também `integrations.credentials` (as senhas dos conectores) e
as `email_*`. Basta alguém pedir, ou uma injeção. A decisão do Erick foi
**cortar nesta entrega**, protegendo DMs e anotações juntas.

- **Não mexer no `leitura`**: é o usuário do Erick (e do Claude nesta máquina)
  para consulta e diagnóstico. Revogar nele cortaria o dono.
- **Usuário novo para o conector da `nina`** (ex.: `hsos_agente`),
  `NOBYPASSRLS`, **sem** `pg_read_all_data`, com `SELECT` **por tabela, em
  lista fechada** (allowlist) e `default_transaction_read_only = on`. Fora da
  lista, no mínimo: `channel_messages`, `channel_members`, `channels`,
  `integrations`, `email_*`, `recibos_mensagem`, `anexos`, `push_*`,
  `acoes_pendentes`, `lembretes`. Tabela nova nasce fora da lista — é o ponto
  de usar allowlist em vez de revogar o que é sensível.
- **A lista sai do uso real, não de palpite**: primeira tarefa do plano é
  levantar o que a `nina` consulta pelo `banco-hsos` — `AGENTS.md`/`TOOLS.md`
  dela (leitura pelo gateway, permitida), skills publicadas e os traces das
  sessões (`~/.openclaw/agents/nina/sessions/*.jsonl`, chamadas a
  `banco-hsos__query`). Se aparecer uso legítimo de tabela sensível (ex.: a
  `nina` resumindo um canal), **parar e trazer ao Erick** em vez de liberar.
- Trocar a credencial do conector `HsOs` para o usuário novo (pela tela de
  Conectores ou rota de integração; a senha é gerada no script admin e não
  passa pelo transcript) e **conferir perguntando à `nina`** — uma consulta a
  `channel_messages` tem que falhar com permissão negada, e uma consulta da
  lista tem que funcionar. Reler a config não prova nada (ver `CLAUDE.md`).
- **API de broadcast** (`routers/broadcast.py`, `service_role`, acha canal por
  `name ILIKE`): leitura e escrita recusam canal `pessoal`, com teste.
- **Administrador não apaga nem renomeia a conversa pessoal de outra pessoa**:
  as policies de `UPDATE`/`DELETE` em `channels` hoje deixam; a migração
  restringe para `pessoal` (só `created_by`).

## Conferência

- pytest: rota pessoal idempotente (duas chamadas → mesmo id), recusa de DM
  consigo mesmo, `POST /channels` com `type: pessoal` recusado, regras puras
  que o builder extrair.
- Vitest: posição fixa no topo e o nome "(você)" nos módulos puros de lista.
- Contra o banco de produção, depois da migração: o enum existe, uma consulta
  como **outro usuário** (`SET LOCAL app.current_user_id`) não vê a conversa
  pessoal de ninguém, e o usuário novo da `nina` **não lê** `channel_messages`
  nem `integrations` (permissão negada).
- Perguntando à `nina`: ler mensagens de canal falha; o uso levantado segue
  funcionando.
- No navegador: a conversa aparece no topo, mandar texto e anexo funciona, nada
  de ✓✓ nem "digitando", e nenhuma notificação chega a outra pessoa.

## Deixado para o builder

Nomes de funções e componentes, ícone, texto exato do placeholder, se o
"Apagar para mim" fica, a forma da criação (função `SECURITY DEFINER` vs
policy), e a ordem das tarefas no plano.
