# TeamsHS

Plataforma de gestão de agentes de IA da Health & Safety — um "Mission Control" para
agentes que rodam num **OpenClaw Gateway** hospedado em VPS.

Originalmente um remix do `dn.os` (dn.ia), em processo de virar produto próprio:
rebrand, Postgres no servidor da HS e deploy em VPS própria. O prompt original que
gerou o projeto está preservado em [`docs/ORIGEM-PROMPT-LOVABLE.md`](docs/ORIGEM-PROMPT-LOVABLE.md).

## Estrutura

```
frontend/      React 18 + TypeScript + Vite + Tailwind/shadcn-ui
backend/
  app/         API FastAPI + asyncpg — em construção
  migrations/  SQL numerado do Postgres próprio
  supabase/    Edge Functions do backend atual (fonte da portagem)
docs/          auditoria de estabilidade e resumos herdados do dn.os
```

## Rodando

**Frontend** — http://localhost:8080

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

**Backend** — http://localhost:8000 (docs em `/docs`)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Sem `DATABASE_URL` preenchido o backend sobe assim mesmo — `/health` e `/docs` funcionam,
e os endpoints de dados respondem 503. É o estado esperado enquanto o Postgres próprio
não existe.

**Stack completa em Docker:**

```bash
docker compose up -d --build
```

## Estado atual

O backend em produção ainda é o Supabase (banco + 73 Edge Functions, em `backend/supabase/`).
A API própria em `backend/app/` é o destino da migração e hoje é só esqueleto.

Arquitetura, armadilhas do caminho crítico do chat e o mapa do rebrand estão no
[`CLAUDE.md`](CLAUDE.md).
