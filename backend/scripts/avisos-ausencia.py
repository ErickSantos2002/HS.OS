"""Chave do aviso de pedido de ausência ao RH (`app_settings` `avisos_ausencia`).

    cd backend
    PYTHONPATH=. ~/projetos/bancos/.venv/bin/python scripts/avisos-ausencia.py --mostrar
    PYTHONPATH=. ~/projetos/bancos/.venv/bin/python scripts/avisos-ausencia.py --ligar <email> [--aplicar]
    PYTHONPATH=. ~/projetos/bancos/.venv/bin/python scripts/avisos-ausencia.py --tirar <email> [--aplicar]
    PYTHONPATH=. ~/projetos/bancos/.venv/bin/python scripts/avisos-ausencia.py --desligar [--aplicar]
    PYTHONPATH=. ~/projetos/bancos/.venv/bin/python scripts/avisos-ausencia.py --decisoes [--aplicar]

`--decisoes` liga a resposta para quem pediu (26/11/2026, tarde): grava
`decisoes_desde` = agora. Só decisão do RH a partir daí vira recado — ligar não
manda o histórico para a empresa. Rodar de novo NÃO mexe na data já gravada.

Spec: docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md.

`--ligar <email>` acrescenta a pessoa (sem duplicar) e liga. Sem `--aplicar` é
ensaio. Escrever em `app_settings` pede o perfil admin: o script usa o cadastro
`bancos` sem ler o `admin.toml` — por isso o Python do venv do cadastro.

⚠️ **Quem avisa é o backend EM PRODUÇÃO** (etapa da passada do disparador):
sem o deploy com `app/avisos_ausencia.py`, ligar a chave não faz nada.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CHAVE = "avisos_ausencia"


def valor_novo(atual: dict | None, ligado: bool, entra: str | None = None, sai: str | None = None,
               decisoes_desde: str | None = None) -> dict:
    ids = [i for i in ((atual or {}).get("destinatarios") or []) if isinstance(i, str)]
    if entra and entra not in ids:
        ids.append(entra)
    if sai:
        ids = [i for i in ids if i != sai]
    novo = {"ligado": ligado, "destinatarios": ids}
    desde = (atual or {}).get("decisoes_desde") or decisoes_desde
    if desde:
        novo["decisoes_desde"] = desde
    return novo


def _ler(cur):
    cur.execute("SELECT value FROM public.app_settings WHERE key = %s", (CHAVE,))
    r = cur.fetchone()
    v = r[0] if r else None
    return json.loads(v) if isinstance(v, str) else v


def _id_por_email(cur, email: str) -> str:
    cur.execute("SELECT id::text, full_name FROM public.profiles WHERE lower(email) = lower(%s)", (email,))
    r = cur.fetchone()
    if not r:
        sys.exit(f"❌ ninguém com o e-mail {email} no HS.OS")
    cur.execute("SELECT agent_id, sistemas_ligados FROM public.agent_profiles WHERE dono_id = %s::uuid", (r[0],))
    g = cur.fetchone()
    if not g:
        sys.exit(f"❌ {r[1]} não tem Guardi")
    if "talenths" not in (g[1] or []):
        sys.exit(f"❌ o Guardi {g[0]} não tem o TalentHS ligado")
    print(f"{r[1]} → Guardi {g[0]}")
    return r[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--mostrar", action="store_true")
    g.add_argument("--ligar", metavar="EMAIL")
    g.add_argument("--tirar", metavar="EMAIL")
    g.add_argument("--desligar", action="store_true")
    g.add_argument("--decisoes", action="store_true")
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()

    sys.path.insert(0, str(Path.home() / "projetos/bancos"))
    import bancos  # noqa: E402

    escreve = a.aplicar and not a.mostrar
    with bancos.conectar("hsos", perfil="admin" if escreve else "leitura") as conn:
        with conn.cursor() as cur:
            atual = _ler(cur)
            print(f"atual: {atual if atual is not None else 'ausente (desligado)'}")
            if a.mostrar:
                return 0
            if a.ligar:
                novo = valor_novo(atual, True, entra=_id_por_email(cur, a.ligar))
            elif a.tirar:
                cur.execute("SELECT id::text FROM public.profiles WHERE lower(email) = lower(%s)", (a.tirar,))
                r = cur.fetchone()
                novo = valor_novo(atual, bool((atual or {}).get("ligado")), sai=r[0] if r else None)
            elif a.decisoes:
                if not (atual or {}).get("ligado"):
                    sys.exit("❌ ligue primeiro o aviso ao RH (--ligar <email>): a resposta usa a mesma leitura")
                novo = valor_novo(atual, True, decisoes_desde=datetime.now(timezone.utc).isoformat())
            else:
                novo = valor_novo(atual, False)
            print(f"novo:  {novo}")
            if not a.aplicar:
                print("(ensaio — nada foi escrito; use --aplicar)")
                return 0
            cur.execute(
                "INSERT INTO public.app_settings (key, value, updated_at) VALUES (%s, %s::jsonb, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                (CHAVE, json.dumps(novo)))
            conn.commit()
            ok = _ler(cur) == novo
            print("✅ chave gravada e conferida" if ok else "❌ a releitura não bateu")
            return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
