"""Escreve o bloco "O time da Health & Safety" no USER.md dos agentes.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/atualizar-time.py erick-bot nina iris          # ensaio
    PYTHONPATH=. .venv/bin/python scripts/atualizar-time.py erick-bot nina --aplicar
    PYTHONPATH=. .venv/bin/python scripts/atualizar-time.py --todos-com-bloco --aplicar  # gente nova

Gerado do cadastro (`app/time_da_empresa.py`). ⚠️ Escreve nos arquivos dos
agentes no gateway: rodar o ensaio e combinar com o Erick antes de --aplicar.
"""
import argparse
import asyncio
import sys

from dotenv import load_dotenv

load_dotenv(".env")

from app import time_da_empresa  # noqa: E402
from app.database import close_db, init_db  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("agentes", nargs="*")
    ap.add_argument("--todos-com-bloco", action="store_true")
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()
    await init_db()
    try:
        alvos = await time_da_empresa.agentes_com_bloco() if a.todos_com_bloco else a.agentes
        for aid, r in (await time_da_empresa.atualizar(alvos, aplicar=a.aplicar)).items():
            print(f"  {aid:16} {r}")
        if not a.aplicar:
            print("(ensaio — nada foi escrito)")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
