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


# --- CSV: recusar ANTES de o csv.reader parsear a linha inteira ------------

def test_csv_com_linha_de_2_milhoes_de_virgulas_e_recusado_sem_parse(monkeypatch):
    """`islice` depois do reader não protege: a lista de 20M itens já existe.
    A linha física grande demais é recusada antes de o reader ser criado."""
    def nao_deve_parsear(*a, **k):
        raise AssertionError("csv.reader chamado")

    monkeypatch.setattr(L.csv, "reader", nao_deve_parsear)
    bruto = ("A,B\n" + "," * 2_000_000 + "\n").encode()
    t = L.conteudo_legivel("p.csv", "text/csv", bruto)
    assert t.startswith("planilha grande demais para ler por aqui")


def test_csv_decodificado_acima_de_50_mb_e_recusado(monkeypatch):
    monkeypatch.setattr(L, "TETO_CSV_BYTES", 10)
    t = L.conteudo_legivel("p.csv", "text/csv", b"A,B\n1,2\n3,4\n")
    assert t.startswith("planilha grande demais para ler por aqui")
