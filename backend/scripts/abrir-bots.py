"""Libera cada bot pessoal para o PRÓPRIO dono e fecha os especialistas.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/abrir-bots.py            # ensaio
    PYTHONPATH=. .venv/bin/python scripts/abrir-bots.py --aplicar

Decisão do Erick (05/11/2026): no dia em que os bots abrem, os especialistas
(nina, iris, atlas, flow, bruce) ficam só para o Nicholson — exceção: a
Lidisay segue no `bruce`. O administrador continua vendo tudo (`_pode_ver`).
"""
import argparse
import asyncio
import sys

from dotenv import load_dotenv

load_dotenv(".env")

from app.database import close_db, init_db, sessao  # noqa: E402

NICHOLSON = "np@healthsafetytech.com"
LIDISAY = "adm01@healthsafetytech.com"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()
    await init_db()
    try:
        async with sessao(role="service_role") as conn:
            ids = {r["email"]: r["id"] for r in await conn.fetch(
                "SELECT lower(email) AS email, id::text AS id FROM public.profiles "
                " WHERE lower(email) IN ($1, $2)", NICHOLSON, LIDISAY)}
            if NICHOLSON not in ids:
                print("❌ não achei o perfil do Nicholson")
                return 1
            bots = await conn.fetch("SELECT agent_id, dono_id::text AS dono FROM public.agent_profiles "
                                    " WHERE dono_id IS NOT NULL ORDER BY agent_id")
            esp = await conn.fetch("SELECT agent_id FROM public.agent_profiles WHERE dono_id IS NULL "
                                   "ORDER BY agent_id")
            print(f"{len(bots)} bots → cada um só para o dono")
            for e in esp:
                quem = [ids[NICHOLSON]] + ([ids[LIDISAY]] if e["agent_id"] == "bruce" and LIDISAY in ids else [])
                print(f"especialista {e['agent_id']:6} → {'Nicholson' + (' + Lidisay' if len(quem) > 1 else '')}")
            if not a.aplicar:
                print("(ensaio — nada foi escrito)")
                return 0
            await conn.execute(
                "UPDATE public.agent_profiles SET access_type = 'specific_users', "
                "  allowed_user_ids = ARRAY[dono_id] WHERE dono_id IS NOT NULL")
            for e in esp:
                quem = [ids[NICHOLSON]] + ([ids[LIDISAY]] if e["agent_id"] == "bruce" and LIDISAY in ids else [])
                await conn.execute("UPDATE public.agent_profiles SET access_type = 'specific_users', "
                                   "  allowed_user_ids = $2::uuid[] WHERE agent_id = $1", e["agent_id"], quem)
        print("✅ aplicado")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
