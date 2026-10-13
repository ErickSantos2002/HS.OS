"""O que o login com Microsoft precisa do banco: achar a conta e o ticket de uso único.

**Por que um ticket, e não o token na URL.** O callback da Microsoft termina num
redirect para o front, e o JWT não pode ir na query string: entraria no
histórico do navegador, no log do proxy e no `Referer`. O callback grava um
ticket opaco de 60 s apontando para a pessoa e manda só ele; o front troca por
`POST /auth/sso/exchange`, e só aí o JWT é emitido.

**Por que no Postgres, e não num dict em memória** (como no GestorHS): o backend
roda com dois workers do uvicorn. Em memória, a troca cai metade das vezes no
processo que não emitiu o ticket e o login falha sem nada no log.

No banco fica só o sha256 do ticket — nem o ticket em claro nem o JWT: o usuário
de leitura da empresa enxerga as tabelas, e com o ticket em mãos entraria na
conta de outra pessoa.

As funções ficam separadas das rotas para que os testes troquem o banco por um
dicionário sem levantar Postgres.
"""

import hashlib
import secrets

from app.database import sessao

VALIDADE_SEGUNDOS = 60


def _hash(ticket: str) -> str:
    return hashlib.sha256(ticket.encode()).hexdigest()


_CONTA = """
    SELECT u.id::text AS id, u.email, u.is_active,
           COALESCE(r.role::text, 'sem_papel') AS papel
      FROM auth.users u
      LEFT JOIN public.user_roles r ON r.user_id = u.id
     WHERE {filtro}
     ORDER BY CASE r.role::text WHEN 'administrador' THEN 0 ELSE 1 END
     LIMIT 1
"""


async def buscar_conta(email: str) -> dict | None:
    """Conta pelo e-mail, sem diferenciar maiúsculas — igual ao `/auth/login`."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(_CONTA.format(filtro="lower(u.email) = lower($1)"), email)
    return dict(linha) if linha else None


async def conta_por_id(user_id: str) -> dict | None:
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(_CONTA.format(filtro="u.id = $1::uuid"), user_id)
    return dict(linha) if linha else None


async def emitir_ticket(user_id: str) -> str:
    ticket = secrets.token_urlsafe(32)
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO public.sso_tickets (ticket_hash, user_id, expira_em)"
            " VALUES ($1, $2::uuid, now() + make_interval(secs => $3))",
            _hash(ticket), user_id, VALIDADE_SEGUNDOS,
        )
    return ticket


async def resgatar_ticket(ticket: str) -> str | None:
    """Id da pessoa, queimando o ticket; `None` se não existe, venceu ou já foi usado.

    O `DELETE ... RETURNING` é atômico: duas trocas simultâneas do mesmo ticket,
    a segunda espera o lock da linha, acha a linha apagada e volta vazia.
    """
    if not ticket or "\x00" in ticket:
        return None
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.sso_tickets WHERE expira_em <= now()")
        return await conn.fetchval(
            "DELETE FROM public.sso_tickets WHERE ticket_hash = $1 AND expira_em > now()"
            " RETURNING user_id::text",
            _hash(ticket),
        )


async def registrar_entrada(user_id: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1::uuid", user_id
        )
