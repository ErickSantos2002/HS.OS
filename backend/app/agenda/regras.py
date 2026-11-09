"""Regras puras de recorrência e validação dos lembretes.

Sem banco, sem relógio próprio: quem chama passa o "agora". A aritmética é em
hora local (America/Sao_Paulo) e só o retorno vai para UTC, que é como o banco
guarda `proximo_em`.
"""
import calendar
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")

TETO_ATIVOS = 30
TETO_TURNOS_DIA = 12
ANTECEDENCIA_MIN = timedelta(minutes=5)
HORIZONTE_MAX = timedelta(days=366)
ATRASO_MAX = timedelta(hours=6)
ADIAMENTO = timedelta(minutes=2)
ADIAMENTO_MAX = timedelta(minutes=30)

_FORMATO_EM = "%Y-%m-%dT%H:%M"
_HORA = re.compile(r"^(\d{1,2}):(\d{2})$")


class RegraInvalida(ValueError):
    """Mensagem pronta para o agente ou a tela."""


def _hora(valor) -> time:
    m = _HORA.match(valor) if isinstance(valor, str) else None
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise RegraInvalida(f"Hora inválida: {valor!r}. Use HH:MM, de 00:00 a 23:59.")
    return time(int(m.group(1)), int(m.group(2)))


def _hhmm(t: time) -> str:
    return f"{t.hour:02d}:{t.minute:02d}"


def _so_campos(regra: dict, permitidos: set[str]) -> None:
    extras = set(regra) - permitidos
    if extras:
        raise RegraInvalida(f"Campo(s) não aceito(s) nesta regra: {', '.join(sorted(extras))}.")


def _em(valor) -> datetime:
    try:
        return datetime.strptime(valor, _FORMATO_EM).replace(tzinfo=FUSO)
    except (TypeError, ValueError):
        raise RegraInvalida(f"Data/hora inválida: {valor!r}. Use AAAA-MM-DDTHH:MM, hora de Brasília.")


def _local(instante: datetime) -> datetime:
    if instante.tzinfo is None:
        raise ValueError("instante sem fuso")
    return instante.astimezone(FUSO)


def validar_regra(regra: dict, agora: datetime) -> dict:
    """Devolve a regra normalizada (estável para jsonb) ou levanta RegraInvalida."""
    if not isinstance(regra, dict):
        raise RegraInvalida("A regra deve ser um objeto com o campo 'tipo'.")
    tipo = regra.get("tipo")
    if tipo == "unico":
        _so_campos(regra, {"tipo", "em"})
        em = _em(regra.get("em"))
        agora = _local(agora)
        if em < agora + ANTECEDENCIA_MIN:
            raise RegraInvalida("O lembrete único precisa ser daqui a pelo menos 5 minutos.")
        if em > agora + HORIZONTE_MAX:
            raise RegraInvalida("O lembrete único não pode passar de 1 ano no futuro.")
        return {"tipo": "unico", "em": em.strftime(_FORMATO_EM)}
    if tipo in ("diario", "dias_uteis"):
        _so_campos(regra, {"tipo", "hora"})
        return {"tipo": tipo, "hora": _hhmm(_hora(regra.get("hora")))}
    if tipo == "semanal":
        _so_campos(regra, {"tipo", "dias", "hora"})
        dias = regra.get("dias")
        if (not isinstance(dias, list) or not dias
                or any(type(d) is not int or not 0 <= d <= 6 for d in dias)):
            raise RegraInvalida("'dias' deve ser uma lista de 0 a 6 (0 = segunda, 6 = domingo).")
        return {"tipo": "semanal", "dias": sorted(set(dias)), "hora": _hhmm(_hora(regra.get("hora")))}
    if tipo == "mensal":
        _so_campos(regra, {"tipo", "dia", "hora"})
        dia = regra.get("dia")
        if type(dia) is not int or not 1 <= dia <= 31:
            raise RegraInvalida("'dia' deve ser um número de 1 a 31.")
        return {"tipo": "mensal", "dia": dia, "hora": _hhmm(_hora(regra.get("hora")))}
    raise RegraInvalida(
        f"Tipo de regra desconhecido: {tipo!r}. Use unico, diario, dias_uteis, semanal ou mensal."
    )


def _no_dia(dia, hora: time) -> datetime:
    return datetime.combine(dia, hora, tzinfo=FUSO)


def proximo(regra: dict, depois_de: datetime) -> datetime | None:
    """Próximo instante estritamente depois de `depois_de`, em UTC; None se não há."""
    ref = _local(depois_de)
    tipo = regra["tipo"]
    if tipo == "unico":
        alvo = _em(regra["em"])
        return alvo.astimezone(timezone.utc) if alvo > ref else None

    hora = _hora(regra["hora"])
    if tipo == "mensal":
        ano, mes = ref.year, ref.month
        for _ in range(14):
            dia = min(regra["dia"], calendar.monthrange(ano, mes)[1])
            alvo = _no_dia(ref.date().replace(year=ano, month=mes, day=dia), hora)
            if alvo > ref:
                return alvo.astimezone(timezone.utc)
            ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
        return None

    if tipo == "diario":
        valido = lambda d: True
    elif tipo == "dias_uteis":
        valido = lambda d: d.weekday() < 5
    else:
        dias = set(regra["dias"])
        valido = lambda d: d.weekday() in dias
    for i in range(8):
        dia = ref.date() + timedelta(days=i)
        alvo = _no_dia(dia, hora)
        if valido(dia) and alvo > ref:
            return alvo.astimezone(timezone.utc)
    return None


def regra_de(quando: str | None, repetir: dict | None) -> dict:
    """Monta a regra a partir dos dois parâmetros da ferramenta; exatamente um.

    Não valida o conteúdo: isso é `validar_regra`.
    """
    if (quando is None) == (repetir is None):
        raise RegraInvalida("Informe só um: 'quando' (lembrete único) ou 'repetir' (recorrente).")
    if quando is not None:
        return {"tipo": "unico", "em": quando}
    return dict(repetir)
