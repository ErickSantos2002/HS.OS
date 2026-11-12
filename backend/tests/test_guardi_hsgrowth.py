"""Guardi no HSGrowth (12/11/2026): cliente com token de agente e catálogo de
leitura. Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`."""
import asyncio

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app import hsgrowth_consultas as hg
from app.sistemas import hsgrowth
from app.sistemas.taskhs import ErroSistema


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


# --- o cliente ------------------------------------------------------------------

def test_chama_a_api_com_aud_hsgrowth(chave, monkeypatch):
    """Token com `aud` errado o HSGrowth recusa com 401 e a pessoa leria "sem
    conta lá". E a URL tem que ser a da API (`growthhsapi`, com `/api/v1`): o
    front devolveria o HTML da SPA com 200."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 5})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    assert asyncio.run(hsgrowth.chamar("ana@hs.com", "ana-bot", "/cards/5/expanded")) == {"id": 5}
    r = reqs[0]
    assert str(r.url) == "https://growthhsapi.healthsafetytech.com/api/v1/cards/5/expanded"
    token = r.headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="hsgrowth")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_403_na_leitura_e_na_escrita_dizem_coisas_diferentes(chave, monkeypatch):
    """Na escrita, 403 é a FUNÇÃO do dono; a mensagem de leitura mandaria a
    pessoa pedir um acesso que ela já tem (e vice-versa)."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(lambda r: httpx.Response(403, json={})))
    with pytest.raises(ErroSistema) as le:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards/1/expanded"))
    with pytest.raises(ErroSistema) as es:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "ver" in str(le.value)
    assert "o HSGrowth não deixa a sua função fazer isso" in str(es.value)


def test_409_repassa_o_detail(chave, monkeypatch):
    """O `detail` do 409 é a regra do CRM ("Este CNPJ está com o parceiro X");
    uma mensagem genérica esconderia à pessoa o que fazer a seguir."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(
        lambda r: httpx.Response(409, json={"detail": "Este CNPJ está com o parceiro X"})))
    with pytest.raises(ErroSistema) as e:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "Este CNPJ está com o parceiro X" in str(e.value)


# --- o catálogo -----------------------------------------------------------------

def test_catalogo_recusa_filtro_desconhecido_e_id_nao_numerico():
    """`assigned_to_id` vindo do agente leria o funil de outra pessoa; id com `/`
    levaria o token do dono a uma rota fora do catálogo."""
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1, "assigned_to_id": 3}, eu_id=9)
    with pytest.raises(ValueError):
        hg.params_da_consulta("minhas_tarefas", {"assigned_to_id": 3}, eu_id=9)
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("card", "5/../users")
    assert hg.caminho_da_consulta("card", "5") == "/cards/5/expanded"
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("quadros", "3")
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1}, eu_id=None)   # sem o dono, não lê


def test_o_dono_e_injetado_pelo_servidor():
    """O `<eu>` entra na query por aqui: `meus_cards` leva `all=true` (sem ele
    só viria a primeira página) e `quadros` sempre `category=vendas`."""
    p = hg.params_da_consulta("meus_cards", {"board_id": 2, "is_lost": False}, eu_id=9)
    assert ("assigned_to_id", "9") in p and ("all", "true") in p and ("is_lost", "false") in p
    assert hg.params_da_consulta("minhas_tarefas", None, eu_id=9) == [("assigned_to_id", "9")]
    assert hg.params_da_consulta("quadros", None) == [("category", "vendas")]
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {}, eu_id=9)       # board_id é obrigatório


def test_cnpj_da_receita_aceita_pontuacao():
    """CNPJ colado da tela vem com pontos; 13 dígitos é número digitado errado e
    a Receita responderia como se o CNPJ não existisse."""
    assert hg.caminho_da_consulta("receita", "12.345.678/0001-90") == "/clients/cnpj/12345678000190"
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("receita", "1234567800019")


def test_meus_cards_filtra_etapa_tarefa_e_dono_localmente():
    """O `/cards` traz cards de outros responsáveis conforme o papel; sem o
    corte local o Guardi contaria o funil do time como se fosse do dono."""
    cards = [
        {"id": 1, "assigned_to_id": 3, "list_id": 29, "pending_tasks_status": "overdue"},
        {"id": 2, "assigned_to_id": 9, "list_id": 29, "pending_tasks_status": "overdue"},
        {"id": 3, "assigned_to_id": 3, "list_id": 28, "pending_tasks_status": "overdue"},
        {"id": 4, "assigned_to_id": 3, "list_id": 29, "pending_tasks_status": "future"},
        {"id": 5, "assigned_to_id": 9, "sdr_id": 3, "list_id": 29, "pending_tasks_status": "overdue"},
    ]
    q = hg.params_da_consulta("meus_cards", {"board_id": 1, "etapa": 29, "tarefa": "overdue"}, eu_id=3)
    remotos, locais = hg.separar_filtros("meus_cards", q)
    assert not any(k in ("etapa", "tarefa") for k, _ in remotos)    # nunca vão ao HSGrowth
    r = hg.filtrar_local("meus_cards", {"cards": cards, "total": 5}, locais, 3)
    assert [c["id"] for c in r["cards"]] == [1, 5] and r["total"] == 2
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {}, 3)] == [1, 3, 4, 5]


def test_parado_usa_as_flags_do_kanban():
    """"Parado" é a regra do kanban (`is_stuck_7d`); se o filtro olhasse outro
    campo, o Guardi listaria como parado o card que a tela mostra em dia."""
    cards = [{"id": 1, "assigned_to_id": 3, "is_stuck_3d": True, "is_stuck_7d": True},
             {"id": 2, "assigned_to_id": 3, "is_stuck_3d": True, "is_stuck_7d": False},
             {"id": 3, "assigned_to_id": 3}]
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {"parado": "7d"}, 3)] == [1]
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {"parado": "3d"}, 3)] == [1, 2]
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1, "parado": "5d"}, eu_id=3)
    assert ("minimal", "true") in hg.params_da_consulta("meus_cards", {"board_id": 1}, eu_id=3)


def test_filtro_local_falha_fechado():
    """Formato inesperado devolvido sem corte seria o funil (ou as tarefas) do
    time inteiro entregue ao Guardi de uma pessoa."""
    for chave in ("meus_cards", "tarefas_atrasadas"):
        for ruim in ({"detail": "x"}, "texto", None, [1, 2]):
            with pytest.raises(ValueError, match="resposta inesperada do HSGrowth"):
                hg.filtrar_local(chave, ruim, {}, 3)


def test_tarefas_atrasadas_so_do_dono():
    """O HSGrowth não escopa `/card-tasks/overdue` para admin/gerente: sem o
    corte local o Guardi leria as tarefas atrasadas de todo mundo."""
    tarefas = [{"id": 1, "assigned_to_id": 3}, {"id": 2, "assigned_to_id": 9}]
    assert [t["id"] for t in hg.filtrar_local("tarefas_atrasadas", tarefas, {}, 3)] == [1]
    with pytest.raises(ValueError):
        hg.filtrar_local("tarefas_atrasadas", tarefas, {}, None)
    with pytest.raises(ValueError):
        hg.params_da_consulta("tarefas_atrasadas", None, eu_id=None)
    assert hg.params_da_consulta("tarefas_atrasadas", None, eu_id=3) == []


def test_link_do_card_e_montado_pelo_servidor():
    """O modelo não monta URL: usaria o domínio da API e mandaria a pessoa a
    uma página que não existe."""
    base = "https://hs.x"
    assert hg.com_links("card", {"id": 7}, base)["link"] == "https://hs.x/cards/7"
    r = hg.com_links("meus_cards", {"cards": [{"id": 8}], "total": 1}, base + "/")
    assert r["cards"][0]["link"] == "https://hs.x/cards/8"
    r = hg.com_links("buscar", {"vendas": [{"id": 9}], "servico": [{"id": 4}]}, base)
    assert r["vendas"][0]["link"] == "https://hs.x/cards/9" and "link" not in r["servico"][0]
    assert "link" not in hg.com_links("clientes", [{"id": 1}], base)[0]


def test_link_de_fora_e_sobrescrito():
    """`link` vindo do HSGrowth é dado externo (campo livre): o agente
    entregaria à pessoa um endereço que não é o do servidor."""
    r = hg.com_links("card", {"id": 7, "link": "https://evil"}, "https://hs.x")
    assert r["link"] == "https://hs.x/cards/7"
    assert "link" not in hg.com_links("card", {"id": "../x", "link": "https://evil"}, "https://hs.x")


# --- as ferramentas no hsos-bot-<bot> --------------------------------------------

_CTX = {"sistemas": ["hsgrowth"], "email": "ana@hs.com", "dono": None, "primeiro": "Ana"}


def _roteia(monkeypatch, rotas):
    """Transporte que responde por caminho e guarda as requisições."""
    chamadas = []

    def h(req):
        chamadas.append(req)
        resp = rotas.get(req.url.path.removeprefix("/api/v1"))
        if resp is None:
            return httpx.Response(404, json={"detail": "x"})
        return httpx.Response(200, json=resp)
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    return chamadas


def test_ferramentas_de_leitura_no_guardi_hsgrowth():
    """`FERRAMENTAS_BOT` alimenta o `toolFilter` e o `alsoAllow`: fora dela a
    ferramenta existe no servidor e o Guardi nunca a vê."""
    from app.email.regras import FERRAMENTAS_BOT
    from app.routers import mcp_bot
    nomes = {"hsgrowth_consultas", "hsgrowth_consultar"}
    assert nomes <= set(FERRAMENTAS_BOT)
    assert nomes <= {f["name"] for f in mcp_bot.FERRAMENTAS}


def test_sem_hsgrowth_ligado_recusa_sem_rede(chave, monkeypatch):
    """Sem a flag nada sai: um 401 de lá diria à pessoa que ela não tem conta,
    quando o que falta é ligar."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {})
    ctx = {**_CTX, "sistemas": ["taskhs"]}
    for nome in ("hsgrowth_consultas", "hsgrowth_consultar"):
        with pytest.raises(mcp_bot._Recusa, match="HSGrowth ainda não está ligado"):
            asyncio.run(mcp_bot._hsgrowth(None, "ana-bot", nome, {"consulta": "quadros"}, ctx))
    assert chamadas == []


def test_meus_cards_injeta_o_eu_de_users_me(chave, monkeypatch):
    """O dono vem de `/users/me`, nunca do agente: sem isso `meus_cards` listaria
    card de outro vendedor, ou o agente poderia passar o `assigned_to_id` que
    quisesse. O retorno é dado externo e o link do card é montado aqui."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {
        "/users/me": {"id": 3, "role": "vendedor"},
        "/cards": {"cards": [{"id": 8, "assigned_to_id": 3, "title": "A"},
                             {"id": 9, "assigned_to_id": 4, "sdr_id": 5, "title": "B"}], "total": 2}})
    t = asyncio.run(mcp_bot._hsgrowth(None, "ana-bot", "hsgrowth_consultar",
                                      {"consulta": "meus_cards", "parametros": {"board_id": 2}}, dict(_CTX)))
    q = dict(chamadas[-1].url.params)
    assert q["assigned_to_id"] == "3" and q["all"] == "true" and q["board_id"] == "2"
    assert "HSGrowth" in t and "/cards/8" in t and "/cards/9" not in t   # filtro local do dono


def test_users_me_e_pedido_uma_vez_por_chamada(chave, monkeypatch):
    """O `/users/me` fica no `ctx` da chamada: refazê-lo a cada passo dobraria a
    latência de toda escrita (Tasks seguintes) à toa."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {"/users/me": {"id": 3}})
    ctx = dict(_CTX)
    asyncio.run(mcp_bot._eu_no_hsgrowth(ctx, "ana-bot"))
    asyncio.run(mcp_bot._eu_no_hsgrowth(ctx, "ana-bot"))
    assert len(chamadas) == 1


def test_users_me_sem_id_inteiro_e_recusado(chave, monkeypatch):
    """Resposta sem `id` inteiro faria o filtro do dono falhar aberto ou virar
    `assigned_to_id=None`: melhor recusar com mensagem clara."""
    from app.routers import mcp_bot
    for corpo in ({"id": "3"}, {"role": "x"}, [], {"id": True}):
        _roteia(monkeypatch, {"/users/me": corpo})
        with pytest.raises(ValueError, match="HSGrowth"):
            asyncio.run(mcp_bot._eu_no_hsgrowth(dict(_CTX), "ana-bot"))


def test_consulta_que_nao_e_do_dono_nao_chama_users_me(chave, monkeypatch):
    """`/users/me` só se pede para as consultas que dependem do dono."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {"/boards": [{"id": 1}]})
    asyncio.run(mcp_bot._hsgrowth(None, "ana-bot", "hsgrowth_consultar", {"consulta": "quadros"}, dict(_CTX)))
    assert [r.url.path for r in chamadas] == ["/api/v1/boards"]


def test_filtro_invalido_nao_toca_a_rede(chave, monkeypatch):
    """Filtro e id são validados antes da rede: `1/../x` levaria o token do dono
    a uma rota fora do catálogo."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {})
    for args in ({"consulta": "card", "id": "1/../x"},
                 {"consulta": "clientes", "parametros": {"zzz": 1}}):
        with pytest.raises(ValueError):
            asyncio.run(mcp_bot._hsgrowth(None, "ana-bot", "hsgrowth_consultar", args, dict(_CTX)))
    assert chamadas == []


def test_pede_eu_so_nas_consultas_do_dono():
    """O router decide por `pede_eu` se pede `/users/me`: lista escrita à mão
    no router esqueceria uma consulta nova do dono e ela falharia só em uso."""
    assert {c for c in hg.CONSULTAS if hg.pede_eu(c)} == {"meus_cards", "minhas_tarefas", "tarefas_atrasadas"}


# --- ligar só para os vendedores + ponteiro no AGENTS.md --------------------------

def _publicador():
    import importlib.util
    import pathlib
    caminho = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "publicar-bots-mcp.py"
    spec = importlib.util.spec_from_file_location("publicar_bots_mcp_hg", caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _ConnFalsa:
    def __init__(self, linhas):
        self.linhas, self.gravou = linhas, None

    async def fetch(self, *a):
        return self.linhas

    async def fetchval(self, sql, com_conta, sistema):
        self.gravou = (list(com_conta), sistema)
        return len(com_conta)


class _ModuloFalso:
    ErroSistema = ErroSistema

    def __init__(self, respostas):
        self.respostas = respostas

    async def chamar(self, email, bot, caminho, dono=None):
        r = self.respostas[email]
        if r is None:
            raise ErroSistema(401, "sem conta")
        return r


def test_ligar_vendedores_so_liga_salesperson(capsys):
    """Ligar o HSGrowth para quem tem conta mas é gerente ou admin entregaria a
    um Guardi ferramentas de escrita que a fase 1 só validou para vendedor — e
    sem a `aceita` o script ligaria todo mundo que responde 200."""
    pub = _publicador()
    linhas = [{"agent_id": "ana-bot", "email": "ana@x"}, {"agent_id": "bia-bot", "email": "bia@x"},
              {"agent_id": "cai-bot", "email": "cai@x"}, {"agent_id": "dan-bot", "email": "dan@x"}]
    mod = _ModuloFalso({"ana@x": {"role": "salesperson"}, "bia@x": {"role": "admin"},
                        "cai@x": None, "dan@x": {"role": "salesperson"}})
    conn = _ConnFalsa(linhas)
    asyncio.run(pub._ligar_quem_tem_conta(
        conn, "hsgrowth", mod, "/users/me", True, aceita=lambda eu: eu.get("role") == "salesperson"))
    assert conn.gravou == (["ana-bot", "dan-bot"], "hsgrowth")
    saida = capsys.readouterr().out
    assert "fora desta fase: admin" in saida and "cai-bot" in saida


def test_agents_md_aponta_o_hsgrowth_e_cabe_no_teto():
    """Sem o ponteiro o Guardi diria "só consigo consultar" (lição da skill
    `faturamento`); e o AGENTS.md é cortado em silêncio no teto de 20.000
    caracteres, com o bloco `hsos:empresa` de ~4.000 anexado pelo onboarding."""
    from app.bots_pessoais import arquivos_do_bot
    from app.gateway.client import TETO_ARQUIVO_AGENTE
    a = arquivos_do_bot({"full_name": "Ellen Souza", "email": "ellen@hs.com"})["AGENTS.md"]
    for nome in ("hsgrowth_consultas", "hsgrowth_registrar", "hsgrowth_noshow"):
        assert nome in a
    trecho = " ".join(a.split("hsgrowth_consultas", 1)[1][:900].split())
    assert "realizada" in trecho and "tentativa sem resultado" in trecho and "como Ellen" in trecho
    assert len(a + "\n" + "x" * 4000) <= TETO_ARQUIVO_AGENTE
