"""Crachá assinado do turno: o gateway diz de quem é a chamada (PK-11, 26/11/2026).

⚠️ **Antes disto o MCP DEDUZIA.** O gateway não manda ao servidor MCP de que
sessão veio a chamada, e o Guardi só pode usar e-mail e sistemas no turno do
dono. A dedução olhava `agent_runs` (turno aberto do dono, nenhum de outra
pessoa) e, com admin e dono conversando com o bot ao mesmo tempo, não sabia de
quem era a chamada — então bloqueava os dois (`outro_turno_aberto`).

O plugin `vps-gateway/plugin-cracha/` roda no `before_tool_call` do gateway e,
nas ferramentas `hsos-email-*` e `hsos-bot-*`, apaga qualquer `_cracha` que o
modelo tenha posto e grava o verdadeiro: agente, chave da sessão, run e
horário, com HMAC-SHA256 de um segredo que só o gateway (fora da sandbox dos
agentes) e este backend têm. Aqui se confere e se tira a pessoa da chave.

Sem crachá não é erro: até o plugin estar no ar, e em sessões que não são de
pessoa (varredura, cron), quem chama segue com a dedução de antes. Crachá
PRESENTE e inválido é recusa — é tentativa de forjar ou relógio quebrado.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass

CAMPO = "_cracha"
SEGREDO = "CRACHA_TURNO_SEGREDO"

# O crachá é feito no instante da chamada; 5 min cobrem relógio desalinhado
# entre as VPS e a fila, sem deixar um crachá vazado valer para depois.
PRAZO_S = 300

_SESSAO_DE_PESSOA = re.compile(
    r"^agent:[^:]+:hsos-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")


class CrachaInvalido(Exception):
    pass


@dataclass(frozen=True)
class Cracha:
    agente: str
    sessao: str
    run: str
    pessoa: str | None


def pessoa_da_sessao(chave: str) -> str | None:
    """`agent:<id>:hsos-<user_id>` é a sessão de uma pessoa (ver
    `chave_de_sessao` em `app/gateway/client.py`). Qualquer outra forma não tem pessoa."""
    m = _SESSAO_DE_PESSOA.match(chave or "")
    return m.group(1) if m else None


def _assinatura(segredo: str, agente: str, sessao: str, run: str, ts: int) -> str:
    msg = "\n".join([agente, sessao, run, str(ts)]).encode()
    return hmac.new(segredo.encode(), msg, hashlib.sha256).hexdigest()


def ler(args: dict, agent_id: str, segredo: str | None, agora: float) -> tuple[dict, Cracha | None]:
    """Tira o crachá dos argumentos e confere. Devolve `(args_limpos, crachá|None)`."""
    limpos = {k: v for k, v in (args or {}).items() if k != CAMPO}
    if CAMPO not in (args or {}):
        return limpos, None
    c = args[CAMPO]
    if not segredo:
        raise CrachaInvalido("crachá sem segredo configurado")
    if not isinstance(c, dict):
        raise CrachaInvalido("crachá malformado")
    agente, sessao, run, ts, sig = (c.get("agente"), c.get("sessao"), c.get("run"),
                                    c.get("ts"), c.get("sig"))
    if not all(isinstance(x, str) for x in (agente, sessao, run, sig)) or not isinstance(ts, int) or isinstance(ts, bool):
        raise CrachaInvalido("crachá malformado")
    if not hmac.compare_digest(_assinatura(segredo, agente, sessao, run, ts), sig):
        raise CrachaInvalido("assinatura do crachá não confere")
    if abs(agora - ts) > PRAZO_S:
        raise CrachaInvalido("crachá vencido")
    if agente.strip().lower() != (agent_id or "").strip().lower():
        raise CrachaInvalido("crachá de outro agente")
    return limpos, Cracha(agente=agente, sessao=sessao, run=run, pessoa=pessoa_da_sessao(sessao))
