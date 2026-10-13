# backend/app/anexos_leitura.py
"""Transforma um anexo em texto que o agente consegue ler, por páginas.

Saída em TSV (tabulação entre colunas): é o formato que menos gasta token e
que o modelo lê sem confundir vírgula decimal brasileira com separador.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, time

from app.anexos import tipo_legivel

LINHAS_POR_PAGINA = 200
CARACTERES_POR_PAGINA = 20_000


def _celula(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M") if (v.hour or v.minute) else v.strftime("%Y-%m-%d")
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).replace("\t", " ").replace("\n", " ").strip()


def _abas_xlsx(dados: bytes) -> dict[str, list[list[str]]]:
    import openpyxl

    # `data_only=True`: o valor calculado, não a fórmula. Exportação de
    # sistema (Flash) já vem com valor; fórmula crua não diz nada ao agente.
    wb = openpyxl.load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
    return {ws.title: [[_celula(c) for c in linha] for linha in ws.iter_rows(values_only=True)]
            for ws in wb.worksheets}


def _abas_xls(dados: bytes) -> dict[str, list[list[str]]]:
    import xlrd

    wb = xlrd.open_workbook(file_contents=dados)
    abas = {}
    for sh in wb.sheets():
        linhas = []
        for r in range(sh.nrows):
            linha = []
            for c in range(sh.ncols):
                cel = sh.cell(r, c)
                if cel.ctype == xlrd.XL_CELL_DATE:
                    linha.append(_celula(xlrd.xldate_as_datetime(cel.value, wb.datemode)))
                else:
                    linha.append(_celula(cel.value))
            linhas.append(linha)
        abas[sh.name] = linhas
    return abas


def _decodificar(dados: bytes) -> str:
    # Ordem importa: UTF-8 estrito falha em cp1252 com acento; cp1252 nunca falha.
    for cod in ("utf-8-sig", "cp1252"):
        try:
            return dados.decode(cod)
        except UnicodeDecodeError:
            continue
    return dados.decode("latin-1")


def _abas_csv(dados: bytes) -> dict[str, list[list[str]]]:
    texto = _decodificar(dados)
    amostra = texto[:5000]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=";,\t|")
    except csv.Error:
        # Subclasse: mutar `csv.excel` alteraria a classe global para todo o processo.
        class dialeto(csv.excel):
            delimiter = ";" if amostra.count(";") > amostra.count(",") else ","
    return {"CSV": [[_celula(c) for c in l] for l in csv.reader(io.StringIO(texto), dialeto)]}


def _sem_linhas_vazias(linhas: list[list[str]]) -> list[list[str]]:
    return [l for l in linhas if any(c for c in l)]


def _planilha(nome: str, dados: bytes, aba: str | None, pagina: int) -> str:
    ext = nome.rsplit(".", 1)[-1].lower()
    leitor = {"xlsx": _abas_xlsx, "xlsm": _abas_xlsx, "xls": _abas_xls, "csv": _abas_csv}.get(ext)
    if leitor is None:
        return f"Formato de planilha .{ext} não suportado. Peça o arquivo em .xlsx, .xls ou .csv."
    abas = {n: _sem_linhas_vazias(l) for n, l in leitor(dados).items()}
    resumo = "Abas: " + ", ".join(f"{n} ({len(l)} linhas)" for n, l in abas.items())
    if aba is not None and aba not in abas:
        return f"A aba \"{aba}\" não existe. {resumo}"
    nome_aba = aba or next(iter(abas), None)
    if nome_aba is None:
        return "Planilha sem nenhuma aba com conteúdo."
    linhas = abas[nome_aba]
    if not linhas:
        return f"{resumo}\nA aba {nome_aba} está vazia."
    cabecalho, corpo = linhas[0], linhas[1:]
    total = max(1, -(-len(corpo) // LINHAS_POR_PAGINA))
    if pagina > total:
        return f"{resumo}\nA aba {nome_aba} só tem {total} página{'s' if total > 1 else ''}."
    ini = (pagina - 1) * LINHAS_POR_PAGINA
    fatia = corpo[ini: ini + LINHAS_POR_PAGINA]
    return "\n".join([
        resumo,
        f"Aba: {nome_aba} · página {pagina}/{total} · linhas {ini + 1}–{ini + len(fatia)} de {len(corpo)}"
        " (a 1ª linha da planilha é o cabeçalho e se repete em toda página)",
        "\t".join(cabecalho),
        *("\t".join(l) for l in fatia),
    ])


def _texto(nome: str, dados: bytes) -> str:
    ext = nome.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        from pypdf import PdfReader

        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(dados)).pages)
    if ext == "docx":
        import docx

        return "\n".join(p.text for p in docx.Document(io.BytesIO(dados)).paragraphs)
    return _decodificar(dados)


def _paginar_texto(texto: str, pagina: int) -> str:
    total = max(1, -(-len(texto) // CARACTERES_POR_PAGINA))
    if pagina > total:
        return f"O texto só tem {total} página{'s' if total > 1 else ''}."
    ini = (pagina - 1) * CARACTERES_POR_PAGINA
    return f"Texto · página {pagina}/{total}\n\n" + texto[ini: ini + CARACTERES_POR_PAGINA]


def conteudo_legivel(nome: str, mime: str, dados: bytes, aba: str | None = None, pagina: int = 1) -> str:
    pagina = max(1, int(pagina or 1))
    tipo = tipo_legivel(nome, mime)
    if tipo == "planilha":
        return _planilha(nome, dados, aba, pagina)
    if tipo in ("pdf", "documento", "texto"):
        texto = _texto(nome, dados)
        if not texto.strip():
            return "Arquivo sem texto extraível (PDF escaneado precisa de OCR)."
        return _paginar_texto(texto, pagina)
    return (f"Arquivo {nome} ({tipo}) — o conteúdo não é legível por ferramenta. "
            "Diga à pessoa o que você consegue fazer com ele e peça outro formato se precisar.")
