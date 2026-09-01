"""Cria no HS.OS as contas dos funcionários que ainda não têm uma.

O quadro de pessoal da Health & Safety mora no TalentHS, na view `pessoas` — que
é o crachá e só o crachá (nome, e-mail, setor, cargo), sem CPF, salário nem
telefone. Ver `backend/migrations/008_pessoas_talenths.sql` para o porquê.

⚠️ **Este script NÃO toca o banco do HS.OS.** Ele é cliente de `POST /profiles`,
que já cria `auth.users`, `profiles` e `user_roles` numa transação e registra no
log de acesso. Reimplementar isso em SQL seria um segundo caminho para a mesma
coisa, e o segundo caminho é o que envelhece.

⚠️ **A senha aparece UMA vez, na saída.** Ela vai para o FortiPAM, que é onde a
credencial da HS mora — colaborador não troca a própria senha (decisão de
14/08/2026). Não há como recuperá-la depois: o backend guarda o hash.

Rodar no Konsole:

    cd ~/github/HS.OS/backend
    ./.venv/bin/python scripts/carregar_pessoas.py --conferir   # não cria nada
    ./.venv/bin/python scripts/carregar_pessoas.py

Precisa de duas coisas no ambiente:

    HSOS_API=https://hsosapi.healthsafetytech.com
    HSOS_TOKEN=<token de um administrador>
"""
import argparse
import os
import secrets
import string
import sys

import httpx

# Cadastro de teste no TalentHS: não são funcionários e não viram conta.
NAO_SAO_GENTE = {"bruce@healthsafetytech.com", "carlos@healthsafetytech.com"}

ALFABETO = string.ascii_letters + string.digits + "!@#$%&*?"


def senha_forte() -> str:
    """16 caracteres sorteados. `POST /profiles` exige no mínimo 8."""
    return "".join(secrets.choice(ALFABETO) for _ in range(16))


def normalizar(email: str | None) -> str:
    return (email or "").strip().lower()


def quem_falta(quadro: list[dict], existentes: set[str]) -> list[dict]:
    """Do quadro do TalentHS, quem ainda não tem conta no HS.OS.

    Descarta o cadastro de teste, quem já tem conta e e-mail repetido dentro do
    próprio quadro — as três formas de criar conta duplicada.
    """
    ja_vistos = {normalizar(e) for e in existentes}
    falta = []
    for pessoa in quadro:
        email = normalizar(pessoa.get("email"))
        if not email or email in NAO_SAO_GENTE or email in ja_vistos:
            continue
        ja_vistos.add(email)
        falta.append({**pessoa, "email": email})
    return falta


def ler_quadro() -> list[dict]:
    """A view `pessoas` do TalentHS, pelo cadastro único de bancos."""
    sys.path.insert(0, os.path.expanduser("~/projetos/bancos"))
    import bancos  # noqa: E402

    df = bancos.consultar("talenths", "SELECT nome, email, setor, cargo FROM public.pessoas")
    # `cargo` vem NULL para quem o RH não preencheu (ex.: np@) — o pandas
    # devolve isso como `NaN` (float), não `None`. Sem esta troca, `NaN` vaza
    # para o JSON do POST (`json.dumps` aceita o literal inválido `NaN`) e o
    # `httpx.post` mandaria um corpo que o FastAPI do outro lado rejeitaria.
    df = df.astype(object).where(df.notna(), None)
    return df.to_dict("records")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--conferir", action="store_true",
                    help="só mostra quem seria criado; não cria nada")
    args = ap.parse_args()

    api = os.environ.get("HSOS_API")
    token = os.environ.get("HSOS_TOKEN")
    if not api or not token:
        print("Defina HSOS_API e HSOS_TOKEN.", file=sys.stderr)
        return 2

    cliente = httpx.Client(base_url=api, headers={"Authorization": f"Bearer {token}"},
                           timeout=30)

    perfis = cliente.get("/profiles")
    perfis.raise_for_status()
    existentes = {normalizar(p.get("email")) for p in perfis.json()}

    falta = quem_falta(ler_quadro(), existentes)
    print(f"{len(existentes)} contas hoje · {len(falta)} a criar\n")

    if args.conferir:
        for p in falta:
            print(f"  {p['email']:<38} {p['nome']}  ({p.get('setor') or '—'})")
        return 0

    criadas, falhas = [], []
    for pessoa in falta:
        senha = senha_forte()
        r = cliente.post("/profiles", json={
            "email": pessoa["email"],
            "nome": pessoa["nome"],
            "senha": senha,
            "role": "colaborador",
            "departamento": pessoa.get("setor"),
            "cargo": pessoa.get("cargo"),
        })
        if r.status_code == 201:
            criadas.append((pessoa["email"], senha))
        else:
            falhas.append((pessoa["email"], r.status_code, r.text[:120]))

    # ⚠️ Só aqui a senha existe em texto. Leve para o FortiPAM agora.
    print("\n── senhas · levar para o FortiPAM ──")
    for email, senha in criadas:
        print(f"{email}\t{senha}")

    if falhas:
        print("\n── falhas ──", file=sys.stderr)
        for email, codigo, corpo in falhas:
            print(f"{email}\t{codigo}\t{corpo}", file=sys.stderr)

    print(f"\n{len(criadas)} criadas · {len(falhas)} falhas")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
