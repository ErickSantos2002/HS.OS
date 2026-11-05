"""Token de agente: o bot pessoal age COMO A PESSOA num sistema interno.

Spec: docs/superpowers/specs/2026-11-05-bot-sistemas-internos-design.md.

JWT EdDSA (Ed25519) de 5 minutos, assinado com a chave PRIVADA do HS.OS
(`AGENTE_CHAVE_PRIVADA`). Cada sistema confere com a PÚBLICA e aplica as
permissões que já tem para aquela pessoa — nenhum segredo dos sistemas mora
aqui.

⚠️ `aud` fixa o sistema (token do TaskHS não abre o GestorHS) e o `sub` é o
e-mail do DONO do bot, resolvido pelo `dono_id` — nunca vindo de argumento do
agente. O TaskHS recusa `exp` a mais de 600 s: não aumente os 300.
"""
from __future__ import annotations

import time
import uuid

import jwt
from cryptography.hazmat.primitives import serialization

from app.config import settings

VALIDADE_S = 300


class ErroToken(Exception):
    pass


def _privada():
    pem = (settings.AGENTE_CHAVE_PRIVADA or "").replace("\\n", "\n").strip()
    if not pem:
        raise ErroToken("AGENTE_CHAVE_PRIVADA ausente — o bot não acessa os sistemas")
    return serialization.load_pem_private_key(pem.encode(), password=None)


def token_e_jti(aud: str, email: str, bot: str) -> tuple[str, str]:
    """O token e o `jti` dele — o `jti` vai para a auditoria `agente_chamadas`."""
    agora, jti = int(time.time()), str(uuid.uuid4())
    t = jwt.encode({"iss": "hsos", "aud": aud, "sub": email, "act": {"sub": bot},
                    "iat": agora, "exp": agora + VALIDADE_S, "jti": jti},
                   _privada(), algorithm="EdDSA")
    return t, jti


def token_de_agente(aud: str, email: str, bot: str) -> str:
    return token_e_jti(aud, email, bot)[0]


def chave_publica_pem() -> str:
    return _privada().public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
