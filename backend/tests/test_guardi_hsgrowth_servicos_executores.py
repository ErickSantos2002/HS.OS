"""Executores do clique do Guardi no HSGrowth Serviços (12/11/2026).

Cada teste tranca um defeito que escreveria errado no CRM ou esconderia o que
ficou pela metade.
"""
import asyncio
import json as j

import httpx
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import acoes
from app import agente_token as at
from app.sistemas import hsgrowth

C = "/service-boards/1/cards/7"
LINK = "https://hsgrowth.healthsafetytech.com/servicos/1/cards/7"
PDF = "https://gestorhsapi.healthsafetytech.com/publico/proposta/5?t=x"


@pytest.fixture(autouse=True)
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)


def _rodar(monkeypatch, acao, payload, respostas=None, card=None, pdf=None):
    reqs = []
    respostas = respostas or {}
    card = card if card is not None else {"id": 7, "list_id": 10, "business_info": {}}

    def h(req):
        caminho = req.url.path.removeprefix("/api/v1")
        corpo = None
        if req.content and "multipart" not in req.headers.get("content-type", ""):
            corpo = j.loads(req.content)
        reqs.append((req.method, caminho, corpo, req))
        r = respostas.get((req.method, caminho))
        if callable(r):
            return r()
        if req.method == "GET" and caminho == C:
            return httpx.Response(200, json=card)
        return httpx.Response(200, json=r if r is not None else {"id": 1})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    if pdf is not None:
        monkeypatch.setattr(acoes, "_transporte_pdf", httpx.MockTransport(pdf))
    try:
        out = asyncio.run(acoes.EXECUTORES[("hsgrowth_servicos", acao)]("a@hs.com", "a-bot", payload, "u1"))
    except hsgrowth.ErroSistema as e:
        out = e
    return out, reqs


def _escritas(reqs):
    return [(m, c) for m, c, _, _ in reqs if m != "GET"]


BASE = {"board_id": 1, "card_id": 7, "_exibir": {"link": LINK}}


def test_registrar_recusa_se_a_etapa_mudou(monkeypatch):
    """Sem conferir a etapa, o card que outra pessoa já moveu seria movido de novo
    com base num cartão velho."""
    p = {**BASE, "campos": {"title": "x"}, "mover": {"de": 99, "para": 11}}
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    assert isinstance(out, hsgrowth.ErroSistema) and "mexeu" in str(out)
    assert _escritas(reqs) == []


def test_negocio_mescla_com_o_que_outro_gravou(monkeypatch):
    """Gravar só as chaves do cartão apagaria o que alguém preencheu depois dele."""
    card = {"id": 7, "list_id": 10, "business_info": {"order_number": 5}}
    p = {**BASE, "negocio": {"service_type": "recalibracao"}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p, card=card)
    put = next(r for r in reqs if r[0] == "PUT")
    assert put[2] == {"business_info": {"order_number": 5, "service_type": "recalibracao"}}


def test_put_sai_da_allowlist(monkeypatch):
    """Payload adulterado com list_id/is_deleted/assigned_to_id/contact_info não
    pode chegar ao CRM (mover só pelo /move; contact_info foi vetado)."""
    p = {**BASE, "campos": {"title": "T", "list_id": 9, "is_deleted": True, "assigned_to_id": 3,
                            "contact_info": {"x": 1}}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    put = next(r for r in reqs if r[0] == "PUT")
    assert put[2] == {"title": "T"}


def test_contact_info_nao_chega_ao_hsgrowth(monkeypatch):
    """contact_info sozinho não pode virar PUT: seria escrita de contato por fora da tela."""
    p = {**BASE, "campos": {"contact_info": {"email": "a@b.c"}}}
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    assert _escritas(reqs) == []
    assert all("contact_info" not in (r[2] or {}) for r in reqs)


def test_ordem_campos_atividades_mover(monkeypatch):
    """Mover antes de gravar o Resumo deixaria o card numa etapa que exige o que
    ainda não foi gravado."""
    p = {**BASE, "campos": {"title": "T"}, "mover": {"de": 10, "para": 11},
         "atividades": [{"op": "criar", "category": "anotacao", "description": "n"},
                        {"op": "criar", "category": "atividade", "activity_type": "call", "title": "Lig"}]}
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    assert _escritas(reqs) == [("PUT", C), ("POST", C + "/activities"), ("POST", C + "/activities"),
                               ("PUT", C + "/move")]
    assert reqs[-1][2] == {"list_id": 11}
    assert LINK in out


def test_concluir_envia_valida(monkeypatch):
    """`is_valid` decide pontos de gamificação: nunca pode ser omitido nem presumido."""
    p = {**BASE, "atividades": [{"op": "concluir", "activity_id": 4, "valida": False}]}
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    r = next(r for r in reqs if r[0] == "PATCH")
    assert r[1] == C + "/activities/4/complete" and r[2] == {"is_completed": True, "is_valid": False}
    p = {**BASE, "atividades": [{"op": "concluir", "activity_id": 4}]}
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p)
    assert isinstance(out, hsgrowth.ErroSistema) and _escritas(reqs) == []


def test_perder_anota_motivo_e_move(monkeypatch):
    """Perder sem anotar o motivo deixa o card encerrado sem explicação."""
    p = {**BASE, "de": 10, "para": 13, "motivo": "Sem budget aprovado"}
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_perder", p)
    assert _escritas(reqs) == [("POST", C + "/activities"), ("PUT", C + "/move")]
    assert reqs[1][2] == {"category": "anotacao", "description": "Motivo da perda: Sem budget aprovado"}


def test_ganhar_confere_etapa(monkeypatch):
    """Ganhar com cartão velho ganharia um card que já andou."""
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_ganhar", {**BASE, "de": 99, "para": 12})
    assert isinstance(out, hsgrowth.ErroSistema) and _escritas(reqs) == []
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_ganhar", {**BASE, "de": 10, "para": 12})
    assert _escritas(reqs) == [("PUT", C + "/move")]


def test_itens_usa_rotas_e_allowlist(monkeypatch):
    """Item com chave estranha no corpo (ex.: aparelhos) não pode ir ao CRM."""
    p = {**BASE, "ops": [
        {"tipo": "aparelho", "acao": "por", "corpo": {"product_id": 2, "quantity": 1, "unit_price": 5, "aparelhos": [1]}},
        {"tipo": "servico", "acao": "alterar", "item_id": 8, "corpo": {"quantity": 2}},
        {"tipo": "servico", "acao": "tirar", "item_id": 9}]}
    _, reqs = _rodar(monkeypatch, "hsgrowth_servicos_itens", p)
    assert _escritas(reqs) == [("POST", C + "/products"), ("PUT", C + "/services/8"),
                               ("DELETE", C + "/services/9")]
    assert reqs[0][2] == {"product_id": 2, "quantity": 1, "unit_price": 5}


def _pdf_ok(req):
    return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF-1.4 x")


ANEXO = {**BASE, "numero": 5, "link_pdf": PDF, "nome_arquivo": "Proposta 5.pdf"}


def test_anexar_recusa_host_de_fora(monkeypatch):
    """Baixar de host qualquer faria o servidor ser proxy de SSRF para a rede interna."""
    for url in ("https://evil.example/x.pdf", "http://gestorhsapi.healthsafetytech.com/x"):
        out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_anexar_proposta",
                           {**ANEXO, "link_pdf": url}, pdf=_pdf_ok)
        assert isinstance(out, hsgrowth.ErroSistema) and reqs == []


def test_anexar_recusa_redirect(monkeypatch):
    """Seguir redirect furaria a checagem de host."""
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_anexar_proposta", ANEXO,
                       pdf=lambda r: httpx.Response(302, headers={"location": "http://169.254.169.254/"}))
    assert isinstance(out, hsgrowth.ErroSistema) and reqs == []


def test_anexar_recusa_mais_de_10mb(monkeypatch):
    """Sem teto, um link gigante enche a memória do worker."""
    big = lambda r: httpx.Response(200, headers={"content-type": "application/pdf"},
                                   content=b"%PDF" + b"0" * (10 * 1024 * 1024))
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_anexar_proposta", ANEXO, pdf=big)
    assert isinstance(out, hsgrowth.ErroSistema) and "10 MB" in str(out) and reqs == []


def test_anexar_recusa_o_que_nao_e_pdf(monkeypatch):
    """HTML de erro anexado ao card como 'proposta'."""
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_anexar_proposta", ANEXO,
                       pdf=lambda r: httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>"))
    assert isinstance(out, hsgrowth.ErroSistema) and reqs == []


def test_anexar_envia_multipart_no_slot_proposta(monkeypatch):
    """Sem slot=proposta o arquivo vira anexo solto e não aparece no Resumo."""
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_anexar_proposta", ANEXO, pdf=_pdf_ok)
    m, c, _, req = reqs[0]
    assert (m, c) == ("POST", C + "/activities/files")
    assert req.url.params["slot"] == "proposta"
    assert "multipart/form-data" in req.headers["content-type"]
    assert b'name="file"; filename="Proposta 5.pdf"' in req.content and b"%PDF-1.4" in req.content
    assert LINK in out


def test_lote_para_e_diz_o_que_entrou(monkeypatch):
    """Falha no meio sem dizer o que já entrou levaria a repetir e duplicar atividade."""
    p = {**BASE, "campos": {"title": "T"}, "atividades": [{"op": "criar", "category": "anotacao", "description": "n"}]}
    out, reqs = _rodar(monkeypatch, "hsgrowth_servicos_registrar", p,
                       respostas={("POST", C + "/activities"): lambda: httpx.Response(422, json={"detail": "ruim"})})
    assert isinstance(out, hsgrowth.ErroSistema)
    assert "Parou em anotacao (2 de 2)" in str(out) and "campos do card" in str(out)
