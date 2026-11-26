"""Sandbox Docker no `exec` da nina e do atlas (PK-06, 26/11/2026).

⚠️ **O que custaria:** a sandbox do OpenClaw tem uma segunda lista de
permitidas, e o padrão dela só deixa `exec`, arquivos e `sessions_*`. Ligar
sem `alsoAllow` tiraria da nina as ferramentas de meta e de subagente e TODAS
as MCP — ela continuaria respondendo, sem banco, sem documentos, sem anexos,
e diria que "não tem acesso". O patch também vai com `agents.list` inteira
(array substitui): mexer num agente que não é alvo seria tirar ferramenta de
outro, em silêncio.
"""
import importlib.util
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "sandbox_especialistas", Path(__file__).resolve().parents[2] / "scripts" / "sandbox-especialistas.py")
s = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s)

INVENTARIO = {"core", "plugin", "exec", "read", "write", "create_goal", "subagents",
              "mcp__hsos-documentos__documento_ler"}
CONF = {"agents": {"list": [
    {"id": "nina", "tools": {"alsoAllow": ["mcp__x__y"], "deny": ["browser"]}},
    {"id": "atlas", "tools": {"alsoAllow": ["mcp__z__w"]}},
    {"id": "midas", "tools": {"deny": ["exec"]}},
]}}


def _patch():
    return s.montar_patch(CONF, {"nina": INVENTARIO, "atlas": INVENTARIO})


def test_lista_e_o_inventario_de_hoje_mais_as_mcp():
    lista = s.lista_da_sandbox(INVENTARIO)
    assert "bundle-mcp" in lista
    assert {"create_goal", "subagents", "exec"} <= set(lista)
    assert not {"core", "plugin"} & set(lista)
    assert not any(n.startswith("mcp__") for n in lista)


def test_inventario_sem_exec_e_recusado():
    """Inventário vazio por sessão errada viraria uma lista que corta tudo."""
    with pytest.raises(ValueError):
        s.lista_da_sandbox({"read", "core"})


def test_so_os_alvos_mudam_e_o_resto_da_ferramenta_fica():
    lista = {a["id"]: a for a in _patch()["agents"]["list"]}
    assert lista["midas"] == CONF["agents"]["list"][2]
    assert lista["nina"]["tools"]["alsoAllow"] == ["mcp__x__y"]
    assert lista["nina"]["tools"]["deny"] == ["browser"]
    assert lista["nina"]["sandbox"] == s.SANDBOX
    assert lista["nina"]["tools"]["elevated"] == {"enabled": False}
    assert "sandbox" in lista["atlas"]


def test_a_parede_e_a_combinada():
    d = s.SANDBOX["docker"]
    assert s.SANDBOX["mode"] == "all" and s.SANDBOX["backend"] == "docker"
    assert s.SANDBOX["workspaceAccess"] == "rw"   # SSH/none quebrariam a regra dos sete
    assert d["network"] == "none" and d["readOnlyRoot"] is True and d["capDrop"] == ["ALL"]


def test_conferir_reprova_elevated_ligado_e_outro_agente_mexido():
    p = _patch()
    assert s.conferir(p, CONF)
    # O padrão do OpenClaw é elevated LIGADO: ausente no agente não é fechado.
    sem_portao = {"agents": {"list": [
        {**a, "tools": {k: v for k, v in a["tools"].items() if k != "elevated"}} if a["id"] == "nina" else a
        for a in p["agents"]["list"]]}}
    assert not s.conferir(sem_portao, CONF)
    mexido = {"agents": {"list": [a if a["id"] != "midas" else {"id": "midas"} for a in p["agents"]["list"]]}}
    assert not s.conferir(mexido, CONF)


def test_volta_tira_so_a_sandbox():
    depois = s.montar_volta(_patch())
    assert s.sem_sandbox(depois)
    nina = next(a for a in depois["agents"]["list"] if a["id"] == "nina")
    # O `elevated` fechado FICA: desfazer a sandbox não é motivo para reabrir
    # a válvula que roda `exec` fora dela.
    assert nina["tools"] == {"alsoAllow": ["mcp__x__y"], "deny": ["browser"],
                             "elevated": {"enabled": False}}
