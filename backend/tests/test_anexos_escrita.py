"""O agente devolve arquivo à pessoa — sem nunca escrever bytes.

O modelo produz texto: CSV, Markdown. O servidor é quem monta o `.xlsx`, o
`.docx` e o `.pdf`. Pedir ao modelo um binário em base64 é pedir para errar
um caractere em 80 mil e entregar um arquivo que não abre.
"""
import io

import openpyxl
import pytest

from app import anexos_escrita as E


def test_csv_vira_xlsx_com_as_mesmas_celulas():
    dados, mime, nome = E.montar_arquivo("xlsx", "resumo", "Nome;Horas\nAna;8,5\n")
    ws = openpyxl.load_workbook(io.BytesIO(dados)).active
    assert [[c.value for c in l] for l in ws.iter_rows()] == [["Nome", "Horas"], ["Ana", "8,5"]]
    assert nome == "resumo.xlsx" and "spreadsheetml" in mime


def test_csv_sai_com_bom_para_o_excel_abrir_acento_certo():
    dados, mime, nome = E.montar_arquivo("csv", "r.csv", "Nome;Mês\nJoão;Março\n")
    assert dados.startswith(b"\xef\xbb\xbf") and "Março".encode() in dados
    assert nome == "r.csv"


def test_markdown_vira_secoes_de_documento():
    s = E.secoes_de_markdown("# Título\n## Seção\ntexto\n\n**destaque**\n")
    assert [(x.heading, x.text, x.bold) for x in s] == [
        ("H1", "Título", False), ("H2", "Seção", False),
        (None, "texto", False), (None, "destaque", True),
    ]


@pytest.mark.parametrize("formato,assinatura", [("docx", b"PK"), ("pdf", b"%PDF")])
def test_docx_e_pdf_saem_validos(formato, assinatura):
    dados, _, nome = E.montar_arquivo(formato, "relatorio", "# Ponto\ntudo certo")
    assert dados.startswith(assinatura) and nome == f"relatorio.{formato}"


def test_formato_desconhecido_explica_os_aceitos():
    with pytest.raises(ValueError) as e:
        E.montar_arquivo("exe", "x", "y")
    assert "csv" in str(e.value) and "pdf" in str(e.value)


def test_conteudo_vazio_e_recusado():
    with pytest.raises(ValueError):
        E.montar_arquivo("csv", "x", "   ")


def test_conteudo_gigante_e_recusado_antes_de_montar():
    with pytest.raises(ValueError):
        E.montar_arquivo("csv", "x", "a" * (E.LIMITE_CONTEUDO + 1))
