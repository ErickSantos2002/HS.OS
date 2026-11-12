"""Guardi no GestorHS, fase 2a (Expedição, 12/11/2026): escrita por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md`.
Quatro ações — receber aparelhos (OS em lote), avançar caixa, fechar caixa com
rastreio e cadastrar aparelho — e nenhuma escreve sem o clique do dono. O que se
tranca aqui:
- o servidor confere no GestorHS ANTES do cartão (aparelho com OS ativa, caixa
  na fase errada, série que já existe): o cartão nunca promete o que lá vai ser
  recusado;
- o cartão mostra o cliente de cada aparelho (a série falada pode ser de outro);
- lote que falha no meio para e diz o que abriu, sem desfazer.
"""
import pytest

from app import gestorhs_escrita as ge


# --- regras puras -----------------------------------------------------------------

def test_lote_valida_e_normaliza():
    """Lote com tipo ou acessório inválido daria 400/422 no clique, depois de a
    pessoa já ter confirmado. Recusar antes do cartão evita confirmação inútil."""
    itens = ge.aparelhos_do_lote({"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [2, 8]}]})
    assert itens == [{"equipamento_cliente": 5, "tipo_servico": "C", "condicao_chegada": None,
                      "checklist": [2, 8], "pilhas": 0, "bocais": 0, "observacoes": None}]
    for ruim in ({"aparelhos": []}, {"aparelhos": [{"id": 5, "tipo_servico": "X"}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [10]}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C"}, {"id": 5, "tipo_servico": "C"}]},
                 {"aparelhos": [{"id": i, "tipo_servico": "C"} for i in range(1, 32)]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "condicao": "Ótimo"}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "observacao": "x" * 501}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "pilhas": -1}]},
                 {"aparelhos": [{"id": True, "tipo_servico": "C"}]},
                 {"aparelhos": "5"}):
        with pytest.raises(ValueError):
            ge.aparelhos_do_lote(ruim)


def test_aparelho_com_os_ativa_recusa_nomeando():
    """O GestorHS responderia 409 no clique — no meio do lote, com OS já abertas
    antes dele. Recusar antes, nomeando a série, deixa a pessoa tirar o aparelho
    do lote em vez de descobrir depois."""
    ap = {"id": 5, "cliente_nome": "ACME", "equipamento_descricao": "Phoebus", "serie": "F1"}
    with pytest.raises(ValueError, match="F1"):
        ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 5}])
    assert ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 8}]) == \
        {"cliente": "ACME", "modelo": "Phoebus", "serie": "F1"}


def test_texto_do_gestorhs_entra_no_cartao_em_uma_linha():
    """Nome de cliente e série são texto de terceiro e vão para o cartão que o
    dono confirma: com quebra de linha, um nome forjado desenharia uma linha
    falsa no cartão."""
    ap = {"id": 5, "cliente_nome": "ACME\nCaixa: 999", "equipamento_descricao": "P" * 200, "serie": "F1"}
    ex = ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [])
    assert "\n" not in ex["cliente"] and len(ex["modelo"]) == 80


def test_caixa_existente_em_qualquer_fase_ativa_com_aviso():
    """Decisão do Erick (12/11): pode, mas o cartão avisa onde a OS entra."""
    assert ge.conferir_caixa_para_receber({"id": 7, "fase": 4, "fase_descricao": "Recebido"}) is None
    assert "Laboratório" in ge.conferir_caixa_para_receber({"id": 7, "fase": 5, "fase_descricao": "Laboratório"})
    for fase in (8, 9, None):
        with pytest.raises(ValueError):
            ge.conferir_caixa_para_receber({"id": 7, "fase": fase})


def test_avancar_recusa_preparando_e_pede_cliente_principal():
    """Avançar de Preparando Retorno exige o rastreio: sem ferramenta própria o
    agente mandaria sem `cod_retorno` e levaria o 409 no clique. E caixa com
    clientes misturados não sai de Recebido sem o cliente principal."""
    with pytest.raises(ValueError, match="gestorhs_fechar_caixa"):
        ge.conferir_caixa_para_avancar({"id": 7, "fase": 7, "clientes": ["A"], "total_os": 1}, None)
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_avancar({"id": 7, "fase": 8, "clientes": ["A"], "total_os": 1}, None)
    multi = {"id": 7, "fase": 4, "clientes": ["A", "B"], "cliente_principal": None, "total_os": 2}
    with pytest.raises(ValueError, match="cliente_principal"):
        ge.conferir_caixa_para_avancar(multi, None)
    ex = ge.conferir_caixa_para_avancar(multi, 33)
    assert ex["fase"] == "Recebido" and ex["funcao"] == "Expedição" and ex["total_os"] == 2
    assert ex["clientes"] == ["A", "B"]
    # já com principal gravado na caixa, não pede de novo
    ge.conferir_caixa_para_avancar({**multi, "cliente_principal": 33}, None)


def test_fechar_exige_preparando_e_rastreio():
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 4}, "BR1")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "  ")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "X" * 61)
    ex = ge.conferir_caixa_para_fechar({"id": 7, "fase": 7, "total_os": 3, "clientes": ["ACME"]}, " BR123 ")
    assert ex["cod_retorno"] == "BR123" and ex["total_os"] == 3 and ex["clientes"] == ["ACME"]


def test_cadastro_recusa_serie_que_ja_existe():
    """'Cadastra o bafômetro série X' com X já na frota daria um aparelho
    duplicado, e as OS futuras cairiam ora num, ora noutro."""
    with pytest.raises(ValueError, match="ACME"):
        ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "f 123"},
                             [{"serie": "F123", "cliente_nome": "ACME"}])
    p = ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "F9"}, [])
    assert p == {"cliente": 1, "equipamento": 2, "serie": "F9"}
    p = ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "F9", "patrimonio": "P1",
                              "prox_calibragem": "2027-01-31"}, [{"serie": "F99"}])
    assert p["patrimonio"] == "P1" and p["prox_calibragem"] == "2027-01-31"
    for ruim in ({"cliente": 1, "equipamento": 2, "serie": ""},
                 {"cliente": 1, "equipamento": 2, "serie": "X" * 61},
                 {"cliente": "a", "equipamento": 2, "serie": "F9"},
                 {"cliente": 1, "equipamento": 2, "serie": "F9", "datacompra": "31/01/2027"}):
        with pytest.raises(ValueError):
            ge.conferir_cadastro(ruim, [])


def test_texto_do_lote_parcial():
    """É o texto que a pessoa lê para decidir o resto do lote: sem dizer quais
    OS já existem, ela repetiria o lote inteiro e levaria 409 nos que abriram."""
    t = ge.texto_lote_parcial(2, 5, "F3", "aparelho já possui OS ativa", [100, 101], 40)
    assert t.startswith("Parou no aparelho 3 de 5") and "OS 100, 101" in t and "caixa 40" in t


# --- executores no clique ---------------------------------------------------------

import asyncio  # noqa: E402
import json  # noqa: E402

import httpx  # noqa: E402
from cryptography.hazmat.primitives import serialization as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import acoes  # noqa: E402
from app import agente_token as at  # noqa: E402
from app.sistemas import gestorhs  # noqa: E402


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def _servidor(monkeypatch, responder):
    """GestorHS falso: `responder(req, n)` → httpx.Response; devolve as requisições."""
    reqs = []

    def h(req):
        reqs.append(req)
        return responder(req, len(reqs))
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    return reqs


def _corpo(req):
    return json.loads(req.content) if req.content else None


def _lote(n):
    return {"caixa": None, "data_chegada": None,
            "aparelhos": [{"equipamento_cliente": i, "tipo_servico": "C", "condicao_chegada": None,
                           "checklist": [], "pilhas": 0, "bocais": 0, "observacoes": None}
                          for i in range(1, n + 1)],
            "_exibir": {"linhas": [{"cliente": "ACME", "modelo": "Phoebus", "serie": f"F{i}"}
                                   for i in range(1, n + 1)], "caixa": "nova", "aviso": None,
                        "clientes": 1}}


def _executar(acao, p):
    return asyncio.run(acoes.EXECUTORES[("gestorhs", acao)]("ana@hs.com", "ana-bot", p))


def test_receber_abre_a_primeira_sem_caixa_e_as_demais_na_dela(chave, monkeypatch):
    """Decisão 2 do Erick: a 1ª OS cria a caixa; mandar caixa nas outras é o que
    as junta. Mandar a caixa na 1ª (inexistente) ou omiti-la nas outras daria
    uma caixa por aparelho."""
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(201, json={"id": 99 + n, "caixa": 40}))
    r = _executar("receber", _lote(3))
    assert [q.method for q in reqs] == ["POST"] * 3 and all(q.url.path == "/ordens" for q in reqs)
    corpos = [_corpo(q) for q in reqs]
    assert "caixa" not in corpos[0]
    assert corpos[1]["caixa"] == 40 and corpos[2]["caixa"] == 40
    assert [c["equipamento_cliente"] for c in corpos] == [1, 2, 3]
    assert "caixa 40" in r and "OS 100, 101, 102" in r


def test_receber_em_caixa_existente_manda_a_caixa_desde_a_primeira(chave, monkeypatch):
    """Chegou mais um da mesma remessa: sem a caixa na 1ª, o aparelho iria para
    uma caixa nova, separado dos irmãos."""
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(201, json={"id": 200 + n, "caixa": 77}))
    p = {**_lote(2), "caixa": 77, "data_chegada": "2026-11-12"}
    _executar("receber", p)
    assert all(_corpo(q)["caixa"] == 77 and _corpo(q)["data_chegada"] == "2026-11-12" for q in reqs)


def test_receber_para_no_meio_e_diz_o_que_abriu(chave, monkeypatch):
    """OS aberta é registro: desfazer sozinho apagaria o que a Expedição já
    etiquetou. Para, diz quais abriram e em qual caixa, e a pessoa decide."""
    def resp(r, n):
        if n == 3:
            return httpx.Response(409, json={"detail": "aparelho já possui OS ativa"})
        return httpx.Response(201, json={"id": 99 + n, "caixa": 40})
    reqs = _servidor(monkeypatch, resp)
    with pytest.raises(gestorhs.ErroSistema) as e:
        _executar("receber", _lote(3))
    t = str(e.value)
    assert t.startswith("Parou no aparelho 3 de 3") and "OS 100, 101" in t and "caixa 40" in t
    assert "F3" in t and "OS ativa" in t
    assert len(reqs) == 3 and all(q.method == "POST" for q in reqs)


def test_receber_falha_no_primeiro_relanca(chave, monkeypatch):
    """Nada abriu: o erro do GestorHS vai como está (ex.: a função do dono), sem
    um "parou no 1 de 5" que faria parecer que algo foi feito."""
    _servidor(monkeypatch, lambda r, n: httpx.Response(403, json={}))
    with pytest.raises(gestorhs.ErroSistema) as e:
        _executar("receber", _lote(2))
    assert "sua função no GestorHS" in str(e.value) and "Parou" not in str(e.value)


def test_erro_longo_nao_e_cortado_em_300():
    """O texto do lote parcial é o que a pessoa usa para decidir o resto: cortado,
    ela não saberia quais OS já existem (30 OS são ~250 caracteres só de números)."""
    import pathlib
    import re
    fonte = (pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "acoes.py").read_text()
    cortes = [int(n) for n in re.findall(r"falha\[:(\d+)\]", fonte)]
    assert cortes and min(cortes) >= 2000
    t = ge.texto_lote_parcial(29, 30, "F" * 60, "x" * 200, list(range(10000, 10029)), 12345)
    assert len(t) < 2000


def test_avancar_403_diz_quem_avanca(chave, monkeypatch):
    """Quem avança é a função dona da fase: "não permite" sozinho deixaria a
    pessoa sem saber a quem pedir."""
    _servidor(monkeypatch, lambda r, n: httpx.Response(403, json={}))
    p = {"caixa": 7, "_exibir": {"fase": "Laboratório", "funcao": "Laboratório", "total_os": 2,
                                 "clientes": ["ACME"]}}
    with pytest.raises(gestorhs.ErroSistema) as e:
        _executar("avancar_caixa", p)
    assert "Laboratório" in str(e.value) and e.value.status == 403


def test_avancar_devolve_a_fase_nova(chave, monkeypatch):
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(200, json={"id": 7, "fase": 5,
                                                                          "fase_descricao": "Laboratório"}))
    r = _executar("avancar_caixa", {"caixa": 7, "cliente_principal": 33, "obs": "ok",
                                    "_exibir": {"fase": "Recebido", "funcao": "Expedição"}})
    assert reqs[0].url.path == "/caixas/7/avancar"
    assert _corpo(reqs[0]) == {"obs": "ok", "cliente_principal": 33}
    assert r == "Caixa 7 avançada para Laboratório."


def test_payload_nunca_leva_sem_nota_fiscal(chave, monkeypatch):
    """`sem_nota_fiscal` é exceção de Administrador para caixa antiga, fora da
    fase 2a: um payload adulterado não pode fazê-la passar pelo corpo."""
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(200, json={"fase_descricao": "Finalizada"}))
    for acao, p in (("avancar_caixa", {"caixa": 7, "sem_nota_fiscal": True, "_exibir": {}}),
                    ("fechar_caixa", {"caixa": 7, "cod_retorno": "BR1", "sem_nota_fiscal": True,
                                      "_exibir": {}})):
        _executar(acao, p)
    assert len(reqs) == 2 and all("sem_nota_fiscal" not in _corpo(q) for q in reqs)


def test_fechar_manda_o_rastreio(chave, monkeypatch):
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(200, json={"fase_descricao": "Finalizada"}))
    r = _executar("fechar_caixa", {"caixa": 1247, "cod_retorno": "BR123", "_exibir": {}})
    assert reqs[0].url.path == "/caixas/1247/avancar" and _corpo(reqs[0]) == {"cod_retorno": "BR123"}
    assert r == "Caixa 1247 finalizada, rastreio BR123."


def test_cadastrar_manda_o_payload_sem_exibir(chave, monkeypatch):
    """O `_exibir` é rótulo do cartão: indo no corpo, o GestorHS recusaria (ou
    pior, um campo de mesmo nome passaria a valer)."""
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(201, json={"id": 9001}))
    r = _executar("cadastrar_aparelho", {"cliente": 1, "equipamento": 2, "serie": "F9",
                                         "_exibir": {"cliente": "ACME", "modelo": "Phoebus"}})
    assert reqs[0].url.path == "/equipamentos-cliente"
    assert _corpo(reqs[0]) == {"cliente": 1, "equipamento": 2, "serie": "F9"}
    assert r == "Aparelho cadastrado (id 9001)."


# --- as ferramentas no hsos-bot-<bot> ---------------------------------------------

from app.email.regras import FERRAMENTAS_BOT  # noqa: E402
from app.routers import mcp_bot  # noqa: E402
from app.routers.mcp_bot import FERRAMENTAS  # noqa: E402

_ESCRITAS = ("gestorhs_receber", "gestorhs_avancar_caixa", "gestorhs_fechar_caixa",
             "gestorhs_cadastrar_aparelho")
_CTX = {"sistemas": ["gestorhs"], "email": "ana@hs.com", "dono": "u-ana", "primeiro": "Ana"}

# GestorHS falso das leituras: caminho → resposta.
_LEITURAS = {
    "/equipamentos-cliente/5": {"id": 5, "cliente": 1, "cliente_nome": "ACME",
                                "equipamento_descricao": "Phoebus", "serie": "F1", "ativo": True},
    "/equipamentos-cliente/5/ordens": [{"id": 9, "fase": 8}],
    "/equipamentos-cliente/6": {"id": 6, "cliente": 2, "cliente_nome": "Beta Ltda",
                                "equipamento_descricao": "Phoebus", "serie": "F2", "ativo": True},
    "/equipamentos-cliente/6/ordens": [],
    "/equipamentos-cliente/8": {"id": 8, "cliente": 1, "cliente_nome": "ACME",
                                "equipamento_descricao": "Phoebus", "serie": "F8", "ativo": True},
    "/equipamentos-cliente/8/ordens": [{"id": 12, "fase": 5}],
    "/caixas/40": {"id": 40, "fase": 5, "fase_descricao": "Laboratório", "total_os": 2,
                   "clientes": ["ACME"], "ordens": [{"id": 1, "cliente": 1, "cliente_nome": "ACME"}]},
    "/caixas/41": {"id": 41, "fase": 4, "total_os": 2, "clientes": ["ACME", "Beta Ltda"],
                   "cliente_principal": None,
                   "ordens": [{"id": 1, "cliente": 1, "cliente_nome": "ACME"},
                              {"id": 2, "cliente": 2, "cliente_nome": "Beta Ltda"}]},
    "/caixas/42": {"id": 42, "fase": 7, "total_os": 1, "clientes": ["ACME"], "ordens": []},
    "/clientes/1": {"id": 1, "nome": "ACME"},
    "/equipamentos": [{"id": 2, "descricao": "Phoebus"}],
}


@pytest.fixture
def gestor(chave, monkeypatch):
    """GestorHS falso + `criar_pendente` capturado. Escrita (não-GET) aqui é defeito."""
    estado = {"reqs": [], "pendentes": [], "frota": {"items": [], "total": 0}}

    def h(req):
        estado["reqs"].append(req)
        if req.method != "GET":
            return httpx.Response(500, json={"detail": "escrita antes do cartão"})
        if req.url.path == "/equipamentos-cliente":
            return httpx.Response(200, json=estado["frota"])
        if req.url.path in _LEITURAS:
            return httpx.Response(200, json=_LEITURAS[req.url.path])
        return httpx.Response(404, json={"detail": "não encontrado"})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))

    async def pendente(conn, dono, bot, sistema, acao, payload, resumo):
        estado["pendentes"].append((sistema, acao, payload, resumo))
        return "a1"
    monkeypatch.setattr(mcp_bot.acoes, "criar_pendente", pendente)
    return estado


def _ferramenta(nome, args, ctx=_CTX):
    return asyncio.run(mcp_bot._gestorhs(object(), "ana-bot", nome, args, ctx))


def test_ferramentas_de_escrita_no_guardi():
    """Fora de `FERRAMENTAS_BOT`, o `toolFilter.include` não as lista e o Guardi
    nunca as vê — mesmo com o servidor respondendo."""
    assert set(_ESCRITAS) <= set(FERRAMENTAS_BOT)
    assert set(_ESCRITAS) <= {f["name"] for f in FERRAMENTAS}


def test_escrita_sem_gestorhs_ligado_recusa_sem_rede(gestor):
    """Sem a flag, nada sai — nem a leitura de conferência."""
    ctx = {**_CTX, "sistemas": ["taskhs"]}
    for nome in _ESCRITAS:
        with pytest.raises(mcp_bot._Recusa):
            _ferramenta(nome, {"caixa": 40, "aparelhos": [{"id": 5, "tipo_servico": "C"}]}, ctx)
    assert gestor["reqs"] == [] and gestor["pendentes"] == []


def test_receber_grava_cartao_com_cliente_em_cada_linha(gestor):
    """A série falada pode bater com aparelho de outro cliente; o cartão é a
    última chance de a pessoa ver isso."""
    t = _ferramenta("gestorhs_receber", {"aparelhos": [
        {"id": 5, "tipo_servico": "C", "acessorios": [8]}, {"id": 6, "tipo_servico": "M"}]})
    assert "Aguardando Ana confirmar" in t
    sistema, acao, payload, resumo = gestor["pendentes"][0]
    assert (sistema, acao) == ("gestorhs", "receber")
    assert payload["caixa"] is None and payload["aparelhos"][0]["equipamento_cliente"] == 5
    ex = payload["_exibir"]
    assert [l["cliente"] for l in ex["linhas"]] == ["ACME", "Beta Ltda"]
    assert ex["linhas"][0]["acessorios"] == ["Maleta"]
    assert ex["caixa"] == "caixa nova" and ex["clientes"] == 2 and ex["aviso"] is None
    assert resumo == "Receber 2 aparelhos (caixa nova)"
    assert all(q.method == "GET" for q in gestor["reqs"])


def test_receber_em_caixa_fora_de_recebido_avisa(gestor):
    """Decisão do Erick (12/11): a OS entra na fase em que a caixa está — o cartão
    tem que dizer, senão a OS "some" do Recebido e a Expedição a procura."""
    _ferramenta("gestorhs_receber", {"caixa": 40, "aparelhos": [{"id": 6, "tipo_servico": "C"}]})
    ex = gestor["pendentes"][0][2]["_exibir"]
    assert ex["caixa"] == "caixa 40" and "Laboratório" in ex["aviso"]
    assert ex["clientes"] == 2     # ACME já na caixa + Beta chegando


def test_receber_com_os_ativa_nao_grava_cartao(gestor):
    """O 409 do GestorHS viria no clique, no meio do lote, com OS já abertas."""
    with pytest.raises(ValueError, match="F8"):
        _ferramenta("gestorhs_receber", {"aparelhos": [{"id": 5, "tipo_servico": "C"},
                                                       {"id": 8, "tipo_servico": "C"}]})
    assert gestor["pendentes"] == []


def test_receber_aparelho_inexistente_diz_como_achar(gestor):
    with pytest.raises(mcp_bot._Recusa, match="q=<série>"):
        _ferramenta("gestorhs_receber", {"aparelhos": [{"id": 777, "tipo_servico": "C"}]})
    assert gestor["pendentes"] == []


def test_avancar_pede_principal_e_confere_que_e_da_caixa(gestor):
    """Cliente principal que não está na caixa daria 409 no clique — ou pior,
    uma proposta para o cliente errado."""
    with pytest.raises(ValueError, match="cliente_principal"):
        _ferramenta("gestorhs_avancar_caixa", {"caixa": 41})
    with pytest.raises(mcp_bot._Recusa):
        _ferramenta("gestorhs_avancar_caixa", {"caixa": 41, "cliente_principal": 99})
    _ferramenta("gestorhs_avancar_caixa", {"caixa": 41, "cliente_principal": 2, "obs": "ok"})
    _s, acao, payload, resumo = gestor["pendentes"][0]
    assert acao == "avancar_caixa" and payload["cliente_principal"] == 2 and payload["obs"] == "ok"
    assert payload["_exibir"]["cliente_principal"] == "Beta Ltda"
    assert payload["_exibir"]["funcao"] == "Expedição" and "Recebido" in resumo


def test_avancar_em_preparando_manda_fechar(gestor):
    with pytest.raises(ValueError, match="gestorhs_fechar_caixa"):
        _ferramenta("gestorhs_avancar_caixa", {"caixa": 42})
    assert gestor["pendentes"] == []


def test_fechar_fora_de_preparando_recusa_e_em_preparando_prepara(gestor):
    """É a conferência combinada para o `erick-bot` antes da primeira escrita
    real: fechar caixa fora de Preparando Retorno recusa antes do cartão."""
    with pytest.raises(ValueError, match="Preparando Retorno"):
        _ferramenta("gestorhs_fechar_caixa", {"caixa": 40, "cod_retorno": "BR1"})
    _ferramenta("gestorhs_fechar_caixa", {"caixa": 42, "cod_retorno": "BR123"})
    _s, acao, payload, resumo = gestor["pendentes"][0]
    assert acao == "fechar_caixa" and payload["cod_retorno"] == "BR123" and "sem_nota_fiscal" not in payload
    assert payload["_exibir"]["total_os"] == 1


def test_cadastrar_recusa_serie_existente_e_prepara_a_nova(gestor):
    gestor["frota"] = {"items": [{"id": 3, "serie": "F 123", "cliente_nome": "Beta Ltda"}], "total": 1}
    with pytest.raises(ValueError, match="Beta Ltda"):
        _ferramenta("gestorhs_cadastrar_aparelho", {"cliente": 1, "equipamento": 2, "serie": "f123"})
    gestor["frota"] = {"items": [], "total": 0}
    _ferramenta("gestorhs_cadastrar_aparelho", {"cliente": 1, "equipamento": 2, "serie": "F9"})
    _s, acao, payload, _r = gestor["pendentes"][0]
    assert acao == "cadastrar_aparelho"
    assert payload == {"cliente": 1, "equipamento": 2, "serie": "F9",
                       "_exibir": {"cliente": "ACME", "modelo": "Phoebus"}}
    with pytest.raises(mcp_bot._Recusa, match="modelo"):
        _ferramenta("gestorhs_cadastrar_aparelho", {"cliente": 1, "equipamento": 3, "serie": "F10"})


def test_descricao_do_receber_manda_perguntar_se_veio_tudo_igual():
    """Decisão 3 do Erick: depende do cliente, então nada de assumir. A regra
    mora onde o agente lê — a descrição da ferramenta."""
    d = next(f for f in FERRAMENTAS if f["name"] == "gestorhs_receber")["description"]
    assert "tudo igual" in d and "NÃO executa" in d
