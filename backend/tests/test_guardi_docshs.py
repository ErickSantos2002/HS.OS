"""Guardi no DocsHS (11/11/2026): lê o que o login do DONO lê, nada mais.

Spec `docs/superpowers/specs/2026-11-11-guardi-docshs-design.md`. Quem aplica a
permissão é o DocsHS (cargo, setor, classificação, papel da Qualidade); daqui
se tranca o resto:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria a prova de um treinamento ou o arquivo de um
  documento, e nenhum dos dois pode chegar ao modelo;
- os filtros são os DECLARADOS no catálogo (o OpenAPI do DocsHS não é
  alcançável de fora, ao contrário do DataCore);
- o "eu" do histórico de treinamentos é resolvido pelo servidor, nunca vem do
  agente — senão o Guardi de A pediria o histórico de B;
- o link para abrir no DocsHS é montado aqui, não pelo modelo.
"""
import pytest

from app import docshs_consultas as dh


def test_catalogo_sem_arquivo_nem_prova():
    """Decisão 2 do Erick: nenhum arquivo de documento passa pelo modelo; e o
    Guardi não pode ver nem ajudar a fazer a prova de ninguém. Uma entrada
    dessas no catálogo bastaria para o agente alcançar — o allowlist do DocsHS
    é a segunda tranca, não a única."""
    proibidas = ("arquivo", "prova", "video", "exportacao", "materiais", "anexos",
                 "/trilha", "/usuarios")
    for chave, (caminho, _desc, _filtros) in dh.CONSULTAS.items():
        assert not any(p in caminho for p in proibidas), chave
        if caminho.startswith("/administracao"):
            assert caminho == "/administracao/tipos", chave
        if caminho.startswith("/auth"):
            assert caminho == "/auth/eu", chave


def test_caminho_vem_do_catalogo():
    """O `id` monta UM segmento: `1/../../auth` escaparia para outra rota do
    DocsHS com o token do dono."""
    assert dh.caminho_da_consulta("documento", "12") == "/documentos/12"
    assert dh.caminho_da_consulta("plano_de_treinamento", "2026") == "/planos-treinamento/2026"
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("usuarios", None)                 # desconhecida
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("documento", None)                # falta o id
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("documentos", "9")                # consulta sem id não leva id
    for ruim in ("1/../../auth", "..", ".", "1/arquivo"):
        with pytest.raises(ValueError):
            dh.caminho_da_consulta("documento", ruim)


def test_eu_nunca_vem_do_agente():
    """Se o `{eu}` aceitasse o `id` do agente, o Guardi de A leria o histórico de
    treinamentos de B e só a regra do DocsHS o barraria — uma tranca a menos
    num dado de pessoa."""
    assert dh.caminho_da_consulta("meus_treinamentos", None, eu=7) == "/treinamentos/pessoas/7/historico"
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("meus_treinamentos", "8", eu=7)
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("meus_treinamentos", None, eu=None)
    assert dh.precisa_de_eu("meus_treinamentos") and not dh.precisa_de_eu("documentos")


def test_filtros_so_os_declarados():
    """Filtro desconhecido o DocsHS ignoraria em silêncio — o agente acharia que
    filtrou e contaria a lista inteira como se fosse a filtrada. Recusa aqui,
    com a lista dos válidos. `tamanho` acima de 200 é 422 lá: recusa antes, com
    mensagem que o agente entende."""
    assert dh.params_da_consulta("documentos", {"busca": "calibração", "situacao": "vencida"}) == [
        ("busca", "calibração"), ("situacao", "vencida")]
    assert dh.params_da_consulta("treinamentos", {"com_pendentes": True, "ano": 2026}) == [
        ("com_pendentes", "true"), ("ano", "2026")]
    with pytest.raises(ValueError) as e:
        dh.params_da_consulta("documentos", {"foo": 1})
    assert "busca" in str(e.value)
    for ruim in ({"tamanho": 500}, {"tamanho": 0}, {"pagina": 0}, {"pagina": "x"}):
        with pytest.raises(ValueError):
            dh.params_da_consulta("documentos", ruim)
    with pytest.raises(ValueError):
        dh.params_da_consulta("painel", {"ano": 2026})
    with pytest.raises(ValueError):
        dh.params_da_consulta("documentos", {"busca": ["a", "b"]})   # nenhum filtro é lista


def test_lista_crua_pagina_do_nosso_lado():
    """Fora a Lista Mestra, as rotas do DocsHS devolvem a lista inteira — sem
    paginação ali, o corte de 12 mil caracteres pararia sempre no mesmo item
    (o defeito do estoque do DataCore, 11/11/2026). `offset`/`limite` não vão ao
    DocsHS: saem da query e são aplicados aqui."""
    params = dh.params_da_consulta("treinamentos", {"ano": 2026, "offset": 40, "limite": 10})
    assert dh.paginacao_local(params) == ([("ano", "2026")], 40, 10)
    assert dh.paginacao_local([("busca", "x")]) == ([("busca", "x")], 0, None)
    with pytest.raises(ValueError):
        dh.params_da_consulta("documentos", {"offset": 10})      # a Lista Mestra pagina lá
    with pytest.raises(ValueError):
        dh.params_da_consulta("treinamentos", {"offset": -1})


def test_links_do_front():
    """O modelo não monta URL: inventaria o caminho (ou o domínio) e mandaria a
    pessoa a uma página que não existe."""
    base = "https://d.x"
    assert dh.link_de("/documentos/12", base) == "https://d.x/documentos/12"
    assert dh.link_de("/treinamentos/3", base + "/") == "https://d.x/treinamentos/3"
    assert dh.link_de("/painel", base) is None
    assert dh.com_links("documentos", {"itens": [{"id": 5}], "total": 1}, base) == {
        "itens": [{"id": 5, "link": "https://d.x/documentos/5"}], "total": 1}
    assert dh.com_links("documento", {"id": 9, "titulo": "PO"}, base)["link"] == "https://d.x/documentos/9"
    assert dh.com_links("treinamentos", [{"id": 2}], base) == [{"id": 2, "link": "https://d.x/treinamentos/2"}]
    assert dh.com_links("treinamento", {"id": 4}, base)["link"] == "https://d.x/treinamentos/4"
    assert dh.com_links("painel", {"id": 1}, base) == {"id": 1}
    # leitura aponta para o documento dela
    assert dh.com_links("minhas_leituras", [{"id": 1, "documento_id": 8}], base)[0]["link"] == \
        "https://d.x/documentos/8"


# --- o cliente ------------------------------------------------------------------

import asyncio  # noqa: E402

import httpx  # noqa: E402
import jwt  # noqa: E402
from cryptography.hazmat.primitives import serialization as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import agente_token as at  # noqa: E402
from app.config import settings  # noqa: E402
from app.sistemas import docshs  # noqa: E402


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def test_cliente_le_a_api_com_token_do_dono(chave, monkeypatch):
    """A API mora em `/api/v1` atrás do nginx do front — chamar a raiz devolve o
    HTML da SPA, não um erro. O token vai com `aud=docshs`, `sub` = e-mail do
    DONO e `act` = o Guardi; e é sempre GET (nesta fase, só leitura)."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 7})
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(h))
    assert asyncio.run(docshs.chamar("ana@hs.com", "ana-bot", "/auth/eu")) == {"id": 7}
    r = reqs[0]
    assert r.method == "GET"
    assert str(r.url) == settings.DOCSHS_URL.rstrip("/") + "/api/v1/auth/eu"
    token = r.headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="docshs")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_404_nao_diz_que_nao_existe(chave, monkeypatch):
    """O DocsHS responde 404 a documento que o dono não pode ver. Se a mensagem
    dissesse "não existe", o Guardi afirmaria à pessoa que a empresa não tem o
    procedimento — quando ele só não é visível para o cargo dela."""
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(404, json={})))
    with pytest.raises(docshs.ErroSistema) as e:
        asyncio.run(docshs.chamar("ana@hs.com", "ana-bot", "/documentos/12"))
    assert "não tem acesso" in str(e.value) and "não existe" not in str(e.value)


def test_401_fala_da_conta_do_dono(chave, monkeypatch):
    """401 é quase sempre "sem conta ativa no DocsHS" (ou o DocsHS ainda sem a
    chave pública) — não "você não tem permissão", que mandaria a pessoa pedir
    acesso a quem não pode dar."""
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(docshs.ErroSistema) as e:
        asyncio.run(docshs.chamar("ana@hs.com", "ana-bot", "/auth/eu"))
    assert "conta ativa no DocsHS" in str(e.value) and e.value.status == 401


# --- as ferramentas no hsos-bot-<bot> --------------------------------------------

_CTX = {"sistemas": ["docshs"], "email": "ana@hs.com", "dono": None, "primeiro": "Ana"}


def test_ferramentas_no_guardi_docshs():
    from app.email.regras import FERRAMENTAS_BOT
    assert {"docshs_consultas", "docshs_consultar"} <= set(FERRAMENTAS_BOT)


def test_sem_docshs_ligado_recusa_sem_rede(chave, monkeypatch):
    """A flag é a ordem de abertura (piloto no erick-bot, depois quem tem conta
    lá). Sem ela, nem o `/auth/eu` sai — um 401 vindo do DocsHS diria à pessoa
    que ela não tem conta, quando o que falta é ligar."""
    from app.routers import mcp_bot
    chamadas = []
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(
        lambda r: chamadas.append(r) or httpx.Response(200, json={})))
    ctx = {**_CTX, "sistemas": ["datacore"]}
    for nome in ("docshs_consultas", "docshs_consultar"):
        with pytest.raises(mcp_bot._Recusa):
            asyncio.run(mcp_bot._docshs("ana-bot", nome, {"consulta": "eu"}, ctx))
    assert chamadas == []


def test_meus_treinamentos_usa_o_id_do_eu(chave, monkeypatch):
    """O histórico é o do DONO: o servidor pergunta ao DocsHS quem ele é e usa
    esse id. O `id` mandado pelo agente é recusado ANTES da rede — senão o
    Guardi de A leria o histórico de B."""
    from app.routers import mcp_bot
    caminhos = []

    def h(req):
        caminhos.append(req.url.path)
        if req.url.path.endswith("/auth/eu"):
            return httpx.Response(200, json={"id": 7, "nome": "Ana"})
        return httpx.Response(200, json={"treinamentos": []})
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(h))
    asyncio.run(mcp_bot._docshs("ana-bot", "docshs_consultar", {"consulta": "meus_treinamentos"}, _CTX))
    assert caminhos == ["/api/v1/auth/eu", "/api/v1/treinamentos/pessoas/7/historico"]
    caminhos.clear()
    with pytest.raises(ValueError):
        asyncio.run(mcp_bot._docshs("ana-bot", "docshs_consultar",
                                    {"consulta": "meus_treinamentos", "id": "8"}, _CTX))
    assert caminhos == []


def test_retorno_e_dado_externo_com_link(chave, monkeypatch):
    """O que volta é dado do DocsHS (título de documento é texto de terceiro e
    pode carregar instrução), com o link montado pelo servidor."""
    from app.routers import mcp_bot
    monkeypatch.setattr(docshs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(
        200, json={"itens": [{"id": 5, "codigo": "PO-07", "titulo": "Calibração"}],
                   "total": 1, "pagina": 1, "tamanho": 25})))
    t = asyncio.run(mcp_bot._docshs("ana-bot", "docshs_consultar",
                                    {"consulta": "documentos", "parametros": {"busca": "calibracao"}}, _CTX))
    assert "DADO_EXTERNO" in t and "origem: DocsHS" in t
    assert settings.DOCSHS_URL.rstrip("/") + "/documentos/5" in t


def test_catalogo_lista_filtros_declarados(chave, monkeypatch):
    from app.routers import mcp_bot
    t = asyncio.run(mcp_bot._docshs("ana-bot", "docshs_consultas", {}, _CTX))
    assert "documentos" in t and "busca" in t and "documento (pede id)" in t
    assert asyncio.run(mcp_bot._docshs("ana-bot", "docshs_consultas", {"consulta": "painel"}, _CTX)) \
        .startswith("- painel")
