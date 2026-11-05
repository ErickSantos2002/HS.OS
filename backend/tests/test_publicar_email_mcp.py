"""A publicação das entradas `hsos-email-<bot>` no gateway.

⚠️ Declarar um servidor MCP o entrega a TODO agente de perfil `coding` — os
cinco especialistas. Sem recalcular o deny de todos no MESMO patch, a `nina`
passaria a ter `email_listar` na caixa do Erick (e, no turno dele com o
`erick-bot`, o servidor aceitaria). É o Foco 1 do plano.
"""
import importlib.util
import pathlib

from app.bots_pessoais import tools_do_bot
from app.email.regras import FERRAMENTAS_EMAIL

_spec = importlib.util.spec_from_file_location(
    "publicar_bots_mcp", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "publicar-bots-mcp.py")
pub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pub)

MODELO = {"url": "https://hsosapi.x.com/mcp/relatorios", "headers": {"Authorization": "x"},
          "toolFilter": {"include": ["publicar_pagina"]}}
SERV = {"hsos-relatorios": MODELO, "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}}}


def _conf():
    return {"mcp": {"servers": dict(SERV)}, "agents": {"list": [
        {"id": "nina", "tools": {"alsoAllow": ["mcp__hsos-relatorios__publicar_pagina"]}},
        {"id": "erick-bot", "tools": tools_do_bot(SERV)},
        {"id": "andre-bot", "tools": tools_do_bot(SERV)},
    ]}}


def test_entrada_so_para_bot_com_email_e_deny_em_todos():
    patch, novos = pub.montar_patch(_conf(), "seg", "tok", bots={"erick-bot", "andre-bot"},
                                    com_email={"erick-bot"})
    assert set(novos) == {"hsos-email-erick-bot"}
    e = novos["hsos-email-erick-bot"]
    assert "/mcp/email/erick-bot/" in e["url"] and e["toolFilter"]["include"] == list(FERRAMENTAS_EMAIL)
    assert e["headers"] == {"Authorization": "Bearer tok"}
    lista = {a["id"]: a["tools"] for a in patch["agents"]["list"]}
    alheias = {f"hsos-email-erick-bot__{f}" for f in FERRAMENTAS_EMAIL}
    assert alheias <= set(lista["nina"]["deny"])
    assert alheias <= set(lista["andre-bot"]["deny"])
    assert {f"mcp__hsos-email-erick-bot__{f}" for f in FERRAMENTAS_EMAIL} <= set(lista["erick-bot"]["alsoAllow"])
    assert pub.conferir(patch_aplicado(patch), novos, {"erick-bot", "andre-bot"}, {"erick-bot"})


def patch_aplicado(patch):
    c = _conf()
    c["mcp"]["servers"].update(patch["mcp"]["servers"])
    c["agents"] = patch["agents"]
    return c


def test_url_nao_e_a_assinatura_do_anexos():
    from app.routers.mcp_anexos import assinatura_do_agente
    _, novos = pub.montar_patch(_conf(), "seg", "tok", bots={"erick-bot"}, com_email={"erick-bot"})
    assert assinatura_do_agente("seg", "erick-bot") not in novos["hsos-email-erick-bot"]["url"]


def test_entrada_de_sistemas_e_negada_aos_outros():
    from app.email.regras import FERRAMENTAS_BOT
    patch, novos = pub.montar_patch(_conf(), "seg", "tok", bots={"erick-bot", "andre-bot"},
                                    com_email=set(), com_sistemas={"erick-bot"})
    assert set(novos) == {"hsos-bot-erick-bot"} and "/mcp/bot/erick-bot/" in novos["hsos-bot-erick-bot"]["url"]
    lista = {a["id"]: a["tools"] for a in patch["agents"]["list"]}
    alheias = {f"hsos-bot-erick-bot__{f}" for f in FERRAMENTAS_BOT}
    assert alheias <= set(lista["nina"]["deny"]) and alheias <= set(lista["andre-bot"]["deny"])
    assert {f"mcp__hsos-bot-erick-bot__{f}" for f in FERRAMENTAS_BOT} <= set(lista["erick-bot"]["alsoAllow"])


def test_segredo_vazio_recusa():
    """Sem ANEXOS_MCP_SEGREDO a assinatura sai de segredo vazio: a entrada é
    publicada e toda chamada dá 404 (o servidor recusa segredo vazio)."""
    import pytest
    with pytest.raises(ValueError, match="ANEXOS_MCP_SEGREDO"):
        pub.montar_patch(_conf(), "", "tok", bots={"erick-bot"}, com_email={"erick-bot"})
