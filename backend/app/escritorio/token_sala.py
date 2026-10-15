"""O passe do script do mapa: JWT HS256, `aud: "escritorio-sala"`, 12 h.

Emitido na `room/access` da Admin API e lido por `/escritorio/meu-status`. Só
serve para a pessoa ler o próprio status. A audiência é o que o separa do
token de login: o `ler_token` do login decodifica sem `audience`, e o PyJWT
recusa (`InvalidAudienceError`) token que traz `aud` assim — o mesmo cuidado
do ticket de upload (`aud: "hsos-upload"`). Vai em query string, então aparece
em log de acesso; o risco foi aceito na spec por ser só leitura e vencer em 12 h.
"""

import time

import jwt

from app.config import settings

AUDIENCIA = "escritorio-sala"
VALIDADE_S = 12 * 3600


def emitir_token_sala(email: str, agora: int | None = None) -> str:
    emitido = int(time.time()) if agora is None else agora
    corpo = {"sub": email, "aud": AUDIENCIA, "iat": emitido, "exp": emitido + VALIDADE_S}
    return jwt.encode(corpo, settings.JWT_SECRET, algorithm="HS256")


def ler_token_sala(token: str) -> str:
    """Devolve o e-mail. Levanta `jwt.PyJWTError` se inválido, vencido ou de outro uso."""
    corpo = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=["HS256"],
        audience=AUDIENCIA,
        options={"require": ["exp", "sub", "aud"]},
    )
    return corpo["sub"]
