"""Põe no `AGENTS.md` da `nina` o ponteiro para a varredura — ensaio por padrão.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/ponteiro-nina-varredura.py            # ensaio
    PYTHONPATH=. .venv/bin/python scripts/ponteiro-nina-varredura.py --aplicar

Exige o túnel do OpenClaw aberto. Spec: `docs/superpowers/specs/2026-11-16-varredura-do-guardi-design.md`.

⚠️ É ESCRITA NO GATEWAY num dos sete arquivos, que vale no turno SEGUINTE em
toda sessão. O `AGENTS.md` da `nina` vive a ~500 caracteres do teto de 20.000 e
o gateway trunca em silêncio o que passar, justamente o fim. Por isso o script
mede ANTES: se não couber, para e diz quanto falta. É idempotente (linha já
presente = nada a fazer) e insere ANTES dos blocos gerados (`hsos:empresa`,
`hsos:roster`), que o backend reescreve inteiros.
"""
import argparse
import asyncio
import sys

PONTEIRO = ("Pendências de alguém ou da equipe: `pendencias_da_equipe`; "
            "resumo velho: `pedir_varredura`.")
_MARCAS = ("<!-- hsos:empresa:inicio -->", "<!-- hsos:roster:inicio -->")


def inserir_ponteiro(atual: str) -> str | None:
    """O texto com o ponteiro, ou None se ele já está lá."""
    if PONTEIRO in atual:
        return None
    achadas = [i for i in (atual.find(m) for m in _MARCAS) if i != -1]
    if not achadas:
        return atual.rstrip() + "\n\n" + PONTEIRO + "\n"
    i = min(achadas)
    return atual[:i].rstrip() + "\n\n" + PONTEIRO + "\n\n" + atual[i:]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()
    from app.gateway.client import TETO_ARQUIVO_AGENTE, excede_o_teto
    from app.routers.bots_pessoais import _Deps

    deps = _Deps()
    r = await deps.chamar("agents.files.get", {"agentId": "nina", "name": "AGENTS.md"})
    atual = ((r.get("file") or {}).get("content")) or ""
    novo = inserir_ponteiro(atual)
    if novo is None:
        print("nina: o ponteiro já está no AGENTS.md — nada a fazer.")
        return 0
    print(f"nina: AGENTS.md {len(atual)} → {len(novo)} caracteres (teto {TETO_ARQUIVO_AGENTE}).")
    if excede_o_teto(novo):
        print(f"NÃO: passaria do teto em {len(novo) - TETO_ARQUIVO_AGENTE} caracteres. "
              "Enxugue o arquivo antes; nada foi escrito.")
        return 1
    if not a.aplicar:
        print("(ensaio — nada foi escrito)")
        return 0
    await deps.chamar("agents.files.set", {"agentId": "nina", "name": "AGENTS.md", "content": novo})
    v = await deps.chamar("agents.files.get", {"agentId": "nina", "name": "AGENTS.md"})
    ok = ((v.get("file") or {}).get("content")) == novo
    print("nina: regravado e conferido na releitura." if ok else "nina: FALHOU na releitura.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
