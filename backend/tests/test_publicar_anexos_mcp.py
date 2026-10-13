"""Tranca a montagem das entradas `hsos-anexos-<agente>` e o mascaramento.

O script que as publica escreve na config do gateway real e não roda em teste;
o que se pode (e deve) trancar sem gateway é o que ele MANDA: a URL de cada
agente carrega o HMAC DELE (a identidade que o servidor confere), o filtro
expõe só as duas ferramentas, e o ensaio impresso não vaza a credencial.
"""
import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "publicar-anexos-mcp.py"
spec = importlib.util.spec_from_file_location("publicar_anexos_mcp", SCRIPT)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

from app.routers.mcp_anexos import assinatura_do_agente  # noqa: E402

MODELO = {
    "url": "https://hsosapi.exemplo.com/mcp/relatorios",
    "transport": "streamable-http",
    "headers": {"Authorization": "Bearer abc"},
    "toolFilter": {"include": ["publicar_pagina"]},
}


def test_cada_agente_recebe_a_propria_url_com_o_proprio_hmac():
    novos = pub.montar_entradas(MODELO, "segredo")
    assert set(novos) == {f"hsos-anexos-{a}" for a in pub.AGENTES}
    for aid in pub.AGENTES:
        esperado = f"https://hsosapi.exemplo.com/mcp/anexos/{aid}/{assinatura_do_agente('segredo', aid)}"
        assert novos[f"hsos-anexos-{aid}"]["url"] == esperado
    urls = {e["url"] for e in novos.values()}
    assert len(urls) == len(pub.AGENTES)


def test_filtro_e_cabecalhos():
    e = pub.montar_entradas(MODELO, "segredo")["hsos-anexos-bruce"]
    assert e["toolFilter"] == {"include": ["ler_anexo", "enviar_arquivo"]}
    assert e["headers"] == MODELO["headers"]
    assert e["transport"] == "streamable-http"
    # não alterou o modelo
    assert MODELO["toolFilter"] == {"include": ["publicar_pagina"]}


def test_mascaramento_nao_vaza_a_assinatura():
    novos = pub.montar_entradas(MODELO, "segredo")
    mascarado = pub.mascarar_entradas(novos)
    for aid in pub.AGENTES:
        m = mascarado[f"hsos-anexos-{aid}"]
        sig = assinatura_do_agente("segredo", aid)
        assert sig not in m["url"]
        assert sig[:20] not in m["url"]
        assert f"/mcp/anexos/{aid}/" in m["url"]
        assert "Bearer" not in str(m)
