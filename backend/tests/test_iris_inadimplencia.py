"""Iris → Inadimplência do DataCore (spec 2026-11-10-iris-inadimplencia).

A `iris` montava "vencido" lendo `tiny.contas_receber` e avisava que aquilo
não era inadimplência — a régua (30 dias de carência, faixas, cobrança) mora no
DataCore. Agora ela lê a API de lá, como o Nicholson. O que se tranca:
- o token vai com `aud=datacore`, `sub` do Nicholson e `act` da iris — nunca
  um e-mail vindo de argumento do agente;
- o texto repete os números que o DataCore deu: nada é recalculado aqui;
- a lista sai inteira (todas as páginas) numa planilha, e o modelo recebe só
  totais e as 10 maiores — lista longa no texto estoura o teto de saída.
"""
import asyncio
import io

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from openpyxl import load_workbook

from app import agente_token as at
from app.relatorios import inadimplencia as inad
from app.sistemas import datacore


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def test_cliente_manda_token_do_datacore_como_o_nicholson(chave, monkeypatch):
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"ok": 1})
    monkeypatch.setattr(datacore, "_transporte", httpx.MockTransport(h))
    asyncio.run(datacore.chamar_como_iris("GET", "/inadimplencia/resumo"))
    assert reqs[0].url.path.endswith("/inadimplencia/resumo")
    token = reqs[0].headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="datacore")
    assert d["sub"] == "np@healthsafetytech.com" and d["act"] == {"sub": "iris"}


def test_401_diz_que_o_datacore_nao_aceitou(chave, monkeypatch):
    monkeypatch.setattr(datacore, "_transporte", httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(datacore.ErroSistema) as e:
        asyncio.run(datacore.chamar_como_iris("GET", "/inadimplencia/resumo"))
    assert "DataCore" in str(e.value)


RESUMO = {
    "total_a_receber": 2276875.49, "total_vencido": 1141135.73, "em_atraso": 141135.73,
    "inadimplente": 1000000.0, "inadimplencia_carteira": 0.4392, "recuperado": None,
    "titulos_vencidos": 403, "titulos_inadimplentes": 300, "empresas_inadimplentes": 120,
    "faixas": [{"faixa": "atraso", "titulos": 103, "empresas": 40, "valor": 141135.73},
               {"faixa": "90_mais", "titulos": 200, "empresas": 90, "valor": 800000.0}],
    "sem_contato": 70, "promessas_7_dias": 3, "promessas_quebradas": 2, "em_negociacao": 5,
}
INDICADORES = {"ultimo_fechado": {"mes": "2026-10", "taxa": 0.051, "valor": 1, "inadimplente": 1,
                                  "titulos": 1, "titulos_inadimplentes": 1, "em_apuracao": False},
               "media_12_meses": 0.047}


def test_resumo_repete_os_numeros_do_datacore():
    t = inad.texto_do_resumo(RESUMO, INDICADORES)
    assert "R$ 1.000.000,00" in t and "43,9%" in t and "120 empresas" in t
    assert "R$ 141.135,73" in t and "5,1%" in t and "4,7%" in t
    assert "DataCoreHS" in t


def test_lista_le_todas_as_paginas():
    paginas = {0: {"itens": [{"empresa": "a"}] * 1000, "total": 1500},
               1000: {"itens": [{"empresa": "b"}] * 500, "total": 1500}}

    async def buscar(offset):
        return paginas[offset]
    assert len(asyncio.run(inad.todas_as_empresas(buscar))) == 1500


EMPRESAS = [{"empresa": f"e{i}", "nome": f"Cliente {i}", "documento": "00.000.000/0001-00",
             "filiais": 1, "titulos": 2, "valor_devido": 1000.0 * (20 - i),
             "valor_inadimplente": 900.0 * (20 - i), "maior_atraso": 40 + i, "status": "promessa",
             "proxima_data": "2026-11-20", "ultimo_contato": None} for i in range(15)]


def test_planilha_tem_uma_linha_por_empresa():
    ws = load_workbook(io.BytesIO(inad.planilha(EMPRESAS))).active
    assert ws.max_row == 1 + len(EMPRESAS)
    assert ws.cell(1, 1).value == "Cliente" and ws.cell(2, 1).value == "Cliente 0"


def test_texto_da_lista_tem_totais_e_so_as_10_maiores():
    t = inad.texto_da_lista(EMPRESAS, "inad.xlsx")
    assert "15 empresas" in t and "Cliente 9" in t and "Cliente 10" not in t
    assert "não reescreva" in t.lower()


def test_ferramenta_registrada_no_hsos_relatorios():
    """A régua escrita na `description` é o que o agente lê — regra no
    docstring não chega a ele (lição da `publicar_pagina`, 08/09/2026)."""
    from app.routers import relatorios
    f = next(x for x in relatorios._FERRAMENTAS if x["name"] == "inadimplencia")
    assert set(f["inputSchema"]["properties"]["modo"]["enum"]) == {"resumo", "lista"}
    d = f["description"].lower()
    assert "datacore" in d and "não calcule" in d
