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
