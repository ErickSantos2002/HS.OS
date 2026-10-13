# backend/tests/test_anexos_leitura.py
"""O que o agente recebe quando abre um anexo.

A primeira planilha real vai ser o ponto exportado do Flash. Três coisas
podem chegar e nenhuma pode virar erro: `.xlsx`, o `.xls` antigo (formato
binário de 1997, que o openpyxl não lê) e CSV salvo pelo Excel brasileiro —
separado por `;` e em Windows-1252, onde "Março" vira "MarÃ§o" se for lido
como UTF-8.

⚠️ **A página repete o cabeçalho.** Planilha de ponto tem centenas de linhas;
o agente lê por páginas, e uma página sem cabeçalho são números sem nome.
"""
import csv
import io

import openpyxl

from app import anexos_leitura as L


def _xlsx(linhas, aba="Ponto"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = aba
    for l in linhas:
        ws.append(l)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def test_xlsx_lista_abas_e_traz_cabecalho_e_linhas():
    dados = _xlsx([["Nome", "Data", "Entrada"], ["Ana", "2026-09-01", "08:02"]])
    t = L.conteudo_legivel("ponto.xlsx", "", dados)
    assert "Abas: Ponto (2 linhas)" in t
    assert "Nome\tData\tEntrada" in t
    assert "Ana\t2026-09-01\t08:02" in t


def test_pagina_dois_repete_o_cabecalho():
    linhas = [["Nome", "Horas"]] + [[f"P{i}", i] for i in range(450)]
    t = L.conteudo_legivel("ponto.xlsx", "", _xlsx(linhas), pagina=2)
    assert "página 2/3" in t
    assert t.count("Nome\tHoras") == 1
    assert "P200\t200" in t and "P199\t199" not in t


def test_pagina_alem_do_fim_diz_quantas_existem():
    t = L.conteudo_legivel("ponto.xlsx", "", _xlsx([["A"], [1]]), pagina=9)
    assert "só tem 1 página" in t


def test_aba_inexistente_lista_as_que_existem():
    t = L.conteudo_legivel("ponto.xlsx", "", _xlsx([["A"]], aba="Ponto"), aba="Resumo")
    assert "não existe" in t and "Ponto" in t


def test_data_vira_iso():
    from datetime import datetime
    t = L.conteudo_legivel("p.xlsx", "", _xlsx([["Dia"], [datetime(2026, 9, 1, 8, 2)]]))
    assert "2026-09-01 08:02" in t


def test_csv_brasileiro_ponto_e_virgula_e_windows_1252():
    bruto = "Nome;Mês;Horas\nJoão;Março;8,5\n".encode("cp1252")
    t = L.conteudo_legivel("ponto.csv", "text/csv", bruto)
    assert "Nome\tMês\tHoras" in t
    assert "João\tMarço\t8,5" in t


def test_csv_utf8_com_bom_e_virgula():
    bruto = "﻿Nome,Horas\nAna,8\n".encode("utf-8")
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert "Nome\tHoras" in t and "﻿" not in t


def test_xls_antigo_e_lido():
    """O Flash pode exportar `.xls`. Recusar seria devolver à Lindsay o
    trabalho de converter à mão — o oposto do que a frente existe para fazer."""
    import xlwt  # só no teste; ver Step 3
    wb = xlwt.Workbook()
    ws = wb.add_sheet("Ponto")
    for i, l in enumerate([["Nome", "Horas"], ["Ana", 8]]):
        for j, v in enumerate(l):
            ws.write(i, j, v)
    b = io.BytesIO()
    wb.save(b)
    t = L.conteudo_legivel("ponto.xls", "application/vnd.ms-excel", b.getvalue())
    assert "Nome\tHoras" in t and "Ana\t8" in t


def test_texto_longo_e_paginado():
    t = L.conteudo_legivel("a.txt", "text/plain", ("x" * 45_000).encode())
    assert "página 1/3" in t


def test_imagem_devolve_so_metadados():
    t = L.conteudo_legivel("foto.png", "image/png", b"\x89PNG")
    assert "não é legível por ferramenta" in t


def test_doc_odt_rtf_nao_viram_lixo_e_pedem_docx_ou_pdf():
    """⚠️ `.doc` (binário OLE), `.odt` (zip) e `.rtf` (marcação) estavam em
    "documento" e caíam no `_decodificar`: o agente recebia bytes de zip ou
    `{\\rtf1\\ansi…` como se fosse o texto, e respondia em cima disso. Não temos
    leitor para nenhum dos três; a resposta certa é pedir outro formato."""
    for nome, dados in (("a.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1lixo"),
                        ("a.odt", b"PK\x03\x04lixo"),
                        ("A.RTF", b"{\\rtf1\\ansi texto}")):
        t = L.conteudo_legivel(nome, "application/octet-stream", dados)
        ext = nome.rsplit(".", 1)[-1].lower()
        assert t == (f"formato .{ext} não é legível por aqui; "
                     "peça o arquivo em .docx ou .pdf"), t


# --- Teto de recursos: xlsx é zip, 100 MB viram GB ao expandir -------------

def test_xlsx_com_tamanho_descompactado_acima_do_teto_nem_abre(monkeypatch):
    """Um zip pequeno pode declarar GB descompactados. A soma dos
    `ZipInfo.file_size` é conferida ANTES de o openpyxl abrir o arquivo, e o
    agente recebe uma mensagem nomeada em vez de derrubar o worker."""
    monkeypatch.setattr(L, "TETO_BYTES_DESCOMPACTADOS", 10)

    def nao_deve_abrir(*a, **k):
        raise AssertionError("abriu a planilha grande demais")

    monkeypatch.setattr(openpyxl, "load_workbook", nao_deve_abrir)
    t = L.conteudo_legivel("p.xlsx", "", _xlsx([["A"], [1]]))
    assert t.startswith("planilha grande demais para ler por aqui")


def test_aba_com_linhas_acima_do_teto_e_recusada(monkeypatch):
    monkeypatch.setattr(L, "TETO_LINHAS", 5)
    linhas = [["N"]] + [[i] for i in range(10)]
    t = L.conteudo_legivel("p.xlsx", "", _xlsx(linhas))
    assert t.startswith("planilha grande demais para ler por aqui")
    assert "5" in t


def test_csv_acima_do_teto_de_linhas_e_recusado(monkeypatch):
    monkeypatch.setattr(L, "TETO_LINHAS", 5)
    bruto = ("N\n" + "\n".join(str(i) for i in range(10))).encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert t.startswith("planilha grande demais para ler por aqui")


def test_so_a_aba_pedida_e_lida_e_a_outra_aparece_no_resumo():
    wb = openpyxl.Workbook()
    wb.active.title = "Ponto"
    wb.active.append(["Nome"])
    wb.active.append(["Ana"])
    wb.create_sheet("Resumo").append(["Total"])
    b = io.BytesIO()
    wb.save(b)
    t = L.conteudo_legivel("p.xlsx", "", b.getvalue(), aba="Resumo")
    assert "Ponto" in t and "Aba: Resumo" in t and "Total" in t
    assert "Ana" not in t


# --- Teto de colunas: uma linha com milhões de campos escapava do de linhas --

def test_csv_com_mil_colunas_mostra_200_e_avisa():
    bruto = (",".join(f"c{i}" for i in range(1000)) + "\n"
             + ",".join(str(i) for i in range(1000)) + "\n").encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    linhas = t.split("\n")
    assert "(mostrando as primeiras 200 colunas)" in t
    assert len(linhas[-1].split("\t")) == 200 and len(linhas[-2].split("\t")) == 200


def test_xlsx_com_300_colunas_mostra_200_e_avisa():
    t = L.conteudo_legivel("p.xlsx", "", _xlsx([list(range(300)), list(range(300))]))
    linhas = t.split("\n")
    assert "(mostrando as primeiras 200 colunas)" in t
    assert len(linhas[-1].split("\t")) == 200


def test_sem_excesso_de_colunas_nao_ha_nota():
    t = L.conteudo_legivel("p.xlsx", "", _xlsx([["A", "B"], [1, 2]]))
    assert "colunas)" not in t


# --- CSV: o teto vale para o REGISTRO, medido enquanto o reader lê ----------

def _espiao_do_reader(monkeypatch):
    """Troca `csv.reader` por um que anota o que entrou (linhas físicas
    entregues ao parser) e o que saiu (registros devolvidos)."""
    real = csv.reader
    visto = {"entrou": [], "saiu": []}

    def espiao(linhas, *a, **k):
        def entregue():
            for l in linhas:
                visto["entrou"].append(len(l))
                yield l
        for registro in real(entregue(), *a, **k):
            visto["saiu"].append(len(registro))
            yield registro

    monkeypatch.setattr(L.csv, "reader", espiao)
    return visto


def test_csv_com_linha_de_2_milhoes_de_virgulas_e_recusado_sem_parse(monkeypatch):
    """`islice` depois do reader não protege: a lista de 2M itens já existiria.
    A linha física que estoura o teto nem chega ao parser."""
    visto = _espiao_do_reader(monkeypatch)
    bruto = ("A,B\n" + "," * 2_000_000 + "\n").encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert t.startswith("planilha grande demais para ler por aqui")
    assert max(visto["entrou"], default=0) < L.TETO_LINHA_CSV
    assert visto["saiu"] == [2]  # só o cabeçalho


def test_csv_registro_multilinha_acima_de_1_mb_e_recusado(monkeypatch):
    """Campo entre aspas pode conter `\n`: um registro só, com 300 mil campos,
    espalhado em 300 mil linhas físicas de 6 caracteres. A pré-varredura por
    linha física (rodada 3) deixava passar, e o reader montava a lista inteira.
    O teto conta o que o reader consumiu desde o último registro devolvido."""
    visto = _espiao_do_reader(monkeypatch)
    bruto = ("A,B\n" + '"a\nb",' * 300_000 + "\n").encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert t.startswith("planilha grande demais para ler por aqui")
    assert visto["saiu"] == [2]  # só o cabeçalho; o registro gigante nunca saiu
    assert sum(visto["entrou"]) <= len("A,B\n") + L.TETO_LINHA_CSV


def test_csv_linha_de_1_mb_partida_por_form_feed_e_recusada():
    """`str.splitlines` quebra em `\x0c`, `\x85`, `\u2028`...; o `csv.reader`
    não. Uma linha de 1,2 MB picada em `\x0c` passava na pré-varredura antiga
    e era parseada inteira — o diferencial entre os dois tokenizadores."""
    bruto = ("A,B\n" + "x,\x0c" * 400_000 + "\n").encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert t.startswith("planilha grande demais para ler por aqui")


def test_form_feed_no_meio_da_linha_e_conteudo_nao_quebra():
    """Só `\n` separa linha física; `\x0c` no meio é conteúdo do campo."""
    bruto = "Nome,Obs\nAna,a\x0cb\nBia,c\n".encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert "Ana\ta\x0cb" in t and "Bia\tc" in t
    assert "de 2 (a 1ª linha" in t


def test_campo_multilinha_pequeno_continua_lido():
    bruto = 'Nome,Obs\nAna,"linha 1\nlinha 2"\nBia,ok\n'.encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert "Ana\tlinha 1 linha 2" in t and "Bia\tok" in t


def test_csv_decodificado_acima_de_50_mb_e_recusado(monkeypatch):
    monkeypatch.setattr(L, "TETO_CSV_BYTES", 10)
    t = L.conteudo_legivel("p.csv", "text/csv", b"A,B\n1,2\n3,4\n")
    assert t.startswith("planilha grande demais para ler por aqui")


# --- Teto de recursos: docx também é zip, PDF pode ter milhares de páginas ---

def _docx(texto: str) -> bytes:
    import docx

    d = docx.Document()
    d.add_paragraph(texto)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def test_docx_com_tamanho_descompactado_acima_do_teto_nem_abre(monkeypatch):
    """O `.docx` ia direto para `docx.Document`, sem o teto que o xlsx tem: um
    zip de poucos KB declarando GB descompactados derrubava o worker. A mesma
    soma de `ZipInfo.file_size` roda antes, com mensagem nomeada."""
    import docx

    dados = _docx("conteúdo")
    monkeypatch.setattr(L, "TETO_BYTES_DESCOMPACTADOS", 10)

    def nao_deve_abrir(*a, **k):
        raise AssertionError("abriu o docx grande demais")

    monkeypatch.setattr(docx, "Document", nao_deve_abrir)
    t = L.conteudo_legivel("c.docx", "", dados)
    assert t.startswith("documento grande demais para ler por aqui")
    assert "descompactado" in t


def test_docx_dentro_do_teto_continua_lido():
    assert "conteúdo do contrato" in L.conteudo_legivel("c.docx", "", _docx("conteúdo do contrato"))


def test_pdf_com_mais_de_200_paginas_le_so_as_primeiras_e_avisa(monkeypatch):
    """PDF de milhares de páginas extraía TODAS antes de paginar o texto — CPU
    e memória proporcionais a um número que quem envia escolhe. Lê 200 e diz
    quantas havia, para o agente pedir o trecho em vez de supor que leu tudo."""
    import pypdf

    lidas = []

    class Pagina:
        def __init__(self, n):
            self.n = n

        def extract_text(self):
            lidas.append(self.n)
            return f"pag{self.n}"

    class LeitorFalso:
        def __init__(self, *_a, **_k):
            self.pages = [Pagina(i) for i in range(1, 251)]

    monkeypatch.setattr(pypdf, "PdfReader", LeitorFalso)
    t = L.conteudo_legivel("r.pdf", "application/pdf", b"%PDF-falso")
    assert len(lidas) == 200 and max(lidas) == 200
    assert "(lidas as primeiras 200 de 250 páginas)" in t


def test_pdf_pequeno_nao_ganha_nota(monkeypatch):
    import pypdf

    class LeitorFalso:
        def __init__(self, *_a, **_k):
            self.pages = [type("P", (), {"extract_text": lambda s: "oi"})()]

    monkeypatch.setattr(pypdf, "PdfReader", LeitorFalso)
    assert "lidas as primeiras" not in L.conteudo_legivel("r.pdf", "", b"%PDF")
