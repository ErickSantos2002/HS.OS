"""Notificações push do navegador — inscrição, teste e cancelamento.

Web Push com VAPID. As chaves são **geradas localmente** e não custam nada:
`vapidkeys` ou `openssl` produzem o par, e o par identifica esta instalação
para o serviço de push do navegador. Não há terceiro cobrando.

⚠️ **Quem envia de verdade é o servidor**, a partir da mensagem gravada
(`app/push_envio.py`, spec 2026-11-03). Esta rota de envio fica só para o
próprio usuário: o botão de teste nas Configurações e o lembrete de status.

⚠️ Sem `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` no ambiente, o envio responde
503 e a tela não oferece o recurso. Ver `docs/DEPLOY.md`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app import push_envio
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

router = APIRouter(prefix="/push", tags=["push"])


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
    publica, _priv, _s = push_envio.chaves()
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
    """Manda uma notificação para os aparelhos **do próprio usuário**.

    ⚠️ Até 03/11/2026 aceitava qualquer `user_id` de qualquer pessoa logada —
    dava para pôr no celular de outra pessoa uma notificação com o título que
    se quisesse. Hoje só serve ao teste e ao lembrete de status, que são para
    si mesmo.
    """
    if dados.user_id != usuario.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Push de teste só vai para os seus aparelhos.")
    publica, privada, _ = push_envio.chaves()
    if not publica or not privada:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Push não configurado: faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.",
        )
    payload = {"title": dados.title, "body": dados.body, "url": dados.url, "tag": dados.tag}
    return await push_envio.enviar_para(usuario.id, payload)


@router.delete("/inscricao", status_code=status.HTTP_204_NO_CONTENT)
async def cancelar_inscricao(
    endpoint: str = Query(description="O endpoint devolvido pelo navegador."),
    usuario: Usuario = Depends(usuario_atual),
):
    """Remove a inscrição de push deste aparelho, se for de quem pede.

    ⚠️ **Exige login desde 03/11/2026** (esclarecimento 4 da spec). Desligar as
    notificações é por aparelho e apaga a inscrição; quem chama é o logout
    (antes de limpar o token) e o interruptor das Configurações. Sem login,
    quem soubesse o endpoint de outra pessoa a desinscrevia.
    """
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND user_id = $2::uuid",
            endpoint, usuario.id,
        )


@router.get("/inscricoes/contagem")
async def contar_inscricoes(
    usuario: Usuario = Depends(usuario_atual),
    endpoint: str | None = Query(default=None,
                                 description="Conta só a inscrição deste aparelho."),
):
    """Quantos aparelhos meus estão inscritos — ou, com `endpoint`, se ESTE está.

    Com `endpoint` é a confirmação que a tela usa antes de deixar de mostrar a
    notificação local: sem ela, quem tinha inscrição no navegador e nenhuma no
    servidor perdia as duas.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if endpoint:
            total = await conn.fetchval(
                "SELECT count(*) FROM public.push_subscriptions "
                "WHERE user_id = $1::uuid AND endpoint = $2",
                usuario.id, endpoint,
            )
        else:
            total = await conn.fetchval(
                "SELECT count(*) FROM public.push_subscriptions WHERE user_id = $1::uuid",
                usuario.id,
            )
    return {"count": total}
