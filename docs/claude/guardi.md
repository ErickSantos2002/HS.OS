# Guardi — bots pessoais, e-mail, sistemas internos, agenda e varredura

> Saiu do `CLAUDE.md` em 23/11/2026 (o arquivo passou do teto de 150 mil caracteres
> de instruções do Claude Code). Texto movido sem edição. Leia antes de mexer na área.

### Bots pessoais — um agente por pessoa (05/11/2026)

Decisão do Erick com o Nicholson: em vez de liberar os cinco especialistas aos
poucos, **cada colaborador ganha um agente**, `<primeironome>-bot` (23 hoje),
que no piloto vai também AGIR (e-mail, CRM, Task). Os especialistas continuam
só do Nicholson — exceção: a Lidisay segue falando com o `bruce`. Spec e plano:
`docs/superpowers/{specs,plans}/2026-11-05-bots-pessoais-cascas*`.

- ⚠️ **`agent_profiles.dono_id IS NOT NULL` é a definição de bot pessoal**
  (`027`, FK `ON DELETE RESTRICT` — com `SET NULL` o órfão viraria
  especialista). Nunca o sufixo `-bot`.
- **Não é o `POST /agents`.** Aquele põe no `agentToAgent`, no roster da `nina`
  (que vive no teto) e pede os sete arquivos à orquestradora. Bot nasce por
  `app/routers/bots_pessoais.py` (`criar_bot`, idempotente, adota o que ficou
  pela metade) via `backend/scripts/criar-bots-pessoais.py` (ensaio por
  padrão; `--aplicar --so <user_id>` / `--todos`; o Nicholson fica fora por
  `FORA_POR_DECISAO`, que a rota também confere). Os sete arquivos são template do backend (`app/bots_pessoais.py`).
  ⚠️ **Depois de criar bot novo, rode `publicar-bots-mcp.py --aplicar`** para ligar agenda,
  memória e anexos a ele: sem isso nasce sem `hsos-bot` (logo sem `agenda_*`) com o
  `AGENTS.md` já prometendo `agenda_criar`. O script de criação avisa no fim.
- ⚠️ **Ferramentas: `profile: "minimal"` + `alsoAllow: [alerta, "bundle-mcp"]`
  + deny de todo MCP menos o alerta + `gateway`, `sessions_*`, `skill_workshop`,
  `cron`.** O perfil `coding` daria shell no host, ao lado do `openclaw.json`.
  Sem `bundle-mcp` o `minimal` esconde o alerta (o bot via só
  `session_status`). Com ele, o bot vê o MCP que o deny não nomeia — por isso
  `tools_do_bot` recusa servidor sem `toolFilter.include`. ⚠️ **Servidor MCP
  novo sem filtro aparece para os bots** até alguém recalcular.
- ⚠️ **`gateway` precisa estar em `_DENY_PRESERVADO`** (`integracoes.py`): o
  recálculo de deny de toda publicação de banco apaga o que não conhece.
- O bot de uma pessoa é o que tem `dono_id` nela — mudar o primeiro nome não
  cria outro. Rodar o script de novo só desfaz o que a própria chamada criou.
- Conferência: **perguntar ao bot** que ferramentas ele tem. Esperado:
  `session_status` e `avisar_administrador`, e nada mais.
- Fora de canal (o backend recusa com 400), do roster, do `publicar-anexos-mcp`
  (pula `profile: "minimal"`), do mapa da frota e dos times. No chat do admin,
  bloco recolhido. Na war-room, **selo no canto superior esquerdo do nó do
  dono**, aceso só por conversa do PRÓPRIO dono — o SQL do feed descarta
  conversa de admin com bot alheio (estado, Fluxo e números).

### E-mail dos bots pessoais — piloto no `erick-bot` (05/11/2026)

Spec e plano: `docs/superpowers/{specs,plans}/2026-11-05-bot-email-piloto*`. O
`erick-bot` é o laboratório: mudança vai nele primeiro (`--so`), os outros
22 só quando o Erick disser.

- **OAuth no app do LOGIN** (Entra "HS.OS"), mas os escopos de e-mail
  (`Mail.ReadWrite[.Shared]`, `Mail.Send[.Shared]`, `offline_access`) são
  pedidos SÓ no "Conectar e-mail" (`app/email/graph.py`). ⚠️ O `ESCOPOS` do
  login não muda — teste tranca.
- Refresh token **cifrado** (Fernet, `EMAIL_CHAVE_CIFRA`, a MESMA no `.env` e
  no EasyPanel) em `email_contas`. ⚠️ O usuário de leitura da empresa enxerga
  as tabelas `email_*` (privilégio padrão): por isso o state da OAuth é hash e
  a `email_pendentes` não guarda assunto nem corpo.
- ⚠️ O callback só grava a conta Microsoft com o **mesmo e-mail** do usuário
  (CSRF de vínculo: A gera o link, B autoriza).
- Servidor `hsos-email-<bot>` (`routers/mcp_email.py`): HMAC `"email:"+id` com o
  `ANEXOS_MCP_SEGREDO`; **só no turno do dono** e **recusa se outra pessoa
  tiver turno aberto com o bot** (o gateway não diz de que sessão veio a
  chamada). Para terceiros só **prepara**: rascunho no Outlook + cartão
  ⚠️ **Desde o PK-11 (26/11/2026) o gateway DIZ:** o plugin `hsos-cracha`
  carimba `hsos-email-*`/`hsos-bot-*` com a sessão de origem, assinada
  (`app/cracha.py`). Crachá de pessoa decide sem a dedução; sem crachá (ou
  sessão de varredura/cron) vale a dedução de antes. Carimbar outra família
  `hsos-*` exige que a rota dela tire o `_cracha` dos argumentos.
  (`conversations.media[{type:"email_aprovacao"}]`); sai pelo clique, que
  confere o hash do rascunho relido (cobre Cco, Responder-para e anexo).
- Flag `agent_profiles.email_ligado` (admin). `tools_do_bot(..., email=True)`
  dá ao bot só a PRÓPRIA entrada. Publicar: `backend/scripts/publicar-bots-mcp.py` (e-mail e sistemas)
  — ⚠️ um patch que declara as entradas e recalcula o deny de TODOS (perfil
  `coding` enxergaria `hsos-email-*`). Só depois do deploy: a URL é a de produção.
- Caixas compartilhadas não se descobrem pelo Graph: `PUT /email/caixas/{user}`
  (admin) com leitura de teste. Enviar pela compartilhada exige "Enviar como"
  no Exchange — o do Erick funciona.
- ⚠️ **Bot novo respondia `NO_REPLY`** (token de silêncio do OpenClaw) a
  "teste": o chat dizia "terminou sem produzir texto". O `AGENTS.md` do
  template manda sempre responder; levar a bot vivo:
  `criar-bots-pessoais.py --reescrever-agents-md --aplicar --so <user_id>`.
  Diagnóstico: o trace `~/.openclaw/agents/<id>/sessions/*.jsonl`
  (`model.completed` → `assistantTexts`).
- ⚠️ **Backend local fala com o banco de PRODUÇÃO.** Para testar sem rodar
  vigia/coletores contra ele: `COLETOR_USO_SEGUNDOS=0 VIGIA_SESSOES_SEGUNDOS=0
  COLETOR_METRICAS_SEGUNDOS=0 COLETOR_RESPOSTAS_SEGUNDOS=0
  DISPARADOR_LEMBRETES_SEGUNDOS=0 FRONTEND_URL=http://localhost:8080`. O `MS_EMAIL_REDIRECT_URI` local aponta
  para o localhost (registrado no Entra).
- **Assinatura** (`030`, `app/email/assinatura.py`): modelo do HSGrowth —
  texto antes, até 2 imagens (GIF animado incluso, ≤ 2 MB cada, ≤ 3 MB
  no total: o Graph recusa requisição > 4 MB) e texto depois (LGPD). ⚠️ Desde
  06/11/2026 os dois textos têm **padrão da empresa** (`TEXTO_ANTES`/`TEXTO_DEPOIS`):
  vazio ou nunca salvo vale o padrão, e o Perfil já mostra preenchido. Continuam
  editáveis (pedido da Qualidade) — a pessoa esquecia de preencher ou de salvar. O
  `email_preparar` monta HTML com o corpo ESCAPADO e as imagens **embutidas**
  (`cid:`) — link externo não anima e o Outlook de quem recebe bloqueia. Uma
  por pessoa, nas duas caixas. O `enviar_para_mim` segue sem assinatura.
- Modelo segue DeepSeek por decisão do Erick (risco LGPD aceito no piloto;
  reavaliar antes de abrir para outras pessoas).

### Bot pessoal nos sistemas internos — token de agente (05/11/2026)

Spec e plano: `docs/superpowers/specs/2026-11-05-bot-sistemas-internos-design.md`,
`docs/superpowers/plans/2026-11-05-bot-taskhs.md`. Nesta fase: **TaskHS**
(GestorHS em seguida; DataCore, HelpHS e ChamadosHS depois, ver a spec).

- **Token de agente** (`app/agente_token.py`): JWT **EdDSA** de 5 minutos,
  `{iss: hsos, aud: <sistema>, sub: <e-mail do DONO>, act: {sub: <bot>}}`,
  assinado com `AGENTE_CHAVE_PRIVADA`. O sistema confere com a pública
  (`GET /agente/chave-publica`, env `HSOS_AGENTE_CHAVE_PUBLICA` lá) e aplica as
  permissões que JÁ tem. ⚠️ A chave privada está também no `.env` local, por
  decisão do Erick: ela abre os sistemas como qualquer colaborador. ⚠️ O
  TaskHS recusa `exp` a mais de 600 s e compara o e-mail exatamente.
- **Servidor `hsos-bot-<bot>`** (`routers/mcp_bot.py`): `lembrar`, `agenda_*` (todo Guardi) e `taskhs_*` (só com
  `sistemas_ligados`).
  Mesmas guardas do e-mail (turno do dono, turno de outra pessoa). Leitura
  direta; **escrita vira `acoes_pendentes` + cartão** (`acao_aprovacao`), e a
  confirmação executa o `payload` GRAVADO (`routers/acoes.py`), fora do
  rollback em caso de erro.
- **Membros da tarefa** (`taskhs_membros`, 09/11/2026): pôr/tirar gente de um
  card, via cartão. Valida antes do cartão: a lista é do `board_id` dado, quem
  entra é membro do quadro, quem sai está no card. Membro de **quadro** o
  TaskHS barra para token de agente (`bloquear_token_de_agente`), de propósito.
- **`lembrar`** grava uma linha no `MEMORY.md` (teto de 6.000 caracteres),
  sem confirmação. A pessoa vê e apaga em Configurações → Perfil → "Memória
  do bot". ⚠️ O `MEMORY.md` entra em toda sessão, inclusive a do admin com o
  bot de outra pessoa, e pode ser plantado por injeção: riscos aceitos pelo
  Erick.
- Flag `agent_profiles.sistemas_ligados` (`029`). A publicação é feita pelo
  `backend/scripts/publicar-bots-mcp.py` (e-mail e sistemas num patch só;
  `--ligar-sistema <bot> taskhs`).
- **Todo agente conhece o time** (`app/time_da_empresa.py`): bloco
  `hsos:time` GERADO do cadastro (pessoas com cargo, setor e e-mail;
  especialistas; bots com nome e dono) no **`USER.md`** de cada agente — o
  `AGENTS.md` da `nina` vive no teto. Diz que conhecer não é acessar (o bot
  inventava "consigo ver na tabela de perfis"). Atualizar:
  `scripts/atualizar-time.py --todos-com-bloco --aplicar` (gente nova); sozinho
  quando alguém renomeia o bot.
- **"Meu bot"** (Perfil, `routers/meu_bot.py`): a pessoa muda só o PREFIXO do nome de
  exibição e a foto — o SUFIXO é da empresa (`SUFIXO_EXIBICAO`, **"-Guardi"**
  desde 09/11/2026, de Guardiões — nome que o RH deu aos colaboradores; na tela
  e nos arquivos do agente o "bot pessoal" virou "Guardi"). Trocar para todos:
  `criar-bots-pessoais.py --trocar-sufixo=-Guardi --aplicar` + mudar a constante e
  deploy. O `agent_id` não muda (é a chave da sessão). Renomear
  regrava `IDENTITY.md`/`SOUL.md` e o bloco do time. ⚠️ Pendência antiga: o
  bucket `agent-files` aceita escrita de qualquer autenticado em qualquer
  caminho, inclusive `avatars/` de outro agente.
- **DataCore (10/11/2026):** `datacore_consultas` / `datacore_consultar` no
  `hsos-bot-<bot>` (com `datacore` em `sistemas_ligados`; ligar todos:
  `publicar-bots-mcp.py --ligar-datacore-todos`). Decisão do Erick: o Guardi vê
  o que o login do DONO vê lá — o DataCore aplica o papel. ⚠️ O agente escolhe
  uma **consulta do catálogo** (`app/datacore_consultas.py`), nunca um
  caminho; filtros só como query; retorno com teto de 12 mil caracteres. Rota
  nova do DataCore só chega ao Guardi entrando no catálogo **e** no allowlist
  de agente de lá. Os filtros saem do `/openapi.json` público do DataCore.
- **DocsHS (11/11/2026):** `docshs_consultas` / `docshs_consultar` no
  `hsos-bot-<bot>` (com `docshs` em `sistemas_ligados`), só leitura, como o
  DONO — o DocsHS aplica cargo, setor e classificação. Spec
  `docs/superpowers/specs/2026-11-11-guardi-docshs-design.md`. Catálogo em
  `app/docshs_consultas.py`, **com os filtros declarados à mão**: o
  `/openapi.json` de lá não é alcançável (o nginx só repassa `/api/`); filtro
  novo numa rota de lá só chega ao Guardi entrando aqui. ⚠️ Fora de propósito:
  arquivo de documento, prova, vídeo, materiais, anexos, exportação. ⚠️ O
  `{eu}` do histórico de treinamentos sai do `/auth/eu` do próprio DocsHS,
  nunca do `id` do agente. ⚠️ O 404 lá também é "documento que o cargo não
  vê": a mensagem nunca diz "não existe", e o `AGENTS.md` manda dizer "não
  achei entre os que você pode ver". O link (`DOCSHS_URL/documentos/<id>`,
  `/treinamentos/<id>`) é montado pelo servidor. API em `DOCSHS_URL + /api/v1`.
  ⚠️ **Ferramenta nova no `hsos-bot-<bot>` exige `publicar-bots-mcp.py
  --aplicar`**: o `toolFilter.include` e o `alsoAllow` listam ferramenta por
  ferramenta (`FERRAMENTAS_BOT`). Ligar: `--ligar-sistema <bot> docshs`
  (piloto) ou `--ligar-docshs-todos`, que liga só quem responde 200 no
  `/auth/eu` (ensaio sem `--aplicar`). **No ar para os 23 Guardis desde
  11/11/2026**, conferido no `erick-bot` (administrador lá) e no `welton-bot`
  (colaborador, 121 documentos visíveis).
- **GestorHS (11/11/2026, fase 1 = só consulta):** `gestorhs_consultas` /
  `gestorhs_consultar` no `hsos-bot-<bot>` (com `gestorhs` em
  `sistemas_ligados`): frota de aparelhos, clientes, OS, caixas, certificados e
  propostas, **como o DONO, com a função dele lá** (decisão do Erick: a função
  no GestorHS é a permissão do Guardi). Spec
  `docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`. Catálogo em
  `app/gestorhs_consultas.py`, filtros declarados (o openapi de lá é
  alcançável, mas não diz que `status=vencendo` são 90 dias); `id` só dígitos.
  ⚠️ **Duas URLs**: `GESTORHS_API_URL` (gestorhsapi, as chamadas) e
  `GESTORHS_URL` (o front, só os links `/app/...`) — trocar uma pela outra faz
  a chamada receber o HTML da SPA. ⚠️ **Allowlist dos dois lados**: rota nova
  só chega ao Guardi entrando no catálogo daqui **e** no allowlist de token de
  agente do GestorHS (que também barra todo método fora de GET). Nas listas que
  paginam lá (`aparelhos`, `clientes`, `ordens`, `caixas`) o `offset` vai ao
  GestorHS; nas cruas é nosso (`offset`/`limite`). Ferramenta nova exige
  `publicar-bots-mcp.py --aplicar`; ligar: `--ligar-sistema <bot> gestorhs`
  (piloto) ou `--ligar-gestorhs-todos` (confere por `/auth/me`, ensaio sem
  `--aplicar`). Fase 2 = escrita (caixa, certificado, proposta) por cartão,
  com o `require_funcao` de lá. ⚠️ **PDF de certificado e proposta vai por
  `link_pdf`**, o link público assinado que o GestorHS já punha nos cards do
  TaskHS (abre sem login, não expira); para token de agente o `html` do
  certificado vem nulo. **No ar para os 23 Guardis desde 11/11/2026**,
  conferido no `erick-bot` (piloto respondeu com o link do PDF da OS 11700).
  ⚠️ O EasyPanel do GestorHS tem dois serviços: deploy do `gestorhs-sistema`
  (front) não sobe o `gestorhs-api` — confira o commit no ar antes de testar.
- **GestorHS, fase 2a = Expedição (12/11/2026, escrita por cartão):**
  `gestorhs_receber` (OS em lote, 1 a 30 aparelhos, **um cartão para o lote**),
  `gestorhs_avancar_caixa`, `gestorhs_fechar_caixa` (Preparando Retorno →
  Finalizada, exige o rastreio) e `gestorhs_cadastrar_aparelho`. Spec
  `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md`;
  regra pura em `app/gestorhs_escrita.py`, executores em `app/acoes.py`
  (ações `receber`, `avancar_caixa`, `fechar_caixa`, `cadastrar_aparelho` —
  não podem colidir com as do TaskHS: o `cartaoDaAcao` do front despacha pelo
  nome). Antes do cartão o servidor só LÊ o GestorHS e recusa o que lá seria
  recusado: aparelho com OS ativa (nomeando a série), caixa fora das fases
  ativas, Preparando Retorno pedido em "avançar", clientes misturados saindo de
  Recebido sem `cliente_principal`, série que já existe (dizendo de qual
  cliente). O cartão mostra o **cliente em cada aparelho** — a série falada
  pode ser de outro cliente. ⚠️ **Execução do lote: a 1ª OS sem caixa (o
  GestorHS a cria), as demais com a caixa que voltou dela.** Falha no meio
  **para e não desfaz** (OS aberta é registro): o `erro` diz "Parou no
  aparelho N de M", quais OS abriram e em qual caixa — por isso o `erro` da
  `acoes_pendentes` passou de 300 para 2.000 caracteres. 403 numa escrita vira
  "a sua função no GestorHS não permite isso" (no avanço, diz qual função
  avança a fase). Corpo por allowlist de chaves: `sem_nota_fiscal` nunca sai
  daqui. ⚠️ **Pré-requisito do lado de lá:** a allowlist de token de agente do
  GestorHS abrir `POST /ordens`, `POST /caixas/{id}/avancar` e `POST
  /equipamentos-cliente` (seção "Para o GestorHS" da spec), com deploy do
  `gestorhs-api`. Sem isso toda escrita volta 403. Depois do deploy daqui:
  `publicar-bots-mcp.py --aplicar` e `criar-bots-pessoais.py
  --reescrever-agents-md --aplicar --todos`.
- **GestorHS, fase 2b = Laboratório (12/11/2026, certificado por cartão):**
  `gestorhs_gerar_certificado`, ação `gerar_certificado`, **um cartão por
  aparelho**. Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-laboratorio-design.md`.
  Antes do cartão o servidor valida as 5 leituras (vírgula ou ponto, até 3
  casas, ≤ 9,999 — **"181" é recusado**: é o técnico falando "um oito um"),
  normaliza para `0,181` e ⚠️ **calcula a média ele mesmo** (`Decimal`,
  meio-para-cima, 3 casas); o agente não a manda e, se mandar, é ignorada.
  Temperatura e pressão vão com ponto (`22.0`, `1017.3`, o formato do banco).
  Lê `/ordens/{id}`, `/certificado-campos` e `/certificados` (só GET): recusa
  OS fora do Laboratório e tipo M; regerar avisa "substitui" e mostra a data
  **antiga** (regerar mantém a data e o cilindro congelado). ⚠️ **O corpo nunca
  leva override de cabeçalho** (`nomecli`, `cnpj`, `serie`…): lista fixa em
  `_CAMPOS_CERTIFICADO`, e o GestorHS, para token de agente, ignora e preserva
  o `cert_overrides` (763 OS têm cabeçalho ajustado pela tela). O `gerar`
  **conclui o aparelho** no laboratório, como na tela; o link do PDF sai do
  retorno do `gerar` (ou de `/certificados`). Avançar caixa no Laboratório com
  OS ativa de `desfecho_lab` pendente **recusa sem cartão, listando OS e
  série** — o GestorHS recusaria no clique só com "faltam N".
- **GestorHS, fase 2c = propostas (12/11/2026, Serviços):**
  `gestorhs_criar_proposta` e `gestorhs_alterar_proposta`, ações
  `criar_proposta`/`alterar_proposta`. Spec
  `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`;
  regras puras em `app/gestorhs_propostas.py`. A pessoa conta o pedido; o
  servidor monta pelo padrão e devolve **lembretes** (frete fora da tabela ou
  estado desconhecido, lacunas do Phoebus, preço fora do catálogo, desconto,
  pagamento diferente da última proposta do mesmo destinatário, aparelho
  vencendo fora da proposta, entrega fora do cadastro). ⚠️ **Lembrete não
  trava** — é linha no cartão e no retorno ao agente, que os lê à pessoa.
  ⚠️ **O padrão vem do GestorHS** (`GET /propostas/padrao?modelos=&series=`:
  observação, validade, frete por região, UF → região e os dois
  `outros_itens`) e **nunca é copiado para cá**; sem a rota, a ferramenta
  recusa. Item só do catálogo (`/servicos` + `/produtos`, consultas
  `servicos`/`produtos`): sku inexistente ou repetido é recusado, nunca
  chutado. Total e frete em `Decimal`, do servidor; Phoebus = frete 0.
  ⚠️ **Nunca toca no cadastro:** o `destinatario` do GestorHS escreve no
  cliente e sincroniza com o **Tiny**, então o `POST` leva só `{tipo, id}` e o
  `PUT` nunca o leva (lista fixa em `app/acoes.py`; trocar cliente é pela
  tela). ⚠️ **O `PUT` substitui listas:** itens e aparelhos vão sempre como a
  lista INTEIRA resultante. Alterar recusa faturada e desabilitada antes do
  cartão, e só refaz o `outros_itens` se os aparelhos mudaram **e** o texto
  ainda é o do modelo — editado na tela vira lembrete, não é sobrescrito.
  Endereço de entrega vai como `{"texto": …}`, o formato que a tela edita.
  ⚠️ **Pré-requisito do lado de lá:** a rota do padrão, a allowlist de token
  de agente (`POST /propostas`, `PUT /propostas/{id}`, `GET /propostas/padrao`,
  `/servicos`, `/produtos` e `/empresas/{id}`, que a proposta para filial lê)
  e o `destinatario` restrito para agente (seção "Para o GestorHS" da spec).
- **HSGrowth (12/11/2026, vendedor):** `hsgrowth_consultas` / `hsgrowth_consultar`
  (leitura) e escrita por cartão: `hsgrowth_registrar` (pós-ligação: campos,
  campos personalizados, nota, tarefas criar/alterar/concluir e mover, **um
  cartão**, nessa ordem, para e não desfaz), `hsgrowth_cliente`,
  `hsgrowth_criar_lead`, `hsgrowth_ganhar`, `hsgrowth_perder`, `hsgrowth_noshow`.
  Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`;
  código em `app/sistemas/hsgrowth.py`, `hsgrowth_consultas.py`,
  `hsgrowth_escrita.py`. ⚠️ **Duas URLs**: `HSGROWTH_API_URL` (API, já com
  `/api/v1`) e `HSGROWTH_URL` (front, só os links `/cards/<id>`, sempre montados
  pelo servidor). O "eu" é `GET /users/me`, não `/auth/me`. ⚠️ **Escrita só em
  card do dono** (`assigned_to_id` ou `sdr_id`), mesmo para admin; card
  ganho/perdido só aceita nota e tarefa nova; cliente/contato só de card aberto.
  Lead novo nasce com `assigned_to_id` = o PRÓPRIO dono (único corpo que leva o
  campo; o `PUT` nunca). ⚠️ O `/clients?search` de lá compara o documento cru:
  a busca do lead vai por dígitos e, sem achado, com a máscara.
  ⚠️ **Comissão mora nas tarefas:** concluir exige `valida` (realizada × tentativa
  sem resultado, vale pontos), reunião que não aconteceu é **no-show**, e
  `alterar` nunca muda `task_type` (fechava o desvio reunião→ligação→concluir).
  ⚠️ "Parado" é o `is_stuck_3d/7d` do HSGrowth, não a régua do
  `relatorios-hsgrowth`; `tarefas_atrasadas` é cortada aqui pelo dono (lá o admin
  vê tudo). **Allowlist dos dois lados**: rota nova só chega ao Guardi no catálogo
  daqui **e** na allowlist de token de agente do HSGrowth. ⚠️ **Pré-requisito do
  lado de lá** (seção "Para o HSGrowth" da spec: token de agente, allowlist, dono
  em toda escrita, "via <bot>"): **nada é ligado antes do deploy do HSGrowth**.
  Ligar: `--ligar-sistema <bot> hsgrowth` (piloto no `erick-bot`) e depois
  `--ligar-hsgrowth-vendedores` (só `salesperson`, ensaio sem `--aplicar`).
  Ordem: deploy do HSGrowth → envs no EasyPanel → deploy do HS.OS →
  `publicar-bots-mcp.py --aplicar` → `criar-bots-pessoais.py
  --reescrever-agents-md --aplicar --todos` → piloto → vendedores.
- **HSGrowth — Serviços (12/11/2026):** sistema `hsgrowth_servicos` (separado do
  `hsgrowth`), quadros 1 (Serviços) e 2 (Cobrança), para quem é `service` lá.
  `hsgrowth_servicos_consultas` / `_consultar` e escrita por cartão:
  `_registrar` (negócio, campos, atividades, anotação e mover UMA etapa, nessa
  ordem, para e não desfaz), `_itens`, `_ganhar`, `_perder`, `_anexar_proposta`.
  Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`;
  código em `app/hsgrowth_servicos_{consultas,escrita,preparo}.py` e executores
  em `app/acoes.py`. ⚠️ **Card de Serviços não tem dono**: é colaborativo, a
  função `service` lá é a permissão (sem regra de "card do dono"). ⚠️ **O
  HSGrowth ignora o `board_id` nas rotas de card**: o Guardi confere a `list_id`
  do card contra as etapas do quadro no preparo **e** no clique. ⚠️ **Mover**:
  sempre por `/move`, uma etapa adiante ou atrás (conferido aqui até para admin),
  e no clique a etapa atual tem de ser a de origem do cartão, senão recusa sem
  gravar. ⚠️ **`business_info` é substituído inteiro lá**: o executor relê o card
  no clique e mescla só as chaves do cartão; `contact_info` nunca é tocado. ⚠️
  **Ganho** segue a regra da tela (mais estrita que a API), reconferida no
  clique. ⚠️ Só avisa o GestorHS (caixa ao Financeiro) card do **quadro 1** com
  `business_info.origem` = OS/caixa liberada do laboratório (= `gestorhs.os`,
  325 de 325); no quadro 2 nunca — e o cartão só diz isso nesse caso. Card
  ganho/perdido só aceita atividade/anotação nova, no preparo e no clique.
  ⚠️ `order_number` é **texto** lá ("PED-2024/123", "035897"), nunca int. ⚠️ **Anexar proposta**: o PDF vem do GestorHS
  (`link_pdf`), só https nos hosts de `GESTORHS_API_URL`/`GESTORHS_URL`, 443, sem
  redirecionamento, 10 MB, conferido como PDF, baixado no preparo e no clique;
  se o `CERT_PUBLIC_BASE_URL` do GestorHS for outro host em produção, recusa.
  ⚠️ Retornos com texto externo saem por `como_dado_externo`. **Pré-requisito do
  lado de lá** (seção "Para o HSGrowth" da spec, soma à de Vendas, incluindo
  `get_card_in_board` nas rotas de card): nada é ligado antes do deploy do
  HSGrowth. Ligar: `--ligar-sistema <bot> hsgrowth_servicos` (piloto no
  `erick-bot`) e `--ligar-hsgrowth-servicos` (só `service`, ensaio sem
  `--aplicar`); mesma ordem de produção de Vendas.
- **A `iris` lê a Inadimplência como o Nicholson** (`np@`, `admin` no
  DataCore; decisão do Erick, 10/11/2026): ferramenta `inadimplencia` no
  `hsos-relatorios`, só dela. Quem pergunta à `iris` não é identificado — se
  outra pessoa passar a falar com ela, rever. Spec
  `docs/superpowers/specs/2026-11-10-iris-inadimplencia-design.md`.
- **Território:** a mudança em cada sistema é feita na sessão daquele repo,
  a partir da seção "Para os outros repositórios" da spec. O TaskHS já está
  pronto (`48832b0`, v2.13.0, sem deploy).

### Guardi na internet — 18/11/2026

Spec `docs/superpowers/specs/2026-11-18-guardi-internet-design.md`. **Só
`web_search`** (Brave), com `internet` em `sistemas_ligados`
(`--ligar-sistema <bot> internet` / `--ligar-internet-todos`, depois
`publicar-bots-mcp.py --aplicar`). Piloto no `erick-bot`.

- ⚠️ **`web_fetch` e `x_search` são negados a TODO agente**, sempre
  (`FERRAMENTAS_WEB` em `integracoes.py`, `TRAVAS_DO_BOT`). O Guardi tem
  e-mail e CRM do dono no contexto; `web_fetch` é GET em URL escolhida pelo
  modelo — instrução plantada vazaria dado pela query string.
- ⚠️ **Ligar `tools.web.search` no gateway dá a busca a todo perfil `coding`**
  (traz `group:web`). Especialista não tem internet por decisão: quem nega é
  `escopo_mcp_do_agente` (todo perfil que não é `minimal`) e o `conferir` do
  `publicar-bots-mcp.py` recusa especialista sem as três no `deny`.
  **Publicar os denies ANTES de ligar a busca no gateway.**
- A chave é `BRAVE_API_KEY` no `~/.openclaw/.env` da VPS. A consulta vai ao
  Brave: o `AGENTS.md` proíbe pôr dado do dono ou da HS na pesquisa.

### "Capacidade" do Guardi — 13/11/2026

Botão ao lado de "Conversas anteriores" (⋮ no celular): o que o Guardi alcança,
por sistema e por assunto, **só o que o login do dono permite**. Spec
`docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.

- ⚠️ **Quem diz o que o login pode é cada sistema**, por `GET /agente/capacidades`
  (token de agente) → `{papel, rotas: [[método, template]]}`. O HS.OS só cruza com os
  catálogos (`app/capacidade.py`) — **nunca copie regra de permissão para cá**.
  No ar nos seis (TaskHS, TalentHS, DocsHS, GestorHS, HSGrowth, DataCore).
- Texto da tela é `app/capacidade_assuntos.py`, separado do texto para o agente.
  ⚠️ **Consulta ou ação nova no Guardi exige entrada lá** (assunto ou `INTERNO`) —
  `test_todo_item_tem_assunto_ou_e_interno` quebra sem ela. **Sistema novo** precisa
  da rota de capacidades do lado de lá, senão aparece "ainda não sei dizer".
- Só o dono vê (404 até para admin). Não gasta token de modelo; cache de 5 min.

### Agenda e lembretes do Guardi — 09/11/2026

Spec: `docs/superpowers/specs/2026-11-09-agenda-lembretes-design.md`. Nasceu de um
Guardi que prometeu "te lembro em 2 dias" sem ter onde guardar. O `cron` do gateway
continua negado aos Guardis (os 560 disparos da `nina`); a agenda é do HS.OS.

- Tabela `lembretes` (`032`), página `/agenda`, ferramentas `agenda_criar|listar|
  editar|apagar` no `hsos-bot-<bot>`. Regra de recorrência e tetos em
  `app/agenda/regras.py` (puro, testado); fuso fixo America/Sao_Paulo, banco em UTC.
- **Tetos no servidor:** 30 ativos por pessoa · recorrência mínima diária · único
  entre 5 min e 1 ano à frente · 12 turnos de agente por pessoa por dia (acima, sai
  só o recado) · `titulo` ≤ 200, `instrucao` ≤ 2000.
- ⚠️ **`app/disparador_lembretes.py` é a PORTA ÚNICA do trabalho autônomo do
  Guardi** (`DISPARADOR_LEMBRETES_SEGUNDOS`, 30; 0 desliga — use ao testar local,
  que fala com o banco de produção). Trabalho que o Guardi faça sozinho no futuro
  entra por `disparar_turno`, em nome do dono; não crie caminho paralelo.
- ⚠️ **O recado é gravado e COMITADO antes do `chat.send`** (por isso `disparar_um`
  recebe `sessao_fn`, não `conn`): com o gateway fora, o lembrete chega mesmo assim.
  O turno aberto conta como turno do dono (`turno_em_curso`), o que faz as
  ferramentas funcionarem; **escrita externa continua virando cartão**.
- ⚠️ **Atraso, adiamento e erro:** atraso > 6 h = `perdido` (avança, não dispara
  velho). Run aberto com o Guardi adia só o turno, em passos de 2 min até 30 min;
  depois fica `entregue_sem_agente`. **Exceção inesperada = `erro` E AVANÇA**
  (único encerra, recorrente vai ao próximo), sem nova tentativa: soltar sem avançar
  regravaria o recado a cada 30 s por até 6 h.
- ⚠️ **Posse da reserva por carimbo (`disparando_em`), não por booleano:** são 2
  workers. Lease de 10 min, até 10 itens por passada, carimbo renovado antes de cada
  item — lease de 2 min era menor que o trabalho de uma passada com `chat.send`.
  Antes do recado confere que o dono está ativo e que `agent_id` ainda é o Guardi
  dele; senão desativa sem disparar.
- ⚠️ **Refresh do e-mail usa constante escolhida por `concedeu_calendario`
  (`email/graph.py`), NUNCA o `scope` cru da resposta.** Esse vem sem
  `offline_access`; reenviá-lo para a rotação do refresh token em silêncio e o
  e-mail cai em ~90 dias. `Calendars.Read.Shared` é pedido só no "Conectar e-mail";
  conta antiga (`escopos` nulo) renova com `ESCOPOS_EMAIL`. Evento do Outlook nunca
  vai para o banco; volta ao agente por `como_dado_externo`.
- ⚠️ **`hsos-bot-<bot>` agora é declarado para TODO Guardi**, com ou sem
  `sistemas_ligados` — senão o `AGENTS.md` promete ferramenta que ele não tem, o
  defeito original. As `taskhs_*` seguem recusadas sem `taskhs` ligado. O Outlook
  nas ferramentas segue `email_ligado`.
- **Risco aceito, decisão revisável (09/11/2026):** instrução criada pelo Guardi
  roda depois como turno do dono (injeção atrasada: instrução plantada por e-mail
  lido). Mitigação: o turno só lê e prepara cartões, tetos acima, selo "criado pelo
  Guardi" na página, título saneado no cabeçalho. Exigir cartão em todo lembrete com
  instrução tiraria o caso de uso pedido.
- ⚠️ **Risco conhecido, a exercitar no `erick-bot` antes de abrir para todos:** se a
  pessoa responde ao recado enquanto o turno do lembrete ainda roda, o run novo vira
  fronteira no coletor (`SQL_RESERVAR_RUNS`) e as duas respostas podem sair coladas
  numa bolha, ou a do lembrete só aparecer no `/recuperar`.
- **Lembrete que chama atenção (13/11/2026, `036`)** — spec
  `docs/superpowers/specs/2026-11-13-lembrete-que-chama-atencao-design.md`. Cada
  recado é um AVISO (`aviso_em`, gravado na mesma transação do recado) que espera
  "Adiar 10 min" ou "Feito"; sem resposta, `reavisar_um` regrava `⏰ Lembrete (de
  novo)` UMA vez em 5 min; adiar vencido avisa de novo e reinicia a insistência.
  ⚠️ **Re-aviso é só o recado**: não chama o Guardi nem conta no teto de 12. Mesmo
  lease `disparando_em` do disparo. A regra de Adiar/Feito é `app/agenda/aviso.py`
  (só sobre o aviso ATUAL não respondido — o segundo clique é inócuo).
  Push do recado sai por `payload_lembrete` (sem `conversa`: o SW não o cala para
  quem olha; `requireInteraction`). ⚠️ **Os botões da notificação não têm login**:
  `POST /agenda/lembretes/acao` só aceita o token de `app/agenda/token_acao.py`
  (HMAC de `LEMBRETE_ACAO_SEGREDO`, escopo lembrete+aviso+ação, 24 h); sem a env o
  push sai sem botões e a rota responde 503. Janela no app:
  `components/agenda/JanelaDeLembrete.tsx`, montada na `CascaDoApp` (vale nas duas
  cascas), lista vinda de `GET /agenda/lembretes/pendentes`, som por Web Audio.
- ⚠️ **O teto de 30 conta só lembrete que ainda vai disparar** (`ativo AND proximo_em IS
  NOT NULL`): único já disparado fica `ativo` com `proximo_em` nulo e não ocupa vaga.
- **Produção, só depois do deploy** (migração `032` antes): `publicar-bots-mcp.py`
  (ensaio primeiro, depois `--aplicar`); `criar-bots-pessoais.py
  --reescrever-agents-md --aplicar --todos`. Conferência no navegador da `/agenda`
  ainda pendente.
- ⚠️ **Ninguém precisa reconectar o e-mail para o Outlook.** Conta conectada antes do
  calendário ganha o escopo na própria renovação (`contas.access_token` →
  `graph.ampliar_para_calendario`), porque o Erick deu consentimento de administrador
  no Entra (09/11/2026). A Microsoft recusou? Renova só com e-mail — a pessoa nunca
  perde o e-mail por causa do calendário. `/email/estado` e `outlook.eventos` tentam a
  ampliação antes de dizer "sem permissão".

### Varredura do Guardi — 16/11/2026

Spec e plano: `docs/superpowers/specs/2026-11-16-varredura-do-guardi-design.md` (e o
plano ao lado, em `plans/`). Cada Guardi confere sozinho as pendências do dono
(TaskHS, HSGrowth, e-mail) e registra um resumo; a Nina reúne o da equipe.

⚠️ **GestorHS saiu da varredura em 23/11/2026** (`APOSENTADOS` em `regras.py`): a
OS lá não tem responsável, então `minhas_os` não existia — 17 Guardis escreviam 0,
dois mandavam totais e três marcavam `falhas` todo dia. A chave ainda chega de
sessão antiga e é descartada em silêncio. ⚠️ **HSGrowth de Serviços é outra
ferramenta** (`hsgrowth_servicos_consultar`, `pendencias minhas=true` e `cards`
com `colaborador=eu`); a instrução só nomeava a de Vendas e Ellen/Leticia
declaravam falha sem tentar. **Antes de pedir um número na varredura, confira
que alguma consulta o devolve POR PESSOA** — senão o Guardi inventa.

⚠️ **Lições da 1ª varredura real (16/11/2026, `erick-bot`):** o validador
descartava em silêncio chave fora de `taskhs/hsgrowth/gestorhs/email` e gravou
`numeros: {}` — hoje recusa com `EXEMPLO_NUMEROS` (em `regras.py`, também na
descrição da ferramenta) e recusa vazio. O Guardi citou total do sistema ("11.559
OS") como pendência e fez duas ofertas. A Nina montou o quadro como HTML dentro da
mensagem (o "Ver artefato" do chat — fica na conversa, NÃO é página pública); por
precaução, `pendencias_da_equipe` proíbe `publicar_pagina` (link público com
remetente e assunto de e-mail) na descrição, no topo do retorno e no texto do quadro.

- ⚠️ **Porta única, de novo:** todo turno sai por `disparar_turno(..., prefixo=
  "hsos-varredura-")`, e a varredura é uma etapa da `passada` do
  `disparador_lembretes` (`app/varredura/`). Nenhum `chat.send` novo, nenhum laço
  paralelo — o adiamento por run aberto é o do lembrete (2 min, até 30, depois `pulada`).
- **Chave** `app_settings` `varredura` = `{ligada, manha: 07:30, tarde: 13:30, quadro:
  08:30}`; ausente = desligada. Quem liga é `scripts/varredura-agora.py --ligar
  --aplicar` (admin; sem `--aplicar` é ensaio). `--so <user_id> --aplicar` cria uma
  pedida de ensaio e espera (mostra status, números e o tamanho do resumo; o texto
  só com `--mostrar-resumo`). ⚠️ **Desligada, só `pedida` dispara**: a agendada já
  semeada fica parada e vira `pulada` pelo limite. ⚠️ **Runtime por modo**, sempre de `backend/` com
  `PYTHONPATH=.`: `--so` no venv do backend (`.venv/bin/python`); `--ligar`/`--desligar`
  em `~/projetos/bancos/.venv/bin/python` (o do backend não tem o cadastro `bancos`).
- **Dias úteis** (seg–sex menos feriados nacionais, móveis pela Páscoa), fuso São
  Paulo, banco em UTC. Passou do limite sem rodar (manhã 12:00, tarde 17:00, quadro
  11:00) = `pulada`: não dispara velho.
- ⚠️ **O resumo é gravado CIFRADO** (`resumo_cifrado`, `app/email/cifra.py`): o
  usuário de leitura da empresa enxerga tabela nova por privilégio padrão, e o resumo
  traz nome de cliente e e-mail. `numeros` fica em claro (só contagens e `falhas`).
- ⚠️ **A tarde decide "novidade" no SERVIDOR**, comparando com a manhã, e só ela pode
  responder `NO_REPLY`. Sistema que caiu não é "zero pendências": `numeros.falhas` o
  nomeia e a tarde não o conta como novidade ao voltar vazio. Guardi que não chama
  `varredura_registrar` vira `sem_registro` ("sem varredura hoje"), nunca zero.
- ⚠️ **O quadro das 08:30 vai na conversa do Nicholson com a Nina, NÃO na Base de
  Conhecimento** — a wiki é legível por todos e o quadro traz pendência nominal.
  ⚠️ **Quem lê o resumo de todos é quem está em `allowed_user_ids` da `nina`** (mais
  administrador que fale com ela); ampliar essa lista também semeia um quadro por pessoa.
  O quadro vira `entregue` quando a resposta da Nina é gravada (`colher_resposta`).
- ⚠️ **Run `hsos-varredura-` não tem recuo de texto** (`_texto_da_resposta(recuo=False)`):
  a tarde em `NO_REPLY` fica vazia e nada é gravado — com o recuo, a narração ("Vou
  conferir o TaskHS…") virava mensagem com push. O retorno de `pendencias_da_equipe`
  vai por `como_dado_externo` (o resumo cita assunto e remetente de e-mail).
- **"🔎 A Nina pediu um resumo das suas pendências."** (`media
  [{"type":"varredura_pedida"}]`) aparece na conversa do dono, **sem push**. Teto de 2
  pedidas por pessoa por dia, 30 min de intervalo, só para a Nina (o ensaio é
  `pedida_por='agenda'`). `varredura_registrar` fora de varredura recusa sem gravar.
- ⚠️ **Ferramenta nova exige as duas publicações:** `varredura_registrar` (no
  `hsos-bot-<bot>`) → `publicar-bots-mcp.py --aplicar`; `pendencias_da_equipe` e
  `pedir_varredura` (no `hsos-anexos`, só a `nina`) → `publicar-anexos-mcp.py --aplicar`. O
  `hsos_agente` da Nina não lê `varreduras` (037): ela passa pela ferramenta.
- ⚠️ **A `037` esqueceu o `GRANT` ao `service_role`** (`has_table_privilege(...,
  'INSERT')` = false em produção): sem ele o backend não lê nem grava a fila, e a etapa
  morre em silêncio a cada 30 s. Vem na `038` (`~/aplicar-hsos-038.py`). Tabela nova:
  `GRANT ... TO service_role` junto com o `REVOKE`, como a `032`.
- **Produção, nesta ordem** (migração `037` aplicada; `038` antes do deploy): deploy → `publicar-bots-mcp.py`
  → `publicar-anexos-mcp.py --aplicar` → `criar-bots-pessoais.py --reescrever-agents-md
  --aplicar --todos` e `ponteiro-nina-varredura.py --aplicar` → perguntar ao
  `erick-bot` e à `nina` se têm as ferramentas → `varredura-agora.py --so <Erick>
  --aplicar` → `--ligar --aplicar`.

### Aviso de pedido de ausência ao RH — 26/11/2026

Spec e plano: `docs/superpowers/{specs,plans}/2026-11-26-aviso-de-ausencia*`. Pedido
**pendente** no TalentHS vira, em até ~2 min, recado + cartões **Aprovar/Recusar** na
conversa de quem está na chave (hoje a Lidisay, `lidisay-bot`).

- **Sem turno de agente e sem mexer no TalentHS:** etapa no fim da `passada` do
  `disparador_lembretes` (`app/avisos_ausencia.py`) que lê `/absences/team` (filtra
  `pending` aqui) como o destinatário e monta os cartões pelo mesmo `talenths_preparo.preparar` do
  Guardi. Escolha do Erick (polling + servidor) contra webhook (exigiria deploy lá e
  perderia aviso se a chamada falhasse) e contra turno do Guardi (custo e dependência
  de o modelo chamar a ferramenta).
- ⚠️ **A trava contra aviso dobrado é a PK de `avisos_ausencia` (`044`)**: os dois
  workers podem ler antes de qualquer um gravar; quem ganha o `INSERT … ON CONFLICT
  DO NOTHING RETURNING` grava recado e cartões **na mesma transação**. Reaviso de
  24 h (cartão vence em 24 h) por compare-and-set em `ultimo_aviso_em`.
- ⚠️ **Recado e cartões têm `created_at` explícito** (`criar_pendente(...,
  criado_em=)`): na transação `now()` é um só e a conversa os embaralharia.
- O preparo (GET no TalentHS) roda **fora** da transação. Pedido do próprio
  destinatário não é avisado. Ritmo: 1 leitura por destinatário a cada 120 s por worker.
- **Chave** `avisos_ausencia` = `{ligado, destinatarios: [user_id]}`; ausente =
  desligado. `backend/scripts/avisos-ausencia.py --mostrar | --ligar <email> |
  --tirar <email> | --desligar [--aplicar]`, com `PYTHONPATH=.` e o Python do venv do
  cadastro. O `--ligar` recusa quem não tem Guardi ou não tem `talenths` ligado.
- ⚠️ **Não é `/absences/team/pending`**: o TalentHS libera ao token de agente só as
  rotas da lista em `auth/agente.py` de lá, e essa não está — volta 403, a mesma cara
  de "sem papel de RH". Na 1ª ligação (26/11) o aviso ficou mudo por isso; o 403 hoje
  é um warning único no log, não traceback a cada 2 min.
- **Cartão único em par (26/11, `045`):** as duas ações (aprovar/recusar) ligadas por
  `acoes_pendentes.par_id`, gravadas por `acoes.criar_par` numa mensagem só
  (`media: {id, rotulo, par: {id, rotulo}}`). O `/confirmar` trava as duas em ordem de
  id, recusa (409) se a outra já foi decidida e cancela a outra no sucesso; falha do
  executor deixa a outra pendente. No front, `CartaoAcao` com `par` (`estadoDoPar` em
  `lib/acoes.ts`, testado). ⚠️ Rejeitado: ação "decidir" com a escolha no clique —
  quebraria "o clique executa só o payload gravado".
