"""A criação do bot pessoal: gateway primeiro, fechado ou nada, e repetível.

⚠️ **São 23 de uma vez, com o gateway reiniciando a cada `config.patch`.** Uma
execução que pare no meio (túnel caiu, WS derrubado pelo reload) não pode
deixar agente no gateway sem linha no banco, nem linha apontando para agente
que não existe — e rodar de novo tem que ADOTAR o que ficou, não duplicar nem
falhar. É o que estes testes trancam.

⚠️ **E nenhum patch toca `tools.agentToAgent`.** O bot entra ali e passa a
poder acionar (e ser acionado por) qualquer especialista — inclusive os que
leem o banco inteiro da empresa.

Async com `asyncio.run`, sem plugin; gateway e banco são falsos em memória.
"""
import asyncio
import copy

from app.bots_pessoais import ALERTA, bot_esta_fechado
from app.routers.bots_pessoais import criar_bot

SERVIDORES = {
    "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}},
    "banco-hsos": {"toolFilter": {"include": ["query"]}},
}
ANDRE = {"id": "u-andre", "full_name": "André Luiz", "email": "servicos03@healthsafetytech.com",
         "departamento": "Serviços", "ativo": True}


class Falso:
    def __init__(self, perfis=None, linhas=None, agentes=None, falhar_patch=False):
        self.perfis = perfis if perfis is not None else {"u-andre": ANDRE}
        self.linhas = linhas or {}
        self.conf = {"mcp": {"servers": SERVIDORES},
                     "tools": {"agentToAgent": {"allow": ["nina"]}},
                     "agents": {"list": agentes or [{"id": "nina", "tools": {}}]}}
        self.falhar_patch = falhar_patch
        self.log, self.patches, self.desfeitos = [], [], []

    async def perfil(self, user_id):
        return self.perfis.get(user_id)

    async def linha(self, agent_id):
        return self.linhas.get(agent_id)

    async def inserir(self, agent_id, dono, nome_bot):
        self.log.append("INSERT")
        self.linhas[agent_id] = {"agent_id": agent_id, "dono_id": dono["id"]}

    async def chamar(self, metodo, params):
        self.log.append(metodo)
        if metodo == "agents.create":
            self.conf["agents"]["list"].append({"id": params["name"], "workspace": params["workspace"]})
        return {}

    async def config(self):
        return copy.deepcopy(self.conf), "h"

    async def patch(self, patch, base_hash, conferir):
        self.log.append("config.patch")
        if self.falhar_patch:
            raise RuntimeError("rate limit do config.patch")
        self.patches.append(patch)
        self.conf = {**self.conf, **copy.deepcopy(patch)}
        assert conferir(self.conf)

    async def desfazer(self, agent_id):
        self.desfeitos.append(agent_id)
        self.linhas.pop(agent_id, None)
        return True


def _tools(f, aid):
    return next(a for a in f.conf["agents"]["list"] if a["id"] == aid).get("tools") or {}


def test_cria_na_ordem_gateway_primeiro():
    f = Falso()
    r = asyncio.run(criar_bot("u-andre", f))
    assert r["resultado"] == "criado" and r["agent_id"] == "andre-bot"
    assert f.log[0] == "agents.create"
    assert f.log[1] == "INSERT"
    assert f.log[2:9] == ["agents.files.set"] * 7
    assert f.log[9] == "config.patch"
    assert bot_esta_fechado(_tools(f, "andre-bot"), SERVIDORES)
    assert ALERTA in _tools(f, "andre-bot")["alsoAllow"]


def test_rodar_de_novo_nao_duplica():
    f = Falso()
    asyncio.run(criar_bot("u-andre", f))
    f.log.clear()
    r = asyncio.run(criar_bot("u-andre", f))
    assert r["resultado"] == "já existia"
    assert "agents.create" not in f.log and "config.patch" not in f.log


def test_adota_agente_que_ficou_sem_linha():
    """Execução anterior criou no gateway e caiu antes do INSERT."""
    f = Falso(agentes=[{"id": "nina", "tools": {}}, {"id": "andre-bot"}])
    r = asyncio.run(criar_bot("u-andre", f))
    assert r["resultado"] == "adotado"
    assert "agents.create" not in f.log
    assert f.linhas["andre-bot"]["dono_id"] == "u-andre"
    assert bot_esta_fechado(_tools(f, "andre-bot"), SERVIDORES)


def test_falha_no_escopo_desfaz():
    f = Falso(falhar_patch=True)
    r = asyncio.run(criar_bot("u-andre", f))
    assert r["resultado"] == "falhou"
    assert "rate limit" in r["motivo"]
    assert f.desfeitos == ["andre-bot"]
    assert "andre-bot" not in f.linhas


def test_nunca_mexe_em_agent_to_agent():
    f = Falso()
    asyncio.run(criar_bot("u-andre", f))
    for p in f.patches:
        assert "agentToAgent" not in (p.get("tools") or {})
    assert f.conf["tools"]["agentToAgent"]["allow"] == ["nina"]


def test_colisao_com_especialista():
    f = Falso(perfis={"u-nina": {**ANDRE, "id": "u-nina", "full_name": "Nina Souza"}},
              linhas={"nina-bot": {"agent_id": "nina-bot", "dono_id": None}})
    r = asyncio.run(criar_bot("u-nina", f))
    assert r["resultado"] == "falhou" and "colisão" in r["motivo"]
    assert f.log == [] and f.desfeitos == []


def test_inelegivel_nao_toca_em_nada():
    f = Falso(perfis={"u-andre": {**ANDRE, "ativo": False}})
    r = asyncio.run(criar_bot("u-andre", f))
    assert r == {"user_id": "u-andre", "agent_id": "andre-bot",
                 "resultado": "falhou", "motivo": "inativo"}
    assert f.log == []


def test_patch_leva_os_outros_agentes_intactos():
    """`agents.list` é array: o patch substitui a lista inteira."""
    nina = {"id": "nina", "tools": {"alsoAllow": ["x"], "deny": ["sessions_send"]}}
    f = Falso(agentes=[copy.deepcopy(nina)])
    asyncio.run(criar_bot("u-andre", f))
    lista = f.patches[-1]["agents"]["list"]
    assert next(a for a in lista if a["id"] == "nina") == nina


def test_config_insegura_recusa_antes_de_escrever():
    """Servidor sem filtro: nada é criado — e um bot que já existia não é
    desfeito por causa disso (rodar o lote de novo não apaga ninguém)."""
    f = Falso()
    f.conf["mcp"]["servers"] = {**SERVIDORES, "novo": {"url": "x"}}
    r = asyncio.run(criar_bot("u-andre", f))
    assert r["resultado"] == "falhou" and "novo" in r["motivo"]
    assert f.log == [] and f.desfeitos == []
