"""Monta o arquivo que o agente devolve, a partir de texto.

⚠️ O modelo escreve TEXTO (CSV, Markdown); quem produz os bytes é o servidor.
Base64 de binário gerado por LLM erra um caractere em dezenas de milhares e
entrega um arquivo que não abre.
"""
from __future__ import annotations

import csv
import io
import re

from app.routers.storage import DefinicaoIn, SecaoIn, _montar_docx, _montar_pdf

FORMATOS = {"csv", "xlsx", "md", "docx", "pdf"}
LIMITE_CONTEUDO = 2_000_000
LIMITE_NOME = 200  # mesmo teto do DocumentoIn.title

_MIME = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "md": "text/markdown",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


def _linhas_csv(conteudo: str) -> list[list[str]]:
    amostra = conteudo[:5000]
    delim = ";" if amostra.count(";") >= amostra.count(",") else ","
    return [l for l in csv.reader(io.StringIO(conteudo), delimiter=delim) if any(l)]


def secoes_de_markdown(md: str) -> list[SecaoIn]:
    secoes = []
    for linha in md.splitlines():
        t = linha.strip()
        if not t:
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", t)
        if m:
            secoes.append(SecaoIn(heading=f"H{len(m.group(1))}", text=m.group(2).strip()))
            continue
        negrito = re.fullmatch(r"\*\*(.+)\*\*", t)
        secoes.append(SecaoIn(text=negrito.group(1) if negrito else t, bold=bool(negrito)))
    return secoes


def montar_arquivo(formato: str, nome: str, conteudo: str) -> tuple[bytes, str, str]:
    """Devolve `(dados, mime, nome_final)`; `ValueError` traz mensagem para o agente."""
    formato = (formato or "").lower().strip()
    if formato not in FORMATOS:
        raise ValueError(f"Formato {formato!r} não suportado. Use um de: {', '.join(sorted(FORMATOS))}.")
    if not (conteudo or "").strip():
        raise ValueError("Conteúdo vazio — nada para enviar.")
    if len(conteudo) > LIMITE_CONTEUDO:
        raise ValueError("Conteúdo grande demais para um arquivo enviado pelo chat (limite de 2 milhões de caracteres).")

    if len(nome or "") > LIMITE_NOME:
        raise ValueError(f"Nome grande demais (limite de {LIMITE_NOME} caracteres).")
    base = (nome or "arquivo").strip()
    if base.lower().endswith(f".{formato}"):
        base = base[: -len(formato) - 1]
    nome_final = f"{base or 'arquivo'}.{formato}"

    if formato == "csv":
        return conteudo.encode("utf-8-sig"), _MIME["csv"], nome_final
    if formato == "md":
        return conteudo.encode("utf-8"), _MIME["md"], nome_final
    if formato == "xlsx":
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        for l in _linhas_csv(conteudo):
            ws.append(l)
        # Injeção de fórmula: texto começando com = + - @ viraria fórmula no
        # Excel (ex.: =HYPERLINK). Força tipo texto nessas células.
        for linha in ws.iter_rows():
            for c in linha:
                if isinstance(c.value, str) and c.value[:1] in ("=", "+", "-", "@"):
                    c.data_type = "s"
        b = io.BytesIO()
        wb.save(b)
        return b.getvalue(), _MIME["xlsx"], nome_final
    secoes = secoes_de_markdown(conteudo)
    titulo = next((s.text for s in secoes if s.heading == "H1"), base)
    definicao = DefinicaoIn(title=titulo, sections=[s for s in secoes if not (s.heading == "H1" and s.text == titulo)])
    dados = _montar_pdf(definicao) if formato == "pdf" else _montar_docx(definicao)
    return dados, _MIME[formato], nome_final
