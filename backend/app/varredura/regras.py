"""Regras puras da varredura do Guardi: dias úteis, horários, tetos e novidade.

Sem banco e sem relógio próprio: quem chama passa o "agora". A aritmética é em
hora local (America/Sao_Paulo); só o retorno de `horario` vai para UTC, que é
como o banco guarda o agendamento.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")

TETO_RESUMO = 4000
TETO_PEDIDAS_DIA = 2
# Varreduras rodando ao mesmo tempo (por worker; ver SQL_RESERVAR).
TETO_SIMULTANEO = 3
INTERVALO_PEDIDAS = timedelta(minutes=30)
ADIAMENTO = timedelta(minutes=2)
ADIAMENTO_MAX = timedelta(minutes=30)
# Passou deste horário local sem rodar, a varredura é pulada: manhã velha à
# tarde mostraria número de manhã como se fosse de agora.
LIMITE = {"manha": time(12), "tarde": time(17), "quadro": time(11)}
SISTEMAS = {"taskhs", "hsgrowth", "gestorhs", "email"}

_PADRAO = {"manha": time(7, 30), "tarde": time(13, 30), "quadro": time(8, 30)}
_HORA = re.compile(r"^([0-9]{1,2}):([0-9]{2})\Z")
_CHAVE = re.compile(r"^[a-z0-9_]{1,30}\Z")
_MAX_CHAVES = 8
# O formato que o Guardi copia. Vai na descrição da ferramenta e na recusa.
EXEMPLO_NUMEROS = ('{"taskhs": {"abertas": 4, "atrasadas": 0, "sem_prazo": 4}, '
                   '"hsgrowth": {"tarefas_atrasadas": 1, "cards_parados": 1}, '
                   '"gestorhs": {"minhas_os": 0}, "email": {"nao_lidos_3d": 4}, "falhas": []}')


def _pascoa(ano: int) -> date:
    """Algoritmo de Meeus/Jones/Butcher (calendário gregoriano)."""
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = (h + l - 7 * m + 114) % 31 + 1
    return date(ano, mes, dia)


def feriados(ano: int) -> set[date]:
    """Feriados nacionais: fixos mais os que andam com a Páscoa."""
    fixos = {(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15),
             (11, 20), (12, 25)}
    r = {date(ano, m, d) for m, d in fixos}
    p = _pascoa(ano)
    for dias in (-48, -47, -2, 60):  # Carnaval seg/ter, Sexta Santa, Corpus Christi
        r.add(p + timedelta(days=dias))
    return r


def dia_util(d: date) -> bool:
    return d.weekday() < 5 and d not in feriados(d.year)


@dataclass(frozen=True)
class Config:
    ligada: bool
    manha: time
    tarde: time
    quadro: time


def _parse(valor, padrao: time) -> time:
    m = _HORA.match(valor) if isinstance(valor, str) else None
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return padrao
    return time(int(m.group(1)), int(m.group(2)))


def config(valor) -> Config:
    """Lê a chave `varredura` de app_settings; ausente ou ruim = desligada."""
    v = valor if isinstance(valor, dict) else {}
    return Config(
        ligada=v.get("ligada") is True,
        manha=_parse(v.get("manha"), _PADRAO["manha"]),
        tarde=_parse(v.get("tarde"), _PADRAO["tarde"]),
        quadro=_parse(v.get("quadro"), _PADRAO["quadro"]),
    )


def horario(cfg: Config, tipo: str, dia: date) -> datetime:
    """Hora agendada do tipo (manha/tarde/quadro) naquele dia, em UTC."""
    if tipo not in _PADRAO:
        raise ValueError(f"tipo sem horário: {tipo!r}")
    h = getattr(cfg, tipo)
    return datetime.combine(dia, h, tzinfo=FUSO).astimezone(timezone.utc)


def velha(tipo: str, proximo_em: datetime, agora: datetime) -> bool:
    """Já passou do limite local daquele dia? A pedida nunca envelhece."""
    limite = LIMITE.get(tipo)
    if limite is None:
        return False
    dia = proximo_em.astimezone(FUSO).date()
    return agora >= datetime.combine(dia, limite, tzinfo=FUSO)


def pode_pedir(pedidas_hoje: list[datetime], agora: datetime) -> tuple[bool, str]:
    if len(pedidas_hoje) >= TETO_PEDIDAS_DIA:
        return False, f"Já foram {TETO_PEDIDAS_DIA} varreduras pedidas hoje para essa pessoa."
    if pedidas_hoje and agora - max(pedidas_hoje) < INTERVALO_PEDIDAS:
        min_ = int(INTERVALO_PEDIDAS.total_seconds() // 60)
        return False, f"A última pedida foi há menos de {min_} minutos."
    return True, ""


def validar_numeros(n: dict) -> dict:
    """Recusa o que foge da forma, com o exemplo — nunca descarta em silêncio.

    ⚠️ Até 16/11/2026 chave desconhecida era descartada: na 1ª varredura real o
    Guardi mandou outro formato e gravou `{}`, sem aviso. Recusando, ele corrige.
    """
    exemplo = f" Exemplo: {EXEMPLO_NUMEROS}"
    if not isinstance(n, dict):
        raise ValueError("`numeros` deve ser um objeto com um item por sistema." + exemplo)
    desconhecidos = sorted(k for k in n if k != "falhas" and k not in SISTEMAS)
    if desconhecidos:
        raise ValueError(f"`numeros` só aceita {sorted(SISTEMAS)} e `falhas`; veio "
                         f"{desconhecidos}." + exemplo)
    saida: dict = {}
    for sis, val in n.items():
        if sis == "falhas":
            if not isinstance(val, list) or not all(isinstance(s, str) and s in SISTEMAS for s in val):
                raise ValueError(f"`falhas` deve listar só sistemas conhecidos: {sorted(SISTEMAS)}.")
            saida["falhas"] = list(val)
        elif sis in SISTEMAS:
            if not isinstance(val, dict):
                raise ValueError(f"`{sis}` deve ser um objeto de contagens.")
            if len(val) > _MAX_CHAVES:
                raise ValueError(f"`{sis}` aceita no máximo {_MAX_CHAVES} contagens.")
            for k, c in val.items():
                if not isinstance(k, str) or not _CHAVE.match(k):
                    raise ValueError(f"Nome de contagem inválido em `{sis}`: {k!r} (use a-z, 0-9 e _, até 30).")
                if isinstance(c, bool) or not isinstance(c, int) or c < 0:
                    raise ValueError(f"`{sis}.{k}` deve ser um inteiro maior ou igual a zero.")
            saida[sis] = dict(val)
    if not any(k in SISTEMAS for k in saida) and not saida.get("falhas"):
        raise ValueError("`numeros` veio vazio: informe as contagens de cada sistema que você "
                         "leu (ou o sistema em `falhas`)." + exemplo)
    return saida


def novidade(manha: dict | None, tarde: dict) -> tuple[bool, list[str]]:
    """A tarde trouxe algo que a manhã não tinha?

    Sistema que falhou à tarde não gera novidade (não sabemos). Sistema que
    falhou de manhã e voltou só conta se voltou com pendência: voltar com zero
    não é fato novo, é só a manhã que faltou.
    """
    if manha is None:
        return True, ["primeira do dia"]
    falhou_manha = set(manha.get("falhas") or [])
    falhou_tarde = set(tarde.get("falhas") or [])
    frases: list[str] = []
    for sis in sorted(SISTEMAS):
        if sis in falhou_tarde or sis not in tarde:
            continue
        novas = tarde[sis]
        if sis in falhou_manha:
            if any(v > 0 for v in novas.values()):
                frases.append(f"{sis}: voltou a responder, com pendências")
            continue
        antigas = manha.get(sis) or {}
        for k, v in sorted(novas.items()):
            antes = antigas.get(k, 0)
            if v > antes:
                frases.append(f"{sis}.{k}: {antes} → {v}")
    return bool(frases), frases


# Sistema ligado no Guardi (`agent_profiles.sistemas_ligados`) → chave em `numeros`.
_LIGADO_PARA_CHAVE = {"taskhs": "taskhs", "gestorhs": "gestorhs",
                      "hsgrowth": "hsgrowth", "hsgrowth_servicos": "hsgrowth"}


def sistemas_faltando(numeros: dict, ligados: list[str], email_ligado: bool) -> list[str]:
    """Os sistemas da varredura que o Guardi tem e não contou nem pôs em `falhas`.

    ⚠️ Na 2ª varredura real (16/11/2026) o Guardi pulou CRM e GestorHS em
    silêncio; o quadro da Nina mostraria a pessoa "sem pendência" ali.
    """
    esperados = {_LIGADO_PARA_CHAVE[s] for s in ligados if s in _LIGADO_PARA_CHAVE}
    if email_ligado:
        esperados.add("email")
    vieram = {k for k in numeros if k in SISTEMAS} | set(numeros.get("falhas") or [])
    return sorted(esperados - vieram)
