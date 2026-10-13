# backend/app/anexos_leitura.py
"""Transforma um anexo em texto que o agente consegue ler, por páginas.

Saída em TSV (tabulação entre colunas): é o formato que menos gasta token e
que o modelo lê sem confundir vírgula decimal brasileira com separador.
"""
from __future__ import annotations

import csv
import io
import itertools
from datetime import date, datetime, time

from app.anexos import tipo_legivel

LINHAS_POR_PAGINA = 200
CARACTERES_POR_PAGINA = 20_000

# Tetos de recursos (xlsx é zip: 100 MB de arquivo podem virar GB em memória).
TETO_LINHAS = 200_000
# Linha com milhões de colunas (dimensão declarada absurda, CSV sem quebra)
# escapava do teto de linhas. Cortar coluna não é erro: vira nota no cabeçalho.
TETO_COLUNAS = 200
TETO_CAMPO_CSV = 1024 * 1024
TETO_CSV_BYTES = 50 * 1024 * 1024
TETO_LINHA_CSV = 1024 * 1024

# Limite de campo definido UMA vez, na importação: salvar/mudar/restaurar a cada
# leitura corria entre threads (`csv.Error` espúrio, limite trocado). Nenhum
# outro código do backend usa `csv` (conferido por grep em 13/10/2026), então
# subir o padrão de 128 KB para 1 MB não afeta ninguém.
csv.field_size_limit(TETO_CAMPO_CSV)
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
    cabecalho, fatia, total, vistas, cortou = None, [], 0, 0, False
    for linha in linhas:
        # openpyxl com `max_col` preenche a linha com vazios até o teto: sem
        # aparar a cauda, toda linha pareceria cortada.
        while linha and linha[-1] == "":
            linha = linha[:-1]
        # Os leitores entregam até TETO_COLUNAS + 1 células: a extra só denuncia o corte.
        if len(linha) > TETO_COLUNAS:
            cortou = True
            linha = linha[:TETO_COLUNAS]
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
    return cabecalho, fatia, total, cortou


def _conferir_zip(dados: bytes) -> None:
    """xlsx e docx são zip: soma o tamanho descompactado DECLARADO antes de abrir.

    Um zip de poucos KB pode declarar GB. O docx ia direto para o
    `docx.Document` sem esta conta até a revisão de segurança de 13/10/2026.
    """
    import zipfile

    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        if sum(i.file_size for i in z.infolist()) > TETO_BYTES_DESCOMPACTADOS:
            raise _GrandeDemais(
                f"o arquivo descompactado passa de {TETO_BYTES_DESCOMPACTADOS // (1024 * 1024)} MB")


def _lido_xlsx(dados: bytes, aba, ini: int):
    import openpyxl

    _conferir_zip(dados)
    # `data_only=True`: o valor calculado, não a fórmula. Exportação de
    # sistema (Flash) já vem com valor; fórmula crua não diz nada ao agente.
    wb = openpyxl.load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
    try:
        nomes = list(wb.sheetnames)
        contagens = {n: getattr(wb[n], "max_row", None) for n in nomes}
        escolhida = aba if aba is not None else (nomes[0] if nomes else None)
        if escolhida not in nomes:
            return nomes, contagens, escolhida, None, [], 0, False
        ws = wb[escolhida]
        cab, fatia, total, cortou = _fatiar(
            ([_celula(c) for c in linha]
             for linha in ws.iter_rows(values_only=True, max_col=TETO_COLUNAS + 1)), ini)
        return nomes, contagens, escolhida, cab, fatia, total, cortou
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
            return nomes, {n: None for n in nomes}, escolhida, None, [], 0, False
        sh = wb.sheet_by_name(escolhida)
        if sh.nrows > TETO_LINHAS:
            raise _GrandeDemais(f"a aba passa de {TETO_LINHAS} linhas")

        def linhas():
            for r in range(sh.nrows):
                yield [_celula(xlrd.xldate_as_datetime(c.value, wb.datemode))
                       if c.ctype == xlrd.XL_CELL_DATE else _celula(c.value)
                       for c in sh.row(r)[:TETO_COLUNAS + 1]]

        cab, fatia, total, cortou = _fatiar(linhas(), ini)
        return nomes, {n: None for n in nomes}, escolhida, cab, fatia, total, cortou
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


class _LinhasContadas:
    """Entrega ao `csv.reader` as linhas físicas do texto, uma por vez, e conta
    quanto ele já consumiu desde o último registro que devolveu.

    ⚠️ **O teto é do REGISTRO, não da linha física.** Um campo entre aspas pode
    conter `\n`, e então um registro só atravessa milhares de linhas físicas
    curtas — 300 mil campos `"a\nb",` passam em qualquer teto por linha e viram
    uma lista de 300 mil itens. A rodada 3 pré-varria o texto com
    `str.splitlines`, que ainda por cima quebra em `\x0c`, `\x85`, `\u2028`...
    onde o reader NÃO quebra: dois tokenizadores discordando é o furo. Aqui só
    existe um, e o limite é medido no que ele de fato consumiu.

    Quebra só em `\n` e mantém o `\n` na linha, como o `io.StringIO` faria — o
    reader precisa dele para montar o campo multilinha. `str.find` a partir da
    posição: nenhuma lista com as linhas do texto inteiro.
    """

    def __init__(self, texto: str):
        self.texto = texto
        self.pos = 0
        self.consumido = 0  # zerado por quem lê, a cada registro devolvido

    def __iter__(self):
        return self

    def __next__(self) -> str:
        if self.pos >= len(self.texto):
            raise StopIteration
        fim = self.texto.find("\n", self.pos)
        fim = len(self.texto) if fim < 0 else fim + 1
        # Confere ANTES de fatiar: a linha que estoura nem chega ao parser.
        if self.consumido + (fim - self.pos) > TETO_LINHA_CSV:
            raise _GrandeDemais(f"há uma linha com mais de {TETO_LINHA_CSV // 1024} KB")
        linha = self.texto[self.pos:fim]
        self.consumido += fim - self.pos
        self.pos = fim
        return linha


def _registros_csv(texto: str, dialeto):
    linhas = _LinhasContadas(texto)
    for registro in csv.reader(linhas, dialeto):
        linhas.consumido = 0
        yield registro


def _lido_csv(dados: bytes, aba, ini: int):
    texto = _decodificar(dados)
    amostra = texto[:5000]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=";,\t|")
    except csv.Error:
        # Subclasse: mutar `csv.excel` alteraria a classe global para todo o processo.
        class dialeto(csv.excel):
            delimiter = ";" if amostra.count(";") > amostra.count(",") else ","
    if len(texto) > TETO_CSV_BYTES:
        raise _GrandeDemais(f"o CSV passa de {TETO_CSV_BYTES // (1024 * 1024)} MB")
    if aba is not None and aba != "CSV":
        return ["CSV"], {"CSV": None}, aba, None, [], 0, False
    # Registro a registro. `islice` corta em TETO_COLUNAS + 1 células, mas age
    # DEPOIS de o reader montar a lista do registro inteiro — quem segura um
    # registro com milhões de campos é o `_LinhasContadas`, durante a leitura.
    # O limite de campo barra um campo único gigante (`csv.Error`, que o router
    # trata como arquivo ilegível).
    cab, fatia, total, cortou = _fatiar(
        ([_celula(c) for c in itertools.islice(l, TETO_COLUNAS + 1)]
         for l in _registros_csv(texto, dialeto)), ini)
    return ["CSV"], {"CSV": None}, "CSV", cab, fatia, total, cortou


def _planilha(nome: str, dados: bytes, aba: str | None, pagina: int) -> str:
    ext = nome.rsplit(".", 1)[-1].lower()
    leitor = {"xlsx": _lido_xlsx, "xlsm": _lido_xlsx, "xls": _lido_xls, "csv": _lido_csv}.get(ext)
    if leitor is None:
        return f"Formato de planilha .{ext} não suportado. Peça o arquivo em .xlsx, .xls ou .csv."
    ini = (pagina - 1) * LINHAS_POR_PAGINA
    try:
        nomes, contagens, nome_aba, cabecalho, fatia, total, cortou = leitor(dados, aba, ini)
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
        " (a 1ª linha da planilha é o cabeçalho e se repete em toda página)"
        + (f" (mostrando as primeiras {TETO_COLUNAS} colunas)" if cortou else ""),
        "\t".join(cabecalho),
        *("\t".join(l) for l in fatia),
    ])


# PDF de milhares de páginas extraía todas antes de paginar o texto: CPU e
# memória proporcionais a um número que quem envia escolhe.
TETO_PAGINAS_PDF = 200


# E página não é a única medida: uma só pode ter content stream enorme, ou o
# PDF pode reaproveitar o mesmo stream em todas. O texto é acumulado pedaço a
# pedaço e a extração PARA ao passar deste teto (revisão de segurança, 13/10).
TETO_TEXTO = 5 * 1024 * 1024
_NOTA_TEXTO_CORTADO = f" (texto cortado em {TETO_TEXTO // (1024 * 1024)} MB)"


def _acumular(pedacos) -> tuple[str, bool]:
    """Junta com "\n" até passar de `TETO_TEXTO`; diz se cortou. Consome o
    iterável preguiçosamente — o que vem depois do teto nem é extraído."""
    partes, tamanho = [], 0
    for p in pedacos:
        partes.append(p)
        tamanho += len(p) + 1
        if tamanho > TETO_TEXTO:
            return "\n".join(partes)[:TETO_TEXTO], True
    return "\n".join(partes), False


def _texto(nome: str, dados: bytes) -> tuple[str, str]:
    """O texto e uma nota para o cabeçalho (vazia quando nada foi cortado)."""
    ext = nome.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        import pypdf

        paginas = pypdf.PdfReader(io.BytesIO(dados)).pages
        total = len(paginas)
        lidas = min(total, TETO_PAGINAS_PDF)
        texto, cortou = _acumular(
            (paginas[i].extract_text() or "") for i in range(lidas))
        nota = (f" (lidas as primeiras {TETO_PAGINAS_PDF} de {total} páginas)"
                if total > TETO_PAGINAS_PDF else "")
        return texto, nota + (_NOTA_TEXTO_CORTADO if cortou else "")
    if ext == "docx":
        import docx

        _conferir_zip(dados)
        texto, cortou = _acumular(
            p.text for p in docx.Document(io.BytesIO(dados)).paragraphs)
        return texto, _NOTA_TEXTO_CORTADO if cortou else ""
    return _decodificar(dados), ""


def _paginar_texto(texto: str, pagina: int, nota: str = "") -> str:
    total = max(1, -(-len(texto) // CARACTERES_POR_PAGINA))
    if pagina > total:
        return f"O texto só tem {total} página{'s' if total > 1 else ''}.{nota}"
    ini = (pagina - 1) * CARACTERES_POR_PAGINA
    return f"Texto · página {pagina}/{total}{nota}\n\n" + texto[ini: ini + CARACTERES_POR_PAGINA]


# Documentos que a linha do anexo chama de "documento" mas que não temos como
# ler: `.doc` é binário OLE, `.odt` é zip e `.rtf` é marcação. Decodificá-los
# como texto entregava lixo ao agente, que respondia em cima dele.
_DOCUMENTO_SEM_LEITOR = ("doc", "odt", "rtf")


def conteudo_legivel(nome: str, mime: str, dados: bytes, aba: str | None = None, pagina: int = 1) -> str:
    pagina = max(1, int(pagina or 1))
    tipo = tipo_legivel(nome, mime)
    ext = nome.rsplit(".", 1)[-1].lower() if "." in (nome or "") else ""
    if tipo == "documento" and ext in _DOCUMENTO_SEM_LEITOR:
        return f"formato .{ext} não é legível por aqui; peça o arquivo em .docx ou .pdf"
    if tipo == "planilha":
        return _planilha(nome, dados, aba, pagina)
    if tipo in ("pdf", "documento", "texto"):
        try:
            texto, nota = _texto(nome, dados)
        except _GrandeDemais as e:
            return f"documento grande demais para ler por aqui: {e}"
        if not texto.strip():
            return "Arquivo sem texto extraível (PDF escaneado precisa de OCR)." + nota
        return _paginar_texto(texto, pagina, nota)
    return (f"Arquivo {nome} ({tipo}) — o conteúdo não é legível por ferramenta. "
            "Diga à pessoa o que você consegue fazer com ele e peça outro formato se precisar.")
