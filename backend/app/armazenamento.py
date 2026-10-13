"""Onde os arquivos moram — Cloudflare R2, pela API S3.

Único módulo que conhece o R2. Rotas, relatórios e o servidor MCP de anexos
falam com ele por `chave(bucket, caminho)` e pelas funções `async` abaixo;
nenhum outro lugar importa `boto3`.

Um bucket físico só (`R2_BUCKET`), com o bucket **lógico** como primeiro
segmento da chave. A permissão é do bucket lógico e mora nas rotas; aqui só se
guarda e se assina.

⚠️ **O `boto3` é síncrono.** Toda chamada roda em thread (`anyio.to_thread`),
senão um upload lento do R2 trava o event loop e, com ele, todo request
daquele worker — chat incluído.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import quote

import anyio
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

BUCKETS_PUBLICOS = {"agent-files", "audio-messages", "wiki-uploads"}
BUCKETS_PRIVADOS = {"company-docs", "generated-documents", "anexos"}
BUCKETS = BUCKETS_PUBLICOS | BUCKETS_PRIVADOS

TAMANHO_MAXIMO = 100 * 1024 * 1024

# Segmento aceitável: letras, números, ponto, hífen, sublinhado. O regex aceita
# `.` e `..` — no disco quem barrava a travessia era o `resolve()`; na chave é
# a conferência explícita em `chave()`.
_SEGMENTO = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


def chave(bucket: str, caminho: str) -> str:
    if bucket not in BUCKETS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bucket desconhecido.")
    partes = [p for p in (caminho or "").split("/") if p]
    if not partes or any(p in (".", "..") or not _SEGMENTO.match(p) for p in partes):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho de arquivo inválido.")
    return f"{bucket}/{'/'.join(partes)}"


@dataclass(frozen=True)
class Objeto:
    tamanho: int
    mime: str | None


class R2:
    def __init__(self, account_id: str, chave_id: str, segredo: str, bucket: str):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=chave_id,
            aws_secret_access_key=segredo,
            region_name="auto",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    @staticmethod
    def _nao_existe(e: Exception) -> bool:
        codigo = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        return codigo in ("404", "NoSuchKey", "NotFound")

    def gravar(self, chave: str, dados: bytes, mime: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=chave, Body=dados, ContentType=mime)

    def ler(self, chave: str) -> bytes | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=chave)["Body"].read()
        except Exception as e:  # noqa: BLE001
            if self._nao_existe(e):
                return None
            raise

    def cabecalho(self, chave: str) -> Objeto | None:
        try:
            r = self.s3.head_object(Bucket=self.bucket, Key=chave)
        except Exception as e:  # noqa: BLE001
            if self._nao_existe(e):
                return None
            raise
        return Objeto(tamanho=int(r["ContentLength"]), mime=r.get("ContentType"))

    def url_get(self, chave: str, segundos: int, nome_download: str | None, inline: bool) -> str:
        params = {"Bucket": self.bucket, "Key": chave}
        if nome_download:
            modo = "inline" if inline else "attachment"
            params["ResponseContentDisposition"] = f"{modo}; filename*=UTF-8''{quote(nome_download)}"
        return self.s3.generate_presigned_url("get_object", Params=params, ExpiresIn=segundos)

    def url_put(self, chave: str, mime: str, tamanho: int, segundos: int) -> str:
        # `ContentLength` entra na assinatura: o R2 recusa corpo de tamanho
        # diferente do declarado. O `concluir` confere de novo do lado de cá.
        return self.s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": chave, "ContentType": mime,
                    "ContentLength": tamanho},
            ExpiresIn=segundos,
        )

    def apagar(self, chave: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=chave)

    def listar(self, prefixo: str, recursivo: bool) -> list[dict]:
        pag = self.s3.get_paginator("list_objects_v2")
        extra = {} if recursivo else {"Delimiter": "/"}
        itens = []
        for pagina in pag.paginate(Bucket=self.bucket, Prefix=prefixo, **extra):
            for o in pagina.get("Contents", []):
                itens.append({"chave": o["Key"], "nome": o["Key"].rsplit("/", 1)[-1],
                              "tamanho": int(o["Size"])})
        return itens


class Memoria:
    """Backend em memória com a mesma interface — para teste, nunca produção."""

    def __init__(self):
        self.objetos: dict[str, tuple[bytes, str]] = {}

    def gravar(self, chave, dados, mime):
        self.objetos[chave] = (dados, mime)

    def ler(self, chave):
        o = self.objetos.get(chave)
        return o[0] if o else None

    def cabecalho(self, chave):
        o = self.objetos.get(chave)
        return Objeto(tamanho=len(o[0]), mime=o[1]) if o else None

    def url_get(self, chave, segundos, nome_download, inline):
        return f"https://r2.invalido/{chave}?expira={segundos}"

    def url_put(self, chave, mime, tamanho, segundos):
        return f"https://r2.invalido/{chave}?put=1&tamanho={tamanho}&expira={segundos}"

    def apagar(self, chave):
        self.objetos.pop(chave, None)

    def listar(self, prefixo, recursivo):
        itens = []
        for k, (dados, _) in sorted(self.objetos.items()):
            if not k.startswith(prefixo):
                continue
            if not recursivo and "/" in k[len(prefixo):]:
                continue
            itens.append({"chave": k, "nome": k.rsplit("/", 1)[-1], "tamanho": len(dados)})
        return itens


_backend = None


def definir(backend) -> None:
    global _backend
    _backend = backend


def _obter():
    global _backend
    if _backend is not None:
        return _backend
    faltando = [n for n in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
                if not getattr(settings, n)]
    if faltando:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Armazenamento de arquivos não configurado: falta {', '.join(faltando)}.",
        )
    _backend = R2(settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID,
                  settings.R2_SECRET_ACCESS_KEY, settings.R2_BUCKET)
    return _backend


async def _rodar(metodo: str, *args):
    backend = _obter()
    try:
        return await anyio.to_thread.run_sync(getattr(backend, metodo), *args)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("R2 falhou em %s(%s): %s", metodo, args[0] if args else "", e)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "O armazenamento de arquivos (R2) recusou a operação. Tente de novo; "
            "se persistir, avise o administrador.",
        )


async def gravar(chave: str, dados: bytes, mime: str) -> None:
    await _rodar("gravar", chave, dados, mime)


async def ler(chave: str) -> bytes | None:
    return await _rodar("ler", chave)


async def cabecalho(chave: str) -> Objeto | None:
    return await _rodar("cabecalho", chave)


async def url_get(chave: str, segundos: int, nome_download: str | None = None,
                  inline: bool = True) -> str:
    return await _rodar("url_get", chave, segundos, nome_download, inline)


async def url_put(chave: str, mime: str, tamanho: int, segundos: int) -> str:
    return await _rodar("url_put", chave, mime, tamanho, segundos)


async def apagar(chave: str) -> None:
    await _rodar("apagar", chave)


async def listar(prefixo: str, recursivo: bool = False) -> list[dict]:
    return await _rodar("listar", prefixo, recursivo)
