# backend/app/relatorios/ponto.py
"""Relatório de ponto do Flash — régua v2, Grupo A (Pontualidade e Jornada).

⚠️ **A régua é da coordenadora de RH, não nossa.** Mandada por escrito em
27/10/2026; mudou na conversa com ela, muda aqui — e muda `VERSAO_REGUA`, senão
o histórico compara meses apurados com réguas diferentes como se fossem iguais.
Ver `docs/superpowers/specs/2026-10-28-regua-ponto-v2-design.md`.

⚠️ **Por que existe código e não o agente:** na homologação o `bruce` leu os
CSV com `ler_anexo` e contou de cabeça — 21 eventos aprovados e 2 cancelados,
quando o arquivo tem 20 e 3. Número sai daqui.

Critérios **gerenciais**: o Flash faz a apuração oficial e nenhum saldo é
recalculado aqui.

⚠️ `CID` e `Justificativa` de evento **não são lidos** — `identificar` descarta
as colunas na leitura, antes de qualquer outra coisa. Ela pediu explicitamente
para não reproduzir diagnóstico.

Módulo puro: bytes entram, `Relatorio` sai; o histórico é um `dict` montado
aqui e gravado no R2 por `app/routers/mcp_anexos.py`.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

VERSAO_REGUA = "2026-10-28"
TETO_LINHAS = 5000


def _hm(texto: str) -> int:
    h, m = texto.split(":")[:2]
    return int(h) * 60 + int(m)


# ── a régua (texto dela, 27/10/2026) — por minuto, segundos descartados ────
ENTRADA_ANTECIPADA_ANTES = _hm("07:20")  # entrada <  07:20 → A1
ATRASO_DESDE = _hm("07:46")              # entrada >= 07:46 → A2
SAIDA_ANTECIPADA_ANTES = _hm("16:50")    # saída   <  16:50 → A3
APOS_JORNADA_DEPOIS = _hm("17:10")       # saída   >  17:10 → A4
INTERVALO_MIN = 60                       # < A5 · = regular · > A6

MEDIDAS = ("entrada", "saida", "intervalo")
# ⚠️ A numeração A1–A6 é NOSSA, na ordem da tabela dela; ela fala em "A1 a A6"
# sem listar. Sai sempre número + nome, para ela corrigir se for outra ordem.
INDICADORES = {
    "A1": ("Entrada antecipada", "entrada"),
    "A2": ("Atraso", "entrada"),
    "A3": ("Saída antecipada", "saida"),
    "A4": ("Permanência após jornada", "saida"),
    "A5": ("Intervalo reduzido", "intervalo"),
    "A6": ("Intervalo prolongado", "intervalo"),
}
# (abaixo, faixa neutra, acima) de cada medida — é o que fecha a conta.
FAIXAS = {"entrada": ("A1", "Entrada permitida", "A2"),
          "saida": ("A3", "Saída permitida", "A4"),
          "intervalo": ("A5", "Intervalo regular", "A6")}
NEUTRA = "neutra"
NOME_MEDIDA = {"entrada": "entrada", "saida": "saída", "intervalo": "intervalo"}

IDENTIFICADA, JUSTIFICADA = "identificada", "justificada"

# Caractere de controle num campo do Flash faria o openpyxl recusar a célula
# e derrubar a planilha inteira; não há uso legítimo para eles aqui.
_CONTROLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

_COL_MARC = {"Nome", "Data da Marcação", "Hora da Marcação 1", "Tipo Marcação 1"}
_COL_BANCO = {"Nome", "Matrícula", "Saldo banco total"}
_COL_EVENTOS = {"EventoId", "Motivo", "Data Inicio", "Status"}
# Só estas colunas do Eventos sobrevivem à leitura. `CID`, `Justificativa` e
# `Observação da Aprovação` ficam de fora por construção — o que não é lido não
# vaza por descuido numa aba nova.
_EVENTOS_USADAS = ("Matrícula", "Nome", "Departamento", "EventoId", "Motivo", "Descrição",
                   "Data Inicio", "Data Fim", "Hora Inicio", "Hora Fim", "Qtde", "Status")
TIPOS = {
    "marcacoes": "marcações (MarcacoesOriginaisJustificadas)",
    "eventos": "eventos (Eventos)",
    "banco": "banco de horas (BancoHoras)",
}


class ErroPonto(ValueError):
    """Problema nos arquivos, com mensagem que o agente repassa à pessoa."""


# ── calendário ──────────────────────────────────────────────────────────────

def pascoa(ano: int) -> date:
    """Domingo de Páscoa — algoritmo de Meeus/Jones/Butcher (gregoriano)."""
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


# A lista dela: todos valem para a HS (Recife/PE).
_FERIADOS_FIXOS = (
    (1, 1, "Confraternização Mundial", "Nacional"),
    (3, 6, "Data Magna", "Estadual"),
    (4, 21, "Tiradentes", "Nacional"),
    (5, 1, "Dia do Trabalhador", "Nacional"),
    (6, 24, "São João", "Estadual"),
    (9, 7, "Independência", "Nacional"),
    (10, 12, "Nossa Senhora Aparecida", "Nacional"),
    (10, 19, "Dia do Comerciário", "Municipal"),
    (11, 2, "Finados", "Nacional"),
    (11, 15, "Proclamação da República", "Nacional"),
    (11, 20, "Consciência Negra", "Nacional"),
    (12, 8, "Imaculada Conceição", "Municipal"),
    (12, 25, "Natal", "Nacional"),
)


def feriados(ano: int) -> dict[date, tuple[str, str]]:
    """`{data: (nome, tipo)}`. Carnaval e Paixão saem da Páscoa — fixá-los em
    2026 quebraria a régua em janeiro."""
    p = pascoa(ano)
    saida = {date(ano, m, d): (nome, tipo) for m, d, nome, tipo in _FERIADOS_FIXOS}
    saida[p - timedelta(days=47)] = ("Carnaval", "Nacional")
    saida[p - timedelta(days=2)] = ("Paixão de Cristo", "Nacional")
    return saida


def dias_uteis(ano: int, mes: int) -> list[date]:
    fer = feriados(ano)
    d, saida = date(ano, mes, 1), []
    while d.month == mes:
        if d.weekday() < 5 and d not in fer:
            saida.append(d)
        d += timedelta(days=1)
    return saida


# ── estruturas ──────────────────────────────────────────────────────────────

@dataclass
class Evento:
    id: str
    chave: str
    matricula: str
    nome: str
    motivo: str
    codigo: str
    inicio: date
    fim: date
    hora_inicio: int | None
    hora_fim: int | None
    qtde: str
    status: str
    usado: bool = False
    por_que: str = ""
    justificou: list[str] = field(default_factory=list)

    @property
    def aprovado(self) -> bool:
        return self.status.strip().lower() == "aprovado"

    @property
    def dia_inteiro(self) -> bool:
        return self.hora_inicio is None and self.hora_fim is None

    @property
    def parcial(self) -> bool:
        return self.hora_inicio is not None and self.hora_fim is not None

    def evidencia(self) -> str:
        return f"{self.id} · {self.motivo}" + (f" ({self.codigo})" if self.codigo else "")


@dataclass
class Ocorrencia:
    chave: str
    matricula: str
    nome: str
    data: date
    indicador: str        # "A1".."A6"
    minutos: int          # horário da batida, ou duração do intervalo
    situacao: str         # identificada | justificada
    evento: str           # evidência do evento que justifica ("" se nenhum)
    batidas: str          # "07:52 · 12:00 · 13:00 · 17:05"
    ajuste: str           # "batida ajustada: <motivo>" ("" se original)


@dataclass
class Pendencia:
    chave: str
    matricula: str
    nome: str
    data: date
    medida: str           # dia | saída | intervalo | fora da escala | aviso
    motivo: str


@dataclass
class DiaAvaliado:
    """Um dia elegível de uma pessoa: a faixa de cada medida, ou `None` se pendente."""
    chave: str
    data: date
    faixa: dict           # medida -> "A1" | "neutra" | "A2" | None


@dataclass
class Pessoa:
    chave: str
    matricula: str
    nome: str
    setor: str
    dias_uteis: int = 0
    dias_fora: int = 0
    dias_elegiveis: int = 0
    dias_pendentes: int = 0
    identificadas: dict = field(default_factory=lambda: dict.fromkeys(INDICADORES, 0))
    justificadas: dict = field(default_factory=lambda: dict.fromkeys(INDICADORES, 0))
    avaliados: dict = field(default_factory=lambda: dict.fromkeys(MEDIDAS, 0))
    pendentes: dict = field(default_factory=lambda: dict.fromkeys(MEDIDAS, 0))
    neutras: dict = field(default_factory=lambda: dict.fromkeys(MEDIDAS, 0))
    saldo_min: int | None = None
    saldo_txt: str = ""


@dataclass
class Conferencia:
    verificacao: str
    esperado: int
    obtido: int

    @property
    def ok(self) -> bool:
        return self.esperado == self.obtido


@dataclass
class Comparacao:
    status: str           # comparado | outra_versao | sem_historico | indisponivel
    periodo: str          # "AAAA-MM" do mês anterior
    mensagem: str
    linhas: dict = field(default_factory=dict)   # "A1" -> {identificadas, denominador, pct, variacao_pp}


@dataclass
class Relatorio:
    mes: int
    ano: int
    arquivos: list[tuple[str, str]]          # (nome, sha256)
    uteis: list[date]
    pessoas: list[Pessoa]
    dias: list[DiaAvaliado]
    ocorrencias: list[Ocorrencia]
    pendencias: list[Pendencia]
    eventos: list[Evento]
    tem_banco: bool
    conferencias: list[Conferencia] = field(default_factory=list)
    comparacao: Comparacao | None = None


# ── leitura ─────────────────────────────────────────────────────────────────

def _decodificar(dados: bytes) -> str:
    # O Flash exporta UTF-8 com BOM; reaberto e salvo no Excel vira Latin-1.
    try:
        return dados.decode("utf-8-sig")
    except UnicodeDecodeError:
        return dados.decode("latin-1")


def identificar(nome: str, dados: bytes) -> tuple[str, list[dict]]:
    """`("marcacoes" | "eventos" | "banco", registros)` — pelo cabeçalho, não pelo nome."""
    leitor = csv.DictReader(io.StringIO(_decodificar(dados)), delimiter=";")
    try:
        colunas = {(c or "").strip() for c in (leitor.fieldnames or [])}
    except csv.Error as e:
        raise ErroPonto(f"{nome} não pôde ser lido como CSV: {e}.") from e
    if _COL_MARC <= colunas:
        tipo = "marcacoes"
    elif _COL_EVENTOS <= colunas:
        tipo = "eventos"
    elif _COL_BANCO <= colunas:
        tipo = "banco"
    else:
        raise ErroPonto(
            f"{nome} não parece um export do Flash: esperava o CSV de marcações "
            "(MarcacoesOriginaisJustificadas), o de eventos (Eventos) ou o de banco de "
            "horas (BancoHoras).")
    try:
        registros = []
        for r in leitor:
            if not any((v or "").strip() for v in r.values() if isinstance(v, str)):
                continue
            linha = {(k or "").strip(): _CONTROLE.sub("", v if isinstance(v, str) else "").strip()
                     for k, v in r.items()}
            if tipo == "eventos":
                linha = {k: linha.get(k, "") for k in _EVENTOS_USADAS}
            registros.append(linha)
    except csv.Error as e:
        raise ErroPonto(f"{nome} não pôde ser lido como CSV: {e}.") from e
    if len(registros) > TETO_LINHAS:
        raise ErroPonto(f"{nome} tem {len(registros)} linhas; o limite é {TETO_LINHAS}.")
    return tipo, registros


def _minutos(texto: str) -> int | None:
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", texto or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _data(texto: str) -> date | None:
    """`dd/mm/aaaa` do Flash; qualquer outra forma é `None` (quem chama nomeia a linha)."""
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", (texto or "").strip())
    if not m or int(m.group(3)) < 2000:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


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
                   if unicodedata.category(c) != "Mn").strip()


def _chave(matricula: str, nome: str) -> str:
    """Matrícula sem zeros à esquerda; sem matrícula (`-`), nome sem acento e minúsculo."""
    return f"m:{matricula}" if matricula else f"n:{_sem_acento(nome)}"


def _fmt(minutos: int | None) -> str:
    if minutos is None:
        return ""
    sinal = "-" if minutos < 0 else ""
    return f"{sinal}{abs(minutos) // 60:02d}:{abs(minutos) % 60:02d}"


def _codigo(descricao: str) -> str:
    """O número entre parênteses na Descrição: `"... do dia (1004)"` → `"1004"`."""
    achados = re.findall(r"\((\d{3,5})\)", descricao or "")
    return achados[-1] if achados else ""


# ── a régua ─────────────────────────────────────────────────────────────────

def faixa(medida: str, minutos: int) -> str:
    """`"A1".."A6"` ou `NEUTRA`. Os limites estão nas constantes acima."""
    if medida == "entrada":
        return "A1" if minutos < ENTRADA_ANTECIPADA_ANTES else "A2" if minutos >= ATRASO_DESDE else NEUTRA
    if medida == "saida":
        return "A3" if minutos < SAIDA_ANTECIPADA_ANTES else "A4" if minutos > APOS_JORNADA_DEPOIS else NEUTRA
    return "A5" if minutos < INTERVALO_MIN else "A6" if minutos > INTERVALO_MIN else NEUTRA


def _sobreposicao(periodos: list[tuple[int, int]], ini: int, fim: int) -> int:
    """Minutos de `[ini, fim]` cobertos pela união dos períodos."""
    cortes = sorted((max(a, ini), min(b, fim)) for a, b in periodos if min(b, fim) > max(a, ini))
    total, ate = 0, ini
    for a, b in cortes:
        a = max(a, ate)
        if b > a:
            total += b - a
            ate = b
    return total


def justificativa(indicador: str, batidas: list[int], eventos: list[Evento]) -> list[Evento]:
    """Os eventos aprovados parciais do dia que justificam a ocorrência (vazio = identificada).

    A1, A4 e A5 não são justificáveis por evento de ausência: chegar cedo, sair
    tarde e voltar antes não são ausência.
    """
    if indicador == "A2":
        entrada = batidas[0]
        return [e for e in eventos if e.hora_inicio <= ATRASO_DESDE - 1 and e.hora_fim >= entrada]
    if indicador == "A3":
        saida = batidas[-1]
        return [e for e in eventos if e.hora_inicio <= saida and e.hora_fim >= SAIDA_ANTECIPADA_ANTES]
    if indicador == "A6":
        ini, fim = batidas[1], batidas[2]
        quem = [e for e in eventos if min(e.hora_fim, fim) > max(e.hora_inicio, ini)]
        cobre = _sobreposicao([(e.hora_inicio, e.hora_fim) for e in quem], ini, fim)
        return quem if cobre > 0 and (fim - ini) - cobre <= INTERVALO_MIN else []
    return []


def _ler_eventos(registros: list[dict], nome_arq: str) -> list[Evento]:
    eventos = []
    for n, l in enumerate(registros, start=2):
        inicio = _data(l.get("Data Inicio", ""))
        if inicio is None:
            raise ErroPonto(f"{nome_arq}: data inválida {l.get('Data Inicio', '')!r} na linha {n} "
                            "(esperado dd/mm/aaaa).")
        fim_txt = l.get("Data Fim", "")
        fim = _data(fim_txt) if fim_txt else inicio
        if fim is None:
            raise ErroPonto(f"{nome_arq}: data inválida {fim_txt!r} na linha {n} (esperado dd/mm/aaaa).")
        mat = _matricula(l.get("Matrícula", ""))
        eventos.append(Evento(
            id=l.get("EventoId", ""), chave=_chave(mat, l.get("Nome", "")), matricula=mat,
            nome=l.get("Nome", ""), motivo=l.get("Motivo", ""), codigo=_codigo(l.get("Descrição", "")),
            inicio=inicio, fim=max(fim, inicio),
            hora_inicio=_minutos(l.get("Hora Inicio", "")), hora_fim=_minutos(l.get("Hora Fim", "")),
            qtde=l.get("Qtde", ""), status=l.get("Status", "")))
    return eventos


def _evidencia_ajuste(linha: dict, posicoes: list[int]) -> str:
    motivos = [linha.get(f"Motivo Marcação {i}", "") or "sem motivo"
               for i in posicoes if linha.get(f"Tipo Marcação {i}") == "Justificada"]
    return "; ".join(f"batida ajustada: {m}" for m in motivos)


def gerar(arquivos: list[tuple[str, bytes]]) -> Relatorio:
    """`arquivos` = [(nome, bytes)]: marcações e eventos (obrigatórios), banco (opcional)."""
    lidos: dict[str, list[dict]] = {}
    nomes: dict[str, str] = {}
    hashes = []
    for nome, dados in arquivos:
        tipo, registros = identificar(nome, dados)
        if tipo in lidos:
            raise ErroPonto(f"Vieram dois CSV de {TIPOS[tipo]}: {nomes[tipo]} e {nome}. "
                            "Mande um de cada.")
        lidos[tipo], nomes[tipo] = registros, nome
        hashes.append((nome, hashlib.sha256(dados).hexdigest()))
    faltam = [TIPOS[t] for t in ("marcacoes", "eventos") if t not in lidos]
    if faltam:
        achou = ", ".join(nomes.values()) or "nenhum"
        raise ErroPonto(
            f"Falta o CSV de {' e '.join(faltam)} — é obrigatório: sem os eventos não há como "
            f"saber quem estava de férias, atestado ou day-off, e o denominador sai errado. "
            f"Reconhecido: {achou}.")

    linhas = lidos["marcacoes"]
    datas = []
    for n, l in enumerate(linhas, start=2):   # linha 1 é o cabeçalho
        d = _data(l.get("Data da Marcação", ""))
        if d is None:
            raise ErroPonto(f"{nomes['marcacoes']}: data inválida "
                            f"{l.get('Data da Marcação', '')!r} na linha {n} (esperado dd/mm/aaaa).")
        datas.append(d)
    meses = sorted({(d.month, d.year) for d in datas})
    if len(meses) != 1:
        rotulos = ", ".join(f"{m:02d}/{a}" for m, a in meses) or "nenhum"
        raise ErroPonto(f"O CSV de marcações precisa ser de um mês só; veio: {rotulos}.")
    mes, ano = meses[0]
    uteis = dias_uteis(ano, mes)
    uteis_set = set(uteis)
    fer = feriados(ano)

    # Pessoas: quem tem marcação no mês. Casa por matrícula; sem ela, por nome.
    pessoas: dict[str, Pessoa] = {}
    por_dia: dict[tuple[str, date], tuple[int, dict]] = {}
    for n, (l, dia) in enumerate(zip(linhas, datas), start=2):
        mat = _matricula(l.get("Matrícula", ""))
        chave = _chave(mat, l.get("Nome", ""))
        pessoas.setdefault(chave, Pessoa(chave, mat, l.get("Nome", ""), l.get("Departamento", "")))
        if (chave, dia) in por_dia:
            raise ErroPonto(f"{nomes['marcacoes']}: a linha {n} repete pessoa e dia da linha "
                            f"{por_dia[(chave, dia)][0]} ({dia:%d/%m/%Y}).")
        por_dia[(chave, dia)] = (n, l)
    por_nome = {_sem_acento(p.nome): p.chave for p in pessoas.values()}

    def casar(mat: str, nome: str) -> str | None:
        if mat and f"m:{mat}" in pessoas:
            return f"m:{mat}"
        return por_nome.get(_sem_acento(nome))

    # Eventos: o que tira dia do denominador e o que justifica período.
    eventos = _ler_eventos(lidos["eventos"], nomes["eventos"])
    dias_fora: dict[tuple[str, date], Evento] = {}
    parciais: dict[tuple[str, date], list[Evento]] = defaultdict(list)
    for e in eventos:
        dono = casar(e.matricula, e.nome)
        if dono:
            e.chave = dono
        no_mes = [d for d in _intervalo(e.inicio, e.fim) if d.month == mes and d.year == ano]
        uteis_ev = [d for d in no_mes if d in uteis_set]
        if not e.aprovado:
            e.por_que = f"não: status {e.status or 'vazio'} — só Aprovado justifica"
        elif dono is None:
            e.por_que = "não: pessoa sem marcação no mês"
        elif not no_mes:
            e.por_que = "não: fora do mês apurado"
        elif not (e.dia_inteiro or e.parcial):
            e.por_que = "não: só uma das horas (início/fim) preenchida — conferir no Flash"
        elif not uteis_ev:
            e.por_que = "não: nenhum dia útil do mês no período"
        elif e.dia_inteiro:
            e.usado = True
            for d in uteis_ev:
                dias_fora.setdefault((dono, d), e)
            e.por_que = f"sim: {len(uteis_ev)} dia(s) útil(eis) fora do denominador"
        else:
            e.usado = True
            for d in uteis_ev:
                parciais[(dono, d)].append(e)
            e.por_que = "sim: período justificado"

    dias: list[DiaAvaliado] = []
    ocorrencias: list[Ocorrencia] = []
    pendencias: list[Pendencia] = []

    def pendencia(p: Pessoa, d: date, medida: str, motivo: str) -> None:
        pendencias.append(Pendencia(p.chave, p.matricula, p.nome, d, medida, motivo))

    # Marcação fora da escala: sábado, domingo ou feriado não entra em indicador.
    for (chave, d), (_, l) in sorted(por_dia.items(), key=lambda x: (x[0][0], x[0][1])):
        if d in uteis_set:
            continue
        p = pessoas[chave]
        quando = f"feriado ({fer[d][0]})" if d in fer else ("sábado" if d.weekday() == 5 else "domingo")
        if _batidas(l):
            pendencia(p, d, "fora da escala", f"marcação fora da escala: {quando}")

    for p in pessoas.values():
        p.dias_uteis = len(uteis)
        for d in uteis:
            linha = por_dia.get((p.chave, d), (0, {}))[1]
            batidas = _batidas(linha)
            if (p.chave, d) in dias_fora:
                p.dias_fora += 1
                if batidas:
                    ev = dias_fora[(p.chave, d)]
                    pendencia(p, d, "aviso", f"marcação em dia de evento de dia inteiro ({ev.evidencia()}); "
                                             "dia fora do denominador — conferir")
                continue
            p.dias_elegiveis += 1
            evs = parciais.get((p.chave, d), [])
            nao_aprovada = [i for i in range(1, 7) if _minutos(linha.get(f"Hora da Marcação {i}", "")) is not None
                            and linha.get(f"Tipo Marcação {i}") == "Justificada"
                            and linha.get(f"Status Marcação {i}", "").strip().lower() != "aprovado"]
            if not batidas or nao_aprovada:
                p.dias_pendentes += 1
                for m in MEDIDAS:
                    p.pendentes[m] += 1
                dias.append(DiaAvaliado(p.chave, d, dict.fromkeys(MEDIDAS)))
                if nao_aprovada:
                    motivo = "batida justificada não aprovada — conferir no Flash"
                elif evs:
                    motivo = ("sem marcação; há evento parcial aprovado ("
                              + ", ".join(e.evidencia() for e in evs) + ") — conferir")
                else:
                    motivo = "sem marcação e sem evento aprovado — não é falta; conferir"
                pendencia(p, d, "dia", motivo)
                continue

            n = len(batidas)
            medidas = {"entrada": (batidas[0], [1])}
            if n % 2 == 0:
                medidas["saida"] = (batidas[-1], [n])
            if n == 4:
                medidas["intervalo"] = (batidas[2] - batidas[1], [2, 3])
            dia_av = DiaAvaliado(p.chave, d, dict.fromkeys(MEDIDAS))
            texto_batidas = " · ".join(_fmt(b) for b in batidas)
            for m in MEDIDAS:
                if m not in medidas:
                    p.pendentes[m] += 1
                    if m == "saida":
                        motivo = f"{n} batida(s): saída não verificável — conferir no Cálculos Diários"
                    else:
                        motivo = f"{n} batida(s): intervalo não verificável — conferir no Cálculos Diários"
                    pendencia(p, d, NOME_MEDIDA[m], motivo)
                    continue
                valor, posicoes = medidas[m]
                f = faixa(m, valor)
                dia_av.faixa[m] = f
                p.avaliados[m] += 1
                if f == NEUTRA:
                    p.neutras[m] += 1
                    continue
                quem = justificativa(f, batidas, evs)
                for e in quem:
                    e.justificou.append(f"{f} em {d:%d/%m}")
                situacao = JUSTIFICADA if quem else IDENTIFICADA
                (p.justificadas if quem else p.identificadas)[f] += 1
                ocorrencias.append(Ocorrencia(
                    p.chave, p.matricula, p.nome, d, f, valor, situacao,
                    "; ".join(e.evidencia() for e in quem), texto_batidas,
                    _evidencia_ajuste(linha, posicoes)))
            dias.append(dia_av)

    for e in eventos:
        if e.justificou:
            e.por_que += "; justificou " + ", ".join(e.justificou)

    if "banco" in lidos:
        for b in lidos["banco"]:
            dono = casar(_matricula(b.get("Matrícula", "")), b.get("Nome", ""))
            if dono:
                pessoas[dono].saldo_min, pessoas[dono].saldo_txt = _saldo(b.get("Saldo banco total", ""))

    ordem = {c: i for i, c in enumerate(sorted(pessoas, key=lambda c: (_sem_acento(pessoas[c].nome), c)))}
    r = Relatorio(
        mes=mes, ano=ano, arquivos=hashes, uteis=uteis,
        pessoas=sorted(pessoas.values(), key=lambda x: ordem[x.chave]),
        dias=dias,
        ocorrencias=sorted(ocorrencias, key=lambda o: (ordem[o.chave], o.data, o.indicador)),
        pendencias=sorted(pendencias, key=lambda x: (ordem[x.chave], x.data, x.medida)),
        eventos=eventos, tem_banco="banco" in lidos)
    r.conferencias = conferir(r)
    exigir_fechamento(r)
    return r


def _intervalo(inicio: date, fim: date):
    d = inicio
    while d <= fim:
        yield d
        d += timedelta(days=1)


def _batidas(linha: dict) -> list[int]:
    """`Hora da Marcação N` preenchidas, na ordem do Flash."""
    return [m for m in (_minutos(linha.get(f"Hora da Marcação {i}", "")) for i in range(1, 7))
            if m is not None]


# ── indicadores e fechamento ────────────────────────────────────────────────

def totais(r: Relatorio) -> dict[str, dict]:
    """O quadro A1–A6, contado das listas planas (dias e ocorrências) — NÃO
    da soma por pessoa. É o que dá sentido ao fechamento."""
    q = {}
    for a, (nome, medida) in INDICADORES.items():
        ident = sum(1 for o in r.ocorrencias if o.indicador == a and o.situacao == IDENTIFICADA)
        just = sum(1 for o in r.ocorrencias if o.indicador == a and o.situacao == JUSTIFICADA)
        denom = sum(1 for d in r.dias if d.faixa[medida] is not None)
        pend = sum(1 for d in r.dias if d.faixa[medida] is None)
        pessoas = len({o.chave for o in r.ocorrencias if o.indicador == a and o.situacao == IDENTIFICADA})
        q[a] = {"nome": nome, "identificadas": ident, "justificadas": just, "pendentes": pend,
                "denominador": denom, "pct": (ident / denom) if denom else None, "pessoas": pessoas}
    return q


def conferir(r: Relatorio) -> list[Conferencia]:
    """As somas do fechamento. Divergência é defeito da ferramenta."""
    q = totais(r)
    c: list[Conferencia] = []
    for a in INDICADORES:
        c.append(Conferencia(f"{a} identificadas: soma por colaborador × total",
                             q[a]["identificadas"], sum(p.identificadas[a] for p in r.pessoas)))
        c.append(Conferencia(f"{a} justificadas: soma por colaborador × total",
                             q[a]["justificadas"], sum(p.justificadas[a] for p in r.pessoas)))
    for m in MEDIDAS:
        baixo, rotulo, alto = FAIXAS[m]
        avaliados = sum(1 for d in r.dias if d.faixa[m] is not None)
        neutras = sum(1 for d in r.dias if d.faixa[m] == NEUTRA)
        soma = (q[baixo]["identificadas"] + q[baixo]["justificadas"] + neutras
                + q[alto]["identificadas"] + q[alto]["justificadas"])
        nm = NOME_MEDIDA[m]
        c.append(Conferencia(f"{nm}: {baixo} + {rotulo.lower()} + {alto} = avaliados", avaliados, soma))
        c.append(Conferencia(f"{nm}: avaliados por colaborador × total",
                             avaliados, sum(p.avaliados[m] for p in r.pessoas)))
        c.append(Conferencia(f"{nm}: pendentes por colaborador × total",
                             q[baixo]["pendentes"], sum(p.pendentes[m] for p in r.pessoas)))
        c.append(Conferencia(f"{nm}: avaliados + pendentes = dias elegíveis",
                             sum(p.dias_elegiveis for p in r.pessoas), avaliados + q[baixo]["pendentes"]))
    c.append(Conferencia("dias elegíveis = dias úteis − dias fora (soma por colaborador)",
                         sum(p.dias_uteis - p.dias_fora for p in r.pessoas),
                         sum(p.dias_elegiveis for p in r.pessoas)))
    c.append(Conferencia("dias pendentes: soma por colaborador × total",
                         sum(1 for d in r.dias if all(v is None for v in d.faixa.values())),
                         sum(p.dias_pendentes for p in r.pessoas)))
    return c


def exigir_fechamento(r: Relatorio) -> None:
    falhas = [x for x in conferir(r) if not x.ok]
    if falhas:
        detalhe = "; ".join(f"{x.verificacao}: esperado {x.esperado}, obtido {x.obtido}" for x in falhas)
        raise ErroPonto(f"A apuração não fecha ({detalhe}). É defeito da ferramenta, não dos "
                        "arquivos: não entrego planilha que não fecha. Avise o administrador.")


# ── histórico mensal (o JSON que o router grava no R2) ──────────────────────

def periodo(r: Relatorio) -> str:
    return f"{r.ano:04d}-{r.mes:02d}"


def periodo_anterior(per: str) -> str:
    ano, mes = (int(x) for x in per.split("-"))
    return f"{ano - 1:04d}-12" if mes == 1 else f"{ano:04d}-{mes - 1:02d}"


def historico(r: Relatorio, gerado_em: str) -> dict:
    """Só matrícula e números: sem nome, sem horário, sem evento.

    Quem não tem matrícula entra nos totais e fica fora de `por_matricula` —
    a chave dele seria o nome.
    """
    q = totais(r)
    por_mat = {}
    for p in r.pessoas:
        if not p.matricula:
            continue
        por_mat[p.matricula] = {
            "dias_uteis": p.dias_uteis, "dias_fora": p.dias_fora,
            "dias_elegiveis": p.dias_elegiveis, "dias_pendentes": p.dias_pendentes,
            **{a: {"identificadas": p.identificadas[a], "justificadas": p.justificadas[a],
                   "pendentes": p.pendentes[m], "denominador": p.avaliados[m]}
               for a, (_, m) in INDICADORES.items()},
        }
    return {
        "periodo": periodo(r), "versao_regua": VERSAO_REGUA, "gerado_em": gerado_em,
        "arquivos": [{"nome": n, "sha256": h} for n, h in r.arquivos],
        "colaboradores": len(r.pessoas),
        "sem_matricula": sum(1 for p in r.pessoas if not p.matricula),
        "totais": {a: {k: v for k, v in t.items() if k not in ("nome", "pct")} for a, t in q.items()},
        "por_matricula": por_mat,
    }


def caminho_historico(h: dict) -> str:
    """`<AAAA-MM>/<versao>-<sha8 dos arquivos>.json` — dentro do bucket `ponto-historico`."""
    sha8 = hashlib.sha256("".join(sorted(a["sha256"] for a in h["arquivos"])).encode()).hexdigest()[:8]
    return f"{h['periodo']}/{h['versao_regua']}-{sha8}.json"


def _rotulo_periodo(per: str) -> str:
    ano, mes = (int(x) for x in per.split("-"))
    return f"{MESES[mes]}/{ano}"


def comparar(atual: dict, anteriores: list[dict]) -> Comparacao:
    """Compara com o mês anterior apurado na MESMA `VERSAO_REGUA` (o mais recente vale).

    Régua diferente não se compara: diz qual foi e pede reprocessamento.
    """
    alvo = periodo_anterior(atual["periodo"])
    rot = _rotulo_periodo(alvo)
    do_mes = [h for h in anteriores if isinstance(h, dict) and h.get("periodo") == alvo]
    mesma = [h for h in do_mes if h.get("versao_regua") == atual["versao_regua"]]
    if not mesma:
        if do_mes:
            versoes = ", ".join(sorted({str(h.get("versao_regua")) for h in do_mes}))
            return Comparacao("outra_versao", alvo,
                              f"{rot} foi apurado na régua {versoes}; esta é a {atual['versao_regua']}. "
                              f"Reprocesse {rot} com os arquivos dele para comparar.")
        return Comparacao("sem_historico", alvo, f"Não há apuração de {rot} no histórico; sem comparação.")
    ant = max(mesma, key=lambda h: str(h.get("gerado_em", "")))
    linhas = {}
    for a in INDICADORES:
        t_ant, t_at = ant["totais"][a], atual["totais"][a]
        pct_ant = t_ant["identificadas"] / t_ant["denominador"] if t_ant["denominador"] else None
        pct_at = t_at["identificadas"] / t_at["denominador"] if t_at["denominador"] else None
        linhas[a] = {"identificadas": t_ant["identificadas"], "denominador": t_ant["denominador"],
                     "pct": pct_ant,
                     "variacao_pp": None if pct_ant is None or pct_at is None else (pct_at - pct_ant) * 100}
    return Comparacao("comparado", alvo, f"Comparado com {rot} (mesma régua, {atual['versao_regua']}).",
                      linhas)


# ── saída: xlsx e resumo ────────────────────────────────────────────────────

MESES = ("", "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
         "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO")
ABAS = ("Resumo", "Por colaborador", "Ocorrências", "Pendências", "Eventos", "Conferência")


def nome_do_arquivo(r: Relatorio) -> str:
    return f"Controle de jornada - {MESES[r.mes]}-{r.ano}.xlsx"


def rotulo(a: str) -> str:
    return f"{a} — {INDICADORES[a][0]}"


def _hora(minutos: int | None) -> float | None:
    return None if minutos is None else minutos / 1440


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}%".replace(".", ",")


def _cabecalho(ws, colunas: list[str]) -> None:
    from openpyxl.styles import Font
    ws.append(colunas)
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)


def _formatar(ws, colunas: dict[int, str]) -> None:
    for col, fmt in colunas.items():
        ws.cell(ws.max_row, col).number_format = fmt


def montar_xlsx(r: Relatorio) -> bytes:
    """Números como número; horário como fração de dia em `hh:mm`; % como fração."""
    import openpyxl

    wb = openpyxl.Workbook()
    q = totais(r)

    # 1. Resumo
    ws = wb.active
    ws.title = ABAS[0]
    ws.append([f"CONTROLE DE JORNADA — {MESES[r.mes]}/{r.ano}"])
    ws.append(["Grupo A — Pontualidade e Jornada. Critérios gerenciais: não alteram saldo do Flash."])
    ws.append([])
    _cabecalho(ws, ["Período", "Versão da régua", "Colaboradores", "Dias úteis do mês"])
    ws.append([f"{r.mes:02d}/{r.ano}", VERSAO_REGUA, len(r.pessoas), len(r.uteis)])
    ws.append([])
    _cabecalho(ws, ["Arquivo processado", "sha256"])
    for nome, h in r.arquivos:
        ws.append([nome, h[:12]])
    ws.append([])
    comp = r.comparacao
    extra = (["Mês anterior: identificadas", "Mês anterior: denominador", "Mês anterior: %",
              "Variação (p.p.)"] if comp and comp.status == "comparado" else [])
    _cabecalho(ws, ["Indicador", "Identificadas", "Justificadas", "Pendentes", "Denominador", "%",
                    "Colaboradores envolvidos", *extra])
    for a, t in q.items():
        linha = [rotulo(a), t["identificadas"], t["justificadas"], t["pendentes"], t["denominador"],
                 t["pct"], t["pessoas"]]
        if extra:
            ant = comp.linhas[a]
            linha += [ant["identificadas"], ant["denominador"], ant["pct"],
                      None if ant["variacao_pp"] is None else round(ant["variacao_pp"], 2)]
        ws.append(linha)
        _formatar(ws, {6: "0.0%", **({10: "0.0%"} if extra else {})})
    ws.append([])
    _cabecalho(ws, ["Faixa sem ocorrência", "Dias"])
    for m in MEDIDAS:
        ws.append([FAIXAS[m][1], sum(1 for d in r.dias if d.faixa[m] == NEUTRA)])
    ws.append([])
    usados = sum(1 for e in r.eventos if e.usado)
    _cabecalho(ws, ["Outros números", "Valor"])
    for rot, valor in (
        ("Dias elegíveis (soma)", sum(p.dias_elegiveis for p in r.pessoas)),
        ("Dias fora por evento de dia inteiro (soma)", sum(p.dias_fora for p in r.pessoas)),
        ("Dias pendentes (soma)", sum(p.dias_pendentes for p in r.pessoas)),
        ("Pendências listadas", len(r.pendencias)),
        ("Eventos usados", usados),
        ("Eventos não usados", len(r.eventos) - usados),
        ("Fechamento", "conferido" if all(c.ok for c in r.conferencias) else "NÃO FECHA"),
    ):
        ws.append([rot, valor])
    if comp:
        ws.append([])
        ws.append(["Comparação com o mês anterior", comp.mensagem])
    ws.append([])
    ws.append(["Rótulos de reincidência (crítico, atenção, acompanhamento) estão suspensos "
               "pelo RH até validação de critério novo."])

    # 2. Por colaborador — sem rótulo de status.
    ws = wb.create_sheet(ABAS[1])
    cols = ["Matrícula", "Nome", "Setor", "Dias úteis", "Dias fora (evento)", "Dias elegíveis",
            "Dias pendentes"]
    for a in INDICADORES:
        cols += [f"{a} identificadas", f"{a} denominador", f"{a} %", f"{a} justificadas"]
    cols += ["Saldo banco", "Saldo (min)"]
    _cabecalho(ws, cols)
    for p in r.pessoas:
        linha = [p.matricula, p.nome, p.setor, p.dias_uteis, p.dias_fora, p.dias_elegiveis,
                 p.dias_pendentes]
        fmts = {}
        for a, (_, m) in INDICADORES.items():
            den = p.avaliados[m]
            linha += [p.identificadas[a], den, (p.identificadas[a] / den) if den else None,
                      p.justificadas[a]]
            fmts[len(linha) - 1] = "0.0%"
        linha += [p.saldo_txt, p.saldo_min]
        ws.append(linha)
        _formatar(ws, fmts)

    # 3. Ocorrências
    ws = wb.create_sheet(ABAS[2])
    _cabecalho(ws, ["Matrícula", "Nome", "Data", "Indicador", "Horário / duração", "Situação",
                    "Evento que justifica", "Batidas do dia", "Batida ajustada"])
    for o in r.ocorrencias:
        ws.append([o.matricula, o.nome, o.data, rotulo(o.indicador), _hora(o.minutos), o.situacao,
                   o.evento, o.batidas, o.ajuste])
        _formatar(ws, {3: "dd/mm/yyyy", 5: "hh:mm"})

    # 4. Pendências
    ws = wb.create_sheet(ABAS[3])
    _cabecalho(ws, ["Matrícula", "Nome", "Data", "Medida", "Motivo"])
    for x in r.pendencias:
        ws.append([x.matricula, x.nome, x.data, x.medida, x.motivo])
        _formatar(ws, {3: "dd/mm/yyyy"})

    # 5. Eventos — sem CID e sem justificativa (nem chegaram a ser lidos).
    ws = wb.create_sheet(ABAS[4])
    _cabecalho(ws, ["EventoId", "Matrícula", "Nome", "Motivo", "Código", "Início", "Fim",
                    "Hora início", "Hora fim", "Qtde", "Status", "Usado", "Por quê"])
    for e in sorted(r.eventos, key=lambda e: (e.inicio, _sem_acento(e.nome), e.id)):
        ws.append([e.id, e.matricula, e.nome, e.motivo, e.codigo, e.inicio, e.fim,
                   _hora(e.hora_inicio), _hora(e.hora_fim), e.qtde, e.status,
                   "sim" if e.usado else "não", e.por_que])
        _formatar(ws, {6: "dd/mm/yyyy", 7: "dd/mm/yyyy", 8: "hh:mm", 9: "hh:mm"})

    # 6. Conferência
    ws = wb.create_sheet(ABAS[5])
    _cabecalho(ws, ["Verificação", "Esperado", "Obtido", "Fecha?"])
    for c in r.conferencias:
        ws.append([c.verificacao, c.esperado, c.obtido, "SIM" if c.ok else "NÃO"])

    # Injeção de fórmula: nome, motivo e setor são texto que vem do Flash.
    # Começando com = + - @, o Excel da RH os executaria (ex.: =HYPERLINK).
    # Força tipo texto — o mesmo do `enviar_arquivo` em `anexos_escrita.py`.
    for planilha in wb.worksheets:
        for linha in planilha.iter_rows():
            for c in linha:
                if isinstance(c.value, str) and c.value[:1] in ("=", "+", "-", "@"):
                    c.data_type = "s"

    saida = io.BytesIO()
    wb.save(saida)
    return saida.getvalue()


def resumo(r: Relatorio) -> str:
    """O que volta ao modelo: o quadro e os totais — NUNCA nome de pessoa.

    Os detalhes por colaborador são da planilha, que é privada; o resumo vai
    para o contexto do agente, que pode citá-lo em qualquer lugar.
    """
    q = totais(r)
    usados = sum(1 for e in r.eventos if e.usado)
    nao_usados = Counter(e.por_que.split(" — ")[0].removeprefix("não: ")
                         for e in r.eventos if not e.usado)
    partes = [
        f"Controle de jornada {MESES[r.mes]}/{r.ano} — régua {VERSAO_REGUA} "
        "(critérios gerenciais; não mexem em saldo do Flash).",
        f"{len(r.pessoas)} colaboradores, {len(r.uteis)} dias úteis no mês; "
        f"{sum(p.dias_elegiveis for p in r.pessoas)} dias elegíveis, "
        f"{sum(p.dias_fora for p in r.pessoas)} fora por evento de dia inteiro, "
        f"{sum(p.dias_pendentes for p in r.pessoas)} dias pendentes.",
        "Quadro A1–A6 (identificadas / denominador = %; justificadas; pendentes; colaboradores):",
    ]
    for a, t in q.items():
        partes.append(f"- {rotulo(a)}: {t['identificadas']}/{t['denominador']} = {_pct(t['pct'])}; "
                      f"{t['justificadas']} justificada(s); {t['pendentes']} pendente(s); "
                      f"{t['pessoas']} colaborador(es)")
    por_motivo = Counter(x.medida for x in r.pendencias)
    partes.append(f"Pendências: {len(r.pendencias)} ("
                  + ", ".join(f"{k}: {v}" for k, v in sorted(por_motivo.items())) + ")."
                  if r.pendencias else "Pendências: nenhuma.")
    por_status = Counter((e.status or "vazio").lower() for e in r.eventos)
    partes.append(f"Eventos no arquivo: {len(r.eventos)} ("
                  + ", ".join(f"{v} {k}" for k, v in sorted(por_status.items())) + f"); "
                  f"{usados} usados, {len(r.eventos) - usados} não usados"
                  + (" — " + "; ".join(f"{v} {k}" for k, v in sorted(nao_usados.items()))
                     if nao_usados else "") + ".")
    partes.append("Fechamento: conferido — as somas por colaborador batem com o total."
                  if all(c.ok for c in r.conferencias) else "Fechamento: NÃO FECHA.")
    if r.comparacao:
        partes.append(r.comparacao.mensagem)
        if r.comparacao.status == "comparado":
            for a, ant in r.comparacao.linhas.items():
                var = ant["variacao_pp"]
                partes.append(f"  {a}: antes {ant['identificadas']}/{ant['denominador']} = {_pct(ant['pct'])}"
                              + ("" if var is None else f", variação {var:+.1f} p.p.".replace(".", ",")))
    if not r.tem_banco:
        partes.append("Sem o CSV de banco de horas: a planilha sai sem saldo.")
    return "\n".join(partes)
