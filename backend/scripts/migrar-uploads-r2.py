"""Copia /app/uploads para o R2 — roda UMA vez, DENTRO do container de produção.

    docker exec -it <container-backend> python /app/scripts/migrar-uploads-r2.py           # ensaio
    docker exec -it <container-backend> python /app/scripts/migrar-uploads-r2.py --aplicar

O script vive em `backend/scripts/` porque o contexto de build do Dockerfile é
`backend/` (`COPY . .`): é o que o põe em `/app/scripts` dentro da imagem.

Idempotente: pula o que já está no R2 com o mesmo tamanho. Ao fim imprime
contagem e bytes por bucket dos dois lados — o volume só sai do EasyPanel
quando a coluna final bater.

"Bateu", para um bucket, quer dizer: o R2 tem pelo menos a mesma quantidade de
arquivos E pelo menos os mesmos bytes que o disco. "Pelo menos" e não "igual"
porque, depois do deploy, uploads novos já caem direto no R2 e o disco antigo
não os conhece — exigir igualdade reprovaria uma migração correta.
"""
import mimetypes
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, "/app")
from app.armazenamento import BUCKETS, R2  # noqa: E402
from app.config import settings  # noqa: E402

ORIGEM = Path("/app/uploads")


def bateu(n_disco: int, bytes_disco: int, n_r2: int, bytes_r2: int) -> bool:
    """O R2 cobre o disco: ao menos a mesma contagem e ao menos os mesmos bytes."""
    return n_r2 >= n_disco and bytes_r2 >= bytes_disco


def main() -> int:
    aplicar = "--aplicar" in sys.argv
    r2 = R2(settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY, settings.R2_BUCKET)
    disco = defaultdict(lambda: [0, 0])
    enviados = pulados = 0
    for arquivo in sorted(ORIGEM.rglob("*")):
        if not arquivo.is_file():
            continue
        rel = arquivo.relative_to(ORIGEM).as_posix()
        bucket = rel.split("/", 1)[0]
        if bucket not in BUCKETS:
            print(f"  ⚠️  fora de bucket conhecido, ignorado: {rel}")
            continue
        tamanho = arquivo.stat().st_size
        disco[bucket][0] += 1
        disco[bucket][1] += tamanho
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
    ok = True
    for bucket in sorted(BUCKETS):
        n_d, b_d = disco.get(bucket, [0, 0])
        itens = r2.listar(f"{bucket}/", recursivo=True)
        n_r, b_r = len(itens), sum(i["tamanho"] for i in itens)
        passou = bateu(n_d, b_d, n_r, b_r)
        ok &= passou
        print(f"  {bucket:22} {n_d:>6} · {b_d:>8} {n_r:>6} · {b_r:>8}  {'✅' if passou else '❌'}")
    if not aplicar:
        print("\n  (ensaio — nada foi escrito; rode com --aplicar)")
        return 0
    print("\n  " + ("bateu — pode tirar o volume do EasyPanel" if ok else "NÃO bateu — não tire o volume"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
