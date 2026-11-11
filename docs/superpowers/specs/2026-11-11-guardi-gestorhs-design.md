# Guardi no GestorHS: consulta para todos (fase 1), design de 11/11/2026

## Intenção

O GestorHS é o sistema de calibração da HS. Ele guarda a frota de aparelhos
dos clientes, as ordens de serviço (OS), as caixas, os certificados e as
propostas. Hoje quem não trabalha nele precisa abrir o sistema e caçar tela
por tela para perguntas como:

- "quais aparelhos o cliente X tem?", "quantos?"
- "quem tem tal aparelho?", "quantos clientes têm o modelo Y?"
- "quais clientes estão lá?"
- "esse aparelho (série Z) tem OS aberta?", "em qual caixa ele está?"
- "quantos aparelhos tem nessa caixa?"
- "o certificado desse aparelho já saiu?", "quando vence a calibração?"
- "qual proposta mandamos para o cliente X?", "qual o valor?"

A ideia é o Guardi responder isso **lendo o GestorHS como o dono**, no mesmo
molde do DataCore e do DocsHS (`datacore_consultas.py`, `docshs_consultas.py`).

O GestorHS é diferente dos outros sistemas num ponto: além dos que só
consultam (vendas, SDR, marketing), há quem **trabalhe** nele. A Expedição abre
caixas e lança os aparelhos nelas, o Laboratório gera certificados de
calibração, e Serviços (Comercial Pós-Vendas) faz propostas. Por isso o
trabalho tem duas fases:

1. **Fase 1 (esta spec):** consulta para todos.
2. **Fase 2 (spec própria, depois):** escrita para quem trabalha no Gestor.
   Abrir caixa e lançar aparelhos (Expedição), gerar certificado
   (Laboratório), montar proposta junto com o Guardi (Serviços). A escrita
   segue o padrão do TaskHS: o Guardi prepara, um cartão aparece e o dono
   confirma.

## Decisões do Erick (11/11/2026)

1. **A função do dono no GestorHS é a permissão do Guardi dele**, na leitura
   agora e na escrita na fase 2. "Se o Leandro tem função Financeiro no
   Gestor, é porque ele precisa, então o Guardi dele também consegue fazer o
   que o Financeiro consegue." O HS.OS não reimplementa nem restringe
   permissão; quem aplica é o GestorHS.
2. **Primeiro consulta para todos**, depois a escrita de quem trabalha no
   Gestor.
3. **Propostas entram na fase 1** (consulta). Serviços é quem mais vai usar, e
   a fase 2 deles é fazer propostas com o Guardi.
4. **Certificados entram na fase 1** (consulta). São importantes para
   Serviços, Laboratório, Suporte e Expedição.

## O que o reconhecimento mostrou (leitura do `~/github/GestorHS` e dos bancos, 11/11/2026)

- **Login:** JWT HS256 próprio, `{sub: usuario.id, tipo: "usuario"|"cliente",
  token_use: "access"}`. `get_current_usuario` fica em
  `backend/app/api/deps.py`. Não existe token de agente.
- **Leitura é aberta a qualquer usuário logado.** Toda rota GET de frota,
  clientes, OS, caixas, propostas e certificados usa só `get_current_usuario`.
  Pela decisão 1, então, todo Guardi lê tudo isso.
- **Escrita é por função** (`require_funcao`). Exemplos: `GESTOR_CADASTRO`,
  `CANCELA_OS`, o `_escrever` de propostas (Comercial Pós-Vendas, Financeiro,
  Administrador) e `GESTOR_CERT` (Laboratório, Administrador).
- **Função "Consulta"** (nov/2026): só leitura. A trava fica num ponto só,
  `_barrar_escrita_de_consulta` em `get_current_usuario`, e um teste varre as
  rotas. **O token de agente da fase 1 entra pela mesma trava**: qualquer
  método fora de GET/HEAD/OPTIONS dá 403.
- **Os 23 donos de Guardi têm conta ativa no GestorHS com o mesmo e-mail.** A
  spec de 05/11 dizia 17, e isso deixou de ser verdade. Por função: Consulta 7,
  Laboratório 3, Comercial Pós-Vendas 3 (Ellen, Leti e André, o setor
  Serviços), Financeiro 3 (Djalma, Leandro e Lidisay), Expedição 2,
  Qualidade 2, Administrador 2 e Suporte 1.
- **`/openapi.json` de produção é alcançável** (`gestorhsapi.healthsafetytech.com`,
  200). Os filtros podem sair dele, como no DataCore.
- **Telas do front** (para os links): `/app/clientes/:id`, `/app/equipamentos/:id`,
  `/app/ordens/:id`, `/app/caixas/:id`, `/app/propostas` (sem página por
  proposta), `/app/certificados`.

## O que a fase 1 entrega

### No HS.OS

Ferramentas `gestorhs_consultas` e `gestorhs_consultar` no `hsos-bot-<bot>`,
ativas quando `gestorhs` está em `sistemas_ligados`. O padrão é o do DataCore:
o agente escolhe uma **consulta do catálogo**, nunca um caminho. Filtros só
como query, `id` validado e teto de 12 mil caracteres no retorno.

Catálogo inicial (`app/gestorhs_consultas.py`). Chaves e caminhos ficam a
critério do construtor, mas a lista cobre as perguntas da Intenção:

| consulta | rota no GestorHS |
|---|---|
| aparelhos (frota): por cliente, modelo, status da calibração, série/patrimônio | `GET /equipamentos-cliente` |
| um aparelho | `GET /equipamentos-cliente/{id}` |
| histórico do aparelho | `GET /equipamentos-cliente/{id}/historico` |
| OS do aparelho (tem OS aberta?) | `GET /equipamentos-cliente/{id}/ordens` |
| certificados do aparelho | `GET /equipamentos-cliente/{id}/certificados` |
| quantos aparelhos e clientes por modelo | `GET /equipamentos-cliente/resumo-por-modelo` |
| modelos de aparelho (para filtrar por modelo) | `GET /equipamentos` |
| clientes: busca por nome/CNPJ, quem tem tal modelo | `GET /clientes` |
| um cliente | `GET /clientes/{id}` |
| OS: por fase, cliente, tipo, busca, período de chegada | `GET /ordens` |
| uma OS (traz a caixa) | `GET /ordens/{id}` |
| certificados de uma OS | `GET /ordens/{id}/certificados` |
| fases (para traduzir o número da fase) | `GET /fases` |
| caixas | `GET /caixas` |
| uma caixa, com as OS/aparelhos dela | `GET /caixas/{id}` |
| propostas | `GET /propostas` |
| uma proposta | `GET /propostas/{id}` |
| versões de uma proposta | `GET /propostas/{id}/versoes` |

**Duas URLs, duas envs** (chamada do Claude): `GESTORHS_API_URL`
(`https://gestorhsapi.healthsafetytech.com`, para as chamadas) e
`GESTORHS_URL` (`https://gestorhs.healthsafetytech.com`, o front, só para os
links). No DocsHS era um host só; aqui não é, e trocar uma pela outra quebra
os links ou faz a chamada receber o HTML da SPA.

**Links montados pelo servidor** (`GESTORHS_URL` + rota do front), como no
DocsHS. O agente nunca monta link. **Nenhum PDF passa pelo modelo.**
Certificado e proposta voltam como dado (número, data, validade, valor,
situação), e para o PDF o Guardi manda o link da tela no GestorHS.

**Ligar:** `publicar-bots-mcp.py --ligar-sistema <bot> gestorhs` para o
piloto no `erick-bot`, e depois um `--ligar-gestorhs-todos` que, como o do
DocsHS, liga só quem responde 200 no `GET /auth/me` de lá (ensaio sem
`--aplicar`). Ferramenta nova exige `publicar-bots-mcp.py --aplicar`
(`FERRAMENTAS_BOT`).

**`AGENTS.md` do template:** um ponteiro curto, "pergunta sobre aparelho,
cliente da calibração, OS, caixa, certificado ou proposta → `gestorhs_*`",
e a regra de que o 401/403 de lá vira "você não tem acesso a isso no
GestorHS". Levar aos bots vivos com
`criar-bots-pessoais.py --reescrever-agents-md`.

### No GestorHS (na sessão daquele repo, nunca daqui)

Vai para a seção "Para o GestorHS" abaixo, e é o que a spec de 05/11 já
previa, ajustado ao código de hoje.

## Fora da fase 1

- Qualquer escrita: abrir caixa, lançar aparelho, gerar certificado,
  criar/duplicar/alterar proposta, avançar OS ou caixa. Fica para a fase 2.
- Download de PDF (certificado, proposta) e exportações xlsx.
- Notas fiscais e cobrança. Não foram pedidas; entram quando alguém pedir.
- Portal de clientes, usuários, configuração de certificado, integrações.

## Anti-objetivos

- O Guardi mostrar menos ou mais do que o dono veria no GestorHS.
- O agente montar caminho ou link livre.
- Uma escrita escapar na fase 1 porque o GestorHS confiou no token de agente
  sem a trava de método.

## Para o GestorHS (sessão no repo `~/github/GestorHS`)

1. Variável `HSOS_AGENTE_CHAVE_PUBLICA` (PEM Ed25519, de
   `GET /agente/chave-publica` do HS.OS). Sem ela, o token de agente é
   recusado e tudo segue como hoje. ⚠️ O GestorHS usa `python-jose`, que **não
   verifica EdDSA**: o token de agente precisa de PyJWT (com `cryptography`)
   só para esse caminho, e o login de sempre continua no `jose`.
2. Em `get_current_usuario`, para um Bearer com `iss == "hsos"`: EdDSA,
   `aud == "gestorhs"`, `exp` (recusar se faltar mais de 600 s, como o
   TaskHS), usuário **por e-mail exato** (`sub`) e ativo. Tratar como
   `tipo=usuario`. Guardar `act.sub` no request, para log.
3. **Fase 1: só leitura para token de agente**, na mesma trava da função
   Consulta: método fora de GET/HEAD/OPTIONS → 403. Estender o teste que
   varre as rotas para cobrir o token de agente. Na fase 2 essa trava cede
   para as rotas de escrita escolhidas, e daí em diante vale o
   `require_funcao` da função do dono.
4. **Allowlist, não lista negra** (chamada do Claude, mesmo desenho do DocsHS
   e do DataCore): o token de agente só entra nas rotas GET do catálogo da
   fase 1 (a tabela acima) e em `GET /auth/me`. Qualquer outra, inclusive GET,
   dá 403. Isso deixa de fora, sem precisar lembrar uma por uma, notas
   fiscais (PDF/XML), PDFs de certificado e proposta, `/exportar`, logs de
   integração, configuração de certificado, usuários e portal. Rota nova de
   lá só chega ao Guardi entrando **nos dois** catálogos, aqui e lá. O motivo
   é que o catálogo do HS.OS limita o que o agente *pede*, e a allowlist de
   lá limita o que um token vazado *lê*.
5. `get_current_cliente` nunca aceita token de agente.
6. Testes no molde do TaskHS. Token válido entra como a pessoa, com a função
   dela. `aud` errado, vencido, de chave errada ou com e-mail inexistente →
   401. Token de agente em POST → 403, e em rota de auth → 403.
7. Changelog e deploy pelo fluxo de lá.

## Restrições

- Chamadas saem do backend do HS.OS com `httpx` para
  `gestorhsapi.healthsafetytech.com`, com token de agente de 5 minutos
  (`app/agente_token.py`, `aud: "gestorhs"`), registro em `agente_chamadas`
  e retorno como `como_dado_externo(..., origem="GestorHS")`.
- Mesmas guardas do `hsos-bot-<bot>`: só no turno do dono, e recusa se outra
  pessoa tiver turno aberto com o bot.
- Ordem de produção: deploy do GestorHS com o token de agente → env
  `GESTORHS_API_URL` e `GESTORHS_URL` no EasyPanel do HS.OS → deploy do HS.OS →
  `publicar-bots-mcp.py --aplicar` → piloto no `erick-bot` → ligar todos.

## Conferência

Perguntar ao `erick-bot` (Administrador lá) e a um Guardi de função Consulta
(por exemplo o de vendas) perguntas da Intenção cuja resposta o Erick confere
na tela do GestorHS: aparelhos de um cliente, OS aberta de uma série, número
de aparelhos de uma caixa, certificado de um aparelho, proposta de um cliente.
Pedir ao Guardi de Consulta que "abra uma caixa" deve dar recusa (na fase 1,
de qualquer pessoa).

## Para o construtor decidir

- Nomes das chaves do catálogo e o formato de saída (texto enxuto, poucas
  colunas). Traduzir o número da fase pelo `/fases` em vez de deixar o número.
- Filtros vindos do `/openapi.json` (como no DataCore) ou declarados à mão
  (como no DocsHS). O openapi está alcançável.
- Paginação local quando a rota limita a 100.
- O que fazer com a proposta, que não tem página própria no front: link para
  `/app/propostas`, ou nenhum link.
