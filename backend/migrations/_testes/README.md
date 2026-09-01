# Testes de migração

SQL que se prova em SQL. Rodam num banco de rascunho descartável, nunca em
produção:

```bash
bash scripts/banco-rascunho.sh
psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
     -f backend/migrations/_testes/014_acesso_a_agente.test.sql
```

Cada arquivo abre uma transação, cria os dados de que precisa e termina em
`ROLLBACK` — o banco fica como estava. Um `ASSERT` que falha aborta com
`ON_ERROR_STOP`, e é assim que o teste reprova.

⚠️ **A tabela de casos da `014` está escrita duas vezes de propósito**: aqui e
em `backend/tests/test_acesso_agente.py`, que exercita o `_pode_ver` do Python.
São a mesma regra em duas linguagens, e a duplicação é o que faz uma divergência
quebrar um teste em vez de passar despercebida. Ao mexer numa, mexa na outra.
