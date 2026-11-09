"""A conta Microsoft de cada pessoa: token cifrado, renovação e caixas.

Funções recebem a conexão — quem chama escolhe a sessão (`service_role`).
"""
from __future__ import annotations

import logging

from app.email import graph
from app.email.cifra import cifrar, decifrar

logger = logging.getLogger(__name__)


class ErroConta(Exception):
    """Sem conta conectada, ou o token não renova mais (reconectar)."""


async def bot_com_email_do(conn, user_id: str) -> str | None:
    return await conn.fetchval(
        "SELECT agent_id FROM public.agent_profiles "
        " WHERE dono_id = $1::uuid AND email_ligado", user_id)


async def guardar_conta(conn, user_id: str, conta: str, refresh: str,
                        escopos: list[str] | None = None) -> None:
    await conn.execute(
        """INSERT INTO public.email_contas (user_id, conta, refresh_cifrado, escopos)
           VALUES ($1::uuid, $2, $3, $4::text[])
           ON CONFLICT (user_id) DO UPDATE SET conta = EXCLUDED.conta,
               refresh_cifrado = EXCLUDED.refresh_cifrado, escopos = EXCLUDED.escopos,
               atualizado_em = now()""",
        user_id, conta, cifrar(refresh), escopos or None)


async def tem_calendario(conn, user_id: str) -> bool:
    escopos = await conn.fetchval(
        "SELECT escopos FROM public.email_contas WHERE user_id = $1::uuid", user_id)
    return graph.concedeu_calendario(escopos)


async def ampliar_calendario(conn, user_id: str) -> bool:
    """Tenta ganhar o calendário renovando o token; devolve se a conta tem agora.
    Nunca levanta: falha aqui só quer dizer "ainda sem calendário"."""
    try:
        await access_token(conn, user_id)
    except Exception as e:  # noqa: BLE001 — conta expirada, cifra, rede: segue sem calendário
        logger.info("ampliar calendário de %s falhou: %s", user_id, type(e).__name__)
        return False
    return await tem_calendario(conn, user_id)


async def access_token(conn, user_id: str) -> tuple[str, str]:
    """`(access, conta)`. Regrava o refresh quando a Microsoft devolve outro."""
    linha = await conn.fetchrow(
        "SELECT conta, refresh_cifrado, escopos FROM public.email_contas WHERE user_id = $1::uuid", user_id)
    if not linha:
        raise ErroConta("e-mail não conectado — conecte em Configurações → Perfil")
    antigo = decifrar(linha["refresh_cifrado"])
    if not graph.concedeu_calendario(linha["escopos"]):
        # Conta de antes do calendário: tenta ganhar o escopo na renovação, sem
        # a pessoa reconectar. Recusou? Segue só com e-mail — nunca perde o e-mail.
        try:
            access, novo, concedidos = await graph.ampliar_para_calendario(antigo)
        except graph.ErroGraph as e:
            logger.info("calendário não concedido no refresh de %s (%s); segue só e-mail",
                        user_id, e.status)
        else:
            if graph.concedeu_calendario(concedidos):
                await conn.execute(
                    "UPDATE public.email_contas SET escopos = $2::text[], atualizado_em = now() "
                    " WHERE user_id = $1::uuid", user_id, concedidos)
            return await _guardar_refresh(conn, user_id, antigo, novo, access, linha["conta"])
    try:
        access, novo = await graph.renovar(antigo, linha["escopos"])
    except graph.ErroGraph as e:
        raise ErroConta(f"a conexão com a Microsoft expirou — reconecte em Configurações "
                        f"({e.status})") from e
    return await _guardar_refresh(conn, user_id, antigo, novo, access, linha["conta"])


async def _guardar_refresh(conn, user_id, antigo, novo, access, conta) -> tuple[str, str]:
    if novo != antigo:
        await conn.execute(
            "UPDATE public.email_contas SET refresh_cifrado = $2, atualizado_em = now() "
            " WHERE user_id = $1::uuid", user_id, cifrar(novo))
    return access, conta


async def caixas(conn, user_id: str) -> tuple[str | None, list[str]]:
    conta = await conn.fetchval("SELECT conta FROM public.email_contas WHERE user_id = $1::uuid",
                                user_id)
    linhas = await conn.fetch("SELECT endereco FROM public.email_caixas WHERE user_id = $1::uuid "
                              "ORDER BY endereco", user_id)
    return conta, [l["endereco"] for l in linhas]


async def evento(conn, user_id, agent_id, acao, caixa=None, graph_id=None, destinatarios=()):
    """Auditoria SEM corpo."""
    await conn.execute(
        "INSERT INTO public.email_eventos (user_id, agent_id, acao, caixa, graph_id, destinatarios) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6::text[])",
        user_id, agent_id, acao, caixa, graph_id, list(destinatarios))


async def conferir_previstas(user_id: str, access: str, conta: str) -> int:
    """Confere com o token DA PESSOA as caixas que o admin previu para ela
    (`email_caixas_previstas`) e ativa as que abrirem. Devolve quantas."""
    from app.database import sessao
    async with sessao(role="service_role") as conn:
        previstas = [r["endereco"] for r in await conn.fetch(
            "SELECT endereco FROM public.email_caixas_previstas WHERE user_id = $1::uuid", user_id)]
    from app.email.regras import validar_enderecos
    ok = 0
    for caixa in previstas:
        try:
            caixa = validar_enderecos([caixa])[0]
        except ValueError:
            continue
        if caixa == (conta or "").lower() or not await graph.conferir_caixa(access, conta, caixa):
            # Fica prevista: a permissão no Exchange pode vir depois.
            continue
        async with sessao(role="service_role") as conn:
            await conn.execute("INSERT INTO public.email_caixas (user_id, endereco) VALUES ($1::uuid, $2) "
                               "ON CONFLICT DO NOTHING", user_id, caixa)
            # Consumida: se o admin tirar a caixa depois, ela não volta sozinha.
            await conn.execute("DELETE FROM public.email_caixas_previstas WHERE user_id = $1::uuid "
                               "AND lower(endereco) = $2", user_id, caixa)
        ok += 1
    return ok
