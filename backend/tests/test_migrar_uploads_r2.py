"""Tranca a decisão `faltando` do script de migração do disco para o R2.

O volume /app/uploads é APAGADO com base no veredito "bateu". Comparar só
totais deixava um upload novo no R2 compensar um arquivo que nunca migrou; a
conferência é por chave, com o mesmo tamanho. R2 com chaves a mais é normal.
"""
import importlib.util
from pathlib import Path

_s = importlib.util.spec_from_file_location(
    "migrar_uploads_r2", Path(__file__).parents[1] / "scripts" / "migrar-uploads-r2.py")
_m = importlib.util.module_from_spec(_s)
_s.loader.exec_module(_m)
faltando = _m.faltando


def test_arquivo_faltando_nao_e_compensado_por_upload_novo():
    """Mesmo total de arquivos e bytes, mas a chave do disco não está no R2."""
    assert faltando({"anexos/a": 10}, {"anexos/novo": 10}) == ["anexos/a"]


def test_tamanho_divergente_nao_bate():
    assert faltando({"anexos/a": 10}, {"anexos/a": 9}) == ["anexos/a"]


def test_r2_com_chaves_extras_bate():
    assert faltando({"anexos/a": 10}, {"anexos/a": 10, "anexos/b": 5}) == []
