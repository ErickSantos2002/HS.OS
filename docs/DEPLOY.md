# Deploy — EasyPanel

Dois serviços independentes, cada um com seu Dockerfile, no mesmo padrão do
ChamadosHS e do TaskHS. O EasyPanel constrói cada um a partir do repositório.

| Serviço | Contexto | Domínio | Porta interna |
|---|---|---|---|
| Backend | `backend/` | `hsosapi.healthsafetytech.com` | 8000 |
| Frontend | `frontend/` | `hsos.healthsafetytech.com` | 80 |

Ambos rodam na VPS **62.72.11.28**, junto do Postgres — assim o tráfego do banco
não sai do servidor. O Postgres **não suporta TLS** (rejeita o upgrade de SSL),
então mantê-lo em localhost não é preferência, é o que evita senha e dados
trafegando em texto claro pela internet.

O OpenClaw fica na outra VPS (**2.24.85.122**) e é alcançado por um **túnel SSH
persistente** — não pelo domínio público. Ver a seção abaixo.

## O túnel para o OpenClaw

⚠️ **Não adianta apontar o backend para `https://gateway.healthsafetytech.com`.**
A conexão funciona, mas o gateway devolve **zero scopes** e todo método é negado
com `missing scope: operator.read`.

O motivo está na documentação do OpenClaw: *"a session not bound to an approved
paired device/token cannot self-declare permissions"* — sessão proxiada, sem
dispositivo pareado, tem a lista de scopes zerada de propósito. Só conexões que
chegam no **loopback do gateway** recebem os scopes de operador.

A solução é um túnel SSH mantido por systemd no 62.72.11.28:

```bash
scp scripts/tunel-openclaw.sh root@62.72.11.28:/root/
ssh root@62.72.11.28 'bash /root/tunel-openclaw.sh'
```

O script cria uma chave dedicada, o serviço `openclaw-tunnel` com
`Restart=always`, e verifica que o gateway responde. Ele é idempotente.

**O detalhe que faz ou quebra:** o backend roda em container, então o túnel não
pode escutar em `127.0.0.1` do host — dentro do container isso é o próprio
container. E como o EasyPanel usa **Docker Swarm**, os containers alcançam o
host pelo `docker_gwbridge` (`172.18.0.1`), não pelo `docker0`. O script detecta
isso; se um dia as redes mudarem, é só rodá-lo de novo.

Resultado: `OPENCLAW_GATEWAY_URL=http://172.18.0.1:18789`.

**Consequência boa:** com o túnel, `gateway.healthsafetytech.com` deixa de ser
necessário e pode sair do ar — menos superfície exposta.

**Ao autorizar a chave no 2.24.85.122**, use `printf '\n%s\n'` e não `echo`: se
o `authorized_keys` não terminar em quebra de linha, o `>>` cola a chave nova no
fim da linha anterior e corrompe as duas. Aconteceu aqui, e o sintoma é
`Permission denied (publickey)` com a chave aparentemente instalada. O
diagnóstico é `ssh-keygen -lf ~/.ssh/authorized_keys`, que lista só as chaves que
o servidor consegue de fato ler.

## Backup do banco

Instalado em 12/08/2026 pelo `scripts/instalar-backup.sh`, na VPS da aplicação:

```bash
scp scripts/instalar-backup.sh root@62.72.11.28:/root/
ssh root@62.72.11.28 'bash /root/instalar-backup.sh'
```

`pg_dump` diário às 03:20, formato custom, 14 dias em `/var/backups/hsos`
(permissão 700 — o dump tem hash de senha e os segredos de integração). O
`systemd` cuida do agendamento; o script é idempotente.

O dump sai **de dentro do container** do Postgres, então a versão do cliente
sempre casa com a do servidor e a senha vem do ambiente dele, não de um arquivo.

⚠️ **O script termina restaurando o que acabou de gerar**, num banco
descartável, e conferindo as contagens. Backup que ninguém restaurou é
esperança. Se o restore falhar, a instalação falha.

Para restaurar de verdade:

```bash
CID=$(docker ps --format '{{.ID}} {{.Names}}' | grep -i postgres | awk '{print $1}')
docker exec -i $CID sh -c 'pg_restore -U $POSTGRES_USER -d hsos --clean --if-exists' \
  < /var/backups/hsos/hsos-<data>.dump
```

⚠️ **Os dumps ficam na mesma máquina do banco.** Cobrem erro humano e bug de
aplicação; **não** cobrem perder a máquina. Cópia para fora é o passo seguinte.

## Backend

**Build:** contexto `backend/`, Dockerfile padrão. Sem build args.

**Variáveis de ambiente** (ver `backend/.env.example`):

```
DATABASE_URL=postgresql://hsos_app:SENHA@62.72.11.28:2222/hsos
JWT_SECRET=<segredo longo e aleatório>
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=24
FRONTEND_URL=https://hsos.healthsafetytech.com
UPLOADS_DIR=/app/uploads
OPENCLAW_GATEWAY_URL=http://172.18.0.1:18789
OPENCLAW_ADMIN_TOKEN=<token do gateway>
```

Quatro armadilhas que já custaram tempo:

- **É `172.18.0.1`, não `172.17.0.1`.** Esta é a que mais engana, porque o
  `172.17.0.1` é a resposta certa em quase todo lugar: é o gateway do `docker0`,
  o jeito padrão de um container falar com o host. Mas o EasyPanel roda **Swarm**,
  e aí o caminho é a `docker_gwbridge` — que é onde o túnel escuta. Errar o
  dígito dá `Connection refused` **com o túnel perfeitamente de pé**, o que
  manda a investigação para o lugar errado: em 11/08/2026 fomos conferir o
  serviço do túnel (ativo há 6 dias, zero reinícios), a URL pública e o token
  antes de olhar o número da bridge. Diagnóstico em uma linha:

  ```bash
  curl -s https://hsosapi.healthsafetytech.com/gateway/config -H "Authorization: Bearer <token>"
  ```

  Se sair `172.17`, é isso. Trocar a env e reiniciar o serviço basta — a
  variável é lida em tempo de execução, não precisa rebuild. E note o
  `fixado_por_env: true`: com ele, o valor correto que está em `public.vps_config`
  é ignorado, porque o `.env` vence por decisão de projeto.

- **`postgresql://`, não `postgresql+psycopg2://`.** O segundo é formato do
  SQLAlchemy e o asyncpg rejeita a URL.
- **Conectar como `hsos_app`, nunca como superusuário.** Superuser bypassa RLS
  por design; com ele as 191 policies existem no catálogo e não protegem nada.
- **`FRONTEND_URL` é o CORS.** Domínios separados significam chamada
  cross-origin; errar aqui derruba o login inteiro com erro de CORS no console.
- **`public.vps_config` tem precedência sobre o `.env`** para a URL e o token do
  gateway. Mudar a variável no EasyPanel não surte efeito se a tabela tiver
  valor gravado — ajuste pela tela Configurações → Gateway ou por
  `PUT /gateway/config`.

**Volume:** montar `/app/uploads` como persistente, senão os anexos somem a cada
deploy.

**Healthcheck:** `GET /health` (já no Dockerfile).

**Migrations:** a imagem inclui `postgresql-client` e a pasta `migrations/`, então
dá para aplicar de dentro do container:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/000_compat_supabase.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_initial_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_auth_propria.sql
```

No banco atual as três já estão aplicadas — isto vale para reconstruir do zero.

## Frontend

**Build:** contexto `frontend/`, Dockerfile padrão, **com build arg**:

```
VITE_API_URL=https://hsosapi.healthsafetytech.com
```

⚠️ **O Vite embute variáveis `VITE_*` no bundle em tempo de build, não de
execução.** Definir isso como variável de ambiente do serviço não tem efeito
nenhum: precisa ser *build arg*, e trocar a URL exige rebuild da imagem.

Sem build args nenhum o valor cai em `/api`, que só funciona em desenvolvimento
(o proxy do Vite). Em produção isso quebraria todas as chamadas silenciosamente.

**Sem variáveis de ambiente de runtime.** O nginx serve arquivos estáticos.

## Ordem de subida

1. **Backend primeiro**, com o domínio e o certificado prontos
2. Conferir `https://hsosapi.healthsafetytech.com/health` → `{"status":"ok"}`
3. **Frontend depois**, com o `VITE_API_URL` apontando para o domínio acima
4. Entrar em `https://hsos.healthsafetytech.com` e verificar o login

## Verificação pós-deploy

```bash
curl https://hsosapi.healthsafetytech.com/health
curl https://hsosapi.healthsafetytech.com/auth/status   # precisa_bootstrap: false

# CORS liberado para o front?
curl -s -o /dev/null -D- -X OPTIONS https://hsosapi.healthsafetytech.com/auth/login \
  -H "Origin: https://hsos.healthsafetytech.com" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

Na aplicação, **Configurações → Gateway** deve mostrar "Online" e a versão do
OpenClaw. Se não mostrar, o roteiro de diagnóstico é:

| Sintoma | Causa provável |
|---|---|
| `Connection refused` | Túnel fora do ar — `systemctl status openclaw-tunnel` |
| `scopes recebidos: nenhum` | Conexão não está chegando pelo loopback: a URL aponta para o domínio público em vez do túnel |
| `Gateway não configurado` | `vps_config` vazia e `.env` sem os valores |

## O que ainda não está no deploy

- **Serviço `worker`** — os 5 jobs agendados (Lote 5). `pg_cron` não existe no
  Postgres da VPS, então serão APScheduler num container separado. Separado de
  propósito: dentro do web, cada worker do uvicorn dispararia o mesmo job.
- **Storage** — os 6 buckets ainda vivem no Supabase (Lote 7).
- **A maior parte do sistema** ainda chama o Supabase. Este deploy valida a
  infraestrutura, não entrega o produto — ver `docs/ROADMAP.md`.
