"""O Bruce aprende a calcular sobre CSV dentro da sandbox (PK-06, 26/11/2026).

⚠️ **O que custaria:** o bloco vai num dos sete arquivos, que vale no turno
seguinte em toda sessão. Duplicado a cada execução do script, ele cresceria
até o teto de 20.000 — e passar do teto não dá erro, o gateway corta o FIM do
arquivo em silêncio. E sem a conferência de linhas, uma cópia errada do CSV
pelo modelo viraria número errado na mão do RH.
"""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "bruce_calculo", Path(__file__).resolve().parents[2] / "scripts" / "bruce-calculo-em-arquivo.py")
b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b)


def test_rodar_duas_vezes_nao_duplica():
    uma = b.com_bloco("# TOOLS\n\ntexto\n")
    assert b.com_bloco(uma) == uma
    assert uma.count(b.INICIO) == 1


def test_substitui_versao_antiga_do_bloco():
    velho = f"# TOOLS\n\n{b.INICIO}\nantigo\n{b.FIM}\n\nresto\n"
    novo = b.com_bloco(velho)
    assert "antigo" not in novo and "resto" in novo and novo.count(b.INICIO) == 1


def test_bloco_manda_conferir_a_copia_e_proibe_ler_sessao():
    assert "confiro a cópia" in b.BLOCO
    assert "Nunca procuro anexo dentro de arquivo de sessão" in b.BLOCO
