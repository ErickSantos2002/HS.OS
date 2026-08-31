"""Coluna que existe no banco e não aparece em migração nenhuma.

Crua de propósito: procura o NOME da coluna no texto de todas as migrações. Um
nome comum (`id`, `name`) casa em qualquer lugar, então isto não prova que a
coluna foi criada pela migração certa — mas nome que NÃO aparece em lugar nenhum
só pode ter vindo de mudança na mão.
"""
import re, pathlib, sys
sys.path.insert(0, "/home/ericks/projetos/bancos")
import bancos

MIG = pathlib.Path("/home/ericks/github/HS.OS/backend/migrations")
sql = "\n".join(f.read_text() for f in sorted(MIG.glob("*.sql")) if not f.name.startswith("_")).lower()

cols = bancos.consultar('hsos', """
select table_name, column_name from information_schema.columns
where table_schema='public' order by 1,2""")

faltando = [(t, c) for t, c in zip(cols.table_name, cols.column_name)
            if not re.search(rf'\b{re.escape(c.lower())}\b', sql)]
print(f"colunas no banco: {len(cols)}   sem menção em migração: {len(faltando)}\n")
for t, c in faltando:
    print(f"   {t}.{c}")
