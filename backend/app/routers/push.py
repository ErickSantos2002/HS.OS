"""Notificações push do navegador — portado de `send-push`.

Web Push com VAPID. As chaves são **geradas localmente** e não custam nada:
`vapidkeys` ou `openssl` produzem o par, e o par identifica esta instalação
para o serviço de push do navegador. Não há terceiro cobrando.

⚠️ Sem `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` no ambiente, o envio responde
503 e a tela não oferece o recurso. É o estado de hoje: as chaves não estão
configuradas, então o push não funciona — nem antes da portagem funcionava.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from pywebpush import WebPushException, webpush

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])


def _chaves() -> tuple[str, str, str]:
    publica = getattr(settings, "VAPID_PUBLIC_KEY", "") or ""
    privada = getattr(settings, "VAPID_PRIVATE_KEY", "") or ""
    assunto = getattr(settings, "VAPID_SUBJECT", "") or "mailto:ti@healthsafetytech.com"
    # O `subject` do VAPID precisa ser `mailto:` ou `https://`. A edge tinha uma
    # normalização inteira para isso porque o valor chegava de tudo quanto é
    # jeito — com `<>`, sem esquema, com espaço.
    assunto = assunto.strip().replace("<", "").replace(">", "")
    if "@" in assunto and not assunto.startswith("mailto:"):
        assunto = f"mailto:{assunto}"
    elif not assunto.startswith(("mailto:", "http://", "https://")):
        assunto = f"https://{assunto}"
    return publica, privada, assunto


class InscricaoIn(BaseModel):
    endpoint: str = Field(min_length=1)
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)
    user_agent: str | None = None


class EnvioIn(BaseModel):
    user_id: str
    title: str = "HS.OS"
    body: str = ""
    url: str | None = None
    tag: str | None = None


@router.get("/chave-publica")
async def chave_publica():
    """A chave que o navegador usa para se inscrever. Pública por definição."""
    publica, _priv, _s = _chaves()
    return {"publicKey": publica, "configurado": bool(publica)}


@router.put("/inscricao", status_code=status.HTTP_204_NO_CONTENT)
async def inscrever(dados: InscricaoIn, usuario: Usuario = Depends(usuario_atual)):
    """Registra o navegador deste usuário para receber push.

    Idempotente pelo `endpoint`: o navegador manda o mesmo a cada carregamento
    da página, e sem isto a tabela encheria de duplicatas do mesmo aparelho.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            """
            INSERT INTO public.push_subscriptions
                (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
            VALUES ($1::uuid, $2, $3, $4, $5, now())
            ON CONFLICT (endpoint) DO UPDATE SET
                user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth, last_used_at = now()
            """,
            usuario.id, dados.endpoint, dados.p256dh, dados.auth, dados.user_agent,
        )


@router.post("/enviar")
async def enviar(dados: EnvioIn, usuario: Usuario = Depends(usuario_atual)):
    """Manda uma notificação para todos os aparelhos de um usuário.

    Inscrição que o serviço de push recusa com **404 ou 410 é apagada na hora**:
    significa que o navegador foi desinstalado ou revogou a permissão, e insistir
    nela só gera erro a cada envio, para sempre.
    """
    publica, privada, assunto = _chaves()
    if not publica or not privada:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Push não configurado: faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.",
        )

    async with sessao(role="service_role") as conn:
        inscricoes = await conn.fetch(
            "SELECT id::text AS id, endpoint, p256dh, auth FROM public.push_subscriptions "
            "WHERE user_id = $1::uuid",
            dados.user_id,
        )

    corpo = json.dumps({
        "title": dados.title, "body": dados.body,
        "url": dados.url, "tag": dados.tag,
    }, ensure_ascii=False)

    enviados, removidos = 0, []
    for i in inscricoes:
        try:
            webpush(
                subscription_info={
                    "endpoint": i["endpoint"],
                    "keys": {"p256dh": i["p256dh"], "auth": i["auth"]},
                },
                data=corpo,
                vapid_private_key=privada,
                vapid_claims={"sub": assunto},
            )
            enviados += 1
        except WebPushException as e:
            codigo = getattr(e.response, "status_code", None)
            if codigo in (404, 410):
                removidos.append(i["id"])
            else:
                logger.warning("Push falhou para %s: %s", i["endpoint"][:40], e)

    if removidos:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "DELETE FROM public.push_subscriptions WHERE id = ANY($1::uuid[])",
                removidos,
            )
        logger.info("%d inscrição(ões) morta(s) removida(s)", len(removidos))

    return {"enviados": enviados, "inscricoes": len(inscricoes), "removidas": len(removidos)}


@router.delete("/inscricao", status_code=status.HTTP_204_NO_CONTENT)
async def cancelar_inscricao(endpoint: str = Query(description="O endpoint devolvido pelo navegador.")):
    """Remove a inscrição de push deste navegador.

    Sem autenticação de propósito: quem cancela é o navegador que está sendo
    desinstalado ou cujo push foi revogado, e nesse momento pode não haver
    sessão válida. O `endpoint` é gerado pelo serviço de push e funciona como
    o próprio segredo — quem o tem é o dono da inscrição.
    """
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM public.push_subscriptions WHERE endpoint = $1", endpoint
        )


@router.get("/inscricoes/contagem")
async def contar_inscricoes(usuario: Usuario = Depends(usuario_atual)):
    """Quantos aparelhos meus estão inscritos. É diagnóstico da tela de ajustes.

    Serve para a pessoa entender por que o push de teste não chegou: zero
    inscrições explica o silêncio melhor do que "enviado para 0 dispositivos".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM public.push_subscriptions WHERE user_id = $1::uuid",
            usuario.id,
        )
    return {"count": total}
