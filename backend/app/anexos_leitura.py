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

# Tetos de recursos (xlsx é zip: 100 MB de arquivo podem virar GB em memória).
TETO_LINHAS = 200_000
TETO_BYTES_DESCOMPACTADOS = 300 * 1024 * 1024


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


class _GrandeDemais(Exception):
    """A planilha passou de um teto de recursos; a mensagem vai ao agente."""


def _fatiar(linhas, ini: int):
    """Percorre as linhas UMA vez, sem guardá-las: devolve (cabeçalho, fatia,
    total do corpo). Só a fatia `[ini, ini+LINHAS_POR_PAGINA)` fica em memória.

    ⚠️ **Preguiçoso de propósito.** Antes, cada página expandia o workbook
    inteiro em listas; xlsx é zip, e 100 MB viram GB. Linha vazia não conta.
    """
    cabecalho, fatia, total, vistas = None, [], 0, 0
    for linha in linhas:
        vistas += 1
        if vistas > TETO_LINHAS:
            raise _GrandeDemais(f"a aba passa de {TETO_LINHAS} linhas")
        if not any(linha):
            continue
        if cabecalho is None:
            cabecalho = linha
            continue
        if ini <= total < ini + LINHAS_POR_PAGINA:
            fatia.append(linha)
        total += 1
    return cabecalho, fatia, total


def _lido_xlsx(dados: bytes, aba, ini: int):
    import zipfile

    import openpyxl

    # xlsx é zip: soma o tamanho descompactado DECLARADO antes de abrir.
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        if sum(i.file_size for i in z.infolist()) > TETO_BYTES_DESCOMPACTADOS:
            raise _GrandeDemais(
                f"o arquivo descompactado passa de {TETO_BYTES_DESCOMPACTADOS // (1024 * 1024)} MB")
    # `data_only=True`: o valor calculado, não a fórmula. Exportação de
    # sistema (Flash) já vem com valor; fórmula crua não diz nada ao agente.
    wb = openpyxl.load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
    try:
        nomes = list(wb.sheetnames)
        contagens = {n: getattr(wb[n], "max_row", None) for n in nomes}
        escolhida = aba if aba is not None else (nomes[0] if nomes else None)
        if escolhida not in nomes:
            return nomes, contagens, escolhida, None, [], 0
        ws = wb[escolhida]
        cab, fatia, total = _fatiar(
            ([_celula(c) for c in linha] for linha in ws.iter_rows(values_only=True)), ini)
        return nomes, contagens, escolhida, cab, fatia, total
    finally:
        wb.close()


def _lido_xls(dados: bytes, aba, ini: int):
    import xlrd

    # on_demand: só a folha pedida é carregada em memória.
    wb = xlrd.open_workbook(file_contents=dados, on_demand=True)
    try:
        nomes = wb.sheet_names()
        escolhida = aba if aba is not None else (nomes[0] if nomes else None)
        if escolhida not in nomes:
            return nomes, {n: None for n in nomes}, escolhida, None, [], 0
        sh = wb.sheet_by_name(escolhida)
        if sh.nrows > TETO_LINHAS:
            raise _GrandeDemais(f"a aba passa de {TETO_LINHAS} linhas")

        def linhas():
            for r in range(sh.nrows):
                yield [_celula(xlrd.xldate_as_datetime(c.value, wb.datemode))
                       if c.ctype == xlrd.XL_CELL_DATE else _celula(c.value)
                       for c in sh.row(r)]

        cab, fatia, total = _fatiar(linhas(), ini)
        return nomes, {n: None for n in nomes}, escolhida, cab, fatia, total
    finally:
        wb.release_resources()


def _decodificar(dados: bytes) -> str:
    # Ordem importa: UTF-8 estrito falha em cp1252 com acento; cp1252 nunca falha.
    for cod in ("utf-8-sig", "cp1252"):
        try:
            return dados.decode(cod)
        except UnicodeDecodeError:
            continue
    return dados.decode("latin-1")


def _lido_csv(dados: bytes, aba, ini: int):
    texto = _decodificar(dados)
    amostra = texto[:5000]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=";,\t|")
    except csv.Error:
        # Subclasse: mutar `csv.excel` alteraria a classe global para todo o processo.
        class dialeto(csv.excel):
            delimiter = ";" if amostra.count(";") > amostra.count(",") else ","
    if aba is not None and aba != "CSV":
        return ["CSV"], {"CSV": None}, aba, None, [], 0
    # Linha a linha: o reader é um iterador.
    cab, fatia, total = _fatiar(
        ([_celula(c) for c in l] for l in csv.reader(io.StringIO(texto), dialeto)), ini)
    return ["CSV"], {"CSV": None}, "CSV", cab, fatia, total


def _planilha(nome: str, dados: bytes, aba: str | None, pagina: int) -> str:
    ext = nome.rsplit(".", 1)[-1].lower()
    leitor = {"xlsx": _lido_xlsx, "xlsm": _lido_xlsx, "xls": _lido_xls, "csv": _lido_csv}.get(ext)
    if leitor is None:
        return f"Formato de planilha .{ext} não suportado. Peça o arquivo em .xlsx, .xls ou .csv."
    ini = (pagina - 1) * LINHAS_POR_PAGINA
    try:
        nomes, contagens, nome_aba, cabecalho, fatia, total = leitor(dados, aba, ini)
    except _GrandeDemais as e:
        return (f"planilha grande demais para ler por aqui: {e}. "
                "Peça à pessoa uma exportação menor (um período ou uma aba só).")

    def rotulo(n):
        # A aba lida tem contagem exata; as outras, a barata (ou "?").
        if n == nome_aba and cabecalho is not None:
            return f"{n} ({total + 1} linhas)"
        c = contagens.get(n)
        return f"{n} ({c if c is not None else '?'} linhas)"

    resumo = "Abas: " + ", ".join(rotulo(n) for n in nomes)
    if aba is not None and aba not in nomes:
        return f"A aba \"{aba}\" não existe. {resumo}"
    if nome_aba is None:
        return "Planilha sem nenhuma aba com conteúdo."
    if cabecalho is None:
        return f"{resumo}\nA aba {nome_aba} está vazia."
    paginas = max(1, -(-total // LINHAS_POR_PAGINA))
    if pagina > paginas:
        return f"{resumo}\nA aba {nome_aba} só tem {paginas} página{'s' if paginas > 1 else ''}."
    return "\n".join([
        resumo,
        f"Aba: {nome_aba} · página {pagina}/{paginas} · linhas {ini + 1}–{ini + len(fatia)} de {total}"
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
