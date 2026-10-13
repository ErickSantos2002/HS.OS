"""Leva os áudios de canal do bucket público `audio-messages` para `anexos`.

    cd backend && PYTHONPATH=. .venv/bin/python scripts/migrar-audio-anexos.py            # ensaio
    cd backend && PYTHONPATH=. .venv/bin/python scripts/migrar-audio-anexos.py --aplicar

Roda da máquina de desenvolvimento, com o `backend/.env` (banco e R2 de
produção). **Só depois do deploy do front** que entende `anexo:<id>` — antes
disso a tela tentaria tocar `anexo:…` como URL e os áudios ficariam mudos.

Por mensagem: lê o objeto antigo, grava em `anexos/<caminho do anexo>`, cria a
linha em `public.anexos` (contexto `canal`, enviada pelo autor) e troca o
`audio_url` — o `UPDATE` só vale se o valor ainda for o antigo, então rodar de
novo não duplica. Os objetos antigos ficam no R2, ilegíveis (o bucket foi
fechado em 13/10/2026); apagar é passo separado, depois de ouvir os migrados.
"""
import asyncio
import re
import sys
import uuid

_MARCA = "/storage/audio-messages/"
_SEGMENTO = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


def caminho_antigo(audio_url: str | None) -> str | None:
    """O caminho dentro de `audio-messages`, ou `None` se não for URL antiga."""
    if not audio_url or _MARCA not in audio_url:
        return None
    caminho = audio_url.split(_MARCA, 1)[1].split("?", 1)[0]
    partes = caminho.split("/")
    if not partes or any(p in (".", "..") or not _SEGMENTO.match(p) for p in partes):
        return None
    return caminho


async def main(aplicar: bool) -> int:
    from app import anexos as ax
    from app import armazenamento as arm
    from app import database

    await database.init_db()
    async with database.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text AS id, channel_id::text AS channel_id, author_id, author_type, audio_url "
            "  FROM public.channel_messages WHERE audio_url LIKE '%/storage/audio-messages/%' "
            " ORDER BY created_at")
    print(f"{len(linhas)} áudio(s) no bucket antigo.")
    falhas = 0
    for l in linhas:
        antigo = caminho_antigo(l["audio_url"])
        if antigo is None:
            print(f"  ❌ {l['id']}: URL que não reconheço — {l['audio_url'][:80]}")
            falhas += 1
            continue
        dados = await arm.ler(arm.chave("audio-messages", antigo))
        if dados is None:
            print(f"  ❌ {l['id']}: objeto antigo não existe no R2 ({antigo})")
            falhas += 1
            continue
        nome = antigo.rsplit("/", 1)[-1]
        ext = nome.rsplit(".", 1)[-1].lower()
        mime = ax.mime_normalizado({"webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4",
                                    "mp3": "audio/mpeg", "wav": "audio/wav"}.get(ext, "audio/webm"))
        anexo_id = str(uuid.uuid4())
        caminho = ax.caminho_do_anexo(anexo_id, "canal", l["channel_id"], f"audio.{ext}")
        humano = l["author_type"] != "agent"
        print(f"  {'→' if aplicar else '·'} {l['id']}: {antigo} ({len(dados)} B) → anexos/{caminho}")
        if not aplicar:
            continue
        await arm.gravar(arm.chave("anexos", caminho), dados, mime)
        objeto = await arm.cabecalho(arm.chave("anexos", caminho))
        if objeto is None or objeto.tamanho != len(dados):
            print(f"  ❌ {l['id']}: cópia não conferiu no R2 — nada gravado no banco")
            falhas += 1
            continue
        async with database.sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_user,"
                "                           enviado_por_agent, contexto, channel_id)"
                " VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, 'canal', $8::uuid)",
                anexo_id, caminho, f"audio.{ext}", mime, len(dados),
                l["author_id"] if humano else None, None if humano else l["author_id"],
                l["channel_id"])
            trocou = await conn.fetchval(
                "UPDATE public.channel_messages SET audio_url = $2 WHERE id = $1::uuid AND audio_url = $3"
                " RETURNING true", l["id"], f"anexo:{anexo_id}", l["audio_url"])
            if not trocou:
                raise RuntimeError(f"{l['id']}: audio_url mudou durante a migração")
    await database.close_db()
    print("✅ conferido" if falhas == 0 else f"❌ {falhas} falha(s) — me mande esta saída")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--aplicar" in sys.argv)))
