"""Horário de Brasília no texto que o Guardi lê.

⚠️ 13/11/2026: os Guardis diziam a hora de criação de card, de e-mail e de
tarefa **três horas adiantada** — repetiam o UTC que os sistemas devolvem. Pedir
ao modelo para converter é pedir conta de fuso a quem erra conta; o servidor
converte o texto da ferramenta antes de ele chegar ao agente.

Regras, todas conferidas contra o retorno real de cada sistema:
- carimbo com fuso explícito (`Z`, `+00:00`, `-03:00`) → Brasília, sempre;
- `T00:00:00Z` é DATA, não instante (o GestorHS grava data assim): vira só a
  data — converter daria 21:00 do dia anterior;
- carimbo SEM fuso não é tocado, exceto onde se sabe que é UTC (`sem_fuso_e_utc`:
  o HSGrowth grava `DateTime` ingênuo com `utcnow()`).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BRASILIA = ZoneInfo("America/Sao_Paulo")

_CARIMBO = re.compile(
    r"(?<![\d-])(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?"
    r"(Z|[+-]\d{2}:?\d{2})?(?![\d:])"
)


def _offset(tz: str):
    if tz == "Z":
        return timezone.utc
    sinal = -1 if tz[0] == "-" else 1
    h, m = int(tz[1:3]), int(tz[-2:])
    from datetime import timedelta
    return timezone(sinal * timedelta(hours=h, minutes=m))


def em_brasilia(texto: str, sem_fuso_e_utc: bool = False) -> str:
    def troca(m: re.Match) -> str:
        ano, mes, dia, h, mi, s, tz = m.groups()
        if tz is None and not sem_fuso_e_utc:
            return m.group(0)
        if tz in ("Z", "+00:00", "+0000") and (h, mi, s or "00") == ("00", "00", "00"):
            return f"{dia}/{mes}/{ano}"
        try:
            dt = datetime(int(ano), int(mes), int(dia), int(h), int(mi), int(s or 0),
                          tzinfo=_offset(tz) if tz else timezone.utc)
        except ValueError:
            return m.group(0)
        return dt.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M")
    return _CARIMBO.sub(troca, texto or "")
