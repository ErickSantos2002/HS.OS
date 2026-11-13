"""Token de ação do push de lembrete (spec 2026-11-13, "Camada 1").

O service worker não tem o login: quando a pessoa clica "Adiar 10 min" ou
"Feito" na notificação, ele só pode mandar o que veio no payload do push. Por
isso o payload leva um token por ação, e este módulo é TODA a autorização da
rota pública `POST /agenda/lembretes/acao`.

⚠️ **O token não serve para outra coisa.** O escopo assinado é
`(lembrete_id, aviso_em, ação)` com validade de 24 h. Ele não diz quem é a
pessoa nem abre nada além de adiar ou marcar feito AQUELE lembrete NAQUELE
aviso — um token de um aviso velho não mexe no aviso novo, e o de "adiar" não
vira "feito". O segundo clique é inócuo porque a rota só aplica sobre aviso
ainda não reconhecido.

Formato: `base64url(json).base64url(hmac_sha256)`, com o prefixo de domínio
`hsos-lembrete-acao:` dentro do HMAC — o mesmo segredo nunca assina outra
coisa, mas se um dia assinar, um não passa pelo outro.

Puro: quem chama passa o segredo e o relógio.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

VALIDADE = timedelta(hours=24)
ACOES = ("adiar", "feito")
_DOMINIO = b"hsos-lembrete-acao:"


class TokenInvalido(ValueError):
    """Token que não vale. A rota não diz por quê — não ajuda quem forja."""


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode("ascii")


def _de_b64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def _assinatura(segredo: str, corpo: str) -> str:
    return _b64(hmac.new(segredo.encode(), _DOMINIO + corpo.encode("ascii"), hashlib.sha256).digest())


def _instante(aviso_em: datetime) -> str:
    if aviso_em.tzinfo is None:
        raise ValueError("aviso_em sem fuso")
    return aviso_em.astimezone(timezone.utc).isoformat()


def emitir(segredo: str, lembrete_id: str, aviso_em: datetime, acao: str,
           agora: datetime) -> str:
    if not segredo:
        raise ValueError("sem segredo")
    if acao not in ACOES:
        raise ValueError(f"ação inválida: {acao!r}")
    carga = {"l": str(uuid.UUID(lembrete_id)), "a": _instante(aviso_em), "x": acao,
             "e": int((agora + VALIDADE).timestamp())}
    corpo = _b64(json.dumps(carga, separators=(",", ":"), sort_keys=True).encode())
    return f"{corpo}.{_assinatura(segredo, corpo)}"


def conferir(segredo: str, token: str, agora: datetime) -> tuple[str, datetime, str]:
    """`(lembrete_id, aviso_em, acao)` — ou `TokenInvalido`."""
    if not segredo or not isinstance(token, str) or token.count(".") != 1 or len(token) > 1000:
        raise TokenInvalido()
    corpo, assinatura = token.split(".")
    if not hmac.compare_digest(assinatura, _assinatura(segredo, corpo)):
        raise TokenInvalido()
    try:
        carga = json.loads(_de_b64(corpo))
        lembrete_id = str(uuid.UUID(carga["l"]))
        aviso_em = datetime.fromisoformat(carga["a"])
        acao, expira = carga["x"], int(carga["e"])
    except (binascii.Error, ValueError, KeyError, TypeError) as e:
        raise TokenInvalido() from e
    if acao not in ACOES or aviso_em.tzinfo is None or agora.timestamp() > expira:
        raise TokenInvalido()
    return lembrete_id, aviso_em, acao
