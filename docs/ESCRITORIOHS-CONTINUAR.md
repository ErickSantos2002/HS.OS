# EscritorioHS — ponto de retomada

Atualizado em **15/10/2026**, antes de compactar a conversa que construiu os
sub-projetos A e o mapa. Leia isto antes de mexer no escritório virtual.

## Onde estamos

| peça | estado | onde ler |
|---|---|---|
| **A — escritório no ar** | ✅ em produção em `https://escritoriohs.healthsafetytech.com` | `escritoriohs/README.md`, spec/plano `docs/superpowers/*/2026-10-15-escritorio-virtual*` |
| **Mapa próprio da HS** | ✅ é a entrada (`START_ROOM_URL=/~/hs/hs.wam`) | `escritoriohs/mapa/README.md`, spec/plano `docs/superpowers/*/2026-10-15-escritoriohs-mapa*` |
| **B — ligação com o HS.OS** | ⏳ próximo: spec + plano + execução por agentes | abaixo |
| **C — agentes no escritório** | ⏳ depois do B; começa por sondagem | spec do A, tabela dos sub-projetos |

**Link para as pessoas:** `https://escritoriohs.healthsafetytech.com` (login
Microsoft, empresa inteira — sem grupo, "Assignment required = No").

Conferência rápida de tudo, de qualquer máquina com SSH na VPS:

```bash
escritoriohs/testes/testar-config.sh            # config estática
escritoriohs/testes/verificar.sh tudo           # produção: 14 checagens
(cd escritoriohs/mapa && .venv/bin/python -m pytest testes -q)   # gerador: 46 testes
```

## Sub-projeto B — o que o Erick quer (15/10/2026)

**Os cinco**, todos:

1. **Entrar no escritório a partir do HS.OS** — botão/atalho no HS.OS.
2. **Ver no HS.OS quem está no escritório agora.**
3. **Integrar o status** que já existe no perfil do HS.OS (`use-user-status`).
4. **Admin API** — o WA pergunta ao HS.OS quem entra e quem edita o mapa.
5. **Dono de cada sala** — nome da pessoa na placa; a área pessoal ganha dono.

**Como o Erick quer o trabalho:** sem perguntas de escolha — seguir o
recomendado, escrever spec e plano, e **mandar um agente executar cada frente
em branch/worktree separada**, para ficar pronto o mais rápido possível.
Agentes em paralelo só onde os arquivos não se cruzam (ver armadilhas).

### Armadilhas já conhecidas para o B

- ⚠️ **`MAP_EDITOR_ALLOWED_USERS` é ignorada quando existe Admin API.** O item
  4 tem que levar a permissão do editor junto (só o Erick edita), na mesma
  entrega — senão o editor abre para todos, sem erro.
- ⚠️ **Dono da sala:** o envio do mapa (`escritoriohs/mapa/enviar.sh` →
  `mesclar.py`) **preserva** `ownerId`/`allowedTags` das áreas pessoais do ar.
  Atribuir dono pelo navegador ou pela API sobrevive aos envios. A placa com o
  nome é bloco: trocar `"placa"` em `escritoriohs/mapa/planta.json` e reenviar.
- ⚠️ **Envio do mapa com ninguém no editor do navegador** — o map-storage
  autosalva; edição durante o envio se perde.
- ⚠️ O e-mail é a ponte WA ↔ HS.OS (`OPENID_SCOPE=openid email profile`,
  nome do avatar `force_opid` vindo do Entra).
- ⚠️ Itens 1–3 mexem no front do HS.OS (`ChatPage`/`AppSidebar`/`use-user-status`);
  4 e 5 no backend (rotas novas) e no EasyPanel (`ADMIN_API_URL`/`ADMIN_API_TOKEN`
  do serviço `wa`). Dois agentes no mesmo arquivo se atropelam: separar por
  arquivo, não por item.
- O Claude **não grava variável de ambiente no EasyPanel** (regra de segurança
  bloqueia `updateComposeEnv`): monta o bloco e o Erick cola.

## Pendências do Erick

- **Aceite com gente** (`escritoriohs/README.md`, seção Aceite): recusa de
  conta de fora · 4G (Coturn) · 6 pessoas numa reunião · tranca da sala com 2
  pessoas · 3 na Reunião 01 na mesma chamada · silenciosa · chat da bolha ·
  outra conta não vê o botão "Mapa".
- **Colega que não conseguiu entrar** pelo link de teste — causa não achada
  nos logs; pedir print se repetir.
- Decidir sobre **convidados B2B** do diretório (entram hoje).
- **Token do R2 só para o backup** (hoje usa o do backend).
- Apagar `~/escritoriohs-env.sh` e `~/escritoriohs-backup-env.sh`.
  ⚠️ **Não apagar `~/escritoriohs.env`**: o `enviar.sh` do mapa lê dele o
  `MAP_STORAGE_AUTHENTICATION_TOKEN`. Se quiser enxugar, deixar só essa linha.
- Apagar a branch `escritorio-a` do GitHub (já mesclada).

## Lições desta rodada que não estão em outro lugar

- O firewall que vale na VPS é o do **hPanel**, não o `ufw`.
- O Traefik do EasyPanel responde **101** em WebSocket mesmo sem serviço atrás.
- `createComposeService` do MCP do EasyPanel com `source`+`domains` juntos falha.
- **Nunca `git add -f`** em `escritoriohs/mapa/`: nada lá é ignorado por engano,
  e o `-f` levou a `.venv` (1.399 arquivos) para o histórico — tirada antes do
  push com `filter-branch`.
