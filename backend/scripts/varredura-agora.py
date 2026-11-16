"""Ensaio e chave da Varredura do Guardi.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/varredura-agora.py --so <user_id>            # ensaio
    PYTHONPATH=. .venv/bin/python scripts/varredura-agora.py --so <user_id> --aplicar  # cria a pedida e espera
    (… --so <user_id> --aplicar --mostrar-resumo imprime o resumo decifrado; o padrão é só o tamanho)
    PYTHONPATH=. .venv/bin/python scripts/varredura-agora.py --ligar [--aplicar]
    PYTHONPATH=. .venv/bin/python scripts/varredura-agora.py --desligar [--aplicar]

Spec: docs/superpowers/specs/2026-11-16-varredura-do-guardi-design.md.

⚠️ **O script só cria a linha e espera.** Quem dispara o turno é o disparador de
lembretes do backend EM PRODUÇÃO (a passada de ~30 s): sem deploy, a pedida
fica `pedida` até o timeout. A pedida do ensaio entra com `pedida_por='agenda'`,
que não conta no teto de 2/dia da Nina.

⚠️ **`--ligar`/`--desligar` escrevem em `app_settings`**, que pede o perfil
admin: o script usa o cadastro `bancos` (`perfil="admin"`), sem ler o
`admin.toml` — rode com o Python do venv do cadastro nesse caso:
`~/projetos/bancos/.venv/bin/python` (com `PYTHONPATH=.`). O `--so` usa o
`DATABASE_URL` do `backend/.env` (venv do backend: o `dotenv` só existe nele). Ligar liga os 23: a manhã é 07:30 do próximo
dia útil e o quadro, 08:30. Sem `--aplicar` é só ensaio.
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone

from pathlib import Path

CHAVE = "varredura"
ESPERA_SEGUNDOS = 240
INTERVALO = 10

SQL_STATUS = """
    SELECT status, numeros, resumo_cifrado FROM public.varreduras
     WHERE user_id = $1::uuid AND tipo = 'pedida' AND pedida_por = 'agenda'
       AND criado_em >= $2
     ORDER BY criado_em DESC LIMIT 1
"""
TERMINAIS = {"entregue", "pulada", "sem_registro", "erro"}


def valor_da_chave(ligada: bool, atual: dict | None) -> dict:
    """Mantém horários já customizados; o que falta ganha o padrão."""
    base = {"manha": "07:30", "tarde": "13:30", "quadro": "08:30"}
    base.update({k: v for k, v in (atual or {}).items() if k in base})
    base["ligada"] = ligada
    return base


def _gravar_chave(ligada: bool, aplicar: bool) -> int:
    sys.path.insert(0, str(Path.home() / "projetos/bancos"))
    import bancos  # noqa: E402

    with bancos.conectar("hsos", perfil="admin" if aplicar else "leitura") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM public.app_settings WHERE key = %s", (CHAVE,))
            r = cur.fetchone()
            atual = r[0] if r else None
            if isinstance(atual, str):
                atual = json.loads(atual)
            novo = valor_da_chave(ligada, atual)
            print(f"atual: {atual}\nnovo:  {novo}")
            if not aplicar:
                print("(ensaio — nada foi escrito; use --aplicar)")
                return 0
            cur.execute(
                "INSERT INTO public.app_settings (key, value, updated_at) "
                "VALUES (%s, %s::jsonb, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                (CHAVE, json.dumps(novo)),
            )
            conn.commit()
            cur.execute("SELECT value FROM public.app_settings WHERE key = %s", (CHAVE,))
            lido = cur.fetchone()[0]
            if isinstance(lido, str):
                lido = json.loads(lido)
            ok = bool(lido.get("ligada")) == ligada
            print("✅ chave gravada e conferida" if ok else "❌ a releitura não bateu")
            return 0 if ok else 1


async def _ensaio(user_id: str, aplicar: bool, mostrar_resumo: bool = False) -> int:
    from dotenv import load_dotenv  # só o venv do backend tem; o do bancos não

    load_dotenv()
    from app import database
    from app.email import cifra
    from app.varredura import dominio

    await database.init_db()
    # ⚠️ Cada passo numa `sessao(role="service_role")`, nunca `pool.acquire()`
    # cru: o `hsos_app` é NOINHERIT e sem privilégio em `public` — só o SET
    # LOCAL ROLE da sessão dá acesso. E transação curta por passo: a pedida
    # tem que COMITAR para o disparador de produção vê-la.
    try:
        async with database.sessao(role="service_role") as conn:
            cfg = await dominio.ler_config(conn)
        print(f"varredura ligada na config: {cfg.ligada}")
        if not aplicar:
            print(f"(ensaio — criaria uma pedida (por='agenda') para {user_id}; use --aplicar)")
            return 0
        inicio = datetime.now(timezone.utc)
        async with database.sessao(role="service_role") as conn:
            ok, motivo = await dominio.pedir(conn, user_id, inicio, por="agenda")
        if not ok:
            print(f"❌ {motivo}")
            return 1
        print("pedida criada; esperando o disparador (até 4 min)...")
        esperado = 0
        while esperado < ESPERA_SEGUNDOS:
            await asyncio.sleep(INTERVALO)
            esperado += INTERVALO
            async with database.sessao(role="service_role") as conn:
                r = await conn.fetchrow(SQL_STATUS, user_id, inicio)
            print(f"  {esperado:>3}s status={r['status'] if r else '?'}")
            if r and r["status"] in TERMINAIS:
                print("numeros:", r["numeros"])
                if r["resumo_cifrado"]:
                    # O resumo cita assunto e remetente de e-mail do dono:
                    # por padrão só o tamanho, para não cair em transcript.
                    resumo = cifra.decifrar(r["resumo_cifrado"]) or ""
                    if mostrar_resumo:
                        print("resumo:\n" + resumo)
                    else:
                        print(f"resumo: {len(resumo)} caracteres "
                              "(--mostrar-resumo para ver o texto)")
                print("✅ entregue" if r["status"] == "entregue" else f"⚠️ terminou em {r['status']}")
                return 0 if r["status"] == "entregue" else 1
        print("⏱️ sem desfecho em 4 min — o backend com o disparador está no ar?")
        return 1
    except RuntimeError as e:  # `sessao` sem pool
        print(f"Não conectei no banco (DATABASE_URL do backend/.env): {e}")
        return 1
    finally:
        await database.close_db()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--so", metavar="USER_ID", help="cria uma pedida de ensaio para essa pessoa")
    g.add_argument("--ligar", action="store_true", help="liga a varredura para todos")
    g.add_argument("--desligar", action="store_true", help="desliga a varredura")
    ap.add_argument("--aplicar", action="store_true", help="escreve de verdade (padrão: ensaio)")
    ap.add_argument("--mostrar-resumo", action="store_true",
                    help="no --so, imprime o resumo decifrado (padrão: só o tamanho)")
    a = ap.parse_args()
    if a.so:
        return asyncio.run(_ensaio(a.so, a.aplicar, a.mostrar_resumo))
    return _gravar_chave(a.ligar, a.aplicar)


if __name__ == "__main__":
    sys.exit(main())
