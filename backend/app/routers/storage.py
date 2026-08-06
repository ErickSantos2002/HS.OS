"""Arquivos — substitui o `supabase.storage`.

Guarda em disco, sob `UPLOADS_DIR`, um diretório por bucket. Os buckets são os
mesmos que o código herdado usa, com a mesma divisão entre público e privado:

| bucket                | quem lê                                             |
|-----------------------|-----------------------------------------------------|
| `agent-files`         | qualquer um — avatares aparecem em `<img>` sem token |
| `audio-messages`      | qualquer um — áudio toca em `<audio src>`            |
| `wiki-uploads`        | qualquer um — imagem dentro de documento             |
| `company-docs`        | autenticado                                          |
| `generated-documents` | autenticado                                          |

**Por que os três primeiros são públicos:** a tela os usa em `src` de tag HTML,
e o navegador não manda o cabeçalho `Authorization` nesse caso. Era assim no
Supabase (`getPublicUrl`) e mudar isso quebraria avatar, áudio e imagem de wiki
de uma vez. O caminho carrega um id difícil de adivinhar — é a mesma proteção
que havia antes, nem mais nem menos.

Escrever exige autenticação em **todos** os buckets, inclusive nos públicos.
"""

import logging
import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage", tags=["storage"])

_PUBLICOS = {"agent-files", "audio-messages", "wiki-uploads"}
_PRIVADOS = {"company-docs", "generated-documents"}
_BUCKETS = _PUBLICOS | _PRIVADOS

# Segmento de caminho aceitável: letras, números, ponto, hífen, sublinhado. Barra
# é permitida entre segmentos (o `path` do endpoint), mas cada pedaço passa por
# aqui — é o que impede `..` de escapar do diretório do bucket.
_SEGMENTO = re.compile(r"^[A-Za-z0-9._-]{1,120}$")

_TAMANHO_MAXIMO = 25 * 1024 * 1024


def _resolver(bucket: str, caminho: str) -> Path:
    """Traduz bucket + caminho para um arquivo dentro de `UPLOADS_DIR`.

    A validação é por segmento e não por prefixo: conferir só se o resultado
    "começa com" o diretório do bucket é o erro clássico que `..%2f` e link
    simbólico contornam.
    """
    if bucket not in _BUCKETS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bucket desconhecido.")

    partes = [p for p in caminho.split("/") if p]
    if not partes or any(not _SEGMENTO.match(p) for p in partes):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho de arquivo inválido.")

    base = Path(settings.UPLOADS_DIR).resolve() / bucket
    alvo = base.joinpath(*partes)
    # Cinto e suspensório: mesmo com os segmentos validados, confere que o
    # resultado está mesmo sob o bucket.
    if base not in alvo.resolve().parents and alvo.resolve() != base:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho de arquivo inválido.")
    return alvo


class ArquivoOut(BaseModel):
    bucket: str
    path: str
    url: str
    size: int


# ─────────────────────────────────────────────────────────────────────────────
# Extração de texto — metade determinística do `extract-file-text`
# ─────────────────────────────────────────────────────────────────────────────
#
# ⚠️ A edge fazia **duas** coisas: extrair o texto (determinístico) e depois
# mandá-lo para `parse-company-context`, que usa LLM para virar campos do
# `company_profile`. Só a primeira está aqui.
#
# A segunda depende do **Lovable AI Gateway** (`LOVABLE_API_KEY`,
# `google/gemini-2.5-flash`) — dependência da plataforma de origem, que é
# justamente o que a migração existe para remover. Trocar de provedor custa
# dinheiro e é decisão do Erick; ver `docs/ROADMAP.md`.

_LIMITE_TEXTO = 50_000


class TextoExtraidoOut(BaseModel):
    text: str
    caracteres: int
    truncado: bool


@router.post("/extrair-texto/{bucket}/{caminho:path}", response_model=TextoExtraidoOut)
async def extrair_texto(
    bucket: str,
    caminho: str,
    _: Usuario = Depends(usuario_atual),
):
    """Texto de um arquivo já enviado. Aceita `.txt`, `.md`, `.pdf` e `.docx`.

    ⚠️ Declarado **antes** do upload genérico: `POST /storage/{bucket}/{caminho}`
    casaria com esta URL, tomando `extrair-texto` como nome de bucket.

    Recebe o caminho no storage em vez do arquivo porque é assim que a tela já
    trabalha: ela sobe o documento primeiro e depois pede o processamento,
    mandando só `storagePath`.
    """
    alvo = _resolver(bucket, caminho)
    if not alvo.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")

    ext = alvo.suffix.lower().lstrip(".")
    try:
        if ext in ("txt", "md"):
            texto = alvo.read_text(encoding="utf-8", errors="replace")
        elif ext == "pdf":
            from pypdf import PdfReader

            leitor = PdfReader(str(alvo))
            texto = "\n".join((p.extract_text() or "") for p in leitor.pages)
        elif ext == "docx":
            import docx

            texto = "\n".join(p.text for p in docx.Document(str(alvo)).paragraphs)
        else:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Formato não suportado: .{ext}. Envie txt, md, pdf ou docx.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Falha ao extrair texto de %s/%s: %s", bucket, caminho, e)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Não foi possível ler o arquivo: {e}",
        )

    if not texto.strip():
        # PDF de imagem escaneada cai aqui: tem páginas, não tem texto. Dizer
        # "sem texto extraível" é mais útil que devolver string vazia.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Arquivo sem texto extraível. Se for um PDF escaneado, ele precisa de OCR.",
        )

    truncado = len(texto) > _LIMITE_TEXTO
    return TextoExtraidoOut(
        text=texto[:_LIMITE_TEXTO], caracteres=len(texto), truncado=truncado
    )


@router.post("/{bucket}/{caminho:path}", response_model=ArquivoOut,
             status_code=status.HTTP_201_CREATED)
async def enviar(
    bucket: str,
    caminho: str,
    arquivo: UploadFile = File(...),
    _: Usuario = Depends(usuario_atual),
):
    """Grava o arquivo. Sobrescreve se já existir.

    Sobrescrever é o padrão porque era o que o código herdado pedia
    (`upsert: true` no avatar) e porque o caminho já identifica o dono — o
    avatar de um agente é sempre `avatars/<id>.png`. Sem isso, trocar a foto
    criaria arquivo novo e deixaria lixo para sempre.
    """
    alvo = _resolver(bucket, caminho)
    alvo.parent.mkdir(parents=True, exist_ok=True)

    tamanho = 0
    try:
        with alvo.open("wb") as destino:
            while pedaco := await arquivo.read(1024 * 1024):
                tamanho += len(pedaco)
                if tamanho > _TAMANHO_MAXIMO:
                    # Interrompe durante a leitura, não depois: guardar o arquivo
                    # inteiro para então recusá-lo é o que enche o disco.
                    destino.close()
                    alvo.unlink(missing_ok=True)
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"Arquivo acima do limite de {_TAMANHO_MAXIMO // (1024 * 1024)} MB.",
                    )
                destino.write(pedaco)
    except HTTPException:
        raise
    except OSError as e:
        logger.error("Falha ao gravar %s/%s: %s", bucket, caminho, e)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Não foi possível gravar o arquivo."
        )

    logger.info("Arquivo %s/%s gravado (%d bytes)", bucket, caminho, tamanho)
    return ArquivoOut(
        bucket=bucket, path=caminho, url=f"/storage/{bucket}/{caminho}", size=tamanho
    )


@router.get("/privado/{bucket}/{caminho:path}")
async def baixar_privado(
    bucket: str,
    caminho: str,
    _: Usuario = Depends(usuario_atual),
):
    """Serve arquivo de bucket privado, exigindo token.

    ⚠️ Declarado **antes** do handler genérico de propósito: o FastAPI casa na
    ordem de definição, e `/storage/privado/x/y` casaria com
    `/storage/{bucket}/{caminho}` — com `bucket="privado"` — se viesse depois.
    """
    if bucket not in _PRIVADOS:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Bucket não é privado — use /storage/{bucket}/…"
        )
    alvo = _resolver(bucket, caminho)
    if not alvo.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")
    tipo, _sub = mimetypes.guess_type(alvo.name)
    return FileResponse(alvo, media_type=tipo or "application/octet-stream")


@router.get("/{bucket}/{caminho:path}")
async def baixar(bucket: str, caminho: str):
    """Serve o arquivo.

    Sem dependência de autenticação na assinatura porque os buckets públicos
    precisam responder a `<img src>`. Os privados conferem o token na mão, logo
    abaixo — o `Depends` obrigatório fecharia os dois casos junto.
    """
    alvo = _resolver(bucket, caminho)
    if bucket in _PRIVADOS:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Este bucket é privado. Use o endpoint autenticado.",
        )
    if not alvo.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")

    tipo, _ = mimetypes.guess_type(alvo.name)
    return FileResponse(
        alvo,
        media_type=tipo or "application/octet-stream",
        # Curto de propósito: avatar e imagem de wiki são sobrescritos no mesmo
        # caminho, e cache longo mostraria a foto antiga por horas. A tela já
        # acrescenta `?t=<timestamp>` ao trocar, mas isso não pode ser a única
        # defesa.
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.delete("/{bucket}/{caminho:path}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(bucket: str, caminho: str, _: Usuario = Depends(usuario_atual)):
    """Apaga o arquivo. Apagar o que não existe não é erro.

    O `remove()` do Supabase também não reclamava, e a tela usa isso para
    limpar variantes (`.png` e `.jpg`) sem saber qual existe.
    """
    alvo = _resolver(bucket, caminho)
    alvo.unlink(missing_ok=True)


def preparar_diretorios() -> None:
    """Cria os diretórios dos buckets no start.

    Sem isto, o primeiro upload de cada bucket depende do `mkdir` do request, o
    que esconde erro de permissão até alguém tentar subir um arquivo.
    """
    base = Path(settings.UPLOADS_DIR)
    for bucket in sorted(_BUCKETS):
        try:
            (base / bucket).mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning("Não foi possível preparar %s/%s: %s", base, bucket, e)
            return
    logger.info("Buckets prontos em %s: %s", base, ", ".join(sorted(_BUCKETS)))
