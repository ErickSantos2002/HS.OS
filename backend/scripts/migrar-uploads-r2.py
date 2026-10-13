"""Copia /app/uploads para o R2 — roda UMA vez, DENTRO do container de produção.

    docker exec -it <container-backend> python /app/scripts/migrar-uploads-r2.py           # ensaio
    docker exec -it <container-backend> python /app/scripts/migrar-uploads-r2.py --aplicar

O script vive em `backend/scripts/` porque o contexto de build do Dockerfile é
`backend/` (`COPY . .`): é o que o põe em `/app/scripts` dentro da imagem.

Idempotente: pula o que já está no R2 com o mesmo tamanho. Ao fim imprime
contagem e bytes por bucket dos dois lados — o volume só sai do EasyPanel
quando a coluna final bater.

"Bateu" é conferido POR CHAVE: toda chave do disco precisa estar no R2 com o
mesmo tamanho. O R2 pode ter chaves a mais (uploads feitos depois do deploy),
mas isso NÃO compensa um arquivo que falte — comparar só totais deixaria um
upload novo mascarar um arquivo perdido, e o volume é apagado com esse veredito.
Arquivo do disco fora de bucket conhecido também reprova: não seria migrado.
"""
import mimetypes
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, "/app")
from app.armazenamento import BUCKETS, R2  # noqa: E402
from app.config import settings  # noqa: E402

ORIGEM = Path("/app/uploads")


def faltando(disco: dict[str, int], r2: dict[str, int]) -> list[str]:
    """Chaves do disco ausentes no R2 ou com tamanho diferente (vazio = bateu)."""
    return sorted(k for k, t in disco.items() if r2.get(k) != t)


def main() -> int:
    aplicar = "--aplicar" in sys.argv
    ausentes = [n for n in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
                if not getattr(settings, n, "")]
    if ausentes:
        print(f"Variáveis do R2 ausentes: {', '.join(ausentes)}")
        return 2
    r2 = R2(settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY, settings.R2_BUCKET)
    disco = defaultdict(lambda: [0, 0])
    chaves_disco: dict[str, int] = {}
    fora = []
    enviados = pulados = 0
    for arquivo in sorted(ORIGEM.rglob("*")):
        if not arquivo.is_file():
            continue
        rel = arquivo.relative_to(ORIGEM).as_posix()
        bucket = rel.split("/", 1)[0]
        if bucket not in BUCKETS:
            print(f"  ⚠️  fora de bucket conhecido, ignorado: {rel}")
            fora.append(rel)
            continue
        tamanho = arquivo.stat().st_size
        disco[bucket][0] += 1
        disco[bucket][1] += tamanho
        chaves_disco[rel] = tamanho
        ja = r2.cabecalho(rel)
        if ja is not None and ja.tamanho == tamanho:
            pulados += 1
            continue
        if aplicar:
            mime = mimetypes.guess_type(arquivo.name)[0] or "application/octet-stream"
            r2.gravar(rel, arquivo.read_bytes(), mime)
        enviados += 1

    print(f"\n{'enviados' if aplicar else 'a enviar'}: {enviados} · já no R2: {pulados}\n")
    print(f"  {'bucket':22} {'disco':>16} {'R2':>16}")
    chaves_r2: dict[str, int] = {}
    for bucket in sorted(BUCKETS):
        n_d, b_d = disco.get(bucket, [0, 0])
        itens = r2.listar(f"{bucket}/", recursivo=True)
        for i in itens:
            chaves_r2[i["chave"]] = i["tamanho"]
        n_r, b_r = len(itens), sum(i["tamanho"] for i in itens)
        print(f"  {bucket:22} {n_d:>6} · {b_d:>8} {n_r:>6} · {b_r:>8}")
    falta = faltando(chaves_disco, chaves_r2)
    if falta:
        print(f"\n  ❌ {len(falta)} chave(s) faltando ou com tamanho diferente no R2:")
        for k in falta[:20]:
            print(f"     {k} (disco {chaves_disco[k]} · R2 {chaves_r2.get(k, 'ausente')})")
        if len(falta) > 20:
            print(f"     ... e mais {len(falta) - 20}")
    if fora:
        print(f"\n  ❌ {len(fora)} arquivo(s) fora de bucket conhecido (não migrados)")
    ok = not falta and not fora
    if not aplicar:
        print("\n  (ensaio — nada foi escrito; rode com --aplicar)")
        return 0
    print("\n  " + ("bateu — pode tirar o volume do EasyPanel" if ok else "NÃO bateu — não tire o volume"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
