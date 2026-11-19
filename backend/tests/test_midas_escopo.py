"""O escopo do Midas e a decisão de criá-lo — puros, sem gateway nem banco.

⚠️ **O escopo do Midas parte do da `iris` lido do gateway**, não de uma lista
escrita aqui: o que ela enxerga hoje foi ajustado à mão várias vezes
(inadimplência, compradores) e uma cópia no código envelheceria. O que muda é
pouco e é isto que se tranca: a entrada de anexos passa a ser a DELE (a da
`iris` é a identidade dela — HMAC do id na URL), ganha GestorHS e HSGrowth, e
perde `publicar_pagina`, porque contas a pagar trazem salário por pessoa e
dívida, e página pública não tem login.

⚠️ **Rodar `criar-midas.py --aplicar` duas vezes não pode criar outro agente
nem reescrever os arquivos de um Midas vivo** (MEMORY.md, ajustes feitos depois)
— é o `decidir_criacao` que separa "criar" de "adotar" de "já existe".
"""
import asyncio
import importlib.util
from pathlib import Path

from app.agentes.midas_escopo import decidir_criacao, escopo_final, midas_esta_fechado, tools_do_midas


def test_troca_anexos_da_iris_pelos_do_midas():
    t = tools_do_midas({"alsoAllow": ["mcp__hsos-anexos-iris__ler_anexo", "mcp__banco-datacorehs__query"],
                        "deny": ["hsos-anexos-midas__ler_anexo"]})
    assert "mcp__hsos-anexos-midas__ler_anexo" in t["alsoAllow"]
    assert not any("iris" in x for x in t["alsoAllow"] + t["deny"])
    assert "hsos-anexos-midas__ler_anexo" not in t["deny"]


def test_acrescenta_gestorhs_e_hsgrowth():
    t = tools_do_midas({"alsoAllow": []})
    assert {"mcp__banco-gestorhs__query", "mcp__banco-hsgrowth__query"} <= set(t["alsoAllow"])


def test_bancos_novos_saem_do_deny_da_iris():
    # O deny real da `iris` nega os dois — deny ganha de alsoAllow, então
    # acrescentar sem tirar daqui não daria acesso nenhum.
    t = tools_do_midas({"alsoAllow": [], "deny": ["banco-gestorhs__query", "banco-hsgrowth__query",
                                                  "banco-taskhs__query"]})
    assert "banco-gestorhs__query" not in t["deny"]
    assert "banco-hsgrowth__query" not in t["deny"]
    assert "banco-taskhs__query" in t["deny"]


def test_denies_obrigatorios_e_sem_publicar_pagina():
    t = tools_do_midas({"alsoAllow": ["mcp__hsos-relatorios__publicar_pagina"], "deny": []})
    assert "mcp__hsos-relatorios__publicar_pagina" not in t["alsoAllow"]
    for d in ("sessions_send", "sessions_spawn", "skill_workshop", "cron", "gateway",
              "web_fetch", "x_search", "web_search", "hsos-relatorios__publicar_pagina"):
        assert d in t["deny"]


def test_mantem_compradores_e_inadimplencia():
    t = tools_do_midas({"alsoAllow": ["mcp__hsos-relatorios__compradores_produto",
                                      "mcp__hsos-relatorios__inadimplencia"]})
    assert "mcp__hsos-relatorios__inadimplencia" in t["alsoAllow"]
    assert "mcp__hsos-relatorios__compradores_produto" in t["alsoAllow"]


def test_anexos_de_outro_agente_nao_passam_para_o_alsoallow():
    t = tools_do_midas({"alsoAllow": ["mcp__hsos-anexos-atlas__ler_anexo"]})
    assert not any("atlas" in x for x in t["alsoAllow"])


def test_preserva_o_resto_e_nao_mexe_na_entrada():
    iris = {"alsoAllow": ["mcp__hsos-documentos__documento_ler"], "deny": ["banco-hsos__query"],
            "profile": "coding"}
    t = tools_do_midas(iris)
    assert t["profile"] == "coding"
    assert "banco-hsos__query" in t["deny"]
    assert iris == {"alsoAllow": ["mcp__hsos-documentos__documento_ler"],
                    "deny": ["banco-hsos__query"], "profile": "coding"}


def test_decidir_criacao():
    assert decidir_criacao(False, False, None) == "criar"
    assert decidir_criacao(True, True, "/root/.openclaw/workspace-midas") == "ja_existe"
    assert decidir_criacao(True, False, "/root/.openclaw/workspace-midas") == "adotar"
    assert decidir_criacao(True, False, "/root/.openclaw/workspace-outro") == "colisao"


def test_decidir_criacao_linha_sem_agente_cria_no_gateway():
    assert decidir_criacao(False, True, None) == "criar"


# Os servidores como estão no gateway (18/11/2026), reduzidos.
SERVIDORES = {
    "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}},
    "banco-datacorehs": {}, "banco-gestorhs": {}, "banco-hsgrowth": {}, "banco-hsos": {},
    "banco-diretorio-hs-os": {},
    "hsos-relatorios": {"toolFilter": {"include": ["publicar_pagina", "relatorio_vendedores",
                                                   "compradores_produto", "inadimplencia"]}},
    "hsos-anexos-iris": {"toolFilter": {"include": ["ler_anexo", "enviar_arquivo"]}},
    "hsos-anexos-atlas": {"toolFilter": {"include": ["ler_anexo", "enviar_arquivo"]}},
}
IRIS = {
    "alsoAllow": ["mcp__banco-datacorehs__query", "mcp__banco-diretorio-hs-os__query",
                  "mcp__hsos-relatorios__publicar_pagina", "mcp__hsos-relatorios__compradores_produto",
                  "mcp__hsos-anexos-iris__ler_anexo", "mcp__hsos-anexos-iris__enviar_arquivo",
                  "mcp__hsos-relatorios__inadimplencia"],
    "deny": ["banco-gestorhs__query", "banco-hsgrowth__query", "banco-hsos__query",
             "hsos-anexos-atlas__ler_anexo", "hsos-anexos-atlas__enviar_arquivo",
             "hsos-relatorios__relatorio_vendedores", "cron", "sessions_send", "sessions_spawn",
             "skill_workshop", "web_search", "web_fetch", "x_search"],
}


def test_escopo_final_nega_a_identidade_da_iris():
    # Sem a entrada `hsos-anexos-midas` declarada ainda, o deny recalculado
    # sobre os servidores reais é o que impede o Midas de ver os anexos da
    # `iris` — `alsoAllow` não restringe nada.
    t = escopo_final(IRIS, SERVIDORES)
    assert "hsos-anexos-iris__ler_anexo" in t["deny"]
    assert "hsos-anexos-atlas__ler_anexo" in t["deny"]
    assert "hsos-relatorios__publicar_pagina" in t["deny"]
    assert "hsos-relatorios__relatorio_vendedores" in t["deny"]
    assert "banco-gestorhs__query" not in t["deny"]
    assert "hsos-alerta__avisar_administrador" not in t["deny"]
    assert midas_esta_fechado(t, SERVIDORES)


def test_escopo_final_sem_entrada_propria_nao_promete_anexos():
    t = escopo_final(IRIS, SERVIDORES)
    assert not any("hsos-anexos-" in x for x in t["alsoAllow"])


def test_escopo_final_com_entrada_propria_a_concede():
    srv = {**SERVIDORES, "hsos-anexos-midas": {"toolFilter": {"include": ["ler_anexo", "enviar_arquivo"]}}}
    t = escopo_final(IRIS, srv)
    assert "mcp__hsos-anexos-midas__ler_anexo" in t["alsoAllow"]
    assert "hsos-anexos-midas__ler_anexo" not in t["deny"]
    assert midas_esta_fechado(t, srv)


def test_fechado_recusa_o_escopo_da_iris_como_esta():
    assert not midas_esta_fechado(IRIS, SERVIDORES)


# --- O script, com dependências falsas -------------------------------------

def _script():
    caminho = Path(__file__).resolve().parents[1] / "scripts" / "criar-midas.py"
    spec = importlib.util.spec_from_file_location("criar_midas", caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


EMP_I, EMP_F = "<!-- hsos:empresa:inicio -->", "<!-- hsos:empresa:fim -->"
TIME_I, TIME_F = "<!-- hsos:time:inicio -->", "<!-- hsos:time:fim -->"


class Falso:
    def __init__(self, midas_no_gw=None, linha_midas=False, falhar_files=False, falhar_patch=False):
        self.falhar_files, self.falhar_patch = falhar_files, falhar_patch
        self.desfeitos = []
        lista = [{"id": "nina", "tools": {"alsoAllow": ["mcp__banco-hsos__query"]}},
                 {"id": "iris", "model": "deepseek/deepseek-chat",
                  "workspace": "/root/.openclaw/workspace-iris", "tools": dict(IRIS)}]
        if midas_no_gw:
            lista.append(midas_no_gw)
        self.conf = {"mcp": {"servers": SERVIDORES}, "agents": {"list": lista}}
        self.linhas = {"iris": {"access_type": "specific_users", "allowed_user_ids": ["u-np"],
                                "leader_id": "nina"}}
        if linha_midas:
            self.linhas["midas"] = {"access_type": "specific_users", "allowed_user_ids": ["u-np"]}
        self.escritas = []

    async def config(self):
        return self.conf, "h1"

    async def linha(self, agent_id):
        return self.linhas.get(agent_id)

    async def ler_arquivo(self, agent_id, nome):
        return {"AGENTS.md": f"x\n{EMP_I}\nPERFIL DA EMPRESA\n{EMP_F}\n",
                "USER.md": f"y\n{TIME_I}\nO TIME\n{TIME_F}\n"}[nome]

    async def chamar(self, metodo, params):
        if metodo == "agents.files.set" and self.falhar_files:
            raise RuntimeError("files.set caiu")
        self.escritas.append((metodo, params.get("name") or params.get("agentId")))
        if metodo == "agents.create":
            self.conf["agents"]["list"].append({"id": "midas", "workspace": params["workspace"],
                                                "model": params["model"], "tools": {}})
        return {}

    async def inserir(self, linha):
        self.escritas.append(("inserir", linha["agent_id"]))
        self.linhas["midas"] = linha

    async def patch(self, patch, base_hash, conferir):
        if self.falhar_patch:
            raise RuntimeError("config.patch caiu")
        self.escritas.append(("patch", None))
        self.conf["agents"]["list"] = patch["agents"]["list"]
        assert conferir(self.conf)

    async def liberar(self, agent_id):
        self.escritas.append(("liberar", agent_id))

    async def roster(self, lider_id):
        self.escritas.append(("roster", lider_id))

    async def desfazer(self, agent_id):
        self.desfeitos.append(agent_id)
        self.conf["agents"]["list"] = [a for a in self.conf["agents"]["list"] if a["id"] != agent_id]
        self.linhas.pop(agent_id, None)
        return True


def test_ensaio_nao_escreve_nada():
    f = Falso()
    r = asyncio.run(_script().criar_midas(f, aplicar=False))
    assert r["decisao"] == "criar"
    assert f.escritas == []


def test_criar_na_ordem_e_com_os_blocos_da_iris():
    f = Falso()
    r = asyncio.run(_script().criar_midas(f, aplicar=True))
    metodos = [m for m, _ in f.escritas]
    assert metodos[0] == "agents.create"
    assert metodos.count("agents.files.set") == 7
    # A linha é a última escrita (antes só do roster, que a lê): ela quer
    # dizer "o Midas terminou".
    assert metodos[-4:] == ["patch", "liberar", "inserir", "roster"]
    assert r["arquivos"]["AGENTS.md"] > 0
    linha = f.linhas["midas"]
    assert linha["access_type"] == "specific_users" and linha["allowed_user_ids"] == ["u-np"]
    assert linha["is_leader"] is False and linha["dono_id"] is None
    midas = next(a for a in f.conf["agents"]["list"] if a["id"] == "midas")
    assert "mcp__banco-hsgrowth__query" in midas["tools"]["alsoAllow"]
    # O patch manda a lista inteira: a `nina` não perde o alsoAllow.
    nina = next(a for a in f.conf["agents"]["list"] if a["id"] == "nina")
    assert nina["tools"]["alsoAllow"] == ["mcp__banco-hsos__query"]


def test_midas_vivo_nao_tem_os_arquivos_reescritos():
    vivo = {"id": "midas", "workspace": "/root/.openclaw/workspace-midas", "tools": {}}
    f = Falso(midas_no_gw=vivo, linha_midas=True)
    r = asyncio.run(_script().criar_midas(f, aplicar=True))
    assert r["decisao"] == "ja_existe"
    metodos = [m for m, _ in f.escritas]
    assert "agents.create" not in metodos and "agents.files.set" not in metodos


def test_colisao_aborta_sem_escrever():
    outro = {"id": "midas", "workspace": "/root/.openclaw/workspace-outro", "tools": {}}
    f = Falso(midas_no_gw=outro)
    r = asyncio.run(_script().criar_midas(f, aplicar=True))
    assert r["decisao"] == "colisao"
    assert f.escritas == []


def test_files_set_que_cai_ao_adotar_nao_insere_e_a_segunda_execucao_conclui():
    # Execução anterior parou depois do agents.create: gateway sem linha.
    resto = {"id": "midas", "workspace": "/root/.openclaw/workspace-midas", "tools": {}}
    f = Falso(midas_no_gw=resto, falhar_files=True)
    s = _script()
    try:
        asyncio.run(s.criar_midas(f, aplicar=True))
        assert False, "devia propagar"
    except RuntimeError:
        pass
    assert "midas" not in f.linhas
    assert ("inserir", "midas") not in f.escritas
    assert f.desfeitos == []  # não foi esta chamada que o criou

    f.falhar_files = False
    r = asyncio.run(s.criar_midas(f, aplicar=True))
    assert r["decisao"] == "adotar"
    assert [m for m, _ in f.escritas].count("agents.files.set") == 7
    assert "midas" in f.linhas


def test_patch_que_cai_ao_criar_desfaz_e_nao_insere():
    f = Falso(falhar_patch=True)
    try:
        asyncio.run(_script().criar_midas(f, aplicar=True))
        assert False, "devia propagar"
    except RuntimeError as e:
        assert "config.patch" in str(e)
    assert f.desfeitos == ["midas"]
    assert ("inserir", "midas") not in f.escritas
    assert "midas" not in f.linhas
