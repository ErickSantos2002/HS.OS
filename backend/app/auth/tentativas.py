"""Limite de tentativas do login por senha e a regra do admin (PK-04, 25/11/2026).

⚠️ `POST /auth/login` não tinha limite nem bloqueio, num repositório público.
O contador mora no Postgres (`login_tentativas`, migração 041) porque o backend
roda com dois workers.

Só FALHAS contam, numa janela de 15 min:

- **5 por e-mail.** Bloqueia só a senha: quem tem conta Microsoft entra pelo
  SSO, então trancar alguém de propósito não tranca de verdade.
- **30 por IP**, para vários e-mails da mesma origem — alto o bastante para o
  escritório inteiro, que sai por um IP só. Se o `X-Forwarded-For` for forjado,
  sobra o limite por e-mail.

Guarda o sha256 do e-mail e do IP, nunca o valor: o usuário `leitura` da
empresa enxerga as tabelas.
"""
import hashlib

JANELA_MINUTOS = 15
MAX_POR_EMAIL = 5
MAX_POR_IP = 30

MENSAGEM_BLOQUEIO = (
    f"Muitas tentativas de senha. Espere {JANELA_MINUTOS} minutos "
    "ou entre com a Microsoft."
)
MENSAGEM_ADMIN = (
    "Administrador entra pelo botão \"Entrar com Microsoft\" — a senha não "
    "abre essa conta."
)


def resumo(valor: str) -> str:
    return hashlib.sha256(valor.strip().lower().encode()).hexdigest()


def bloqueia(falhas_email: int, falhas_ip: int) -> bool:
    return falhas_email >= MAX_POR_EMAIL or falhas_ip >= MAX_POR_IP


def admin_pode_por_senha(sso_ativo: bool, emergencia: bool) -> bool:
    """Sem SSO configurado não há outra porta, e trancar o admin seria pior."""
    return emergencia or not sso_ativo


_CONTAR = (
    "SELECT count(*) FROM public.login_tentativas "
    f" WHERE {{coluna}} = $1 AND criado_em > now() - interval '{JANELA_MINUTOS} minutes'"
)


async def travar(conn, email: str) -> None:
    """Serializa as tentativas do MESMO e-mail até o fim da transação.

    Sem isto, contar e gravar em passos separados deixava N pedidos paralelos
    passarem todos pela contagem antes de qualquer um gravar.
    """
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", resumo(email))


async def esta_bloqueado(conn, email: str, ip: str) -> bool:
    por_email = await conn.fetchval(_CONTAR.format(coluna="email_hash"), resumo(email))
    por_ip = await conn.fetchval(_CONTAR.format(coluna="ip_hash"), resumo(ip))
    return bloqueia(por_email or 0, por_ip or 0)


async def registrar_tentativa(conn, email: str, ip: str) -> None:
    """Grava ANTES do bcrypt; `zerar` a apaga quando a senha confere."""
    await conn.execute(
        "INSERT INTO public.login_tentativas (email_hash, ip_hash) VALUES ($1, $2)",
        resumo(email), resumo(ip),
    )
    # Faxina barata no próprio caminho: nada além de um dia interessa.
    await conn.execute(
        "DELETE FROM public.login_tentativas WHERE criado_em < now() - interval '1 day'"
    )


async def zerar(conn, email: str) -> None:
    await conn.execute(
        "DELETE FROM public.login_tentativas WHERE email_hash = $1", resumo(email)
    )
