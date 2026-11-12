"""Guardi no GestorHS, fase 2b (Laboratório, 12/11/2026): certificado por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-laboratorio-design.md`.
O técnico fala os números da calibração e confirma um cartão que gera o
certificado (e, no GestorHS, conclui o aparelho no laboratório). O que se
tranca aqui:
- leitura que não é leitura ("181", "um oito um") é recusada ANTES do cartão:
  número errado num certificado é documento da Qualidade errado;
- a média é do SERVIDOR, arredondada como quem faz à mão (meio para cima) —
  o modelo nunca faz a conta;
- o payload nunca leva override de cabeçalho (nome do cliente, CNPJ, série):
  763 OS têm cabeçalho ajustado pela tela;
- regerar avisa que substitui e mostra a data antiga, não "hoje";
- avançar caixa no Laboratório com aparelho sem certificado recusa listando
  quais faltam, sem cartão que o GestorHS recusaria no clique.
"""
import pytest

from app import gestorhs_escrita as ge


# --- regras puras -----------------------------------------------------------------

def test_leitura_normaliza_e_recusa_o_que_nao_e_leitura():
    """Número errado num certificado é documento da Qualidade errado. "181" é o
    técnico falando "um oito um": aceitar viraria 181,000 no certificado."""
    assert ge.leitura("0,181") == "0,181" and ge.leitura("0.18") == "0,180" and ge.leitura(",181") == "0,181"
    assert ge.leitura(" 0,2 ") == "0,200"
    for ruim in ("181", "abc", "-0,1", "12,5", "", None, "0,1815", "0,1,8", True, "1e-1"):
        with pytest.raises(ValueError):
            ge.leitura(ruim)


def test_media_bate_com_os_certificados_reais():
    """As duas primeiras são certificados reais do GestorHS. A terceira dá
    0,1718, que em 3 casas é 0,172, como o técnico faz à mão. A conta é em
    `Decimal` com meio-para-cima: em float, "0,170" já não é 0,170."""
    assert ge.media(["0,170", "0,170", "0,170", "0,180", "0,190"]) == "0,176"
    assert ge.media(["0,186", "0,180", "0,184", "0,190", "0,190"]) == "0,186"
    assert ge.media(["0,171", "0,172", "0,172", "0,172", "0,172"]) == "0,172"   # 0,1718
    with pytest.raises(ValueError):
        ge.media(["0,170"] * 4)


def test_numero_ambiente_grava_com_ponto():
    """O banco guarda "22.0" e "1017.3" (formato dos certificados reais): com
    vírgula o PDF sairia diferente dos outros 2.909."""
    assert ge.numero_ambiente("22", "temperatura") == "22.0"
    assert ge.numero_ambiente("22,5", "temperatura") == "22.5"
    assert ge.numero_ambiente("1017,3", "pressao") == "1017.3"
    assert ge.numero_ambiente("1017,35", "pressao") == "1017.35"
    assert ge.numero_ambiente(22, "temperatura") == "22.0"
    for ruim in ("", None, "vinte", "22 graus", "-3", True):
        with pytest.raises(ValueError, match="temperatura"):
            ge.numero_ambiente(ruim, "temperatura")


def test_os_fora_do_laboratorio_ou_so_manutencao_recusa():
    """Fora do Laboratório o gerar não conclui nada e o técnico acharia que
    concluiu; OS só de manutenção não tem leitura para registrar."""
    campos = {"data_calibracao": None}
    with pytest.raises(ValueError, match="Laboratório"):
        ge.conferir_os_para_certificado({"id": 1, "fase": 4, "tipo_servico": "C"}, campos, [])
    with pytest.raises(ValueError, match="manutenção"):
        ge.conferir_os_para_certificado({"id": 1, "fase": 5, "tipo_servico": "M"}, campos, [])


def test_primeiro_certificado_sai_com_data_de_hoje():
    ex = ge.conferir_os_para_certificado(
        {"id": 11700, "fase": 5, "tipo_servico": "A", "cliente_nome": "ACME\nOS: 1",
         "equipamento_descricao": "Phoebus", "equipamento_serie": "F006097"},
        {"data_calibracao": None}, [])
    assert ex == {"os": 11700, "cliente": "ACME OS: 1", "modelo": "Phoebus", "serie": "F006097",
                  "data": "hoje", "substitui": False, "tipo": "calibração e manutenção",
                  "manutencao": True}


def test_regerar_mostra_a_data_antiga_e_avisa_que_substitui():
    """Regerar mantém a data (e com ela o cilindro congelado). O cartão dizendo
    "hoje" faria o técnico achar que o certificado ganhou data nova."""
    ex = ge.conferir_os_para_certificado(
        {"id": 1, "fase": 5, "tipo_servico": "C", "cliente_nome": "ACME",
         "equipamento_descricao": "Phoebus", "equipamento_serie": "F1"},
        {"data_calibracao": "2026-11-10"}, [{"tipo": "C"}])
    assert ex["data"] == "2026-11-10" and ex["substitui"] is True and ex["manutencao"] is False


def test_payload_nunca_leva_override_de_cabecalho():
    """Corpo com override zeraria (ou trocaria) o cabeçalho ajustado pela tela."""
    p = ge.payload_do_certificado({"cert": "HF1", "temperatura": "22", "pressao": "1017,3",
                                   "leituras": ["0,17"] * 5, "nomecli": "X"}, 9)
    assert p["ordem"] == 9 and p["calib_cert"] == "HF1"
    assert p["calib_temp"] == "22.0" and p["calib_pressao"] == "1017.3"
    assert [p[f"calib_teste{i}"] for i in range(1, 6)] == ["0,170"] * 5
    assert p["calib_teste_media"] == "0,170" and p["calib_situacao"] == "Aparelho subsequente"
    assert "data_calibracao" not in p
    assert not {"nomecli", "cnpj", "endcli", "serie", "modelo", "marca", "patrimonio", "datacompra"} & set(p)


def test_payload_valida_codigo_situacao_data_e_leituras():
    base = {"cert": "HF1", "temperatura": "22", "pressao": "1017", "leituras": ["0,17"] * 5}
    p = ge.payload_do_certificado({**base, "situacao": "Aparelho inicial", "data_calibracao": "2026-11-11"}, 9)
    assert p["calib_situacao"] == "Aparelho inicial" and p["data_calibracao"] == "2026-11-11"
    for ruim in ({**base, "cert": ""}, {**base, "cert": "X" * 31}, {**base, "cert": "HF\n1"},
                 {**base, "situacao": "Novo"}, {**base, "data_calibracao": "11/11/2026"},
                 {**base, "leituras": ["0,17"] * 4}, {**base, "leituras": "0,17"},
                 {**base, "leituras": ["0,17"] * 4 + ["181"]}, {**base, "pressao": "mil"}):
        with pytest.raises(ValueError):
            ge.payload_do_certificado(ruim, 9)
