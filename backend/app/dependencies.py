"""Dependências compartilhadas dos endpoints.

Substituem o que hoje é feito por RLS do Supabase: com o banco próprio não há
policy no banco decidindo quem lê o quê, então a autorização passa a ser
responsabilidade explícita desta camada. Todo endpoint que lê dado de usuário
precisa depender de `get_current_user` — não existe mais rede de proteção
automática por trás.

Papéis herdados do schema atual (tabela `user_roles`): super_admin, member, user.
"""

import asyncpg
from fastapi import Depends, HTTPException, status

from app.database import get_pool


async def get_db() -> asyncpg.Pool:
    pool = get_pool()
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Banco de dados indisponível.",
        )
    return pool


async def get_current_user():
    """Valida o JWT e devolve o usuário. A implementar na portagem da auth."""
    raise NotImplementedError("Auth ainda não portada — ver backend/supabase/functions/")


def require_roles(*roles: str):
    """Guard de papel, equivalente ao `allowedRoles` do ProtectedRoute no front."""

    async def _guard(user=Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permissão insuficiente.",
            )
        return user

    return _guard
