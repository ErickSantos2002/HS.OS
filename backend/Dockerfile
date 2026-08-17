# Backend HS.OS — FastAPI + asyncpg
# Deploy: EasyPanel, domínio hsosapi.healthsafetytech.com
#
# ⚠️ **Contexto de build: `backend/`.** Não mude — o EasyPanel tem o caminho
# fixo em `code/backend/` e um Dockerfile que espere a raiz do repositório
# quebra o deploy com `"/backend": not found`. Tentado em 17/08/2026 e desfeito
# no mesmo dia.
#
# É por isso que `skills/` mora em `backend/skills/` e não na raiz, que seria o
# lugar natural dela: precisa estar dentro do contexto para entrar na imagem.
# Antes disso, `GET /skills/{slug}/conteudo` respondia 404 em produção enquanto
# a lista aparecia normal na tela — e em desenvolvimento funcionava, porque lá o
# caminho existe de qualquer jeito.
FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# postgresql-client entra para poder aplicar as migrations de dentro do
# container (psql -f migrations/00X.sql) sem depender da máquina do host.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc \
      postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# A tela lê o markdown das skills por `GET /skills/{slug}/conteudo`, e o gateway
# não tem como entregar esse conteúdo (`skills.read`/`get`/`show`/`content` não
# existem). Elas vêm no `COPY . .` acima, já que vivem em `backend/skills/`;
# SKILLS_DIR — saída que o router já previa — deixa o caminho explícito em vez
# de depender de contagem de `parents[]`.
ENV SKILLS_DIR=/app/skills

# uploads/ é volume persistente em produção; criado aqui para o caso de não
# haver mount, evitando erro no primeiro upload.
RUN mkdir -p /app/uploads \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# urllib em vez de requests: é da stdlib e não precisa entrar no requirements
# só por causa do healthcheck.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health',timeout=5).status==200 else 1)" || exit 1

# 2 workers, não 4: cada worker abre a sua própria conexão WebSocket com o
# gateway e o seu próprio pool do Postgres. Aumentar esse número multiplica os
# dois. Quando os jobs agendados entrarem (Lote 5), vão num serviço `worker`
# separado — justamente para não rodarem uma vez por worker do uvicorn.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
