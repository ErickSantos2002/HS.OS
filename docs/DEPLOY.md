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

O OpenClaw fica na outra VPS (**2.24.85.122**) e é alcançado por
`https://gateway.healthsafetytech.com`, cujo nginx tem allowlist liberando
apenas o 62.72.11.28. Ver `CLAUDE.md`.

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
OPENCLAW_GATEWAY_URL=https://gateway.healthsafetytech.com
OPENCLAW_ADMIN_TOKEN=<token do gateway>
```

Três armadilhas que já custaram tempo:

- **`postgresql://`, não `postgresql+psycopg2://`.** O segundo é formato do
  SQLAlchemy e o asyncpg rejeita a URL.
- **Conectar como `hsos_app`, nunca como superusuário.** Superuser bypassa RLS
  por design; com ele as 191 policies existem no catálogo e não protegem nada.
- **`FRONTEND_URL` é o CORS.** Domínios separados significam chamada
  cross-origin; errar aqui derruba o login inteiro com erro de CORS no console.

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
OpenClaw. Se mostrar erro de conexão, o suspeito é o allowlist do nginx no
`2.24.85.122` — confirme que o IP de saída do backend é mesmo o 62.72.11.28.

## O que ainda não está no deploy

- **Serviço `worker`** — os 5 jobs agendados (Lote 5). `pg_cron` não existe no
  Postgres da VPS, então serão APScheduler num container separado. Separado de
  propósito: dentro do web, cada worker do uvicorn dispararia o mesmo job.
- **Storage** — os 6 buckets ainda vivem no Supabase (Lote 7).
- **A maior parte do sistema** ainda chama o Supabase. Este deploy valida a
  infraestrutura, não entrega o produto — ver `docs/ROADMAP.md`.
