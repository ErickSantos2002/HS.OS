# Backend HS.OS — FastAPI + asyncpg
# Deploy: EasyPanel, domínio hsosapi.healthsafetytech.com
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
