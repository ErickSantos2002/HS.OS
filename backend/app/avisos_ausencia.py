"""Aviso de pedido de ausência no Guardi do RH — spec
`docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md`.

A Lidisay controla as ausências no TalentHS, mas são sistemas demais para ela
ficar olhando. Pedido pendente novo vira, em até ~2 min, um recado e dois
cartões (Aprovar/Recusar) na conversa dela com o Guardi.

⚠️ **Etapa da `passada` do `disparador_lembretes`, não laço próprio** — a porta
única do trabalho autônomo do Guardi. E **sem turno de agente**: o servidor
monta recado e cartões pelo mesmo `talenths_preparo.preparar` que o Guardi usa,
então não gasta token e não depende de o modelo lembrar da ferramenta.

A parte de cima é pura (decidir e escrever o recado); a de baixo fala com banco
e TalentHS.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

# O cartão vence em 24 h (`VALIDADE` em `routers/acoes.py`); pedido que segue
# pendente depois disso ganha aviso novo — senão some de novo.
REAVISO = timedelta(hours=24)
# Leitura do TalentHS por destinatário, por worker. A `passada` roda a cada 30 s.
RITMO_SEGUNDOS = 120
TETO_MOTIVO = 300
TETO_CAMPO = 120


@dataclass(frozen=True)
class Config:
    ligado: bool
    destinatarios: tuple[str, ...]


def config(valor) -> Config:
    """`app_settings` `avisos_ausencia`. Ausente ou malformada = desligado."""
    if not isinstance(valor, dict):
        return Config(ligado=False, destinatarios=())
    ids = valor.get("destinatarios")
    ids = tuple(i for i in ids if isinstance(i, str) and i) if isinstance(ids, list) else ()
    return Config(ligado=valor.get("ligado") is True, destinatarios=ids)


def decidir(pendentes: list[dict], avisados: dict[str, datetime], email_destinatario: str,
            agora: datetime) -> list[tuple[dict, bool]]:
    """Quais pedidos avisar agora: `(pedido, de_novo)`.

    Novo (sem aviso registrado) → `False`; avisado há 24 h ou mais e ainda
    pendente → `True`. O pedido do próprio destinatário não entra."""
    eu = (email_destinatario or "").strip().lower()
    saida = []
    for p in pendentes:
        if p.get("status") != "pending" or not p.get("id"):
            continue
        if eu and (p.get("user_email") or "").strip().lower() == eu:
            continue
        visto = avisados.get(str(p["id"]))
        if visto is None:
            saida.append((p, False))
        elif visto <= agora - REAVISO:
            saida.append((p, True))
    return saida


def _limpo(valor, teto: int) -> str:
    s = " ".join(str(valor or "").split())
    return s if len(s) <= teto else s[: teto - 1].rstrip() + "…"


def _dia(iso) -> str:
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%d/%m")
    except ValueError:
        return _limpo(iso, 20)


def _quando(p: dict) -> str:
    ini, fim = _dia(p.get("start_date")), _dia(p.get("end_date") or p.get("start_date"))
    if ini == fim and p.get("start_time") and p.get("end_time"):
        return f"{ini}, {_limpo(p['start_time'], 5)}–{_limpo(p['end_time'], 5)}"
    datas = ini if ini == fim else f"{ini} a {fim}"
    dias = p.get("days")
    if isinstance(dias, (int, float)):
        n = int(dias) if float(dias).is_integer() else dias
        return f"{datas} ({n} {'dia' if n == 1 else 'dias'})"
    return datas


def texto_recado(pedido: dict, de_novo: bool) -> str:
    cabeca = "📅 Ainda pendente — " if de_novo else "📅 Pedido de ausência — "
    quem = _limpo(pedido.get("user_name") or "Alguém", TETO_CAMPO)
    depto = _limpo(pedido.get("department"), TETO_CAMPO)
    tipo = _limpo(pedido.get("type_name") or "Ausência", TETO_CAMPO)
    texto = f"{cabeca}{quem}{f' ({depto})' if depto else ''}: {tipo}, {_quando(pedido)}."
    motivo = _limpo(pedido.get("reason"), TETO_MOTIVO)
    return f"{texto} Motivo: {motivo}" if motivo else texto
