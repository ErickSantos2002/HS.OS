# Automações do Claude Code para o HS.OS

Recomendações levantadas em 01/09/2026 varrendo este repositório (541 arquivos versionados,
248 rotas FastAPI, 327 arquivos em `frontend/src`). **Este documento só documenta** — nada
foi criado em `.claude/`, nenhum hook, agente ou skill foi escrito. Todo bloco de config
abaixo está pronto para colar.

Hoje o projeto **não tem `.claude/`**. A configuração é do zero.

---

## ALERTA DE SEGURANCA

### Nenhum segredo versionado — e como isso foi conferido

Varri os 541 arquivos rastreados procurando JWT (`eyJhbGciOi`), chaves de provedor
(`sk-proj`, `sk-ant-`, `AKIA`, `ghp_`, `sb_secret_`), chaves privadas (`BEGIN PRIVATE KEY`,
`BEGIN RSA`) e atribuições literais do tipo `senha|password|secret|token|api_key = "<16+ chars>"`.
**Zero achados em código.** As três únicas ocorrências dos padrões são referências legítimas:
duas linhas de `frontend/src/integrations/supabase/client.ts` que testam o *formato* da chave,
e um hash de integridade no `package-lock.json`.

Os três `.example` versionados (`backend/.env.example`, `backend/.env.bancos.example`,
`frontend/.env.example`) são templates com valores vazios ou marcadores explícitos
(`troque-por-um-segredo-forte`). Estão certos.

⚠️ **Esta varredura é do estado atual da árvore, não do histórico do git.** Não conferi commits
antigos. Como o remix veio com 2 commits e o `.gitignore` já nasceu com `.env` bloqueado, o risco
é baixo — mas se quiser certeza, `gitleaks detect` cobre o histórico e leva um minuto.

### O que merece ação, em ordem

**1. 🔴 A senha padrão do `super_admin` está em texto aberto num repositório público.**

Ela aparece em quatro arquivos versionados, e dois deles a listam como pendência com as
palavras *"antes de liberar para a equipe"*. Documentar senha de desenvolvimento é normal
**enquanto o repositório é fechado**; este é público, e a conta em questão é a que guarda o
`OPENCLAW_ADMIN_TOKEN`.

Este documento não repete o valor nem o mapa de onde ele está — some quando a senha for
trocada, e até lá não há por que facilitar. O endpoint existe (`POST /auth/trocar-senha`) e a
tela está pronta.

⚠️ **Trocar a senha não apaga o histórico.** Ela fica nos commits antigos de qualquer jeito;
trocar é o que a torna inútil.

Nenhuma automação resolve isso — é um clique. Mas o hook de proteção abaixo evita a próxima
variação do problema.

**2. Quatro `.env` com credencial real estão no disco e o Claude consegue lê-los.**

```
backend/.env               DATABASE_URL de produção, JWT_SECRET, token do gateway
backend/.env.bak
backend/.env.bancos        usuários dos bancos da empresa
backend/.env.superusuario  ← pelo nome, credencial de superusuário do Postgres
```

Confirmei que **os quatro estão fora do versionamento** (`git ls-files` não os lista; o
`.gitignore` os pega em `.env` + `.env.*`). O git está certo. O que não existe é trava do lado
do agente: qualquer `Read` ou `cat` nesses caminhos entrega a credencial para dentro do contexto
da conversa, e daí para o transcript em `~/.claude/projects/`. O `.env.superusuario` é o mais
sensível — pelo combinado do `CLAUDE.md` da máquina, o Claude não lê o `admin.toml` dos bancos
pelo mesmo motivo, e essa regra hoje não tem equivalente aqui.

→ **Hook 1** fecha isso.

**3. Endereços de produção versionados, num repositório público.**

Os IPs das duas VPS, o domínio da API e a porta de SSH estão todos em arquivos rastreados.
É informação de operação, não credencial — e a premissa que a tornaria aceitável ("é um repo
fechado") não vale aqui: `ErickSantos2002/HS.OS` é **público**, conferido em 01/09/2026.

Junto com o item 1, deixa de ser reconhecimento e vira roteiro. Decisão consciente do Erick em
01/09: o repositório continua público — então o que resolve é o item 1, não esconder endereço.

---

## Perfil do projeto

| | |
|---|---|
| **Forma** | Monorepo `frontend/` + `backend/` |
| **Front** | React 18 + Vite 5 + TypeScript + shadcn/ui + TanStack Query · 208 `.tsx`, 129 `.ts` |
| **Back** | FastAPI + asyncpg + Postgres próprio · 69 `.py`, 25 routers, 248 rotas |
| **Testes** | Vitest (3 arquivos) + pytest (7 arquivos) — cobertura real baixa |
| **Lint** | ESLint 9 flat config. **Não há Prettier** neste repositório |
| **Migrations** | 14 arquivos SQL sequenciais, `001` gerado e imutável |
| **CI** | Nenhuma. Não existe `.github/` |
| **Externo** | OpenClaw Gateway via WebSocket/JSON-RPC, atrás de túnel SSH na 18789 |

Três traços deste projeto que mandam nas recomendações abaixo:

- **A dívida é de migração, não de arquitetura.** O `_legado/` guarda o que ainda fala Supabase
  (todas as 5 chamadas `.from(` e as 15 `functions.invoke` vivas estão lá dentro, mais uma numa
  string de documentação — a afirmação do `CLAUDE.md` de que o front está limpo **confere**).
  A direção é só uma, e vale automatizar a guarda dela.
- **O repositório já tem cinco scripts de auditoria escritos** (`backend/scripts/auditar_*.py`,
  `frontend/scripts/auditar_orfaos.py`, `scripts/conferir-contratos.py`). Automação aqui é
  ligar o que existe, não inventar.
- **A documentação é enorme e cara.** `CLAUDE.md` tem 1.109 linhas (67 KB) e `docs/` tem 4.754.
  O `CLAUDE.md` inteiro entra no contexto **de toda sessão**, inclusive quando a tarefa é mexer
  numa tela de React que não toca o gateway. Ver "Emagrecer o CLAUDE.md" no fim.

---

## ⚡ Hooks

### Hook 1 — Proteger segredo e arquivo gerado (o mais importante)

**Por quê:** resolve o item 2 do alerta acima e mais três armadilhas que o `CLAUDE.md` já
documenta em prosa e que hoje dependem de eu lembrar: *"Não edite o `001`"*, *"arquivos gerados —
não editar à mão"*, e o lockfile canônico. Prosa em `CLAUDE.md` é lida; hook é obedecido.

Salvar como `.claude/hooks/proteger-arquivos.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# Recusa leitura de segredo e escrita em arquivo gerado.
# Sai 0 sempre: quem decide é o JSON no stdout, não o código de saída.
set -uo pipefail

entrada=$(cat)
caminho=$(printf '%s' "$entrada" | jq -r '.tool_input.file_path // empty')
[ -z "$caminho" ] && exit 0

rel=${caminho#"${CLAUDE_PROJECT_DIR:-$PWD}"/}
nome=$(basename "$caminho")

recusar() {
  jq -n --arg m "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $m
    }
  }'
  exit 0
}

# --- segredos: qualquer .env que não seja modelo ---
case "$nome" in
  .env|.env.*)
    case "$nome" in
      *.example) ;;
      *) recusar "Credencial real ($nome). Todas as chaves estão documentadas no .env.example ao lado — use ele. Se precisar do VALOR, peça ao Erick." ;;
    esac ;;
esac

# --- arquivos gerados / imutáveis ---
case "$rel" in
  backend/migrations/001_initial_schema.sql)
    recusar "Gerado por migrations/_origem/regerar-001.sh. Mudança de schema vai numa migração nova (014+). Ver backend/migrations/README.md." ;;
  backend/migrations/000_compat_supabase.sql)
    recusar "Base de compatibilidade escrita à mão; sem ela o 001 falha com 213 erros. Alterar só com combinação explícita." ;;
  frontend/src/integrations/supabase/types.ts)
    recusar "~2950 linhas geradas pelo Supabase CLI. Não editar à mão." ;;
  frontend/src/integrations/supabase/client.ts)
    recusar "Gerado, e o fetch customizado dele é deliberado (chave opaca sb_publishable_/sb_secret_ manda só apikey). Ver CLAUDE.md > Arquivos gerados." ;;
  *package-lock.json)
    recusar "Lockfile canônico. Mexer via 'npm install' em frontend/, nunca à mão — a imagem usa 'npm ci' e falha se divergir." ;;
esac

exit 0
```

**Refinamento opcional:** o hook cobre `Read`/`Edit`/`Write`, não `cat backend/.env` via Bash.
Para fechar também isso, adicione um segundo matcher `Bash` lendo
`.tool_input.command` e recusando quando casar com `\.env($|[^.]|\.(?!example))`. Deixei de fora
do bloco principal porque falso positivo em Bash irrita mais do que ajuda — ligue se achar que
vale.

---

### Hook 2 — ESLint no que eu acabei de editar

**Por quê:** não há Prettier aqui, então ESLint é o formatador e o linter ao mesmo tempo, e
`npm run lint` roda no projeto inteiro (72 mil linhas) — caro demais para rodar a cada edição.
Rodar só no arquivo tocado custa menos de um segundo e evita a viagem "editei 8 arquivos, agora
descubro 8 problemas de uma vez".

`.claude/hooks/lint-do-arquivo.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
caminho=$(cat | jq -r '.tool_input.file_path // empty')
case "$caminho" in
  */frontend/src/*.ts|*/frontend/src/*.tsx) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$PWD}/frontend" || exit 0
if ! saida=$(npx --no-install eslint --fix "$caminho" 2>&1); then
  printf 'ESLint reprovou %s:\n%s\n' "$caminho" "$saida" >&2
  exit 2   # 2 = devolve o texto para o Claude corrigir
fi
exit 0
```

---

### Hook 3 — Estado do ambiente no início da sessão

**Por quê:** esta é a automação mais específica do HS.OS que existe. O `CLAUDE.md` diz, com
todas as letras, que sem o túnel *"tudo que depende dele responde `Connection refused`"* e que
**"o sintoma é confuso"**. Ele é confuso porque o erro chega três camadas abaixo de onde a
pessoa está trabalhando. Descobrir isso na primeira linha da sessão, de graça, vale mais do que
qualquer subagente desta lista.

`.claude/hooks/estado-do-ambiente.sh`:

```bash
#!/usr/bin/env bash
# SessionStart: o stdout entra no contexto da conversa.
porta_viva() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

echo "── Ambiente HS.OS ──"

if porta_viva 18789; then
  echo "✅ Túnel OpenClaw de pé (127.0.0.1:18789)."
else
  echo "⚠️  TÚNEL FECHADO. Gateway, agentes, chat, crons e skills vão responder"
  echo "    'Connection refused' — o erro aparece longe da causa. Subir com:"
  echo "    bash scripts/tunel-openclaw.sh   (ou o systemd --user equivalente)"
fi

porta_viva 8002 && echo "✅ Backend na 8002." \
                || echo "ℹ️  Backend fora do ar (porta 8002 — NÃO 8000/8001, que são de outros projetos)."
porta_viva 8080 && echo "✅ Vite na 8080."

echo "── migração: última é $(ls backend/migrations/0*.sql 2>/dev/null | tail -1 | xargs -r basename) ──"
```

⚠️ Rode `chmod +x` nos três. Hook sem bit de execução falha em silêncio e o sintoma é
"o hook não faz nada".

---

### Hook 4 — Não reintroduzir o Supabase (complementar)

**Por quê:** o `CLAUDE.md` abre com a instrução *"não acrescente dependência do Supabase que
depois vai ter que ser desfeita"*. É uma regra binária e verificável — caso de hook, não de
lembrete. A quarentena `_legado/` fica de fora de propósito.

`.claude/hooks/sem-supabase-novo.sh`, em `PostToolUse`:

```bash
#!/usr/bin/env bash
set -uo pipefail
caminho=$(cat | jq -r '.tool_input.file_path // empty')
case "$caminho" in
  */frontend/src/_legado/*) exit 0 ;;          # quarentena, pode
  */frontend/src/*.ts|*/frontend/src/*.tsx) ;;
  *) exit 0 ;;
esac

if grep -q "integrations/supabase" "$caminho" 2>/dev/null; then
  echo "⚠️ $caminho passou a importar o client do Supabase fora de _legado/." >&2
  echo "A direção da migração é a oposta (CLAUDE.md, primeiro bloco): o front está" >&2
  echo "limpo hoje — zero chamadas vivas. Use a API própria em backend/app/routers/." >&2
  exit 2
fi
exit 0
```

---

### Hook 5 — pytest do backend (complementar)

**Por quê:** os 7 testes de `backend/tests/` são funções puras com cliente falso — o próprio
`requirements-dev.txt` diz que nem precisam de event loop compartilhado. Rodam em segundos, o
que os torna baratos o bastante para rodar a cada edição no `app/`.

Em `PostToolUse`, comando único (não precisa de script):

```bash
jq -r '.tool_input.file_path // empty' \
  | grep -q 'backend/app/.*\.py$' \
  && "$CLAUDE_PROJECT_DIR/backend/.venv/bin/python" -m pytest "$CLAUDE_PROJECT_DIR/backend/tests" -q 2>&1 | tail -20 \
  || true
```

---

### `.claude/settings.json` — os cinco hooks juntos

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/proteger-arquivos.sh" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/lint-do-arquivo.sh" },
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/sem-supabase-novo.sh" },
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // empty' | grep -q 'backend/app/.*\\.py$' && \"$CLAUDE_PROJECT_DIR/backend/.venv/bin/python\" -m pytest \"$CLAUDE_PROJECT_DIR/backend/tests\" -q 2>&1 | tail -20 || true"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/estado-do-ambiente.sh" }
        ]
      }
    ]
  }
}
```

---

## 🤖 Subagentes

Ficam em `.claude/agents/<nome>.md`. Os três abaixo atacam classes de erro que este repositório
**já catalogou como recorrentes** — não são revisores genéricos.

### `revisor-gateway`

**Por quê:** o `CLAUDE.md` tem mais de vinte blocos ⚠️ só sobre o gateway, e vários registram
o mesmo enredo: o código parecia certo, o gateway aceitou, e o defeito apareceu dias depois.
`Hub.publicar` chamado com 2 argumentos em vez de 3 e o push nunca funcionando *por semanas*.
O `(r.get("payload") or r)` devolvendo o job em vez do envelope no `cron.add`, produzindo
HTTP 201 com `gateway_job_id` nulo e jobs órfãos. `sessionKey` mandada sem o prefixo composto,
derrubando **todos** os avisos ao agente líder em silêncio. Nenhum desses é pego por `tsc`,
ESLint ou pytest — todos são pegos por alguém que conhece a lista.

```markdown
---
name: revisor-gateway
description: Revisa código que fala com o OpenClaw Gateway. Use SEMPRE que a mudança tocar backend/app/gateway/, backend/app/routers/{agents,gateway,llm,skills,integracoes}.py, os guardiões, o vigia de sessões ou qualquer chamada a chamar(). Confere a lista de armadilhas já catalogadas do protocolo.
tools: Read, Grep, Glob, Bash
model: sonnet
---

Você revisa código que conversa com o OpenClaw Gateway. O contrato inteiro está no
`CLAUDE.md` da raiz — leia as seções "Gateway", "chat.send", "Agendamento (cron.*)"
e "Configurar LLM" antes de opinar.

Confira, item por item, e cite arquivo:linha em cada achado:

1. **Desembrulho.** `(r.get("payload") or r)` está certo em `cron.list`, `agents.list`,
   `config.get`, `models.list`, `sessions.list`. Está ERRADO em `cron.add`, `cron.get`
   e `cron.update`, que devolvem o job no topo — e o job tem um campo `payload`, então
   o idioma devolve o objeto errado sem levantar erro. Método novo que devolva objeto
   de domínio: usar `r` direto.
2. **`Hub.publicar` é síncrono e tem três argumentos** `(topico, tipo, dados)`. Sem
   `await`. Empacotar o tipo no dicionário levanta TypeError.
3. **`chat.send`** — `agentId` sempre explícito (sem ele vai para o agente padrão, sem
   aviso); `sessionKey` sempre composta `agent:<id>:<sufixo>`; `idempotencyKey`
   obrigatório.
4. **Ordem de escrita:** gateway primeiro, banco depois. Se o gateway recusar, nada é
   gravado e a rota devolve 502. O contrário — gravar e seguir com um warning — é o
   padrão herdado das edges e produz banco e agente discordando.
5. **Escopo.** Método novo pode precisar de scope novo em `SCOPES` (`client.py`).
   `missing scope` é falha de lista, não de token.
6. **`cron.list` sem `includeDisabled` omite job desligado.** Toda tela que lista
   agendamento precisa do parâmetro, senão o botão de religar some junto com o job.
7. **Erro de conexão logo após `config.patch` NÃO significa que não gravou** — o patch
   dispara reload e o reload derruba o socket. Releia antes de concluir falha.
8. **O gateway não valida quase nada na escrita.** `agents.update` grava modelo
   inexistente; `cron.add` aceita `agentId` que não existe; `cron.update` aceita
   `delivery.mode` fora do enum. Toda escrita precisa de releitura conferindo o efeito.

Não sugira sondar método de escrita para descobrir formato. Se faltar informação sobre
o protocolo, diga o que falta e pare.
```

### `auditor-de-autorizacao`

**Por quê:** o histórico é explícito. `POST/PATCH/DELETE /agents/{id}/crons` ficaram em
"só logado" — *escrita*, não leitura — até 14/08/2026: qualquer pessoa autenticada apagava
agendamento de qualquer agente. `PUT/DELETE /configuracoes/{chave}` idem, numa tabela que é
global por instalação. E a página que entregava os sete arquivos do agente, incluindo o
`SOUL.md` que o próprio agente recusa mostrar. São **248 rotas** e só **12 dos 25 routers**
mencionam `exige_papel`. O `CLAUDE.md` fecha a seção com a frase certa: *"Esconder no menu não
é fechar"*.

```markdown
---
name: auditor-de-autorizacao
description: Audita autorização de rotas FastAPI. Use ao criar ou alterar qualquer rota em backend/app/routers/, e antes de qualquer PR que mexa em rota. Verifica exige_papel/exige_segredo e cruza com quem consome no front.
tools: Read, Grep, Glob, Bash
model: sonnet
---

Você audita quem pode chamar o quê no HS.OS. Comece rodando o script que já existe:

    python3 backend/scripts/auditar_auth_das_rotas.py

Ele classifica cada rota em papel:X / segredo / so logado / SEM AUTH. Depois, para cada
rota nova ou alterada no diff:

1. **Escrita (POST/PUT/PATCH/DELETE) sem `exige_papel` é achado**, a menos que haja
   justificativa escrita. Foi exatamente assim que os crons de agente ficaram abertos.
2. **Leitura pode ser aberta, mas confira O QUE ela devolve.** `GET /agents` é aberto ao
   colaborador de propósito — mas só porque `systemPrompt` volta vazio e `tokensUsed`
   zerado. Campo novo num payload aberto é vazamento novo.
3. **`app_settings` é global por instalação, não por pessoa.** Rota de escrita ali é
   `administrador`, sempre.
4. **Papel é acesso ao sistema, não hierarquia da empresa.** O CEO é `colaborador`. Não
   proponha fechar rota "porque colaborador é menos importante" — o critério é o dado.
5. **Não afrouxe `exige_papel` para alimentar tela nova.** Se o `AgentResumoPanel`
   precisa de um dado a mais, o dado vem de endpoint já aberto ao colaborador; foi para
   isso que ele existe em vez de condicional dentro do `AgentDetailPanel`.

Verificação que vale: token de colaborador emitido na mão com `emitir_token(...)`,
batendo na API direto. Sumir do menu não é resposta.
```

### `revisor-de-contrato-api` (complementar)

**Por quê:** classe de erro com três ocorrências datadas nesta migração, e o
`scripts/conferir-contratos.py` foi escrito exatamente para ela — mas o docstring do próprio
script admite que o regex não cobre `Record<...>`, *que é a forma do bug que motivou o script*.
Ou seja: aqui existe um buraco conhecido que só leitura humana (ou de agente) fecha.

```markdown
---
name: revisor-de-contrato-api
description: Confere se os campos que o front declara existem mesmo na resposta da API. Use quando o diff mexer ao mesmo tempo em backend/app/routers/ e frontend/src/, ou quando uma tela "não funciona" mas a rota responde 200.
tools: Read, Grep, Glob, Bash
model: sonnet
---

O sintoma desta classe de erro é sempre o mesmo: **a rota responde 200 e a tela não
funciona.** O TypeScript não pega, porque `api<{ label: string }>(...)` é uma afirmação
sobre o que vem da rede, não uma verificação.

Rode primeiro o script que existe (precisa do backend de pé e de um token):

    python3 scripts/conferir-contratos.py --token "<token>"

Depois cubra à mão o que ele NÃO cobre — está no docstring dele:

- rota com parâmetro na URL, e todo POST/PUT/DELETE;
- chamadas na forma `api<{ x: T[]; y: Record<string, string> }>` — o `>` interno fecha o
  genérico cedo demais e a chamada é ignorada **em silêncio**. Testado: reintroduzindo o
  bug do `/gateway/models`, o relatório continuou limpo.

Para cada par rota↔tela do diff, leia o `return` do router e o genérico do `api<...>` e
compare campo a campo. Achado é `arquivo:linha` dos dois lados.
```

---

## 🎯 Skills

Ficam em `.claude/skills/<nome>/SKILL.md`.

### `/auditar-hsos` — ligar os cinco scripts que já existem

**Por quê:** o repositório tem cinco auditorias escritas e nenhuma forma de lembrar que elas
existem. Vira um comando.

⚠️ **Os scripts têm caminho absoluto embutido** (`RAIZ = pathlib.Path("/home/ericks/github/HS.OS/...")`
em `auditar_auth_das_rotas.py` e `auditar_orfaos.py`, pelo menos). Funcionam nesta máquina e
quebram em qualquer outra. Se um dia o repositório sair daqui, trocar por caminho relativo é
pré-requisito.

```markdown
---
name: auditar-hsos
description: Roda as cinco auditorias do repositório e resume os achados em ordem de gravidade.
disable-model-invocation: true
---

Rode as cinco, na ordem, e **resuma** — não despeje a saída bruta:

| script | pergunta que responde |
|---|---|
| `backend/scripts/auditar_auth_das_rotas.py` | quais rotas estão SEM AUTH |
| `backend/scripts/auditar_rls.py` | as policies de RLS batem com o esperado |
| `backend/scripts/auditar_deriva_schema.py` | o banco divergiu das migrations |
| `backend/scripts/auditar_rotas_sem_chamador.py` | rota que ninguém chama |
| `frontend/scripts/auditar_orfaos.py` | arquivo do front que ninguém importa |

Ordene os achados por gravidade: escrita sem autorização primeiro, deriva de schema
depois, código morto por último.

⚠️ **Rota sem chamador não é necessariamente rota para apagar.** `POST /agents/{id}/crons`
passou meses sem um único chamador e a conclusão certa era "a tela nunca foi ligada", não
"apagar a rota". Ao reportar, diga qual das duas parece ser o caso e por quê.

⚠️ **Arquivo órfão no front também não é.** Grep pelo nome do componente não serve (casa
com import e comentário), e a conferência que o `CLAUDE.md` recomendava até 07/08 dava 11
de 21 páginas vivas — errando para o lado de fazer página em uso parecer morta. Confira no
`App.tsx` antes de sugerir remoção.
```

### `/nova-migracao` — andar o schema sem quebrar a regra

**Por quê:** as migrations são sequenciais (`000`…`013`), o `001` é gerado e não pode ser
editado, e o `000` precisa rodar antes senão o `001` falha com 213 erros. Três regras que se
esquecem exatamente quando se está com pressa.

```markdown
---
name: nova-migracao
description: Cria a próxima migração SQL do backend, numerada e com o cabeçalho do padrão do repo.
disable-model-invocation: true
---

1. Descubra o próximo número: `ls backend/migrations/0*.sql | tail -1`. Hoje a última é a
   `013_crons_no_gateway.sql`, então a próxima é a `014`.
2. Crie `backend/migrations/0NN_<assunto-em-kebab>.sql`. Nome em português, como o resto.
3. Cabeçalho no padrão do repositório: um comentário explicando **por que** a mudança
   existe, não o que o SQL faz. O SQL já diz o que faz.
4. Idempotência sempre que der: `IF NOT EXISTS`, `IF EXISTS`, `ON CONFLICT DO NOTHING`.
5. Se criar tabela, decida o RLS **na mesma migração** — deixar para depois é como as
   policies ficam inconsistentes.

⚠️ Nunca edite `001_initial_schema.sql` (gerado por `_origem/regerar-001.sh`) nem
`000_compat_supabase.sql`. Toda mudança de schema vai num arquivo novo.

⚠️ Se a migração precisar de escrita ou DDL no Postgres de produção, **não rode**: monte o
script e peça ao Erick rodar no Konsole. É o mesmo combinado do `sudo` e do `admin.toml`.

Ao terminar, atualize `backend/migrations/README.md` e o placar do `docs/ROADMAP.md`.
```

### `/publicar-skill-agente` — e a diferença entre publicada e usada

**Por quê:** este é o caso mais instrutivo do repositório. A skill `faturamento` foi publicada,
o gateway listou, a `iris` **confirmou que a enxergava e leu o título dela** — e na pergunta real
respondeu do jeito antigo, R$ 654.645,95 em vez de R$ 441.712,80. **48% a mais.** O que faltava
era um ponteiro curto num dos sete arquivos. Uma skill que não carrega essa regra junto vai
repetir o erro.

```markdown
---
name: publicar-skill-agente
description: Publica uma skill no OpenClaw e faz a conferência que realmente prova que ela está sendo usada.
disable-model-invocation: true
---

1. Escreva `backend/skills/<slug>/SKILL.md`. Régua de negócio da HS **não se inventa**:
   a autoridade é `~/projetos/relatorios-hsgrowth/`, `~/projetos/extracao-consultoria/DESIGN.md`
   e o repositório do sistema de origem. Ao divergir, o número do painel manda.
2. Publique: `bash scripts/publicar-skills.sh --enviar` (exige o túnel de pé).
3. **Adicione o ponteiro.** Carregar sob demanda depende de o agente LEMBRAR que a skill
   existe, e isso varia com o modelo. Num dos sete arquivos — normalmente o `AGENTS.md` —
   entra uma linha curta: "pergunta sobre X começa abrindo a skill Y". O procedimento longo
   fica na skill; nos sete entra só o gatilho.
4. **Conferência.** `skills.status` mostrando o nome só prova que o arquivo chegou. A prova
   é fazer ao agente a **pergunta real** e conferir o número contra a fonte. Perguntar "você
   enxerga a skill?" não serve — a `iris` respondeu que sim e errou a resposta seguinte.

⚠️ Âncora de verificação só serve se exercitar exatamente o que pode estar errado. O caso
`MESES_ANALISE` passou por **três** conferências com ✅ porque todas validavam um mês
fechado, e o erro estava no recorte do trimestre. Conferir outra coisa e dar certo é pior
que não conferir — dá confiança.
```

---

## 🔌 MCP Servers

### Já disponíveis nesta máquina — nada a instalar

| servidor | situação | uso aqui |
|---|---|---|
| **context7** | ativo (`plugin:context7`) | doc ao vivo de TanStack Query v5, TipTap 3, FastAPI, Radix. O front tem ~90 dependências e várias em versão recente demais para memória de modelo |
| **Playwright** | ativo (`plugin:playwright`) | ⚠️ **é o único caminho de E2E que funciona hoje.** `frontend/playwright.config.ts` importa `lovable-agent-playwright-config`, que **não está no `package.json`** — `npx playwright test` não roda. A pasta `.playwright-mcp/` mostra que o MCP já vem sendo usado. Ou adicione a dependência, ou apague o config e fique com o MCP |
| **Semgrep** | ativo | vale uma passada, dado o item 1 do alerta |

### GitHub MCP — **quebrado, e vale consertar**

Está configurado e falhou ao conectar nesta sessão:

```
plugin:github:github (400): "Error POSTing to endpoint: bad request: Authorization header is badly formatted"
```

É formato do header, não permissão — normalmente token expirado ou com espaço/quebra de linha
sobrando. Reautentique com `claude mcp` numa sessão interativa. Sem ele não há leitura de PR nem
de issue a partir daqui, e como **o projeto não tem CI** (`.github/` não existe), o GitHub é o
único ponto de integração que sobraria.

### Postgres somente-leitura — o que falta

**Por quê:** existe `backend/scripts/auditar_deriva_schema.py` justamente porque a pergunta
"o banco bate com as migrations?" aparece o tempo todo, e hoje ela custa um script. Com um MCP
de Postgres apontando para o `hsos`, vira pergunta direta — e `information_schema` deixa de ser
adivinhação, que é literalmente a instrução que o `CLAUDE.md` dá para os agentes.

⚠️ **Não consegui verificar o pacote a recomendar.** A busca web está sem permissão nesta
sessão, e o servidor de referência `@modelcontextprotocol/server-postgres` foi arquivado em
algum ponto — não vou afirmar qual é o sucessor atual sem conferir. Escolha o pacote na hora de
instalar; o que importa são as duas condições abaixo, que valem para qualquer um deles.

**Condição 1 — usuário só-leitura, sempre.** O `.env.bancos.example` deste repositório já
descreve o role certo, e o argumento dele vale igual aqui:

```sql
CREATE USER hsos_mcp_ro WITH PASSWORD '…';
GRANT CONNECT ON DATABASE hsos TO hsos_mcp_ro;
GRANT pg_read_all_data TO hsos_mcp_ro;
ALTER ROLE hsos_mcp_ro SET default_transaction_read_only = on;
```

São duas travas independentes de propósito: `pg_read_all_data` cobre tabela criada **depois**
(um `GRANT SELECT ON ALL TABLES` não cobriria, e o sintoma seria "essa tabela não existe"), e
`default_transaction_read_only` recusa escrita antes de olhar permissão.

**Condição 2 — a senha não pode entrar no `.mcp.json` versionado.** Use a forma
`${POSTGRES_MCP_URL}` lendo do ambiente, e mantenha o valor fora do repositório. Vale versionar
o `.mcp.json` (o time inteiro ganha o servidor); não vale versionar a credencial.

---

## Emagrecer o `CLAUDE.md` — a recomendação com maior retorno

O `CLAUDE.md` tem **1.109 linhas / 67 KB** e entra no contexto de **toda** sessão, inclusive
quando a tarefa é ajustar um `<Dialog>` que não chega perto do gateway. Boa parte dele é
referência de protocolo — as seções de `cron.*`, `chat.send`, catálogo de LLM, escopo MCP,
compactação de sessão, `agent_to_agent`. Material excelente, e caro no lugar errado.

Uma skill carrega **sob demanda**. Mover essas seções para `.claude/skills/contrato-do-gateway/SKILL.md`
e deixar no `CLAUDE.md` um ponteiro de três linhas ("mexeu com gateway? abra a skill
`contrato-do-gateway`") preserva o conteúdo e devolve contexto em toda sessão que não toca o
gateway.

⚠️ **E a armadilha é a mesma da skill `faturamento`.** Skill carregada sob demanda depende de
o modelo lembrar que ela existe. Se fizer essa migração, o ponteiro no `CLAUDE.md` precisa ser
**nominal e específico** — "abra a skill X ao mexer em Y", não "consulte a documentação do
gateway". Foi exatamente essa diferença que fez o roster do `AGENTS.md` da `nina` funcionar:
só passou a valer quando virou palavra nominal (`aparelho`, `calibração`) em vez de texto
corrido.

O `CLAUDE.md` já documenta a lição que se aplica a ele mesmo: *"decisão em aberto documentada
envelhece igual a código"*. Três das quatro linhas da seção de feature flags descreviam um
sistema que não existia mais. Quanto maior o arquivo, mais barato é isso acontecer de novo.

---

## Menos pedido de permissão

Escrevendo este documento, bati em recusa de permissão em **oito** comandos de leitura pura —
`git grep`, `grep -rn` com alternância, `for` sobre arquivos. Cada um custou uma ida e volta.
Um allowlist em `.claude/settings.json` resolve:

```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git ls-files:*)",
      "Bash(git grep:*)",
      "Bash(git show:*)",
      "Bash(grep:*)",
      "Bash(rg:*)",
      "Bash(ls:*)",
      "Bash(find:*)",
      "Bash(wc:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(jq:*)",
      "Bash(npm run lint:*)",
      "Bash(npm run test:*)",
      "Bash(npx vitest run:*)",
      "Bash(npx eslint:*)",
      "Bash(npx tsc --noEmit:*)",
      "Bash(python3 scripts/:*)",
      "Bash(python3 backend/scripts/:*)",
      "Bash(python3 frontend/scripts/:*)",
      "Bash(backend/.venv/bin/python -m pytest:*)"
    ]
  }
}
```

⚠️ Note que **`Bash(cat:*)` não está na lista, de propósito.** Liberar `cat` sem restrição
contornaria o Hook 1 pelo lado do Bash — o hook cobre `Read`/`Edit`/`Write`, e um `cat backend/.env.superusuario`
passaria direto. Ler arquivo é trabalho do `Read`, que é onde a proteção mora.

---

## Ordem sugerida

1. **Trocar a senha do `super_admin`.** Não é automação, é um clique, e num repositório
   público é o único item aqui com consequência hoje.
2. **Hook 1** (proteger segredo e arquivo gerado) — a segunda consequência de segurança, e não
   depende de nada.
3. **Hook 3** (estado do ambiente) — barato, e mata o sintoma mais confuso do projeto.
4. **Allowlist de permissões** — devolve tempo em toda sessão.
5. **`revisor-gateway`** e **`auditor-de-autorizacao`** — as duas classes de erro com mais
   reincidência documentada aqui.
6. **Hooks 2, 4 e 5**, depois as skills.
7. **Emagrecer o `CLAUDE.md`** por último: é o de maior retorno e o de maior risco de perder
   contexto no caminho. Merece uma sessão só dele.

---

## O que ficou de fora, e por quê

- **Hook de `tsc --noEmit`** — a base tem 72 mil linhas de TS; rodar a cada edição é caro
  demais. Se quiser, ponha num hook de `Stop` (uma vez ao fim da tarefa), não em `PostToolUse`.
  Não há script `typecheck` no `package.json`; o comando seria
  `npx tsc --noEmit -p frontend/tsconfig.app.json`.
- **Subagente gerador de teste** — a cobertura é quase zero e a tentação é gerar teste em massa.
  Contra este código específico isso produziria dezenas de testes de fumaça em componentes de
  UI e nenhum no `chat-sender.ts` (~2.100 linhas), que é onde os bugs A1–A19 moram. Vale mais
  escolher a dedo do que automatizar.
- **CI no GitHub Actions** — cabe, mas é decisão de infraestrutura, não automação do Claude
  Code. Se entrar, `npm run lint` + `vitest run` + `pytest` é o mínimo, e os três já rodam.

Peça mais opções de qualquer categoria, ou a implementação de qualquer item — este documento
não criou nada.
```
