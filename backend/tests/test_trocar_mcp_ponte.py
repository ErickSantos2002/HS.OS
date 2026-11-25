"""Troca das entradas `hsos-*` do gateway para a `mcp-ponte` (25/11/2026).

⚠️ **O que custaria:** o patch mexe em 78 entradas de `mcp.servers` de uma vez.
Trocar o caminho junto com a origem quebraria a assinatura por bot (ela está no
caminho) e toda ferramenta dos Guardis sumiria; tocar num `banco-*` o tiraria do
`banco-mcp`. Só a ORIGEM pode mudar.
"""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "trocar_mcp_ponte", Path(__file__).resolve().parents[2] / "scripts" / "trocar-mcp-ponte.py")
t = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(t)

SERVIDORES = {
    "hsos-anexos-ana-bot": {"url": f"{t.API}/mcp/anexos/ana-bot/abc123",
                            "headers": {"X-Bridge-Token": "x"}, "toolFilter": {"include": ["ler_anexo"]}},
    "hsos-relatorios": {"url": f"{t.API}/mcp/relatorios", "headers": {"X-Bridge-Token": "x"}},
    "banco-taskhs": {"url": "http://127.0.0.1:18790/mcp", "headers": {"X-Banco-Url": "postgresql://…"}},
}


def test_troca_so_a_origem_e_mantem_o_caminho():
    novos = t.montar_patch(SERVIDORES)["mcp"]["servers"]
    assert novos["hsos-anexos-ana-bot"] == {"url": f"{t.PONTE}/mcp/anexos/ana-bot/abc123"}
    assert novos["hsos-relatorios"] == {"url": f"{t.PONTE}/mcp/relatorios"}


def test_nao_toca_banco_nem_outros_campos():
    novos = t.montar_patch(SERVIDORES)["mcp"]["servers"]
    assert "banco-taskhs" not in novos
    assert all(set(e) == {"url"} for e in novos.values())


def test_rodar_de_novo_nao_reescreve():
    trocados = {n: {**s, **t.montar_patch(SERVIDORES)["mcp"]["servers"].get(n, {})}
                for n, s in SERVIDORES.items()}
    assert t.montar_patch(trocados) == {}
    assert t.apontam_para({"mcp": {"servers": trocados}}, t.PONTE)


def test_volta_devolve_a_url_original():
    trocados = {n: {**s, **t.montar_patch(SERVIDORES)["mcp"]["servers"].get(n, {})}
                for n, s in SERVIDORES.items()}
    volta = t.montar_volta(trocados)["mcp"]["servers"]
    assert volta["hsos-anexos-ana-bot"]["url"] == SERVIDORES["hsos-anexos-ana-bot"]["url"]


def test_publicacao_futura_herda_a_ponte():
    """Os scripts de publicação copiam a base do `hsos-relatorios` assim."""
    trocado = t.montar_patch(SERVIDORES)["mcp"]["servers"]["hsos-relatorios"]["url"]
    assert trocado.rsplit("/mcp/", 1)[0] == t.PONTE
