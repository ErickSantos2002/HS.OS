"""O servidor envia Web Push (spec 2026-11-03, Frente B, B1).

Caminho:

    INSERT em channel_messages / conversations(role=agent)
      → trigger `trg_push_pendente` (023) → pg_notify('push_pendente', {tabela, id})
      → `escuta_banco` → **`processar`** → reserva em `push_enviados` → `enviar_para`

⚠️ **Os dois workers recebem o NOTIFY.** Envia quem reservar primeiro: o
`INSERT … ON CONFLICT DO NOTHING RETURNING` devolve a lista vazia para quem
perdeu. Mesmo padrão do guardião de crons, com rastro.

⚠️ **Push é acessório.** Nada aqui levanta: banco fora, VAPID ausente, serviço
de push recusando — vira log e segue. Quem grava a mensagem nunca espera isto.

⚠️ **Sem VAPID o push fica desligado, e diz isso UMA vez** ("push desligado:
VAPID ausente") — no boot, pelo `lifespan`. Sem o aviso único, ou o log
encheria a cada mensagem ou o desligamento passaria em silêncio.

Quem recebe e o que a notificação diz mora em `app/push_regras.py`, puro.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from pywebpush import WebPushException, webpush

from app.config import settings
from app.database import sessao
from app.agenda import token_acao
from app.push_regras import (Membro, destinatarios_canal, endpoint_de_push_valido,
                              item_de_lembrete, payload_agente, payload_canal,
                              payload_lembrete)

logger = logging.getLogger(__name__)

_avisado = False

# Um dia na fila do serviço de push com o aparelho desligado; 10 s por envio.
_TTL_S = 86_400
_TIMEOUT_S = 10

SQL_RESERVAR = """
    INSERT INTO public.push_enviados (mensagem_id, user_id)
    SELECT $1::uuid, u FROM unnest($2::uuid[]) AS u
    ON CONFLICT DO NOTHING
    RETURNING user_id::text AS user_id
"""

# Resposta recuperada horas depois (o `/recuperar` traz órfãs em lote) não
# notifica: seria uma rajada sobre coisa velha. A conta é do banco, no relógio
# dele — o `created_at` da resposta recuperada vem do gateway.
_SQL_RESPOSTA = """
    SELECT c.id::text AS id, c.agent_id, c.user_id::text AS user_id, c.content, c.media,
           c.created_at > now() - interval '30 minutes' AS recente,
           COALESCE(NULLIF(ap.name, ''), c.agent_id) AS agente_nome
      FROM public.conversations c
      LEFT JOIN public.agent_profiles ap ON ap.agent_id = c.agent_id
     WHERE c.id = $1::uuid AND c.role = 'agent'
"""

_SQL_MENSAGEM = """
    SELECT m.id::text AS id, m.channel_id::text AS channel_id, m.author_id,
           m.author_name, m.content, m.attachments, m.audio_url,
           m.thread_id::text AS thread_id,
           m.created_at > now() - interval '30 minutes' AND m.deleted_at IS NULL AS recente,
           ch.name AS nome_canal, ch.type::text AS tipo
      FROM public.channel_messages m
      JOIN public.channels ch ON ch.id = m.channel_id
     WHERE m.id = $1::uuid
"""

# Só humanos com id de pessoa e conta ativa. Agente nunca recebe.
_SQL_MEMBROS = """
    SELECT cm.user_id,
           COALESCE(NULLIF(p.full_name, ''), split_part(p.email, '@', 1), '') AS nome,
           cm.silenciado
      FROM public.channel_members cm
      LEFT JOIN public.profiles p ON p.id::text = cm.user_id
     WHERE cm.channel_id = $1::uuid
       AND cm.member_type = 'human'
       AND cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND COALESCE(p.status, 'active') = 'active'
"""

_SQL_THREAD = """
    SELECT DISTINCT author_id FROM public.channel_messages
     WHERE id = $1::uuid OR thread_id = $1::uuid
"""


def chaves() -> tuple[str, str, str]:
    """`(pública, privada, subject)` — o subject normalizado para `mailto:`/`https://`."""
    publica = settings.VAPID_PUBLIC_KEY or ""
    privada = settings.VAPID_PRIVATE_KEY or ""
    assunto = settings.VAPID_SUBJECT or "mailto:ti@healthsafetytech.com"
    # O `subject` do VAPID precisa ser `mailto:` ou `https://`. A edge tinha uma
    # normalização inteira para isso porque o valor chegava de tudo quanto é
    # jeito — com `<>`, sem esquema, com espaço.
    assunto = assunto.strip().replace("<", "").replace(">", "")
    if "@" in assunto and not assunto.startswith("mailto:"):
        assunto = f"mailto:{assunto}"
    elif not assunto.startswith(("mailto:", "http://", "https://")):
        assunto = f"https://{assunto}"
    return publica, privada, assunto


def ligado() -> bool:
    global _avisado
    publica, privada, _ = chaves()
    if publica and privada:
        return True
    if not _avisado:
        _avisado = True
        logger.warning("push desligado: VAPID ausente")
    return False


_TAREFAS: set[asyncio.Task] = set()


def disparar(coro) -> None:
    """Tarefa solta, com referência guardada para não ser coletada no meio."""
    try:
        tarefa = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _TAREFAS.add(tarefa)
    tarefa.add_done_callback(_TAREFAS.discard)


async def enviar_para(user_id: str, payload: dict) -> dict:
    """Manda para todos os aparelhos de uma pessoa. Nunca levanta.

    ⚠️ `webpush` é síncrono (usa `requests`): roda em thread. Chamado direto
    dentro de `async`, cada envio travava o worker inteiro.

    Inscrição recusada com **404 ou 410** é apagada: o aparelho desinstalou ou
    revogou, e insistir geraria erro a cada mensagem, para sempre.
    """
    resultado = {"enviados": 0, "inscricoes": 0, "removidas": 0}
    publica, privada, assunto = chaves()
    if not (publica and privada):
        return resultado
    try:
        async with sessao(role="service_role") as conn:
            inscricoes = await conn.fetch(
                "SELECT id::text AS id, endpoint, p256dh, auth FROM public.push_subscriptions "
                "WHERE user_id = $1::uuid",
                user_id,
            )
        resultado["inscricoes"] = len(inscricoes)
        corpo = json.dumps(payload, ensure_ascii=False)
        mortas: list[str] = []
        for i in inscricoes:
            # ⚠️ SSRF: linha gravada antes da allowlist pode apontar para a
            # rede interna. Não chama, e apaga.
            if not endpoint_de_push_valido(i["endpoint"]):
                logger.warning("Inscrição %s com endpoint fora da lista; apagando.", i["id"])
                mortas.append(i["id"])
                continue
            try:
                await asyncio.to_thread(
                    webpush,
                    subscription_info={"endpoint": i["endpoint"],
                                       "keys": {"p256dh": i["p256dh"], "auth": i["auth"]}},
                    data=corpo,
                    vapid_private_key=privada,
                    vapid_claims={"sub": assunto},
                    # ⚠️ Os padrões do pywebpush são `ttl=0` (FCM e Apple
                    # descartam se o aparelho estiver dormindo — o caso de uso
                    # inteiro) e sem timeout (thread presa para sempre).
                    ttl=_TTL_S,
                    timeout=_TIMEOUT_S,
                    headers={"Urgency": "high"},
                )
                resultado["enviados"] += 1
            except WebPushException as e:
                if getattr(e.response, "status_code", None) in (404, 410):
                    mortas.append(i["id"])
                else:
                    logger.warning("Push falhou para %s: %s", i["endpoint"][:40], e)
            except Exception as e:  # noqa: BLE001 — push é acessório
                logger.warning("Push falhou para %s: %s", i["endpoint"][:40], e)
        if mortas:
            async with sessao(role="service_role") as conn:
                await conn.execute(
                    "DELETE FROM public.push_subscriptions WHERE id = ANY($1::uuid[])", mortas)
            resultado["removidas"] = len(mortas)
            logger.info("%d inscrição(ões) morta(s) removida(s)", len(mortas))
    except Exception as e:  # noqa: BLE001
        logger.warning("Push para %s falhou: %s", user_id, e)
    return resultado


# O lembrete do recado, da PRÓPRIA pessoa: o título e a instrução atuais.
_SQL_LEMBRETE = """
    SELECT titulo, instrucao FROM public.lembretes
     WHERE id = $1::uuid AND user_id = $2::uuid
"""


def _acoes_do_lembrete(lembrete_id: str, aviso_em: str) -> dict | None:
    """Tokens de "adiar" e "feito" para o SW. Sem segredo ou sem aviso: nenhum."""
    segredo = settings.LEMBRETE_ACAO_SEGREDO
    if not segredo or not aviso_em:
        return None
    try:
        instante = datetime.fromisoformat(aviso_em)
        agora = datetime.now(timezone.utc)
        return {a: token_acao.emitir(segredo, lembrete_id, instante, a, agora)
                for a in token_acao.ACOES}
    except ValueError:
        return None


async def _payload_do_lembrete(conn, linha, item: dict) -> dict | None:
    lembrete = await conn.fetchrow(_SQL_LEMBRETE, item["id"], linha["user_id"])
    if not lembrete:
        return None  # apagado entre o recado e o push: vira push comum
    aviso_em = item.get("aviso_em") or ""
    return payload_lembrete(
        lembrete_id=item["id"], titulo=lembrete["titulo"], instrucao=lembrete["instrucao"],
        aviso_em=aviso_em, de_novo=bool(item.get("de_novo")),
        acoes=_acoes_do_lembrete(item["id"], aviso_em))


async def _alvos_da_resposta(conn, ident: str):
    linha = await conn.fetchrow(_SQL_RESPOSTA, ident)
    if not linha or not linha["recente"]:
        return None
    media = linha["media"]
    if isinstance(media, str):
        try:
            media = json.loads(media)
        except ValueError:
            media = None
    item = item_de_lembrete(media)
    if item:
        payload = await _payload_do_lembrete(conn, linha, item)
        if payload:
            return payload, [linha["user_id"]]
    payload = payload_agente(agent_id=linha["agent_id"], agente_nome=linha["agente_nome"],
                             conteudo=linha["content"], anexos=linha["media"])
    return payload, [linha["user_id"]]


async def _alvos_da_mensagem(conn, ident: str):
    linha = await conn.fetchrow(_SQL_MENSAGEM, ident)
    if not linha or not linha["recente"]:
        return None
    membros = [Membro(m["user_id"], m["nome"] or "", bool(m["silenciado"]))
               for m in await conn.fetch(_SQL_MEMBROS, linha["channel_id"])]
    participantes = None
    if linha["thread_id"]:
        participantes = {r["author_id"] for r in await conn.fetch(_SQL_THREAD, linha["thread_id"])}
    quem = destinatarios_canal(linha["author_id"], membros, linha["content"] or "", participantes)
    anexos = linha["attachments"]
    if isinstance(anexos, str):
        anexos = json.loads(anexos)
    payload = payload_canal(
        canal_id=linha["channel_id"], canal_nome=linha["nome_canal"] or "", tipo=linha["tipo"],
        autor=linha["author_name"] or "", conteudo=linha["content"] or "", anexos=anexos,
        audio=bool(linha["audio_url"]), thread_id=linha["thread_id"])
    return payload, sorted(quem)


async def processar(tabela: str, ident: str) -> None:
    """Decide, reserva e envia o push de uma mensagem nova. Nunca levanta."""
    if not ligado():
        return
    try:
        async with sessao(role="service_role") as conn:
            if tabela == "conversations":
                alvo = await _alvos_da_resposta(conn, ident)
            elif tabela == "channel_messages":
                alvo = await _alvos_da_mensagem(conn, ident)
            else:
                return
            if not alvo or not alvo[1]:
                return
            payload, usuarios = alvo
            # A reserva é commitada ao fim deste bloco, ANTES do envio: o
            # worker que chegar depois esbarra no conflito e não envia.
            reservados = [r["user_id"] for r in await conn.fetch(SQL_RESERVAR, ident, usuarios)]
        for uid in reservados:
            await enviar_para(uid, payload)
    except Exception as e:  # noqa: BLE001 — push é acessório
        logger.warning("Push de %s %s falhou: %s", tabela, ident, e)
