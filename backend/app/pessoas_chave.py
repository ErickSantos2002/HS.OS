# backend/app/pessoas_chave.py
"""As pessoas que o código conhece pelo nome — identificadas pelo ID, nunca pelo e-mail.

⚠️ Em 27/11/2026 a conta do Erick passou de `ti@` para `erick.santos@` e o Midas
o recusou: o `USER.md` liberava dado financeiro "por nome e e-mail". O `np@` do
Nicholson e os e-mails de setor vão mudar para `nome.sobrenome@` nas semanas
seguintes. O `id` de `public.profiles` (= `auth.users`) não muda com o e-mail.

Quando outro sistema precisa do e-mail (o DataCore autentica o agente pelo
e-mail da pessoa), ele é lido AGORA de `profiles` pelo id — `email_atual`.
"""
from __future__ import annotations

NICHOLSON_ID = "83bc4b9d-c002-49a3-b0e4-3e7c95f5f37c"   # CEO
ERICK_ID = "77071556-7a52-41d5-805a-cbbd3923da45"       # administrador do HS.OS
LIDISAY_ID = "373a0bb3-4b2a-49d6-8d1f-5c5165b62215"     # RH — segue no `bruce`


async def email_atual(user_id: str) -> str | None:
    """O e-mail de hoje da pessoa, de `profiles` (que acompanha as trocas)."""
    from app.database import sessao

    async with sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT NULLIF(trim(email), '') FROM public.profiles WHERE id = $1::uuid", user_id)
