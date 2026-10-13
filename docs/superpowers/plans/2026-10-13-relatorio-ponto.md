# Relatório de ponto (Flash) no `bruce` — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O `bruce` recebe os dois CSV do Flash como anexo, chama `relatorio_ponto` e a coordenadora de RH recebe na conversa um xlsx com Resumo Gerencial, Controle Principal, Dados e-mail, Ocorrências e Ajustes, calculado por código.

**Architecture:** A régua é um módulo puro (`app/relatorios/ponto.py`): bytes dos CSV entram, um `Relatorio` sai, e dele saem o xlsx e o resumo em texto. A ferramenta mora no servidor MCP `hsos-anexos`, que já verifica a identidade do agente pela URL, a posse do anexo e o turno em curso; ela passa a existir só para o `bruce`. A entrega reaproveita o caminho do `enviar_arquivo`, extraído para uma função comum.

**Tech Stack:** Python 3 · FastAPI · openpyxl 3.1.5 (já no `requirements.txt`) · pytest (em `requirements-dev.txt`) · asyncpg · anyio.

**Spec:** `docs/superpowers/specs/2026-10-13-relatorio-ponto-design.md`

## Global Constraints

- Código, comentários, docstrings, mensagens e testes em **português**, como o resto do repo.
- **Nenhum nome, matrícula ou e-mail real** em código, teste, fixture ou commit — o repositório é público. Dados de teste são inventados.
- Rodar testes de `backend/`: `.venv/bin/python -m pytest tests -q` (o `pytest` vem de `requirements-dev.txt`).
- Limites da régua (minutos desde 00:00), copiados da spec:
  - originais: entrada antecipada `< 07:29`; atraso `>= 07:46`; saída antecipada `< 16:59`; após jornada `> 17:01`
  - analisadas: entrada antecipada `<= 07:19`; atraso `>= 07:50`; saída antecipada `<= 16:48`; após jornada `>= 17:20`
  - intervalo (as duas): `< 60` min é "< 1h", `> 60` min é "> 1h"
- Entrada = 1ª batida; intervalo = 3ª − 2ª (se houver 3); saída = **última** batida, só em dia com 4+ batidas.
- Ajuste = batida `Tipo Marcação N == "Justificada"`; **não conta** se `Motivo + Justificativa` (sem acento, minúsculo) contém `externo`, `viagem`, `home office` ou `cliente`.
- Recorrente = indicador com `>= 10` ocorrências **nas originais** (ajustes incluídos). Status: 3+ `CRÍTICO`, 2 `ATENÇÃO`, 1 `ACOMPANHAMENTO`, 0 `REGULAR`.
- Pessoas casadas entre os dois CSV pela **matrícula sem zeros à esquerda**; sem matrícula, pelo nome. Quem só está no banco de horas fica de fora.
- Teto: 5.000 linhas de marcação. Um mês só por arquivo.
- Saldo no xlsx: texto `-07:42` **e** minutos com sinal (`int`). Horário/duração: fração de dia com formato `hh:mm`.
- Só o agente `bruce` enxerga e chama `relatorio_ponto`.

## Review Focus

1. **CSV sem BOM ou em Latin-1** (export salvo de novo no Excel) — deve ler igual; o erro, se houver, tem que nomear o arquivo.
2. **Hora com segundos** (`07:29:00`) ou com espaço — deve contar como `07:29`, não quebrar nem virar ocorrência.
3. **O mesmo id passado duas vezes**, ou dois CSV de marcações — erro dizendo qual arquivo falta, não um relatório vazio.
4. **Pessoa nas marcações sem linha no banco de horas** — entra no relatório com saldo em branco, sem derrubar o resto.
5. **Os dois anexos de pessoas diferentes** — recusa antes de ler o R2; o arquivo de uma pessoa não pode ir para outra.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `backend/app/relatorios/ponto.py` (criar) | régua pura: ler CSV, avaliar dias, agregar pessoas, montar xlsx, resumo |
| `backend/tests/test_relatorio_ponto.py` (criar) | régua e xlsx, com CSV inventados |
| `backend/app/routers/mcp_anexos.py` (modificar) | `_entregar` extraído, ferramentas por agente, `relatorio_ponto` |
| `backend/tests/test_mcp_anexos.py` (modificar) | visibilidade só para o `bruce` e o fluxo da ferramenta |
| `backend/skills/ponto-flash/SKILL.md` (criar) | instrução ao agente |
| `CLAUDE.md`, `docs/CONTINUAR-AQUI.md` (modificar) | registrar |

---

### Task 1: A régua — leitura dos CSV e contagem

**Files:**
- Create: `backend/app/relatorios/ponto.py`
- Test: `backend/tests/test_relatorio_ponto.py`

**Interfaces:**
- Produces:
  - `class ErroPonto(ValueError)` — mensagem legível ao agente
  - `INDICADORES: tuple[str, ...]` = `("entrada_antecipada", "atraso", "intervalo_menor", "intervalo_maior", "saida_antecipada", "apos_jornada")`
  - `ROTULOS: dict[str, str]` — rótulo de cada indicador e de `"ajustes"`
  - `identificar(nome: str, dados: bytes) -> tuple[str, list[dict]]` — `"marcacoes"` ou `"banco"`
  - `gerar(arquivos: list[tuple[str, bytes]]) -> Relatorio`
  - dataclasses `Ocorrencia(nome, data: date, indicador, minutos: int, original: bool, analisada: bool)`, `Ajuste(nome, departamento, data: date, marcacao: str, motivo, justificativa, minutos: int, conta: bool)`, `Pessoa(nome, matricula, setor, ajustes: int, originais: dict[str,int], analisadas: dict[str,int], saldo_min: int | None, saldo_txt: str, padrao: str, status: str)`, `Relatorio(mes: int, ano: int, pessoas: list[Pessoa], ocorrencias: list[Ocorrencia], ajustes: list[Ajuste])`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (de `backend/`): `.venv/bin/python -m pytest tests/test_relatorio_ponto.py -q`
Expected: FAIL — `ImportError: cannot import name 'ponto'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/relatorios/ponto.py
"""Relatório de ponto do Flash — a régua da coordenadora de RH.

⚠️ **A régua é dela, não nossa.** Foi levantada em 13/10/2026 das planilhas de
setembro que ela monta à mão e das respostas dela; mudou na conversa com ela,
muda aqui. Ver `docs/superpowers/specs/2026-10-13-relatorio-ponto-design.md`.

Duas contagens, como no relatório que ela manda ao CEO:

- **originais** — as fórmulas do "Controle Principal" da planilha dela;
- **analisadas** — a régua que ela declarou ("7h19, atraso a partir de 7h50,
  antecipada até 16h49 e extra a partir de 17h20"). Saída às 16:49 NÃO conta:
  é o que os números dela dizem (22/25 contra 20/25), e a frase admite as duas
  leituras.

O julgamento caso a caso que ela faz depois (descartar uma ocorrência olhando o
dia) não é regra e não está aqui: sai a aba "Ocorrências" para ela confirmar.

Módulo puro: bytes entram, `Relatorio` sai. Quem lê do R2 e entrega é o
`app/routers/mcp_anexos.py`.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

TETO_LINHAS = 5000


def _hm(texto: str) -> int:
    h, m = texto.split(":")[:2]
    return int(h) * 60 + int(m)


# Originais — as fórmulas da planilha (AM/AN da "Lista de Marcações").
ORIG_ENTRADA_ANTES = _hm("07:29")   # entrada <  07:29 → antecipada
ORIG_ATRASO_DESDE = _hm("07:46")    # entrada >= 07:46 → atraso
ORIG_SAIDA_ANTES = _hm("16:59")     # saída   <  16:59 → antecipada
ORIG_APOS_DEPOIS = _hm("17:01")     # saída   >  17:01 → após jornada
# Analisadas — a régua que ela declarou em 13/10/2026.
ANAL_ENTRADA_ATE = _hm("07:19")     # entrada <= 07:19
ANAL_ATRASO_DESDE = _hm("07:50")    # entrada >= 07:50
ANAL_SAIDA_ATE = _hm("16:48")       # saída   <= 16:48
ANAL_APOS_DESDE = _hm("17:20")      # saída   >= 17:20
INTERVALO_MIN = 60
RECORRENTE = 10

INDICADORES = ("entrada_antecipada", "atraso", "intervalo_menor",
               "intervalo_maior", "saida_antecipada", "apos_jornada")
ROTULOS = {
    "ajustes": "Ajustes de ponto",
    "entrada_antecipada": "Entrada antecipada",
    "atraso": "Atrasos",
    "intervalo_menor": "Intervalo <1h",
    "intervalo_maior": "Intervalo >1h",
    "saida_antecipada": "Saída antecipada",
    "apos_jornada": "Após jornada",
}
_PADRAO = {
    "ajustes": "Ajustes recorrentes",
    "entrada_antecipada": "Entrada antecipada recorrente",
    "atraso": "Atraso recorrente",
    "intervalo_menor": "Intervalo reduzido recorrente",
    "intervalo_maior": "Intervalo prolongado recorrente",
    "saida_antecipada": "Saída antecipada recorrente",
    "apos_jornada": "Permanência após jornada recorrente",
}
# Ajuste por motivo de trabalho não conta (confirmado por ela em 13/10/2026).
_TRABALHO = re.compile(r"\b(externo|viagem|home office|cliente)\b")

_COL_MARC = {"Nome", "Data da Marcação", "Hora da Marcação 1", "Tipo Marcação 1"}
_COL_BANCO = {"Nome", "Matrícula", "Saldo banco total"}


class ErroPonto(ValueError):
    """Problema nos arquivos, com mensagem que o agente repassa à pessoa."""


@dataclass
class Ocorrencia:
    nome: str
    data: date
    indicador: str
    minutos: int          # horário da batida, ou duração do intervalo
    original: bool
    analisada: bool


@dataclass
class Ajuste:
    nome: str
    departamento: str
    data: date
    marcacao: str
    motivo: str
    justificativa: str
    minutos: int
    conta: bool


@dataclass
class Pessoa:
    nome: str
    matricula: str
    setor: str
    ajustes: int = 0
    originais: dict = field(default_factory=lambda: dict.fromkeys(INDICADORES, 0))
    analisadas: dict = field(default_factory=lambda: dict.fromkeys(INDICADORES, 0))
    saldo_min: int | None = None
    saldo_txt: str = ""
    padrao: str = ""
    status: str = "REGULAR"


@dataclass
class Relatorio:
    mes: int
    ano: int
    pessoas: list[Pessoa]
    ocorrencias: list[Ocorrencia]
    ajustes: list[Ajuste]


# ── leitura ─────────────────────────────────────────────────────────────────

def _decodificar(dados: bytes) -> str:
    # O Flash exporta UTF-8 com BOM; reaberto e salvo no Excel vira Latin-1.
    try:
        return dados.decode("utf-8-sig")
    except UnicodeDecodeError:
        return dados.decode("latin-1")


def identificar(nome: str, dados: bytes) -> tuple[str, list[dict]]:
    """`("marcacoes" | "banco", registros)` — decidido pelo cabeçalho, não pelo nome."""
    leitor = csv.DictReader(io.StringIO(_decodificar(dados)), delimiter=";")
    colunas = {(c or "").strip() for c in (leitor.fieldnames or [])}
    if _COL_MARC <= colunas:
        tipo = "marcacoes"
    elif _COL_BANCO <= colunas:
        tipo = "banco"
    else:
        raise ErroPonto(
            f"{nome} não parece um export do Flash: esperava o CSV de marcações "
            "(MarcacoesOriginaisJustificadas) ou o de banco de horas (BancoHoras).")
    registros = [{(k or "").strip(): (v or "").strip() for k, v in r.items()}
                 for r in leitor if any((v or "").strip() for v in r.values())]
    if len(registros) > TETO_LINHAS:
        raise ErroPonto(f"{nome} tem {len(registros)} linhas; o limite é {TETO_LINHAS}.")
    return tipo, registros


def _minutos(texto: str) -> int | None:
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", texto or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _data(texto: str) -> date:
    d, m, a = (int(x) for x in texto.strip().split("/"))
    return date(a, m, d)


def _saldo(texto: str) -> tuple[int | None, str]:
    """`(-07:42)` → (-462, "-07:42"); `02:05` → (125, "02:05")."""
    t = (texto or "").strip()
    negativo = t.startswith("(") or t.startswith("-")
    m = re.search(r"(\d+):(\d{2})", t)
    if not m:
        return None, ""
    total = int(m.group(1)) * 60 + int(m.group(2))
    return (-total if negativo else total), f"{'-' if negativo else ''}{m.group(1).zfill(2)}:{m.group(2)}"


def _matricula(texto: str) -> str:
    t = (texto or "").strip().lstrip("0")
    return t if t.isdigit() else ""


def _sem_acento(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (t or "").lower())
                   if unicodedata.category(c) != "Mn")


def _rotulo_da_batida(posicao: int, total: int) -> str:
    if posicao == 1:
        return "Entrada"
    if posicao == total and total >= 4:
        return "Saída"
    return "Saída para intervalo" if posicao % 2 == 0 else "Retorno do intervalo"


# ── a régua ─────────────────────────────────────────────────────────────────

def _avaliar_dia(nome: str, dia: date, batidas: list[int]) -> list[Ocorrencia]:
    achados: list[tuple[str, int, bool, bool]] = []
    entrada = batidas[0]
    achados.append(("entrada_antecipada", entrada,
                    entrada < ORIG_ENTRADA_ANTES, entrada <= ANAL_ENTRADA_ATE))
    achados.append(("atraso", entrada, entrada >= ORIG_ATRASO_DESDE, entrada >= ANAL_ATRASO_DESDE))
    if len(batidas) >= 3:
        dur = batidas[2] - batidas[1]
        achados.append(("intervalo_menor", dur, dur < INTERVALO_MIN, dur < INTERVALO_MIN))
        achados.append(("intervalo_maior", dur, dur > INTERVALO_MIN, dur > INTERVALO_MIN))
    if len(batidas) >= 4:
        saida = batidas[-1]
        achados.append(("saida_antecipada", saida, saida < ORIG_SAIDA_ANTES, saida <= ANAL_SAIDA_ATE))
        achados.append(("apos_jornada", saida, saida > ORIG_APOS_DEPOIS, saida >= ANAL_APOS_DESDE))
    return [Ocorrencia(nome, dia, ind, mins, o, a) for ind, mins, o, a in achados if o or a]


def _classificar(pessoa: Pessoa) -> None:
    contagens = {"ajustes": pessoa.ajustes, **pessoa.originais}
    recorrentes = [k for k in ("ajustes", *INDICADORES) if contagens[k] >= RECORRENTE]
    pessoa.padrao = " + ".join(_PADRAO[k] for k in recorrentes)
    pessoa.status = {0: "REGULAR", 1: "ACOMPANHAMENTO", 2: "ATENÇÃO"}.get(len(recorrentes), "CRÍTICO")


def gerar(arquivos: list[tuple[str, bytes]]) -> Relatorio:
    """`arquivos` = [(nome, bytes)] com os dois CSV do Flash, em qualquer ordem."""
    lidos: dict[str, list[dict]] = {}
    for nome, dados in arquivos:
        tipo, registros = identificar(nome, dados)
        lidos[tipo] = registros
    faltam = [r for t, r in (("marcacoes", "marcações (MarcacoesOriginaisJustificadas)"),
                             ("banco", "banco de horas (BancoHoras)")) if t not in lidos]
    if faltam:
        achou = ", ".join(sorted(lidos)) or "nenhum"
        raise ErroPonto(f"Falta o CSV de {' e '.join(faltam)}. Reconhecido: {achou}.")

    linhas = lidos["marcacoes"]
    meses = sorted({(_data(l["Data da Marcação"]).month, _data(l["Data da Marcação"]).year)
                    for l in linhas if l.get("Data da Marcação")})
    if len(meses) != 1:
        rotulos = ", ".join(f"{m:02d}/{a}" for m, a in meses) or "nenhum"
        raise ErroPonto(f"O CSV de marcações precisa ser de um mês só; veio: {rotulos}.")
    mes, ano = meses[0]

    pessoas: dict[str, Pessoa] = {}
    ocorrencias: list[Ocorrencia] = []
    ajustes: list[Ajuste] = []
    for l in linhas:
        nome = l["Nome"]
        chave = _matricula(l.get("Matrícula", "")) or nome
        pessoa = pessoas.setdefault(chave, Pessoa(nome, _matricula(l.get("Matrícula", "")),
                                                  l.get("Departamento", "")))
        dia = _data(l["Data da Marcação"])
        marcadas = [(i, _minutos(l.get(f"Hora da Marcação {i}", ""))) for i in range(1, 7)]
        marcadas = [(i, mins) for i, mins in marcadas if mins is not None]
        batidas = [mins for _, mins in marcadas]
        for n, (i, mins) in enumerate(marcadas, start=1):
            if l.get(f"Tipo Marcação {i}") != "Justificada":
                continue
            motivo, just = l.get(f"Motivo Marcação {i}", ""), l.get(f"Justificativa {i}", "")
            conta = not _TRABALHO.search(_sem_acento(f"{motivo} {just}"))
            ajustes.append(Ajuste(nome, pessoa.setor, dia, _rotulo_da_batida(n, len(marcadas)),
                                  motivo, just, mins, conta))
            pessoa.ajustes += conta
        if not batidas:
            continue
        for o in _avaliar_dia(nome, dia, batidas):
            ocorrencias.append(o)
            pessoa.originais[o.indicador] += o.original
            pessoa.analisadas[o.indicador] += o.analisada

    for b in lidos["banco"]:
        chave = _matricula(b.get("Matrícula", "")) or b.get("Nome", "")
        if chave in pessoas:
            pessoas[chave].saldo_min, pessoas[chave].saldo_txt = _saldo(b.get("Saldo banco total", ""))

    for pessoa in pessoas.values():
        _classificar(pessoa)
    ordenadas = sorted(pessoas.values(), key=lambda x: _sem_acento(x.nome))
    return Relatorio(mes, ano, ordenadas, ocorrencias, ajustes)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_relatorio_ponto.py -q`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/relatorios/ponto.py backend/tests/test_relatorio_ponto.py
git commit -m "feat(ponto): régua do controle de jornada do Flash, levantada da planilha do RH"
```

---

### Task 2: O xlsx e o resumo ao agente

**Files:**
- Modify: `backend/app/relatorios/ponto.py` (acrescentar no fim)
- Test: `backend/tests/test_relatorio_ponto.py` (acrescentar no fim)

**Interfaces:**
- Consumes: `Relatorio`, `Pessoa`, `ROTULOS`, `INDICADORES` da Task 1
- Produces:
  - `MESES: tuple[str, ...]` — nomes em maiúsculas, índice 1 = "JANEIRO"
  - `nome_do_arquivo(r: Relatorio) -> str` → `"Controle de jornada - SETEMBRO-2026.xlsx"`
  - `montar_xlsx(r: Relatorio) -> bytes`
  - `resumo(r: Relatorio) -> str`
  - `ABAS: tuple[str, ...]` = `("Resumo Gerencial", "Controle Principal", "Dados e-mail", "Ocorrências", "Ajustes")`

- [ ] **Step 1: Write the failing tests** (acrescentar ao arquivo de teste)

```python
# ── o xlsx ──────────────────────────────────────────────────────────────────
import io as _io

import openpyxl


def _livro(r):
    return openpyxl.load_workbook(_io.BytesIO(p.montar_xlsx(r)))


def _r_completo():
    return rel(_dias_com_atraso(10, volta="12:30") + [
        marc("Bia Teste", "000002", "01/09/2026", "07:30", "12:00", "13:00", "17:00",
             depto="COMERCIAL")],
        (("Ana Teste", "000001", "(-07:42)"), ("Bia Teste", "000002", "01:00")))


def test_abas_e_nome_do_arquivo():
    r = _r_completo()
    assert _livro(r).sheetnames == list(p.ABAS)
    assert p.nome_do_arquivo(r) == "Controle de jornada - SETEMBRO-2026.xlsx"


def test_contagens_sao_numeros_e_saldo_vai_em_texto_e_minutos():
    """O xlsx do `enviar_arquivo` grava tudo como texto, e SOMA no Excel não
    funciona sem converter. Este tem que somar."""
    ws = _livro(_r_completo())["Controle Principal"]
    cab = [c.value for c in ws[1]]
    ana = next(l for l in ws.iter_rows(min_row=2, values_only=True) if l[0] == "Ana Teste")
    linha = dict(zip(cab, ana))
    assert linha["Atraso"] == 10 and isinstance(linha["Atraso"], int)
    assert linha["Saldo banco"] == "-07:42" and linha["Saldo (min)"] == -462
    assert linha["Status"] == "ATENÇÃO" and linha["Tratativa"] in (None, "")


def test_ocorrencia_tem_horario_como_hora_do_dia():
    ws = _livro(_r_completo())["Ocorrências"]
    linha = next(ws.iter_rows(min_row=2))
    celula_hora = linha[3]
    assert celula_hora.number_format == "hh:mm"
    assert abs(celula_hora.value - (7 * 60 + 55) / 1440) < 1e-9


def test_resumo_gerencial_lista_so_quem_nao_esta_regular():
    ws = _livro(_r_completo())["Resumo Gerencial"]
    nomes = [c.value for c in ws["A"] if c.value in ("Ana Teste", "Bia Teste")]
    assert nomes == ["Ana Teste"]


def test_resumo_ao_agente_tem_totais_e_quem_precisa_de_atencao():
    texto = p.resumo(_r_completo())
    assert "SETEMBRO/2026" in texto and "2 colaboradores" in texto
    assert "Ana Teste" in texto and "ATENÇÃO" in texto and "-07:42" in texto
    assert "Bia Teste" not in texto
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_relatorio_ponto.py -q`
Expected: FAIL — `AttributeError: module 'app.relatorios.ponto' has no attribute 'montar_xlsx'`

- [ ] **Step 3: Write the implementation** (acrescentar ao fim de `ponto.py`)

```python
# ── saída: xlsx e resumo ────────────────────────────────────────────────────

MESES = ("", "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
         "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO")
ABAS = ("Resumo Gerencial", "Controle Principal", "Dados e-mail", "Ocorrências", "Ajustes")
_GRAVIDADE = {"CRÍTICO": 0, "ATENÇÃO": 1, "ACOMPANHAMENTO": 2, "REGULAR": 3}


def nome_do_arquivo(r: Relatorio) -> str:
    return f"Controle de jornada - {MESES[r.mes]}-{r.ano}.xlsx"


def _hora(minutos: int) -> float:
    return minutos / 1440


def _fmt(minutos: int | None) -> str:
    if minutos is None:
        return ""
    sinal = "-" if minutos < 0 else ""
    return f"{sinal}{abs(minutos) // 60:02d}:{abs(minutos) % 60:02d}"


def _cabecalho(ws, colunas: list[str]) -> None:
    from openpyxl.styles import Font
    ws.append(colunas)
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)


def montar_xlsx(r: Relatorio) -> bytes:
    """Números como número: contagem `int`, horário fração de dia em `hh:mm`.

    Saldo vai em duas colunas — texto para ler e minutos para somar — porque o
    Excel mostra `#####` para hora negativa em `[h]:mm`.
    """
    import openpyxl

    wb = openpyxl.Workbook()
    resumo_ws = wb.active
    resumo_ws.title = ABAS[0]

    # Resumo Gerencial — o relatório que vai ao CEO.
    ws = resumo_ws
    ws.append([f"CONTROLE DE JORNADA — {MESES[r.mes]}/{r.ano}"])
    ws.append([])
    negativos = [x.saldo_min for x in r.pessoas if x.saldo_min is not None and x.saldo_min < 0]
    por_status = Counter(x.status for x in r.pessoas)
    _cabecalho(ws, ["Indicadores principais", "Dados"])
    for rotulo, valor in (
        ("Colaboradores monitorados", len(r.pessoas)),
        ("Total de ajustes de ponto", sum(x.ajustes for x in r.pessoas)),
        ("Colaboradores em acompanhamento", por_status["ACOMPANHAMENTO"]),
        ("Colaboradores em atenção", por_status["ATENÇÃO"]),
        ("Colaboradores críticos", por_status["CRÍTICO"]),
        ("Colaboradores com saldo negativo", len(negativos)),
        ("Saldo negativo acumulado", _fmt(sum(negativos)) if negativos else "00:00"),
    ):
        ws.append([rotulo, valor])
    ws.append([])
    _cabecalho(ws, ["Quadro de ocorrências", "Pessoas afetadas",
                    "Total de ocorrências originais", "Total de ocorrências analisadas"])
    total_aj = sum(x.ajustes for x in r.pessoas)
    ws.append([ROTULOS["ajustes"], sum(1 for x in r.pessoas if x.ajustes), total_aj, total_aj])
    for k in INDICADORES:
        ws.append([ROTULOS[k], sum(1 for x in r.pessoas if x.originais[k]),
                   sum(x.originais[k] for x in r.pessoas), sum(x.analisadas[k] for x in r.pessoas)])
    ws.append([])
    _cabecalho(ws, ["Colaborador que precisa de acompanhamento", "Saldo", "Status", "Tratativa", "Padrão"])
    for x in sorted((x for x in r.pessoas if x.status != "REGULAR"),
                    key=lambda x: (_GRAVIDADE[x.status], _sem_acento(x.nome))):
        ws.append([x.nome, x.saldo_txt, x.status, "", x.padrao])

    # Controle Principal — originais, por pessoa.
    ws = wb.create_sheet(ABAS[1])
    _cabecalho(ws, ["Colaborador", "Setor", "Ajustes", *[
        {"entrada_antecipada": "Entrada antecipada", "atraso": "Atraso",
         "intervalo_menor": "Intervalo < 1h", "intervalo_maior": "Intervalo > 1h",
         "saida_antecipada": "Saída antecipada", "apos_jornada": "Após jornada"}[k]
        for k in INDICADORES], "Saldo banco", "Saldo (min)", "Padrão", "Status", "Tratativa"])
    for x in r.pessoas:
        ws.append([x.nome, x.setor, x.ajustes, *[x.originais[k] for k in INDICADORES],
                   x.saldo_txt, x.saldo_min, x.padrao, x.status, ""])

    # Dados e-mail — analisadas, por pessoa.
    ws = wb.create_sheet(ABAS[2])
    _cabecalho(ws, ["Colaborador", "Setor", "Ajustes", "Entrada antecipada", "Atraso",
                    "Intervalo < 1h", "Intervalo > 1h", "Saída antecipada", "Após jornada",
                    "Saldo banco", "Saldo (min)", "Observações"])
    for x in r.pessoas:
        ws.append([x.nome, x.setor, x.ajustes, *[x.analisadas[k] for k in INDICADORES],
                   x.saldo_txt, x.saldo_min, ""])

    # Ocorrências — onde ela confirma ou descarta caso a caso.
    ws = wb.create_sheet(ABAS[3])
    _cabecalho(ws, ["Colaborador", "Data", "Indicador", "Horário / duração",
                    "Conta nas originais", "Conta nas analisadas"])
    for o in sorted(r.ocorrencias, key=lambda o: (_sem_acento(o.nome), o.data, o.indicador)):
        ws.append([o.nome, o.data, ROTULOS[o.indicador], _hora(o.minutos),
                   "SIM" if o.original else "NÃO", "SIM" if o.analisada else "NÃO"])
        ws.cell(ws.max_row, 2).number_format = "dd/mm/yyyy"
        ws.cell(ws.max_row, 4).number_format = "hh:mm"

    # Ajustes — o histórico, com a coluna que decide se conta.
    ws = wb.create_sheet(ABAS[4])
    _cabecalho(ws, ["Colaborador", "Departamento", "Data", "Marcação", "Motivo",
                    "Justificativa", "Horário", "Conta no indicador?"])
    for a in r.ajustes:
        ws.append([a.nome, a.departamento, a.data, a.marcacao, a.motivo, a.justificativa,
                   _hora(a.minutos), "SIM" if a.conta else "NÃO"])
        ws.cell(ws.max_row, 3).number_format = "dd/mm/yyyy"
        ws.cell(ws.max_row, 7).number_format = "hh:mm"

    saida = io.BytesIO()
    wb.save(saida)
    return saida.getvalue()


def resumo(r: Relatorio) -> str:
    """O que volta ao modelo: totais e quem precisa de atenção — nunca as linhas."""
    por_status = Counter(x.status for x in r.pessoas)
    partes = [f"Controle de jornada {MESES[r.mes]}/{r.ano}: {len(r.pessoas)} colaboradores, "
              f"{sum(x.ajustes for x in r.pessoas)} ajustes de ponto que contam."]
    partes.append("Ocorrências (originais / analisadas): " + "; ".join(
        f"{ROTULOS[k]} {sum(x.originais[k] for x in r.pessoas)} / "
        f"{sum(x.analisadas[k] for x in r.pessoas)}" for k in INDICADORES) + ".")
    partes.append(f"Status: {por_status['CRÍTICO']} crítico(s), {por_status['ATENÇÃO']} em atenção, "
                  f"{por_status['ACOMPANHAMENTO']} em acompanhamento, {por_status['REGULAR']} regular(es).")
    destaque = sorted((x for x in r.pessoas if x.status in ("CRÍTICO", "ATENÇÃO")),
                      key=lambda x: (_GRAVIDADE[x.status], _sem_acento(x.nome)))
    for x in destaque:
        partes.append(f"- {x.nome} — {x.status}, saldo {x.saldo_txt or 'sem saldo'}: {x.padrao}")
    return "\n".join(partes)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_relatorio_ponto.py -q`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/relatorios/ponto.py backend/tests/test_relatorio_ponto.py
git commit -m "feat(ponto): planilha com números de verdade e resumo curto para o agente"
```

---

### Task 3: Conferência contra a planilha real de setembro (fora do repositório)

Não gera commit: os dados são de pessoas reais e ficam no scratchpad.

**Files:**
- Create (scratchpad, fora do repo): `<scratchpad>/ponto/conferir.py`

**Interfaces:**
- Consumes: `p.gerar` da Task 1; os arquivos já baixados em `<scratchpad>/ponto/dados/` (`marcacoes.csv`, `bancohoras.csv`, `ajustada.xlsx`). Se a pasta não existir, rebaixar do R2 pelos ids em `public.anexos` enviados por `adm01@`.

- [ ] **Step 1: Escrever o script de conferência**

```python
# <scratchpad>/ponto/conferir.py — roda com: PYTHONPATH=backend backend/.venv/bin/python -I <este arquivo> <dados>
import sys, pathlib, openpyxl
from app.relatorios import ponto as p

d = pathlib.Path(sys.argv[1])
r = p.gerar([("m.csv", (d / "marcacoes.csv").read_bytes()), ("b.csv", (d / "bancohoras.csv").read_bytes())])
wb = openpyxl.load_workbook(d / "ajustada.xlsx", read_only=True, data_only=True)
cp = {l[0]: l for l in wb["Controle Principal"].iter_rows(min_row=8, max_row=32, values_only=True) if l[0]}
de = {l[0]: l for l in wb["Dados e-mail"].iter_rows(min_row=5, max_row=38, values_only=True) if l[0]}
por_nome = {x.nome: x for x in r.pessoas}
col = dict(zip(p.INDICADORES, range(3, 9)))

def conta(tab, attr):
    ok = tot = 0; dif = []
    for nome, linha in tab.items():
        x = por_nome.get(nome)
        if x is None:
            dif.append((nome, "sem par")); continue
        for k, ci in col.items():
            tot += 1
            if getattr(x, attr)[k] == (linha[ci] or 0): ok += 1
            else: dif.append((nome.split()[0], k, getattr(x, attr)[k], linha[ci]))
    return ok, tot, dif

print("pessoas:", len(r.pessoas), "(esperado 25)")
print("ajustes:", sum(1 for a in r.ajustes), "(esperado 97);", "contam", sum(a.conta for a in r.ajustes), "(esperado 88)")
for nome, tab, attr in (("Controle Principal", cp, "originais"), ("Dados e-mail", de, "analisadas")):
    ok, tot, dif = conta(tab, attr)
    print(f"{nome}: {ok}/{tot}")
    for x in dif: print("   ", x)
```

- [ ] **Step 2: Rodar e conferir os números**

Run: `PYTHONPATH=backend backend/.venv/bin/python -I <scratchpad>/ponto/conferir.py <scratchpad>/ponto/dados`

Expected:
- `pessoas: 25`, `ajustes: 97`, `contam 88`
- `Dados e-mail: 128/150` (o número do levantamento, já com a saída na última batida)
- `Controle Principal`: as diferenças em relação às 149/150 do levantamento só podem estar nas colunas `saida_antecipada`/`apos_jornada` de quem teve dia com 6 batidas, mais a célula digitada por cima (`apos_jornada` 10 contra 2). Qualquer diferença em entrada, atraso ou intervalo é defeito — voltar à Task 1.

- [ ] **Step 3: Abrir o xlsx gerado e olhar**

Run: `PYTHONPATH=backend backend/.venv/bin/python -I -c "import sys,pathlib; from app.relatorios import ponto as p; d=pathlib.Path(sys.argv[1]); r=p.gerar([('m',(d/'marcacoes.csv').read_bytes()),('b',(d/'bancohoras.csv').read_bytes())]); (d/p.nome_do_arquivo(r)).write_bytes(p.montar_xlsx(r)); print(p.resumo(r))" <scratchpad>/ponto/dados`

Expected: o resumo lista os críticos e em atenção; o arquivo `Controle de jornada - SETEMBRO-2026.xlsx` abre com as 5 abas.

---

### Task 4: A ferramenta `relatorio_ponto` no `hsos-anexos`

**Files:**
- Modify: `backend/app/routers/mcp_anexos.py`
- Test: `backend/tests/test_mcp_anexos.py` (acrescentar no fim)

**Interfaces:**
- Consumes: `p.gerar`, `p.montar_xlsx`, `p.resumo`, `p.nome_do_arquivo`, `p.ErroPonto` (Tasks 1–2); `buscar_anexo`, `membro_do_canal`, `ax.agente_pode_ler`, `turno_em_curso`, `arm.ler`, `arm.chave` (já existentes)
- Produces:
  - `_FERRAMENTAS_RESTRITAS: dict[str, frozenset[str]]` = `{"relatorio_ponto": frozenset({"bruce"})}`
  - `ferramentas_de(agent_id: str) -> list[dict]`
  - `async def _entregar(agent_id: str, para: str, nome: str, dados: bytes, mime: str) -> tuple[str, bool]` — extraída de `_enviar_arquivo`, mesmo comportamento e mesmas mensagens
  - `async def _relatorio_ponto(agent_id: str, args: dict) -> tuple[str, bool]`

- [ ] **Step 1: Write the failing tests** (acrescentar ao fim de `tests/test_mcp_anexos.py`)

```python
# ── relatorio_ponto — só o bruce, e só com os anexos da pessoa em turno ─────
#
# A planilha de ponto do RH traz nome e horário de cada funcionário. A ferramenta
# mora aqui porque este servidor verifica o agente pela URL e a posse do anexo;
# nos servidores que confiam no argumento, outro agente a chamaria.

PONTO_M = "﻿Nome;Matrícula;Departamento;Data da Marcação;Tipo Marcação 1;Hora da Marcação 1\nAna Teste;000001;LAB;01/09/2026;Original;07:55\n".encode()
PONTO_B = "﻿Ano;Mês;Matrícula;Nome;Saldo banco total\n2026;9;000001;Ana Teste;(-01:00)\n".encode()


def test_relatorio_ponto_so_aparece_para_o_bruce():
    assert "relatorio_ponto" in [f["name"] for f in m.ferramentas_de("bruce")]
    assert "relatorio_ponto" not in [f["name"] for f in m.ferramentas_de("nina")]
    assert {"ler_anexo", "enviar_arquivo"} <= {f["name"] for f in m.ferramentas_de("nina")}


def test_outro_agente_chamando_relatorio_ponto_recebe_ferramenta_desconhecida(monkeypatch):
    """Esconder no `tools/list` não basta: o `tools/call` tem que recusar também."""
    async def segredo(nome):
        return SEGREDO

    async def proibido(*a, **k):
        raise AssertionError("relatorio_ponto executado para a nina")

    monkeypatch.setattr(m, "ler_segredo", segredo)
    monkeypatch.setattr(m, "_relatorio_ponto", proibido)
    corpo = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": "relatorio_ponto", "arguments": {"ids": ["a", "b"]}}}
    r = asyncio.run(m.mcp_anexos("nina", m.assinatura_do_agente(SEGREDO, "nina"), _Req(corpo), None))
    assert json.loads(r.body)["error"]["code"] == -32601


@pytest.fixture
def ponto(isolado, monkeypatch):
    """Dois anexos da mesma pessoa, em turno; R2 devolve os CSV; a entrega é capturada."""
    anexos = {"m": _anexo(id="m", nome="Marcacoes.csv"), "b": _anexo(id="b", nome="BancoHoras.csv")}
    conteudo = {"m": PONTO_M, "b": PONTO_B}
    entregas = []

    async def buscar(conn, anexo_id):
        return anexos.get(anexo_id)

    async def ler(chave):
        return conteudo[chave.split("/")[-1]]

    async def entregar(agent_id, para, nome, dados, mime):
        entregas.append((agent_id, para, nome, dados))
        return "Enviado.", False

    monkeypatch.setattr(m, "buscar_anexo", buscar)
    monkeypatch.setattr(m.arm, "chave", lambda bucket, caminho: f"{bucket}/{caminho}")
    monkeypatch.setattr(m.arm, "ler", ler)
    monkeypatch.setattr(m, "_entregar", entregar)
    for a in anexos.values():
        a.caminho = a.id
    isolado.update(anexos=anexos, entregas=entregas)
    return isolado


def test_relatorio_ponto_entrega_ao_dono_dos_anexos(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["b", "m"]}))
    assert not erro, texto
    [(agente, para, nome, dados)] = ponto["entregas"]
    assert (agente, para, nome) == ("bruce", "u1", "Controle de jornada - SETEMBRO-2026.xlsx")
    assert dados[:2] == b"PK"  # xlsx é zip
    assert "SETEMBRO/2026" in texto and "Enviado." in texto


def test_relatorio_ponto_recusa_anexos_de_pessoas_diferentes_sem_ler_o_r2(ponto, monkeypatch):
    ponto["anexos"]["b"].dono_conversa = "u2"

    async def ler_proibido(chave):
        raise AssertionError("leu o R2 com anexos de duas pessoas")
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "b"]}))
    assert erro and "mesma pessoa" in texto and ponto["entregas"] == []


def test_relatorio_ponto_com_o_mesmo_id_duas_vezes(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "m"]}))
    assert erro and "dois" in texto and ponto["entregas"] == []


def test_relatorio_ponto_sem_turno_e_recusado(ponto):
    ponto["runs"] = []
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "b"]}))
    assert erro and texto == m._FORA_DO_TURNO_LER and ponto["entregas"] == []


def test_relatorio_ponto_com_id_de_fora_da_conversa_nao_toca_o_r2(ponto, monkeypatch):
    async def ler_proibido(chave):
        raise AssertionError("leu o R2 com um anexo que não é da conversa")
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "nao-existe"]}))
    assert erro and "não pertence" in texto and ponto["entregas"] == []


def test_relatorio_ponto_com_dois_csv_de_marcacoes_diz_o_que_falta(ponto):
    ponto["anexos"]["b"].caminho = "m"   # o R2 devolve marcações para os dois ids
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "b"]}))
    assert erro and "banco de horas" in texto and ponto["entregas"] == []
```

> Nota para quem implementa: se o `_ConnRuns` do `isolado` não tiver algum método que a sua implementação consulta, acrescente o método ao dublê em vez de mudar a implementação para caber nele.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mcp_anexos.py -q`
Expected: FAIL — `AttributeError: module 'app.routers.mcp_anexos' has no attribute 'ferramentas_de'`

- [ ] **Step 3: Extrair `_entregar` de `_enviar_arquivo`, sem mudar comportamento**

Em `backend/app/routers/mcp_anexos.py`, o corpo de `_enviar_arquivo` depois de montar o arquivo vira uma função própria. `_enviar_arquivo` fica:

```python
async def _enviar_arquivo(agent_id: str, args: dict) -> tuple[str, bool]:
    para = str(args.get("para") or "").strip()
    if para.startswith("hsos-"):
        para = para[len("hsos-"):]
    try:
        # UUID aceita chaves, urn: e sem hífen; o valor cru iria para o caminho.
        para = str(uuid.UUID(para))
    except (ValueError, AttributeError):
        return "`para` deve ser o id (uuid) da pessoa, como aparece em hsos-<id>.", True
    try:
        # Destino primeiro: montar PDF de 2M caracteres para quem nem pode receber
        # seria trabalho (e thread) jogados fora.
        async with sessao(role="service_role") as conn:
            if not await _ja_conversa(conn, agent_id, para):
                return ("Só posso enviar arquivo para quem já conversa com você. "
                        "Não tente outro destino; responda na conversa em curso."), True
            if not await turno_em_curso(conn, agent_id, para):
                logger.warning("enviar_arquivo fora do turno: agente %s, destino %s", agent_id, para)
                return _FORA_DO_TURNO_ENVIAR, True
    except Exception:  # noqa: BLE001
        logger.exception("enviar_arquivo: falha interna (agente %s, destino %s)", agent_id, para)
        return "Falha interna ao enviar o arquivo; avise o administrador.", True
    try:
        # Numa thread: reportlab/docx/openpyxl são síncronos e pesados; no
        # loop travariam o worker (chat, /ws, /reply).
        dados, mime, nome = await anyio.to_thread.run_sync(
            lambda: montar_arquivo(str(args.get("formato") or ""),
                                   str(args.get("nome") or ""), str(args.get("conteudo") or "")))
    except ValueError as e:
        return str(e), True
    return await _entregar(agent_id, para, nome, dados, mime)


async def _entregar(agent_id: str, para: str, nome: str, dados: bytes, mime: str) -> tuple[str, bool]:
    """Grava o arquivo como anexo da conversa com `para` e na Documentos dele.

    Quem chama já conferiu o destino. Usada pelo `enviar_arquivo` e pelo
    `relatorio_ponto`: as duas entregas têm que ser idênticas, senão uma delas
    aparece na conversa e some da Documentos (ou o contrário).
    """
    anexo_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    gravados: list[str] = []
    try:
        caminho = ax.caminho_do_anexo(anexo_id, "conversa_agente", agent_id, nome)
        # ... daqui até o `return (f"Enviado: ...` final: o bloco atual de
        # `_enviar_arquivo` SEM ALTERAÇÃO — gravação no R2, os três INSERT,
        # o `except` que recolhe o que subiu e o log final.
```

Mova o bloco literalmente (do `caminho = ax.caminho_do_anexo(...)` até o `return` final, incluindo o `except Exception` com o recolhimento de `gravados`) para dentro de `_entregar`. Não reescreva: os testes `test_falha_no_insert_recolhe_os_objetos_do_r2` e `test_caminho_feliz_grava_anexo_da_conversa_do_agente` são a garantia de que o comportamento não mudou.

Run: `.venv/bin/python -m pytest tests/test_mcp_anexos.py -q -k "enviar or destino or insert or caminho_feliz or para_que"`
Expected: os testes de envio que já existiam continuam PASS.

- [ ] **Step 4: Ferramentas por agente e `relatorio_ponto`**

Acrescentar a `_FERRAMENTAS` (no fim da lista):

```python
}, {
    "name": "relatorio_ponto",
    "description": (
        "Monta o controle de jornada do mês a partir dos DOIS CSV do Flash que a pessoa "
        "anexou: o de marcações (MarcacoesOriginaisJustificadas) e o de banco de horas "
        "(BancoHoras). Passe os dois ids, em qualquer ordem. O servidor calcula com a "
        "régua do RH e envia a planilha à pessoa na conversa e na Documentos; você recebe "
        "só o resumo. NÃO recalcule nem reescreva os números: repasse o resumo e diga que "
        "a planilha chegou. A Tratativa e a confirmação caso a caso são da pessoa."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "ids": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2,
                    "description": "Os ids dos dois anexos, como vieram em [anexo: … id=…]."},
        },
        "required": ["ids"],
    },
}]

# Ferramenta que só alguns agentes enxergam. A identidade vem da URL assinada,
# então esconder no `tools/list` e recusar no `tools/call` é uma fronteira de
# verdade — não depende do agente se declarar.
_FERRAMENTAS_RESTRITAS = {"relatorio_ponto": frozenset({"bruce"})}


def ferramentas_de(agent_id: str) -> list[dict]:
    return [f for f in _FERRAMENTAS
            if agent_id in _FERRAMENTAS_RESTRITAS.get(f["name"], {agent_id})]
```

Acrescentar, depois de `_ler_anexo`:

```python
async def _relatorio_ponto(agent_id: str, args: dict) -> tuple[str, bool]:
    ids = args.get("ids")
    if not isinstance(ids, list) or len(ids) != 2 or not all(isinstance(i, str) and i.strip() for i in ids):
        return "Passe `ids` com os ids dos DOIS anexos do Flash (marcações e banco de horas).", True
    ids = [i.strip() for i in ids]
    if ids[0] == ids[1]:
        return ("Os dois ids são o mesmo anexo. Preciso de dois arquivos: o CSV de marcações "
                "e o de banco de horas."), True
    try:
        async with sessao(role="service_role") as conn:
            anexos = []
            for anexo_id in ids:
                anexo = await buscar_anexo(conn, anexo_id)
                # Só anexo de conversa com este agente: planilha de RH em canal
                # não é o caso de uso, e canal não tem dono a quem entregar.
                if (anexo is None or anexo.contexto != "conversa_agente"
                        or not ax.agente_pode_ler(anexo, agent_id, False)):
                    logger.warning("relatorio_ponto recusado: agente %s, anexo %s", agent_id, anexo_id)
                    return ("Este anexo não pertence a uma conversa sua. Não tente de novo; "
                            "peça à pessoa para anexar os arquivos aqui."), True
                anexos.append(anexo)
            if anexos[0].dono_conversa != anexos[1].dono_conversa:
                return "Os dois anexos têm que ser da mesma pessoa, na conversa com você.", True
            dono = str(anexos[0].dono_conversa)
            if not await turno_em_curso(conn, agent_id, dono):
                return _FORA_DO_TURNO_LER, True
        arquivos = []
        for anexo in anexos:
            dados = await arm.ler(arm.chave("anexos", anexo.caminho))
            if dados is None:
                return f"O arquivo {anexo.nome} não está mais no armazenamento.", True
            arquivos.append((anexo.nome, dados))
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: falha interna (agente %s)", agent_id)
        return "Falha interna ao ler os anexos; avise o administrador.", True

    def calcular():
        r = ponto.gerar(arquivos)
        return r, ponto.montar_xlsx(r)

    try:
        # Numa thread: CSV + openpyxl são síncronos; no loop travariam o worker.
        relatorio, xlsx = await anyio.to_thread.run_sync(calcular)
    except ponto.ErroPonto as e:
        return str(e), True
    except Exception:  # noqa: BLE001
        logger.exception("relatorio_ponto: falha ao calcular (agente %s)", agent_id)
        return "Não consegui montar a planilha com estes arquivos; avise o administrador.", True

    texto, erro = await _entregar(
        agent_id, dono, ponto.nome_do_arquivo(relatorio), xlsx,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if erro:
        return texto, True
    logger.info("relatorio_ponto: %s montou %s para %s", agent_id, ponto.nome_do_arquivo(relatorio), dono)
    return f"{ponto.resumo(relatorio)}\n\n{texto}", False
```

Import no topo, junto dos outros de `app`:

```python
from app.relatorios import ponto
```

No `mcp_anexos` (a rota), trocar `tools/list` e o despacho:

```python
    if metodo == "tools/list":
        return _resposta(ident, {"tools": ferramentas_de(agent_id)})
    if metodo == "tools/call":
        nome, args = params.get("name"), params.get("arguments") or {}
        if nome not in {f["name"] for f in ferramentas_de(agent_id)}:
            return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
        if nome == "ler_anexo":
            texto, erro = await _ler_anexo(agent_id, args)
            return _texto(ident, texto, erro)
        if nome == "enviar_arquivo":
            texto, erro = await _enviar_arquivo(agent_id, args)
            return _texto(ident, texto, erro)
        if nome == "relatorio_ponto":
            texto, erro = await _relatorio_ponto(agent_id, args)
            return _texto(ident, texto, erro)
        return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
```

- [ ] **Step 5: Run the whole suite**

Run: `.venv/bin/python -m pytest tests -q`
Expected: tudo PASS (os 381 de antes + os novos)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/mcp_anexos.py backend/tests/test_mcp_anexos.py
git commit -m "feat(anexos): relatorio_ponto no hsos-anexos, só para o bruce"
```

---

### Task 5: Skill, ponteiro no `bruce` e registro

Depende do deploy do `hsos-backend` com as Tasks 1–4: sem ele a ferramenta não existe em produção e o ponteiro manda o agente para algo que não há.

**Files:**
- Create: `backend/skills/ponto-flash/SKILL.md`
- Modify: `CLAUDE.md` (seção "Anexos — R2, privados, e o agente lê por ferramenta", um parágrafo no fim)
- Modify: `docs/CONTINUAR-AQUI.md` (item 0, estado)
- Gateway: `AGENTS.md` do `bruce` (uma linha)

- [ ] **Step 1: Escrever a skill**

```markdown
---
name: ponto-flash
description: >-
  Controle de jornada do RH a partir do export do Flash (sistema de ponto). Use
  SEMPRE que alguém anexar os CSV do Flash (MarcacoesOriginaisJustificadas e
  BancoHoras) ou pedir o controle de jornada, atrasos, entradas e saídas fora do
  horário, intervalo, ajustes de ponto ou banco de horas do mês.
emoji: ⏱️
always: false
---

# Controle de jornada — a régua do RH

⚠️ **Não calcule de cabeça.** São ~500 dias de marcação por mês e cada
indicador tem dois limites. Quem calcula é a ferramenta `relatorio_ponto`.

## Quando chegarem os arquivos

1. Confira que vieram os **dois** CSV do Flash: marcações e banco de horas. Se
   faltar um, peça — não monte com um só.
2. Chame `relatorio_ponto` com os dois ids, como vieram em `[anexo: … id=…]`.
3. A planilha chega à pessoa sozinha, na conversa e na Documentos. Responda com o
   resumo que a ferramenta devolveu, sem reescrever os números, e diga que a
   planilha chegou.

## A régua (para explicar, não para calcular)

- Entrada = 1ª batida; intervalo = 3ª − 2ª; saída = **última** batida.
- **Originais** (Controle Principal): antecipada antes de 7h29, atraso a partir
  de 7h46, saída antecipada antes de 16h59, após jornada depois de 17h01.
- **Analisadas** (Dados e-mail, o que vai ao Nicholson): antecipada até 7h19,
  atraso a partir de 7h50, saída antecipada até 16h48, após jornada a partir de
  17h20.
- Intervalo diferente de 1h conta nas duas.
- Ajuste de ponto conta, menos os de trabalho (externo, viagem, home office,
  atendimento a cliente).
- 10 ou mais ocorrências num indicador = recorrente. 3 recorrentes CRÍTICO, 2
  ATENÇÃO, 1 ACOMPANHAMENTO.

## O que é da pessoa, não seu

- A coluna **Tratativa**.
- Confirmar ou descartar cada ocorrência — a aba **Ocorrências** existe para isso.
- Mudar a régua. Se ela disser que um limite ou uma regra está errado, anote
  exatamente o que ela disse e avise que o ajuste é feito pelo TI. Não aplique
  uma régua diferente por conta própria.
```

- [ ] **Step 2: Publicar a skill**

Run (da raiz): `bash scripts/publicar-skills.sh --enviar`
Expected: `ponto-flash` listada como enviada.

- [ ] **Step 3: Ponteiro no `AGENTS.md` do `bruce`, medindo o teto antes**

Ler o `AGENTS.md` do `bruce` por `agents.files.get`, guardar cópia no scratchpad, acrescentar ao fim da seção "Ponto eletrônico é meu":

```
Planilha de ponto do Flash (CSV de marcações e de banco de horas) começa abrindo a skill `ponto-flash`.
```

Conferir com `excede_o_teto(novo)` de `app/gateway/client.py` antes de gravar (hoje 8.937 de 20.000); gravar com `agents.files.set` e reler com `agents.files.get` comparando com o texto gravado.

- [ ] **Step 4: Conferir perguntando ao `bruce`** (combinar o envio com o Erick antes — é escrita no gateway)

Pergunta, sem citar a skill nem a ferramenta: *"Se a RH te mandar os dois CSV do Flash do mês, o que você faz com eles?"*
Expected: ele diz que abre a skill/chama a ferramenta de relatório com os dois ids e não calcula de cabeça.

- [ ] **Step 5: Registrar no `CLAUDE.md` e no `CONTINUAR-AQUI.md`**

No `CLAUDE.md`, ao fim da seção de anexos:

```markdown
⚠️ **`relatorio_ponto` mora no `hsos-anexos` e só o `bruce` a enxerga.** O
`tools/list` desse servidor depende do agente da URL (`_FERRAMENTAS_RESTRITAS`),
e `tools/call` de outro agente recebe "ferramenta desconhecida". A régua é a da
coordenadora de RH, em `app/relatorios/ponto.py` — **mudou na conversa com ela,
muda lá**, com teste. O xlsx dela vem com número de verdade; o do
`enviar_arquivo` continua todo texto.
```

No `docs/CONTINUAR-AQUI.md`, item 0: marcar os passos 3 e 4 como feitos, com a data, e apontar para a spec.

- [ ] **Step 6: Commit**

```bash
git add backend/skills/ponto-flash/SKILL.md CLAUDE.md docs/CONTINUAR-AQUI.md
git commit -m "feat(ponto): skill ponto-flash e registro da ferramenta do bruce"
```
