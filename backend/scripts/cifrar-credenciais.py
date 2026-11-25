"""Cifra os valores de `integrations.credentials` que ainda estão em claro (PK-08).

Rodar de `backend/`, com o venv do backend (tem a `cryptography`) e o cadastro
de bancos no caminho — DEPOIS do deploy do código que lê os dois formatos:

    PYTHONPATH=.:$HOME/projetos/bancos .venv/bin/python scripts/cifrar-credenciais.py            # ensaio
    PYTHONPATH=.:$HOME/projetos/bancos .venv/bin/python scripts/cifrar-credenciais.py --aplicar

⚠️ A chave é a `EMAIL_CHAVE_CIFRA` do `backend/.env` e TEM que ser a de
produção — senão o backend no ar não abre o que este script gravou. O script
confere isso antes de escrever: decifra um resumo de varredura de produção com
ela (o mesmo segredo, já em uso).

Nunca imprime valor: só contagens. Tudo numa transação; antes do commit relê
cada linha e confere que decifra para o original.
"""
import json
import sys

import bancos

from app import credenciais
from app.email import cifra

aplicar = "--aplicar" in sys.argv


def em_claro(estrutura) -> int:
    if isinstance(estrutura, list):
        vals = [c.get("value") for c in estrutura if isinstance(c, dict)]
    elif isinstance(estrutura, dict):
        vals = list(estrutura.values())
    else:
        vals = []
    return sum(1 for v in vals if isinstance(v, str) and v and not v.startswith(credenciais.PREFIXO))


def carregar(bruto):
    return json.loads(bruto) if isinstance(bruto, str) else bruto


with bancos.conectar("hsos", perfil="admin" if aplicar else "leitura") as conn:
    with conn.cursor() as cur:
        # A chave local é a de produção? Um resumo de varredura cifrado tem que abrir.
        cur.execute("SELECT resumo_cifrado FROM public.varreduras "
                    "WHERE resumo_cifrado IS NOT NULL ORDER BY criado_em DESC LIMIT 1")
        amostra = cur.fetchone()
        try:
            if amostra is None:
                raise cifra.ErroCifra("sem resumo de varredura para conferir a chave")
            cifra.decifrar(amostra[0])
        except cifra.ErroCifra as e:
            print(f"❌ a EMAIL_CHAVE_CIFRA local não é a de produção: {e}")
            sys.exit(1)
        print("chave local = chave de produção ✅")

        cur.execute("SELECT id::text, name, credentials FROM public.integrations ORDER BY name")
        linhas = cur.fetchall()
        alvo = [(i, n, carregar(c)) for i, n, c in linhas if em_claro(carregar(c))]
        total = sum(em_claro(c) for _, _, c in alvo)
        print(f"{len(linhas)} linhas; {len(alvo)} com valor em claro; {total} valores a cifrar")
        if not aplicar:
            print("(ensaio — use --aplicar)")
            sys.exit(0)

        for ident, nome, cred in alvo:
            cur.execute("UPDATE public.integrations SET credentials = %s::jsonb WHERE id = %s::uuid",
                        (json.dumps(credenciais.fechar(cred)), ident))

        # Conferência antes do commit: relida, cada linha abre igual ao original.
        originais = {i: c for i, _, c in alvo}
        cur.execute("SELECT id::text, credentials FROM public.integrations")
        sobra = falha = 0
        for ident, bruto in cur.fetchall():
            relida = carregar(bruto)
            sobra += em_claro(relida)
            if ident in originais and credenciais.abrir(relida) != originais[ident]:
                falha += 1
        if sobra or falha:
            conn.rollback()
            print(f"❌ revertido: {sobra} valor(es) ainda em claro, {falha} linha(s) não abrem igual")
            sys.exit(1)
    conn.commit()

print(f"✅ {total} valores cifrados em {len(alvo)} linhas; nenhum em claro; todos abrem igual")
