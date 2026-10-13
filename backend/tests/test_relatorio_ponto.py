# backend/tests/test_relatorio_ponto.py
"""A régua do ponto do Flash — a da coordenadora de RH, não a nossa.

Levantada em 13/10/2026 das planilhas de setembro que ela monta à mão e das
respostas dela por WhatsApp: a planilha dela colava o CSV sem mexer, calculava
o "Controle Principal" por fórmula (149 de 150 células reproduzidas) e fazia o
resumo para o CEO com uma régua mais tolerante (128 de 150). Ver
`docs/superpowers/specs/2026-10-13-relatorio-ponto-design.md`.

⚠️ **Os dados aqui são inventados.** O repositório é público e a planilha real
traz nome, matrícula e horário de cada funcionário.
"""
from datetime import date

import pytest

from app.relatorios import ponto as p

CAB_MARC = ["Nome", "Matrícula", "Filial", "Departamento", "Centro de Custo", "Data da Marcação"]
for _i in range(1, 7):
    CAB_MARC += [f"Tipo Marcação {_i}", f"Motivo Marcação {_i}", f"Justificativa {_i}",
                 f"Status Marcação {_i}", f"Hora da Marcação {_i}"]
CAB_BANCO = ["Ano", "Mês", "Matrícula", "Nome", "Cargo", "Filial", "Nome Departamento",
             "Código Centro de Custo", "Nome Gestor", "Saldo banco anterior",
             "Saldo banco no periodo", "Saldo banco total"]


def marc(nome, matricula, data, *batidas, depto="LABORATÓRIO"):
    """Uma linha de marcações. Cada batida é "HH:MM" ou (hora, tipo, motivo, justificativa)."""
    linha = [nome, matricula, "MATRIZ", depto, "", data]
    for b in batidas:
        hora, tipo, motivo, just = (b, "Original", "", "") if isinstance(b, str) else b
        linha += [tipo, motivo, just, "Aprovado" if tipo == "Justificada" else "", hora]
    linha += [""] * (len(CAB_MARC) - len(linha))
    return linha


def csv(cab, linhas, bom=True, codif="utf-8"):
    texto = "\n".join(";".join(l) for l in [cab] + linhas) + "\n"
    return (("﻿" if bom else "") + texto).encode(codif)


def banco(*pessoas):
    """pessoas: (nome, matricula, saldo_total)."""
    return csv(CAB_BANCO, [["2026", "9", m, n, "Analista", "MATRIZ", "LABORATÓRIO", "",
                            "GESTOR FICTICIO", "00:00", "00:00", s] for n, m, s in pessoas])


def rel(linhas_marc, pessoas_banco=(("Ana Teste", "000001", "01:00"),)):
    return p.gerar([("m.csv", csv(CAB_MARC, linhas_marc)), ("b.csv", banco(*pessoas_banco))])


def pessoa(r, nome="Ana Teste"):
    return next(x for x in r.pessoas if x.nome == nome)


# ── leitura ─────────────────────────────────────────────────────────────────

def test_reconhece_os_dois_arquivos_pelo_cabecalho_em_qualquer_ordem():
    m = csv(CAB_MARC, [marc("Ana Teste", "000001", "01/09/2026", "07:30", "12:00", "13:00", "17:00")])
    b = banco(("Ana Teste", "000001", "01:00"))
    assert p.identificar("x.csv", m)[0] == "marcacoes"
    assert p.identificar("y.csv", b)[0] == "banco"
    r = p.gerar([("y.csv", b), ("x.csv", m)])
    assert (r.mes, r.ano) == (9, 2026) and len(r.pessoas) == 1


def test_cabecalho_desconhecido_nomeia_o_arquivo():
    with pytest.raises(p.ErroPonto, match="planilha.csv"):
        p.identificar("planilha.csv", b"a;b;c\n1;2;3\n")


def test_falta_um_dos_dois_arquivos_diz_qual():
    m = csv(CAB_MARC, [marc("Ana Teste", "000001", "01/09/2026", "07:30")])
    with pytest.raises(p.ErroPonto, match="banco de horas"):
        p.gerar([("a.csv", m), ("b.csv", m)])


def test_le_csv_sem_bom_e_em_latin1():
    linhas = [marc("Joana Ação", "000001", "01/09/2026", "07:30", "12:00", "13:00", "17:00")]
    for dados in (csv(CAB_MARC, linhas, bom=False), csv(CAB_MARC, linhas, bom=False, codif="latin-1")):
        tipo, registros = p.identificar("m.csv", dados)
        assert tipo == "marcacoes" and registros[0]["Nome"] == "Joana Ação"


def test_hora_com_segundos_conta_como_minuto():
    r = rel([marc("Ana Teste", "000001", "01/09/2026", "07:29:00", "12:00", "13:00", "17:00")])
    assert pessoa(r).originais["entrada_antecipada"] == 0


def test_mais_de_um_mes_e_recusado():
    with pytest.raises(p.ErroPonto, match="09/2026.*10/2026|10/2026.*09/2026"):
        rel([marc("Ana Teste", "000001", "30/09/2026", "07:30"),
             marc("Ana Teste", "000001", "01/10/2026", "07:30")])


def test_teto_de_linhas():
    linhas = [marc("Ana Teste", "000001", "01/09/2026", "07:30")] * (p.TETO_LINHAS + 1)
    with pytest.raises(p.ErroPonto, match="linhas"):
        rel(linhas)


# ── a régua, na fronteira exata ─────────────────────────────────────────────

@pytest.mark.parametrize("entrada,orig_ant,anal_ant,orig_atr,anal_atr", [
    ("07:19", 1, 1, 0, 0),
    ("07:20", 1, 0, 0, 0),
    ("07:28", 1, 0, 0, 0),
    ("07:29", 0, 0, 0, 0),
    ("07:45", 0, 0, 0, 0),
    ("07:46", 0, 0, 1, 0),
    ("07:49", 0, 0, 1, 0),
    ("07:50", 0, 0, 1, 1),
])
def test_limites_da_entrada(entrada, orig_ant, anal_ant, orig_atr, anal_atr):
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026", entrada, "12:00", "13:00", "17:00")]))
    assert a.originais["entrada_antecipada"] == orig_ant and a.analisadas["entrada_antecipada"] == anal_ant
    assert a.originais["atraso"] == orig_atr and a.analisadas["atraso"] == anal_atr


@pytest.mark.parametrize("saida,orig_ant,anal_ant,orig_apos,anal_apos", [
    ("16:48", 1, 1, 0, 0),
    ("16:49", 1, 0, 0, 0),
    ("16:58", 1, 0, 0, 0),
    ("16:59", 0, 0, 0, 0),
    ("17:01", 0, 0, 0, 0),
    ("17:02", 0, 0, 1, 0),
    ("17:19", 0, 0, 1, 0),
    ("17:20", 0, 0, 1, 1),
])
def test_limites_da_saida(saida, orig_ant, anal_ant, orig_apos, anal_apos):
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026", "07:30", "12:00", "13:00", saida)]))
    assert a.originais["saida_antecipada"] == orig_ant and a.analisadas["saida_antecipada"] == anal_ant
    assert a.originais["apos_jornada"] == orig_apos and a.analisadas["apos_jornada"] == anal_apos


@pytest.mark.parametrize("volta,menor,maior", [("12:59", 1, 0), ("13:00", 0, 0), ("13:01", 0, 1)])
def test_intervalo_e_terceira_menos_segunda(volta, menor, maior):
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026", "07:30", "12:00", volta, "17:00")]))
    assert (a.originais["intervalo_menor"], a.originais["intervalo_maior"]) == (menor, maior)
    assert (a.analisadas["intervalo_menor"], a.analisadas["intervalo_maior"]) == (menor, maior)


def test_dia_de_seis_batidas_usa_a_ultima_como_saida():
    """A planilha dela pegava sempre a 4ª — o que erra quando a pessoa sai e
    volta no meio do dia. Ela corrigia à mão; confirmado em 13/10/2026."""
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026",
                         "07:30", "12:00", "13:00", "15:00", "15:30", "17:30")]))
    assert a.originais["saida_antecipada"] == 0
    assert a.originais["apos_jornada"] == 1 and a.analisadas["apos_jornada"] == 1


def test_dia_de_duas_batidas_nao_avalia_intervalo_nem_saida():
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026", "07:30", "11:00")]))
    assert all(a.originais[k] == 0 for k in p.INDICADORES)


def test_ocorrencia_registra_em_qual_regua_conta():
    r = rel([marc("Ana Teste", "000001", "02/09/2026", "07:25", "12:00", "13:00", "17:00")])
    [o] = r.ocorrencias
    assert (o.indicador, o.minutos, o.original, o.analisada) == ("entrada_antecipada", 7 * 60 + 25, True, False)
    assert o.data == date(2026, 9, 2)


# ── ajustes ─────────────────────────────────────────────────────────────────

def test_ajuste_por_trabalho_nao_conta_e_o_resto_conta():
    j = lambda h, mot, just: (h, "Justificada", mot, just)
    r = rel([marc("Ana Teste", "000001", "01/09/2026",
                  j("07:30", "Ajuste de horário", "Externo"),
                  j("12:00", "Home Office", ""),
                  j("13:00", "Esquecimento de marcação", "Voltei logo pra resolver um problema de atendimento ao cliente"),
                  j("17:00", "Esquecimento de marcação", "Esqueci"))])
    assert [a.conta for a in r.ajustes] == [False, False, False, True]
    assert [a.marcacao for a in r.ajustes] == ["Entrada", "Saída para intervalo", "Retorno do intervalo", "Saída"]
    assert pessoa(r).ajustes == 1


def test_viagem_com_acento_e_maiuscula_nao_conta():
    r = rel([marc("Ana Teste", "000001", "01/09/2026", ("07:30", "Justificada", "Ajuste de horário", "VIAGEM a São Paulo"))])
    assert r.ajustes[0].conta is False


# ── por pessoa ──────────────────────────────────────────────────────────────

def _dias_com_atraso(n, nome="Ana Teste", matricula="000001", saida="17:00", volta="13:00"):
    return [marc(nome, matricula, f"{d:02d}/09/2026", "07:55", "12:00", volta, saida) for d in range(1, n + 1)]


@pytest.mark.parametrize("linhas,status,padrao", [
    (_dias_com_atraso(9), "REGULAR", ""),
    (_dias_com_atraso(10), "ACOMPANHAMENTO", "Atraso recorrente"),
    (_dias_com_atraso(10, volta="12:30"), "ATENÇÃO", "Atraso recorrente + Intervalo reduzido recorrente"),
    (_dias_com_atraso(10, volta="12:30", saida="17:30"), "CRÍTICO",
     "Atraso recorrente + Intervalo reduzido recorrente + Permanência após jornada recorrente"),
])
def test_status_e_padrao(linhas, status, padrao):
    a = pessoa(rel(linhas))
    assert (a.status, a.padrao) == (status, padrao)


def test_saldo_negativo_do_flash_vira_minutos_com_sinal():
    a = pessoa(rel([marc("Ana Teste", "000001", "01/09/2026", "07:30")],
                   (("Ana Teste", "000001", "(-07:42)"),)))
    assert (a.saldo_min, a.saldo_txt) == (-462, "-07:42")


def test_casa_por_matricula_sem_zeros_mesmo_com_nome_diferente():
    a = pessoa(rel([marc("Ana Teste", "0072", "01/09/2026", "07:30")],
                   (("Ana Teste da Silva", "000072", "02:05"),)))
    assert a.saldo_min == 125


def test_sem_linha_no_banco_entra_com_saldo_em_branco():
    r = rel([marc("Ana Teste", "000001", "01/09/2026", "07:30"),
             marc("Bia Teste", "000002", "01/09/2026", "07:30")])
    assert pessoa(r, "Bia Teste").saldo_min is None and pessoa(r, "Bia Teste").saldo_txt == ""


def test_quem_so_esta_no_banco_fica_de_fora():
    r = rel([marc("Ana Teste", "000001", "01/09/2026", "07:30")],
            (("Ana Teste", "000001", "01:00"), ("Diretor Ficticio", "-", "00:00")))
    assert [x.nome for x in r.pessoas] == ["Ana Teste"]
