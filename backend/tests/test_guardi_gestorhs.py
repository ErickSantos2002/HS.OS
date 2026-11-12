"""Guardi no GestorHS (11/11/2026, fase 1): lê o que o login do DONO lê, nada mais.

Spec `docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`. Quem aplica a
permissão é o GestorHS (a função do dono lá); daqui se tranca o resto, no molde
do DocsHS:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria nota fiscal, PDF de certificado ou a lista de
  usuários, nenhum deles pedido na fase 1;
- os filtros são os DECLARADOS no catálogo, para recusar o que o GestorHS
  ignoraria em silêncio;
- o `id` é só dígitos (todo id do GestorHS é inteiro);
- o link para abrir no GestorHS é montado aqui, com o endereço do FRONT — que
  não é o da API.
"""
import pytest

from app import gestorhs_consultas as gh


def test_catalogo_so_leitura_sem_pdf_nem_nota():
    """Spec: fora da fase 1, PDF, exportação, nota fiscal, logs, usuários e
    portal. Uma entrada dessas bastaria para o agente alcançar — a allowlist do
    GestorHS é a segunda tranca, não a única."""
    proibidas = ("pdf", "exportar", "nota", "logs", "usuarios", "portal", "campos", "/auth")
    for chave, (caminho, _d, _f) in gh.CONSULTAS.items():
        assert not any(p in caminho for p in proibidas), chave


def test_id_e_so_digitos():
    """O `id` monta UM segmento: `1/notas-fiscais` ou `1/../../usuarios`
    levariam o token do dono a uma rota fora do catálogo. Todo id do GestorHS é
    inteiro, então a regra é mais estreita que a do DocsHS."""
    assert gh.caminho_da_consulta("aparelho", "42") == "/equipamentos-cliente/42"
    assert gh.caminho_da_consulta("caixa", "7") == "/caixas/7"
    assert gh.caminho_da_consulta("versoes_da_proposta", 3) == "/propostas/3/versoes"
    for ruim in ("1/notas-fiscais", "..", "1/../../usuarios", "abc", "", None, "12345678901"):
        with pytest.raises(ValueError):
            gh.caminho_da_consulta("aparelho", ruim)
    with pytest.raises(ValueError):
        gh.caminho_da_consulta("aparelhos", "3")      # lista não leva id
    with pytest.raises(ValueError):
        gh.caminho_da_consulta("notas_fiscais", None)  # fora do catálogo


def test_filtro_fora_da_lista_e_recusado():
    """Filtro desconhecido o GestorHS ignoraria em silêncio — o agente acharia
    que filtrou e contaria a lista inteira como se fosse a filtrada. E `limit`
    ou `page_size` acima de 100 é 422 lá: recusa antes, com mensagem que o
    agente entende."""
    assert gh.params_da_consulta("aparelhos", {"cliente": 9, "status": "vencido"}) == \
        [("cliente", "9"), ("status", "vencido")]
    assert gh.params_da_consulta("caixas", {"incluir_concluidas": True}) == \
        [("incluir_concluidas", "true")]
    with pytest.raises(ValueError, match="incluir_concluidas"):   # a mensagem nomeia os aceitos
        gh.params_da_consulta("caixas", {"fase": 3})
    for ruim in ({"limit": 1000}, {"limit": 0}, {"offset": -1}, {"cliente": [1, 2]}):
        with pytest.raises(ValueError):
            gh.params_da_consulta("aparelhos", ruim)
    with pytest.raises(ValueError):
        gh.params_da_consulta("propostas", {"page_size": 500})
    with pytest.raises(ValueError):
        gh.params_da_consulta("aparelho", {"cliente": 1})          # item único não tem filtro


def test_paginacao_local_nao_vai_ao_gestorhs():
    """`/equipamentos`, `/fases` e os históricos devolvem a lista inteira: sem
    paginar aqui, o corte de 12 mil caracteres pararia sempre no mesmo item (o
    defeito do estoque do DataCore, 11/11/2026). `offset`/`limite` saem da query."""
    p = gh.params_da_consulta("modelos", {"offset": 20, "limite": 10})
    assert gh.paginacao_local("modelos", p) == ([], 20, 10)
    # nas que paginam lá, o `offset` É do GestorHS: tirá-lo da query faria o
    # agente receber sempre a primeira página achando que avançou
    p = gh.params_da_consulta("aparelhos", {"offset": 20, "limit": 50})
    assert gh.paginacao_local("aparelhos", p) == ([("offset", "20"), ("limit", "50")], 0, None)
    with pytest.raises(ValueError):
        gh.params_da_consulta("aparelhos", {"limite": 10})


def test_links_do_front():
    """O modelo não monta URL: inventaria o caminho (ou usaria o domínio da API)
    e mandaria a pessoa a uma página que não existe. O envelope do GestorHS é
    `items`, não `itens` como no DocsHS."""
    base = "https://g.x"
    d = gh.com_links("aparelhos", {"items": [{"id": 5, "serie": "A1"}], "total": 1}, base)
    assert d["items"][0]["link"] == "https://g.x/app/equipamentos/5"
    assert gh.com_links("caixa", {"id": 7}, base)["link"] == "https://g.x/app/caixas/7"
    assert gh.com_links("os_do_aparelho", [{"id": 3}], base)[0]["link"] == "https://g.x/app/ordens/3"
    assert gh.com_links("cliente", {"id": 4}, base + "/")["link"] == "https://g.x/app/clientes/4"
    assert gh.com_links("proposta", {"id": 2}, base)["link"] == "https://g.x/app/propostas"
    assert "link" not in gh.com_links("fases", [{"id": 1}], base)[0]
    assert gh.com_links("aparelho", {"serie": "sem id"}, base) == {"serie": "sem id"}


# --- o cliente ------------------------------------------------------------------

import asyncio  # noqa: E402

import httpx  # noqa: E402
import jwt  # noqa: E402
from cryptography.hazmat.primitives import serialization as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import agente_token as at  # noqa: E402
from app.config import settings  # noqa: E402
from app.sistemas import gestorhs  # noqa: E402


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def test_cliente_chama_a_api_nao_o_front(chave, monkeypatch):
    """Duas URLs: a API (gestorhsapi) e o front (gestorhs). Chamar o front
    devolveria o HTML da SPA com 200 — o agente leria uma página de login como
    se fosse a resposta. O token vai com `aud=gestorhs`, `sub` = e-mail do DONO
    e `act` = o Guardi; e é sempre GET (na fase 1, só leitura)."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 7})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    assert asyncio.run(gestorhs.chamar("ana@hs.com", "ana-bot", "/auth/me")) == {"id": 7}
    r = reqs[0]
    assert r.method == "GET"
    assert str(r.url) == settings.GESTORHS_API_URL.rstrip("/") + "/auth/me"
    assert "gestorhsapi" in settings.GESTORHS_API_URL and "gestorhsapi" not in settings.GESTORHS_URL
    token = r.headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="gestorhs")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_401_fala_da_conta_do_dono(chave, monkeypatch):
    """401 é quase sempre "sem conta ativa no GestorHS" (ou o GestorHS ainda sem
    a chave pública) — não "você não tem permissão", que mandaria a pessoa pedir
    acesso a quem não pode dar."""
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(gestorhs.ErroSistema) as e:
        asyncio.run(gestorhs.chamar("ana@hs.com", "ana-bot", "/auth/me"))
    assert "conta ativa no GestorHS" in str(e.value) and e.value.status == 401


def test_escrita_vai_com_metodo_e_corpo_e_403_fala_da_funcao(chave, monkeypatch):
    """Fase 2a: o mesmo cliente escreve (abrir OS, avançar caixa, cadastrar).
    O 403 numa escrita é a FUNÇÃO do dono no GestorHS (Consulta tentando abrir
    OS), não "o Guardi não pode ver": a mensagem da leitura mandaria a pessoa
    pedir acesso de leitura, que ela já tem."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 100, "caixa": 40})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    r = asyncio.run(gestorhs.chamar("ana@hs.com", "ana-bot", "/ordens", metodo="POST",
                                    json={"equipamento_cliente": 5}))
    assert r == {"id": 100, "caixa": 40}
    assert reqs[0].method == "POST" and reqs[0].url.path == "/ordens"
    import json as _json
    assert _json.loads(reqs[0].content) == {"equipamento_cliente": 5}

    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(403, json={})))
    with pytest.raises(gestorhs.ErroSistema) as e:
        asyncio.run(gestorhs.chamar("ana@hs.com", "ana-bot", "/ordens", metodo="POST", json={}))
    assert "sua função no GestorHS" in str(e.value) and e.value.status == 403
    with pytest.raises(gestorhs.ErroSistema) as e:
        asyncio.run(gestorhs.chamar("ana@hs.com", "ana-bot", "/caixas/7"))
    assert "não deixa o Guardi ver" in str(e.value)      # na leitura, a mensagem da fase 1


# --- as ferramentas no hsos-bot-<bot> --------------------------------------------

_CTX = {"sistemas": ["gestorhs"], "email": "ana@hs.com", "dono": None, "primeiro": "Ana"}


def _grava(monkeypatch, resposta):
    chamadas = []

    def h(req):
        chamadas.append(req)
        return httpx.Response(200, json=resposta)
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    return chamadas


def test_ferramentas_no_guardi_gestorhs():
    """O `toolFilter.include` e o `alsoAllow` listam ferramenta por ferramenta a
    partir de `FERRAMENTAS_BOT`: fora dela, a ferramenta existe no servidor e o
    Guardi nunca a vê."""
    from app.email.regras import FERRAMENTAS_BOT
    from app.routers import mcp_bot
    assert {"gestorhs_consultas", "gestorhs_consultar"} <= set(FERRAMENTAS_BOT)
    assert {"gestorhs_consultas", "gestorhs_consultar"} <= {f["name"] for f in mcp_bot.FERRAMENTAS}


def test_sem_gestorhs_ligado_recusa_sem_rede(chave, monkeypatch):
    """Sem a flag, nada sai: um 401 de lá diria à pessoa que ela não tem conta,
    quando o que falta é ligar."""
    from app.routers import mcp_bot
    chamadas = _grava(monkeypatch, {})
    ctx = {**_CTX, "sistemas": ["docshs"]}
    for nome in ("gestorhs_consultas", "gestorhs_consultar"):
        with pytest.raises(mcp_bot._Recusa):
            asyncio.run(mcp_bot._gestorhs(None, "ana-bot", nome, {"consulta": "aparelhos"}, ctx))
    assert chamadas == []


def test_id_invalido_nao_toca_a_rede(chave, monkeypatch):
    """O `id` é validado antes da rede: `1/notas-fiscais` levaria o token do dono
    a uma rota fora do catálogo, e só a allowlist de lá o barraria."""
    from app.routers import mcp_bot
    chamadas = _grava(monkeypatch, {})
    for args in ({"consulta": "aparelho", "id": "1/notas-fiscais"},
                 {"consulta": "caixas", "parametros": {"fase": 3}}):
        with pytest.raises(ValueError):
            asyncio.run(mcp_bot._gestorhs(None, "ana-bot", "gestorhs_consultar", args, _CTX))
    assert chamadas == []


def test_lista_crua_pagina_do_nosso_lado(chave, monkeypatch):
    """`/equipamentos` devolve a tabela inteira: o `offset` iria ao GestorHS e
    seria ignorado (o defeito do `/estoque/` do DataCore em 11/11) — o agente
    receberia sempre a mesma fatia achando que avançou."""
    from app.routers import mcp_bot
    chamadas = _grava(monkeypatch, [{"id": i, "nome": f"M{i}"} for i in range(30)])
    t = asyncio.run(mcp_bot._gestorhs(None, "ana-bot", "gestorhs_consultar",
                                      {"consulta": "modelos",
                                       "parametros": {"offset": 10, "limite": 5}}, _CTX))
    assert chamadas[0].url.query == b""
    assert '"offset":10' in t and '"proximo_offset":15' in t


def test_retorno_e_dado_externo_com_link(chave, monkeypatch):
    """O que volta é dado do GestorHS (observação de caixa e nome de cliente são
    texto de terceiro e podem carregar instrução), com o link do FRONT montado
    pelo servidor — e o `offset` das listas que paginam lá segue na query."""
    from app.routers import mcp_bot
    chamadas = _grava(monkeypatch, {"items": [{"id": 5, "serie": "A1"}], "total": 1})
    t = asyncio.run(mcp_bot._gestorhs(None, "ana-bot", "gestorhs_consultar",
                                      {"consulta": "aparelhos",
                                       "parametros": {"cliente": 9, "offset": 50}}, _CTX))
    assert "DADO_EXTERNO" in t and "origem: GestorHS" in t
    assert settings.GESTORHS_URL.rstrip("/") + "/app/equipamentos/5" in t
    assert chamadas[0].url.path == "/equipamentos-cliente"
    assert dict(chamadas[0].url.params) == {"cliente": "9", "offset": "50"}


def test_catalogo_lista_filtros_declarados(chave, monkeypatch):
    """O catálogo é o que o agente lê para escolher: sem o significado de
    `vencendo` ele chutaria a janela, e sem o "(pede id)" mandaria a consulta
    de item único sem id."""
    from app.routers import mcp_bot
    chamadas = _grava(monkeypatch, {})
    t = asyncio.run(mcp_bot._gestorhs(None, "ana-bot", "gestorhs_consultas", {}, _CTX))
    assert "aparelhos" in t and "vencendo" in t and "aparelho (pede id)" in t
    assert asyncio.run(mcp_bot._gestorhs(None, "ana-bot", "gestorhs_consultas", {"consulta": "caixa"}, _CTX)) \
        .startswith("- caixa (pede id)")
    assert chamadas == []


def test_agents_md_do_guardi_aponta_para_o_gestorhs_e_cabe_no_teto():
    """Ferramenta disponível não é ferramenta usada (lição de 14/08 com a skill
    `faturamento`): sem o ponteiro no AGENTS.md o Guardi responderia "não tenho
    acesso ao GestorHS". E o AGENTS.md tem teto de 20.000 caracteres que o
    gateway corta em silêncio — o que se perde é o último bloco escrito."""
    from app.bots_pessoais import arquivos_do_bot
    from app.gateway.client import excede_o_teto
    a = arquivos_do_bot({"full_name": "Ana Souza", "email": "ana@hs.com"})["AGENTS.md"]
    assert "gestorhs_consultas" in a and "gestorhs_consultar" in a
    assert "login de Ana" in a.split("gestorhs_consultar", 1)[1][:80]
    assert not excede_o_teto(a)


class _ConnFalsa:
    def __init__(self, linhas):
        self.linhas, self.escritas, self.fetch_args = linhas, [], None

    async def fetch(self, sql, *args):
        self.fetch_args = args
        return self.linhas

    async def fetchval(self, sql, *args):
        self.escritas.append(args)
        return len(args[0])


def test_ligar_gestorhs_todos_so_quem_tem_conta(chave, monkeypatch, capsys):
    """Ligar o GestorHS para quem não tem conta lá faria o Guardi responder
    "sem conta" a cada pergunta, com o AGENTS.md prometendo a ferramenta. O
    "eu" de lá é `/auth/me` (no DocsHS é `/auth/eu`: trocar daria 404 para
    todo mundo e ninguém seria ligado). E o ensaio não escreve nada."""
    import importlib.util
    import pathlib
    spec = importlib.util.spec_from_file_location(
        "publicar_bots_mcp", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "publicar-bots-mcp.py")
    pub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pub)

    caminhos = []

    def h(req):
        caminhos.append(req.url.path)
        sub = jwt.decode(req.headers["authorization"].removeprefix("Bearer "),
                         options={"verify_signature": False})["sub"]
        return httpx.Response(200 if sub == "ana@hs.com" else 401, json={})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    linhas = [{"agent_id": "ana-bot", "email": "ana@hs.com"}, {"agent_id": "beto-bot", "email": "b@hs.com"}]

    conn = _ConnFalsa(linhas)
    assert asyncio.run(pub._ligar_gestorhs_todos(conn, aplicar=False)) == 0
    assert caminhos == ["/auth/me", "/auth/me"] and conn.fetch_args == ("gestorhs",)
    assert conn.escritas == []
    out = capsys.readouterr().out
    assert "Com conta no GestorHS: ana-bot" in out and "beto-bot (401)" in out

    conn = _ConnFalsa(linhas)
    asyncio.run(pub._ligar_gestorhs_todos(conn, aplicar=True))
    assert conn.escritas == [(["ana-bot"], "gestorhs")]


def test_guardi_entrega_o_link_pdf_do_gestorhs():
    """11/11/2026, primeira pergunta real no piloto: "consegue me retornar o
    link do certificado da OS 11700?" — e o Guardi respondeu que não tinha,
    mandando abrir pela OS. O GestorHS já tinha esse link (o mesmo que vai aos
    cards do TaskHS); só não o devolvia ao Guardi. Agora devolve em `link_pdf`,
    e sem o nome do campo na descrição da ferramenta e no AGENTS.md o agente
    continuaria dizendo que PDF "não é acessível"."""
    from app.bots_pessoais import arquivos_do_bot
    from app.routers.mcp_bot import FERRAMENTAS
    desc = next(f for f in FERRAMENTAS if f["name"] == "gestorhs_consultar")["description"]
    assert "link_pdf" in desc and "não é acessível" not in desc
    a = arquivos_do_bot({"full_name": "Ana Souza", "email": "ana@hs.com"})["AGENTS.md"]
    assert "link_pdf" in a.split("gestorhs_consultar", 1)[1][:400]
