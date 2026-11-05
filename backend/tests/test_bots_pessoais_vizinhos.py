"""O resto do sistema não tropeça nos 23 bots pessoais.

⚠️ **Três vizinhos que, sem cuidado, desfariam o isolamento ou a orquestradora:**

- o **roster** da `nina` lista todo `agent_profiles` — com 23 bots, o `AGENTS.md`
  dela (a ~500 caracteres do teto de 20.000) seria cortado em silêncio;
- o **canal**: um bot posto num canal passa a responder a quem está nele, e a
  regra é que só o administrador conversa com as cascas;
- o **`publicar-anexos-mcp.py`** pega o `agents.list` inteiro e daria a cada bot
  uma entrada `hsos-anexos-<bot>` — ferramenta de arquivo num agente que
  nasceu sem nenhuma — e, ao reescrever o `tools` de todos, não pode tirar o
  perfil `minimal` nem a trava `gateway` do bot.
"""
import asyncio
import importlib.util
import pathlib

from app.bots_pessoais import tools_do_bot
from app.routers import agents as ag
from app.routers import channels as ch

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "publicar-anexos-mcp.py"
_spec = importlib.util.spec_from_file_location("publicar_anexos_mcp_viz", SCRIPT)
pub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pub)


class ConnFalsa:
    def __init__(self, linhas=None):
        self.sql, self.linhas = [], linhas or []

    async def fetch(self, sql, *a):
        self.sql.append(sql)
        return self.linhas

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def test_roster_exclui_bot(monkeypatch):
    conn = ConnFalsa()
    monkeypatch.setattr(ag, "sessao", lambda **k: conn)
    asyncio.run(ag._atualizar_roster_do_lider("nina"))
    assert any("dono_id IS NULL" in s for s in conn.sql)


def test_canal_reconhece_bot_pessoal():
    conn = ConnFalsa(linhas=[{"agent_id": "andre-bot"}])
    achados = asyncio.run(ch._bots_pessoais_entre(conn, ["andre-bot", "iris"]))
    assert achados == ["andre-bot"]
    assert "dono_id IS NOT NULL" in conn.sql[0]
    assert asyncio.run(ch._bots_pessoais_entre(ConnFalsa(), [])) == []


def test_criar_e_adicionar_a_canal_chamam_a_guarda():
    """As duas portas de entrada em canal passam pela guarda."""
    import inspect
    assert "_bots_pessoais_entre" in inspect.getsource(ch.criar)
    assert "_bots_pessoais_entre" in inspect.getsource(ch.adicionar_membros)


MODELO = {"url": "https://hsosapi.exemplo.com/mcp/relatorios",
          "headers": {"Authorization": "Bearer abc"}, "toolFilter": {"include": ["x"]}}


def test_anexos_pula_bot_e_mantem_a_trava():
    servidores = {"hsos-relatorios": MODELO,
                  "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}}}
    bot = {"id": "andre-bot", "tools": tools_do_bot(servidores)}
    conf = {"mcp": {"servers": servidores},
            "agents": {"list": [{"id": "nina", "tools": {}}, bot]}}
    patch, novos = pub.montar_patch(conf, "segredo")
    assert "hsos-anexos-nina" in novos
    assert "hsos-anexos-andre-bot" not in novos
    t = next(a for a in patch["agents"]["list"] if a["id"] == "andre-bot")["tools"]
    assert t["profile"] == "minimal"
    assert "gateway" in t["deny"]
    assert "hsos-anexos-nina__ler_anexo" in t["deny"]
    assert not any("andre-bot" in x for x in t["alsoAllow"])
