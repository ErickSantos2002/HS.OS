# Guardi no DocsHS — design (11/11/2026)

## Intenção

O DocsHS é o sistema de documentos da qualidade (ISO 9001) da HS: a Lista
Mestra, as revisões, as leituras distribuídas e os treinamentos. Hoje, para
saber "temos um procedimento sobre X?" ou "que treinamento eu ainda não fiz?",
a pessoa abre o DocsHS e procura. A Qualidade, que administra o sistema, monta o
acompanhamento olhando tela por tela: quantos treinamentos estão abertos, quem
falta fazer, que documento venceu, que revisão está parada.

A ideia é o Guardi responder isso **lendo o DocsHS como o dono**, no mesmo molde
do DataCore (`2026-11-10-iris-inadimplencia-design.md`, `datacore_consultas.py`):

- **colaborador:** "temos documento sobre calibração?", "qual a revisão
  vigente do PO-07?", "que treinamentos estão abertos pra mim?", "tenho leitura
  pendente?";
- **Qualidade:** "quantos treinamentos estão coletando e quantos já
  encerraram?", "quem ainda não respondeu o treinamento de NR-35?", "que
  documentos estão vencidos ou vencem este mês?", "que revisões estão paradas
  em aprovação?", "quem está com leitura atrasada?".

Quem decide o que cada um vê é o **DocsHS**, com as regras que já tem. O HS.OS
não reimplementa permissão.

## Decisões do Erick (11/11/2026)

1. **Só leitura nesta fase.** Confirmar leitura, assinar ata, responder
   treinamento continuam sendo atos da própria pessoa — têm valor de registro
   na ISO 9001.
2. **Busca por título e código, mais o link.** O Guardi usa a busca que a Lista
   Mestra já tem (código e título, sem acento) e devolve código, título,
   revisão vigente, situação de vencimento e o link para abrir no DocsHS.
   **Nenhum arquivo de documento passa pelo modelo.**
3. **Piloto no `erick-bot`, depois todos.** O Erick confere como colaborador e
   como Qualidade; depois um comando liga para os 23 Guardis.

## O que o reconhecimento mostrou (leitura do `~/github/docshs`, 11/11/2026)

- **Login:** JWT HS256 próprio, `{sub: usuario.id, ver: token_versao, exp}`,
  Bearer, 8 h. Senha ou Microsoft Entra. `usuario_atual` em
  `backend/app/core/dependencias.py:17` recusa inativo e `ver` divergente
  (`POST /auth/sair` incrementa `token_versao` e derruba todo token emitido).
  **Não existe token de serviço nem de agente.**
- **E-mail é único** (índice em `lower(email)`, normalizado em minúsculas).
- **Papéis:** `admin_qualidade`, `gestor`, `colaborador`, `administrador`
  (este pode tudo o que a Qualidade pode, `core/papeis.py`).
- **Visibilidade de documento:** `services/permissao.py`
  (`condicao_de_visibilidade`, `filtrar_visiveis`, `pode_ver`). Qualidade e
  Administrador veem tudo; os outros, a classificação (C1–C4) permitida ao
  cargo **e** (setor próprio, setor distribuído, C4 ou leitura atribuída).
  Documento invisível dá **404, não 403**.
- **Vencimento é derivado**, não gravado: `services/vencimento.py`
  (`sem_periodicidade`, `em_dia`, `vence_em_breve` — 30 dias —, `vencida`).
- **Revisão:** rascunho → em_revisao → em_aprovacao → vigente → obsoleta, ou
  cancelada.
- **Leitura pendente:** `Leitura.confirmada_em IS NULL`; atrasada com `prazo`
  vencido.
- **Treinamento:** rascunho → coletando ("aberto") → encerrada, ou cancelada.
  Por pessoa: `pendente | confirmou | nao_participou | nao_confirmou`, mais o
  percurso de vídeo e prova. As pendências de uma pessoa saem de
  `treinamento_consulta.pendencias` (servida em `/minhas-acoes`).
- ⚠️ **`GET /treinamentos` não é "os treinamentos abertos" para o
  colaborador:** para quem não é Qualidade ele lista só os que a pessoa
  **ministra**. Os abertos para a pessoa vêm de `/minhas-acoes` e do histórico
  pessoal.
- **Busca:** só metadados (`busca` em `GET /documentos`, `LIKE` sem acento em
  código e título). Não há índice de conteúdo.
- **Rede:** o backend não é publicado; o nginx do front repassa `/api/`. O
  `/openapi.json` existe no backend mas **não é alcançável de fora** — ao
  contrário do DataCore, os filtros não podem ser lidos de lá.
- **URL de produção:** `https://docshs.healthsafetytech.com` (front +
  `/api/v1` pelo nginx; `GET /api/v1/auth/eu` sem token responde 401,
  conferido em 11/11/2026). Mesma VPS do backend do HS.OS (`62.72.11.28`),
  mas o EasyPanel dela não é o que o MCP deste computador enxerga. Fica em
  `DOCSHS_URL`.

## Objetivos

1. **Token de agente no DocsHS** (`aud = "docshs"`), só em GET, só nas rotas
   do allowlist abaixo, entrando como o usuário do e-mail do `sub`.
2. **Ferramentas `docshs_consultas` e `docshs_consultar`** no servidor
   `hsos-bot-<bot>`, por **catálogo** (o agente escolhe uma chave, nunca um
   caminho), com teto de retorno e paginação, igual ao DataCore.
3. **Link para abrir** em toda resposta que traga documento ou treinamento:
   `<DOCSHS_URL>/documentos/<id>` e `<DOCSHS_URL>/treinamentos/<id>`, montado
   pelo servidor, não pelo modelo.
4. **Flag `docshs` em `sistemas_ligados`**, ligada no `erick-bot` primeiro e
   depois em todos por `publicar-bots-mcp.py --ligar-docshs-todos`.
5. **Ponteiro no `AGENTS.md` do template do Guardi**: pergunta sobre
   documento, procedimento, formulário, leitura ou treinamento começa pelo
   `docshs_consultas`.

## O catálogo (`backend/app/docshs_consultas.py`)

Os filtros ficam **declarados no catálogo**, porque o OpenAPI do DocsHS não é
alcançável. Cada entrada: chave → (caminho, o que é, filtros aceitos). O agente
pode mandar só os filtros declarados; o resto é recusado com a lista dos
válidos.

| chave | caminho | para quem | filtros |
|---|---|---|---|
| `eu` | `/auth/eu` | todos | — |
| `documentos` | `/documentos` | todos (o DocsHS filtra) | `busca`, `tipo_id`, `setor_id`, `classificacao`, `status`, `situacao`, paginação |
| `documento` | `/documentos/{id}` | todos | — |
| `revisoes_do_documento` | `/documentos/{id}/revisoes` | todos | — |
| `setores` | `/setores` | todos | — |
| `normas` | `/normas` | todos | — |
| `tipos_de_documento` | `/administracao/tipos` | Qualidade (o DocsHS barra os outros) | — |
| `minhas_leituras` | `/leituras/minhas` | todos | — |
| `minhas_pendencias` | `/minhas-acoes` | todos | — |
| `meus_treinamentos` | `/treinamentos/pessoas/{eu}/historico` | todos | — |
| `painel` | `/painel` | todos (bloco da Qualidade só para ela) | — |
| `treinamentos` | `/treinamentos` | Qualidade: todos; outros: os que ministra | `ano`, `situacao`, `tipo`, `instrutor_id`, `com_pendentes` |
| `treinamento` | `/treinamentos/{id}` | quem o DocsHS deixa | — |
| `controle_de_treinamentos` | `/treinamentos/controle` | Qualidade (404 aos outros) | os da rota |
| `plano_de_treinamento` | `/planos-treinamento/{ano}` | quem o DocsHS deixa | — |
| `leituras_por_pessoa` | `/leituras/por-pessoa` | Qualidade | os da rota |
| `leituras_de_uma_pessoa` | `/leituras/por-pessoa/{id}` | Qualidade | — |
| `leituras_da_revisao` | `/revisoes/{id}/leituras` | Qualidade | — |
| `verificacoes` | `/documentos/verificacoes` | Qualidade | os da rota |

- `{eu}` é resolvido pelo **servidor** (chama `/auth/eu` e usa o `id`), nunca
  vem do agente — senão o Guardi de A pediria o histórico de B e só a regra do
  DocsHS o barraria.
- Os filtros exatos de cada rota o construtor tira do código do DocsHS
  (schemas e `Query` de cada rota) e os escreve no catálogo, com teste.
- O retorno passa por `como_dado_externo(..., origem="DocsHS")`, teto de 12 mil
  caracteres; lista crua pagina do nosso lado (`paginacao_local` do DataCore
  serve, ou o equivalente com filtros declarados).
- A `description` do `docshs_consultar` diz: o que volta é a visão do dono
  (recusa ou 404 é permissão dele — diga isso, não contorne); "vencida" e
  "vence em breve" já vêm calculados pelo DocsHS, não recalcule; documento
  sem acesso **não aparece**, então "não achei" quer dizer "não achei entre os
  que você pode ver", e é assim que deve ser dito.

## Para o repositório DocsHS (na sessão dele)

O Erick abre `cl docshs` e entrega esta seção.

1. Env `HSOS_AGENTE_CHAVE_PUBLICA` (PEM Ed25519; o EasyPanel guarda com `\n`
   literal). Sem ela todo token de agente dá 401 e o resto segue como hoje.
2. Em `usuario_atual`, para Bearer com `iss == "hsos"` (decidido olhando o
   payload sem verificar, como em `DataCore/backend/app/core/agente.py`):
   EdDSA, `aud == "docshs"`, `exp` exigido e a no máximo 600 s, `sub` e
   `act.sub` presentes; usuário por `lower(email) == sub`, **ativo**. Cópia do
   `agente.py` do DataCore com `AUDIENCIA = "docshs"`.
   - **`token_versao` não se aplica** ao token de agente (ele não carrega
     `ver`): quem revoga é o HS.OS (token de 5 min, emitido a cada chamada, e
     `ativo` conferido aqui). Escrever isso no comentário.
3. **Só GET e só allowlist**: as rotas do catálogo acima. Qualquer outra (e
   qualquer método ≠ GET) com token de agente → **403**. Fora do allowlist de
   propósito:
   - `/revisoes/{id}/arquivo/{tipo}` e `/arquivo-vigente` (decisão 2: nenhum
     arquivo vai ao modelo);
   - tudo de **prova** (`/treinamentos/{id}/prova*`): o Guardi não pode ver
     nem ajudar a fazer a prova de ninguém;
   - `/treinamentos/video/{token}`, materiais, anexos e exportações;
   - `/auth/*` exceto `/auth/eu`; `/administracao/*` exceto `GET
     /administracao/tipos` (é a única fonte dos ids do filtro `tipo_id`);
     `/usuarios/*`,
     `/trilha`, `/documentos/exportacao`, `/documentos/proximo-codigo`.
4. O acesso por token de agente **não** grava em `AcessoLog` como download
   (nenhum arquivo é servido); se houver trilha de leitura de ficha, marcar
   `via=<act.sub>`.
5. Testes: token válido entra como a pessoa e vê o que ela vê (colaborador não
   vê documento fora do cargo/setor → 404); `aud` errado, vencido, `exp` longo
   ou chave errada → 401; usuário inativo → 401; rota fora do allowlist e
   método ≠ GET → 403; rota de prova → 403 mesmo para Qualidade.
6. Changelog do DocsHS (é regra de lá).

## Do lado do HS.OS

- `app/sistemas/docshs.py`: `chamar(...)` por `chamar_sistema` com
  `AUD = "docshs"`, base `settings.DOCSHS_API_URL` (= `DOCSHS_URL + "/api/v1"`)
  e mensagens próprias (401: "o DocsHS não reconheceu o seu dono…"; 403: "o
  DocsHS não deixa o Guardi ver isso"; 404: "não encontrado — ou o seu dono não
  tem acesso a este documento").
- `app/docshs_consultas.py`: catálogo puro, testado
  (`tests/test_guardi_docshs.py`): chave desconhecida, `id` obrigatório e
  proibido, filtro fora da lista, `{eu}` nunca vindo do argumento, link montado.
- `routers/mcp_bot.py`: `docshs_*` exige `docshs` em `sistemas_ligados`
  (`_Recusa` "O DocsHS ainda não está ligado para mim.").
- `config.py`/`.env.example`: `DOCSHS_URL`.
- `publicar-bots-mcp.py`: `--ligar-sistema <bot> docshs` já serve para o
  piloto; acrescentar `--ligar-docshs-todos`, que **liga só quem tem conta no
  DocsHS**: chama `/auth/eu` com o token de cada dono, liga quem responde 200
  e lista quem deu 401 (sem conta ou inativo lá). Ensaio por padrão.
- 401 no `docshs_consultar` diz "o seu dono não tem conta ativa no DocsHS (ou
  o acesso do Guardi ainda não foi ligado lá)".
- Template do Guardi (`app/bots_pessoais.py`): o ponteiro curto no `AGENTS.md`
  e o nome das ferramentas no `TOOLS.md`. Medir o teto de 20.000 antes.
  Levar aos vivos com `criar-bots-pessoais.py --reescrever-agents-md`.
- Changelog do HS.OS (`frontend/src/data/changelog.ts`).

## Não-objetivos

- Escrever no DocsHS (confirmar leitura, assinar ata, abrir RNC).
- Ler conteúdo de arquivo de documento.
- Busca semântica ou por conteúdo.
- RNC, indicadores, auditorias e análise crítica — ficam para outra fase, se
  pedirem. (O `/painel` já os resume para quem os vê; está no catálogo.)
- A `nina` e os especialistas: só o Guardi.

## Anti-objetivos

- **O Guardi dizer que um documento não existe** quando só não é visível ao
  dono. A frase certa é "não achei entre os que você pode ver".
- **O Guardi ajudar a fazer prova** de treinamento — fecha no allowlist do
  DocsHS, não em instrução.
- **O HS.OS decidir quem vê o quê.** Qualquer filtro de permissão do lado de cá
  é duplicação que diverge.
- **Número recontado pelo modelo** quando o DocsHS já dá o total (painel,
  controle). A `description` manda usar o número que veio.

## Restrições

- Território: a mudança do DocsHS é feita na sessão daquele repo.
- Ordem de produção: DocsHS com a chave pública no ar → deploy do HS.OS com
  `DOCSHS_URL` → `--ligar-sistema erick-bot docshs` → conferência → todos.
- Modelo dos Guardis é o DeepSeek (risco LGPD aceito no piloto). O que vai ao
  modelo são metadados e nomes de pessoas nas visões da Qualidade.

## Conferência (piloto)

O Erick é **administrador** no DocsHS (11/11/2026). A visão da Qualidade se
confere no `erick-bot`; a de colaborador, ligando **só para o teste** o Guardi
de um colaborador que concordar (`--ligar-sistema <bot> docshs`), e desligando
depois se ele não fizer parte da abertura geral. Perguntar **sem citar a
resposta na pergunta**:
1. no Guardi do colaborador: "temos documento sobre calibração?", "tenho
   treinamento aberto?";
2. no `erick-bot` (Qualidade): "quantos treinamentos estão coletando?", "quais documentos
   estão vencidos?";
3. "me mostra a prova do treinamento X" → recusa;
4. um documento que o cargo não vê → "não achei entre os que você pode ver".

## Decisões minhas (Claude), revisáveis

- Tipos de documento entram pelo `GET /administracao/tipos`, único do
  `/administracao/*` no allowlist; para o colaborador o DocsHS recusa, e ele
  procura por `busca`.
- `--ligar-docshs-todos` confere conta por `/auth/eu` antes de ligar.
- Filtros declarados no catálogo (o OpenAPI do DocsHS não é alcançável).
- `token_versao` não vale para o token de agente.

## Para o construtor decidir

- Os filtros exatos de cada rota (tirados do código do DocsHS) e se
  `/documentos` pagina lá (repassa) ou é cortado do nosso lado.
- O formato do link (o servidor acrescenta `link` em cada item que tenha `id`
  de documento ou treinamento, ou uma linha no fim).
