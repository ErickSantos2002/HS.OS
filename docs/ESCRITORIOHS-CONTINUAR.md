# EscritorioHS — ponto de retomada

Atualizado em **16/10/2026, manhã**. Leia isto antes de mexer no
escritório virtual.

## Onde estamos

| peça | estado | onde ler |
|---|---|---|
| **A — escritório no ar** | ✅ em produção em `https://escritoriohs.healthsafetytech.com` | `escritoriohs/README.md`, spec/plano `docs/superpowers/*/2026-10-15-escritorio-virtual*` |
| **Mapa próprio da HS** | ✅ é a entrada (`/~/hs/hs.wam`) | `escritoriohs/mapa/README.md` |
| **B — ligação com o HS.OS** | 🟢 **no ar desde 16/10** (Admin API ligada no `wa`, mapa com `escritorio.js` enviado); falta aceite com gente e donos das salas | abaixo; spec `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`, plano `docs/superpowers/plans/2026-10-15-escritoriohs-b.md` |
| **C — agentes no escritório** | ⏳ depois do B; começa por sondagem | spec do A |

Conferência rápida (de qualquer máquina com SSH na VPS):

```bash
escritoriohs/testes/testar-config.sh            # config estática
escritoriohs/testes/verificar.sh tudo           # produção: 17 checagens (inclui `admin`)
(cd escritoriohs/mapa && .venv/bin/python -m pytest testes -q)   # gerador: 69 testes
(cd backend && ./.venv/bin/python -m pytest tests -q)            # 625 testes
```

## Sub-projeto B — o que já foi feito (15/10/2026)

Três agentes, um por frente, mesclados na `main` (`3034ae2`) depois de revisão
final; correções da revisão em `362b575`.

- **Backend** (`backend/app/escritorio/`, `routers/escritorio_wa.py`,
  `routers/escritorio.py`): Admin API do WA em `/escritorio-wa/api/*`, vigia de
  presença no `/ws/admin/rooms` do play, `GET /escritorio/presenca`,
  `GET /escritorio/meu-status?t=` (para o script do mapa), access log sem a
  query dessas rotas (o play manda o token Microsoft nela).
- **Front**: item "Escritório" no menu (abre em nova aba), bloco "No escritório
  agora" na lista do chat, 🏢 ao lado de quem está lá.
- **Mapa**: `"dono": "<e-mail>"` por sala na `planta.json` vira `ownerId`
  (planta vence o ar; sem dono na planta, vale o do ar); `script/escritorio.js`
  leva o status do HS.OS para o WA (Em reunião→Ocupado, Foco→Não perturbe,
  Almoço/Ausente→Já volto).
- Lista de salas do WA só com o EscritorioHS (`0ec47fa`): o `office` continua no
  map-storage como volta atrás, mas some da lista **quando a Admin API ligar**.

**Em produção já:**
- ✅ Backend do HS.OS com `ESCRITORIO_ADMIN_API_TOKEN`,
  `ESCRITORIO_ADMIN_SOCKETS_TOKEN`, `ESCRITORIO_EDITORES` (colados pelo Erick) e
  deploy feito. Conferido por `curl`: capabilities 200 `{}`, map sem token 403,
  raiz redireciona para o hs, `ti@` entra com editor e sem `username`, gmail
  recusado, lista de salas só com o hs, `meu-status` 401 com CORS `*`.
- ✅ `wa` reimplantado com o compose novo (variáveis da Admin API ainda
  **vazias** = escritório funciona como antes, sem perguntar ao HS.OS).
- ✅ Correção do login ("Service is not reachable" depois da Microsoft): buffer
  do nginx da `borda`, `c036efc`. **Lição:** deploy do `wa` não recarrega o
  nginx — foi preciso `docker restart escritoriohs_wa-borda-1` (está no README).
- O **front do HS.OS**: confirmar se o Erick fez deploy dele junto com o
  backend (o bloco "No escritório agora" só aparece com a presença ligada).

## O que aconteceu em 16/10/2026

- **Admin API ligada no `wa`** e deploy feito: `play` healthy com as 3
  variáveis, presença do Erick aparecendo no HS.OS. `verificar.sh tudo`: 17
  checagens (a raiz agora é 302 para a sala; ganhou a do `no-cache`).
- **Editor vira admin no WA:** as tags `["admin","editor"]` liberam mensagem
  global e gravação. A gravação não foi montada nem testada (LiveKit egress).
- **Móvel nunca é bloco** (decisão do Erick): os carimbos de blocos saíam
  quebrados — TV cortada, cadeira que era só o pé, mesa emendada. Tudo virou
  objeto da coleção; TV e quadros saíram (não há na coleção).
  `test_nenhum_movel_e_bloco` tranca.
- **Cache:** o map-storage manda `s-max-age` (inválido) e o navegador segurava
  o `hs.tmj` velho por horas — no Firefox do Erick, mesmo depois do
  Ctrl+Shift+R. A `borda` agora força `no-cache` no `/map-storage/`. Quem entrou
  antes de 16/10 pode precisar limpar os dados do site **uma vez**.
- ⚠️ O classificador do auto mode às vezes bloqueia o deploy pelo MCP e o
  `ssh` de leitura na VPS mesmo com a permissão dada; passa quando o Erick
  autoriza na própria conversa.

- **Carga de 28 pessoas / 20 câmeras:** não cabe nesta VPS (LiveKit no teto
  de 2 CPUs e preso depois do teste). VPS própria para a mídia **só se o
  escritório for adiante** (decisão do Erick). Números no `escritoriohs/README.md`.
- Pendente pequeno: o Console acusa
  `…/map-storageassets/entities/entities.json` (falta `/` na URL da coleção de
  objetos enviados pelo editor). Não afeta os móveis.

## ▶ Próximos passos, em ordem

Feitos em 16/10: 1, 2 e 4 (o 4 falta a conferência do status no navegador).

## ▶ Próximos passos, em ordem

Os valores dos tokens estão em `~/escritoriohs-b.env` (`600`). **Não imprimir**:
montar o bloco no clipboard por script, como foi feito:

```bash
f=~/escritoriohs-b.env; { echo "ADMIN_API_URL=https://hsosapi.healthsafetytech.com/escritorio-wa"; \
  echo "ADMIN_API_TOKEN=$(grep -oP '^ESCRITORIO_ADMIN_API_TOKEN=\K.+' $f)"; \
  echo "ADMIN_SOCKETS_TOKEN=$(grep -oP '^ESCRITORIO_ADMIN_SOCKETS_TOKEN=\K.+' $f)"; } | wl-copy
```

1. **Erick cola as 3 linhas** no Environment do serviço `wa` (acrescentar no
   fim, sem apagar nada) e salva.
2. **Deploy do `wa`** (o Claude pode: a permissão de `execute_destructive` do
   EasyPanel foi liberada pelo Erick; confirmar antes mesmo assim). Conferir:
   containers de pé (`play` healthy — se o HS.OS não responder `capabilities`
   o play não sobe), `verificar.sh tudo`, e no log do backend a presença
   conectando.
3. **Testes com gente:** Erick entra e vê o botão "Mapa" (editor); outra conta
   entra **sem** editor; lista de salas sem o Office; no HS.OS (chat) aparece
   "No escritório agora" com quem está lá; o 🏢 na lista de DMs.
4. **Enviar o mapa** (`escritoriohs/mapa/enviar.sh`), com ninguém no editor do
   navegador. Leva o `escritorio.js`. Depois, no navegador (F12 → Console),
   conferir "Loading map related script at …/escritorio.js" sem erro de
   CORS/MIME, e mudar o status no HS.OS para "Em reunião" → o avatar vira
   Ocupado em até 60 s.
5. **Donos das salas:** o Erick manda a lista "sala → e-mail"; pôr `"dono"` (e,
   se quiser, `"placa"` com o nome) em `escritoriohs/mapa/planta.json` e
   reenviar.
6. Atualizar este arquivo, o `CLAUDE.md` (seção EscritorioHS) e o README.

**Volta atrás** em qualquer ponto: apagar `ADMIN_API_URL` do `wa` e
reimplantar — `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL` continuam lá.

## Armadilhas que valem para o B

- ⚠️ **Com `ADMIN_API_URL` preenchida o escritório depende do HS.OS**: o play
  repete `capabilities` até responder e só então sobe. Backend do HS.OS fora =
  ninguém entra.
- ⚠️ `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL` ficam sem efeito com a Admin
  API — quem edita é `ESCRITORIO_EDITORES` (backend do HS.OS).
- ⚠️ A presença lê `ESCRITORIO_ADMIN_SOCKETS_TOKEN` só no boot do backend: token
  trocado exige reiniciar o backend.
- ⚠️ `ADMIN_API_URL` só no `play` (no `back`/`uploader` quebraria coisa);
  `testar-config.sh` confere.
- ⚠️ Envio do mapa com ninguém no editor do navegador (autosave).
- Não aceitos de propósito (registrados na revisão): o pet do avatar some;
  tirar `dono` da planta não limpa o dono do ar (limpa-se pelo editor).
- O card "EscritorioHS" na lista de salas mostra a miniatura do mapa antigo —
  cosmético, para depois.

## Pendências do Erick

- Colega **Nicholson** tentou entrar depois da correção do login? Confirmar.
- **Aceite com gente** (`escritoriohs/README.md`, seção Aceite): 4G (Coturn),
  6 pessoas numa reunião, tranca da sala com 2, 3 na Reunião 01, silenciosa,
  chat da bolha.
- **Token do R2 só para o backup** (hoje usa o do backend).
- Apagar `~/escritoriohs-env.sh` e `~/escritoriohs-backup-env.sh`.
  ⚠️ **Não apagar `~/escritoriohs.env`** (o `enviar.sh` lê o
  `MAP_STORAGE_AUTHENTICATION_TOKEN` dele) **nem `~/escritoriohs-b.env`** (tokens
  da Admin API).
- Apagar a branch remota `escritorio-a` (já mesclada).

## Lições que não estão em outro lugar

- O firewall que vale na VPS é o do **hPanel**, não o `ufw`.
- O Traefik do EasyPanel responde **101** em WebSocket mesmo sem serviço atrás,
  e troca 502 do serviço pela tela "Service is not reachable".
- O classificador de permissões bloqueia `updateComposeEnv` (env é o Erick que
  cola). Deploy pelo MCP (`deployComposeService`) foi liberado em 15/10/2026.
- **Nunca `git add -f`** em `escritoriohs/mapa/` (já levou a `.venv` ao histórico).
- Agente em worktree nasce do commit **anterior** ao HEAD atual às vezes —
  os três reposicionaram a branch no commit do plano; conferir a base.
