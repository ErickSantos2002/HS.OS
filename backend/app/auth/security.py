"""Hash de senha e emissão/validação de JWT.

Substitui o `supabase.auth`. Sem dependência externa: bcrypt e PyJWT.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

# bcrypt trunca em 72 bytes e o pacote levanta erro acima disso. O limite é
# validado no schema de entrada; aqui só documentamos por que ele existe.
LIMITE_SENHA_BYTES = 72


def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def conferir_senha(senha: str, hash_armazenado: str | None) -> bool:
    """Compara em tempo constante. Conta sem senha (convite pendente) nunca autentica."""
    if not hash_armazenado:
        return False
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), hash_armazenado.encode("utf-8"))
    except ValueError:
        # hash malformado no banco — trata como falha, não como exceção 500
        return False


def emitir_token(user_id: str, papel: str, email: str) -> tuple[str, int]:
    """Devolve (token, segundos_ate_expirar)."""
    expira_em = timedelta(hours=settings.JWT_EXPIRE_HOURS)
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "papel": papel,
        "iat": agora,
        "exp": agora + expira_em,
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, int(expira_em.total_seconds())


def ler_token(token: str) -> dict:
    """Valida assinatura e expiração. Levanta jwt.PyJWTError se inválido."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
