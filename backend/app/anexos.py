# backend/app/anexos.py
"""Anexo de conversa: quem lê, onde mora, como o agente o vê.

Funções puras — a decisão de acesso fica aqui, testada sem banco, e as rotas
(`app/routers/anexos.py`, `app/routers/mcp_anexos.py`) só buscam os fatos
(a linha, se é membro do canal) e perguntam.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.dependencies import normalizar_agent_id

SQL_ANEXO = """
    SELECT id::text AS id, caminho, nome, mime, tamanho, contexto,
           channel_id::text AS channel_id, agent_id, dono_conversa::text AS dono_conversa
      FROM public.anexos WHERE id = $1::uuid
"""


@dataclass(frozen=True)
class Anexo:
    id: str
    caminho: str
    nome: str
    mime: str
    tamanho: int
    contexto: str
    channel_id: str | None
    agent_id: str | None
    dono_conversa: str | None

    @classmethod
    def de_linha(cls, linha) -> "Anexo":
        return cls(**{k: linha[k] for k in cls.__dataclass_fields__})


def pessoa_pode_ler(anexo: Anexo, usuario_id: str, membro_do_canal: bool) -> bool:
    if anexo.contexto == "canal":
        return membro_do_canal
    if anexo.contexto == "conversa_agente":
        return bool(anexo.dono_conversa) and anexo.dono_conversa == usuario_id
    return False


def agente_pode_ler(anexo: Anexo, agent_id: str, agente_no_canal: bool) -> bool:
    if anexo.contexto == "canal":
        return agente_no_canal
    if anexo.contexto == "conversa_agente":
        return bool(anexo.agent_id) and \
            normalizar_agent_id(anexo.agent_id) == normalizar_agent_id(agent_id)
    return False


def nome_saneado(nome: str) -> str:
    """Nome que passa no `_SEGMENTO` do armazenamento, legível o bastante.

    O nome original continua na tabela e é o que aparece na tela e no
    download — este só serve de chave.
    """
    sem_acento = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode()
    base, ponto, ext = sem_acento.rpartition(".")
    if not ponto:
        base, ext = sem_acento, ""
    limpo = lambda s: re.sub(r"-{2,}", "-", re.sub(r"[^A-Za-z0-9._-]", "-", s)).strip("-.")  # noqa: E731
    base, ext = limpo(base), limpo(ext)[:10]
    if not base:
        return "arquivo"
    sufixo = f".{ext}" if ext else ""
    return base[: 100 - len(sufixo)] + sufixo


def caminho_do_anexo(anexo_id: str, contexto: str, alvo_id: str, nome: str) -> str:
    pasta = "canal" if contexto == "canal" else "conversa"
    return f"{pasta}/{alvo_id}/{anexo_id}/{nome_saneado(nome)}"


_EXT = {
    "planilha": ("xlsx", "xls", "xlsm", "csv", "ods"),
    "pdf": ("pdf",),
    "documento": ("docx", "doc", "odt", "rtf"),
    "texto": ("txt", "md", "json", "xml", "html"),
    "imagem": ("png", "jpg", "jpeg", "gif", "webp", "heic"),
    "audio": ("mp3", "ogg", "wav", "m4a", "webm"),
}


def tipo_legivel(nome: str, mime: str) -> str:
    ext = nome.rsplit(".", 1)[-1].lower() if "." in (nome or "") else ""
    for tipo, exts in _EXT.items():
        if ext in exts:
            return tipo
    m = (mime or "").lower()
    if m.startswith("image/"):
        return "imagem"
    if m.startswith("audio/"):
        return "audio"
    if m.startswith("text/"):
        return "texto"
    return "arquivo"


def tamanho_legivel(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        # Meio para cima: o `round` do Python arredonda para o par (2,5 -> 2).
        return f"{int(n / 1024 + 0.5)} KB"
    return f"{n / (1024 * 1024):.1f} MB".replace(".", ",")


def linha_de_anexo(anexo: Anexo) -> str:
    return (f"[anexo: {anexo.nome} · {tamanho_legivel(anexo.tamanho)} · "
            f"{tipo_legivel(anexo.nome, anexo.mime)} · id={anexo.id}]")
