"""Disparo da varredura do Guardi (spec 2026-11-16, "O turno do Guardi").

Uma etapa da `passada` do disparador de lembretes: semeia as varreduras de
hoje (se a chave está ligada), fecha as `rodando` que terminaram sem registro e
dispara as vencidas — todas pela porta única `disparar_turno`, com o prefixo
`hsos-varredura-`.

⚠️ **`rodando` é gravado ANTES do `chat.send`.** O Guardi pode chamar
`varredura_registrar` antes de o envio voltar, e o registro só acha varredura
`rodando`. O `run_id` vem depois, com o mesmo carimbo (`rodando` mantém o lease,
que é a janela de 30 min do registro).

⚠️ **Turno aberto com o agente** (de qualquer pessoa): adia 2 em 2 min, até
30 min contados do PRIMEIRO adiamento; depois `pulada`. Mesma regra e mesmo
motivo do lembrete — abrir turno no meio de outro cola duas respostas numa
bolha ou faz o coletor perder a em curso.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from app.agenda.dominio import guardi_de
from app.dependencies import normalizar_agent_id
from app.disparador_lembretes import (SQL_DONO_ATIVO, SQL_NOME, SQL_RECADO,
                                      SQL_TURNO_ABERTO, _primeiro_nome)
from app.routers.mcp_anexos import JANELA_TURNO_S
from app.varredura import dominio
from app.varredura.regras import ADIAMENTO, ADIAMENTO_MAX, velha

logger = logging.getLogger(__name__)

# O `colher_resposta` reconhece a varredura por este prefixo (sem recuo de
# texto, quadro vira `entregue`); `test_varredura_disparo` tranca os dois iguais.
PREFIXO_RUN = "hsos-varredura-"

SQL_ATENDIDO_PELA_NINA = """
    SELECT EXISTS (SELECT 1 FROM public.agent_profiles
                    WHERE agent_id = 'nina' AND $1::uuid = ANY(allowed_user_ids))
"""

LINHA_PEDIDA = "🔎 A Nina pediu um resumo das suas pendências."
# Sem `base64`/`mimeType`: não é anexo, é a marca que a tela e o push leem.
MEDIA_PEDIDA = json.dumps([{"type": "varredura_pedida"}], ensure_ascii=False)

_CONSULTAS = (
    "Consulte só os sistemas para os quais você tem ferramenta (o que não "
    "aparece na sua lista não está ligado, não tente): `taskhs_minhas`; "
    "`hsgrowth_consultar` com `minhas_tarefas`, `tarefas_atrasadas` e "
    "`meus_cards`; `gestorhs_consultar` nas consultas da função do seu dono "
    "(veja `gestorhs_consultas`); `email_listar` com `so_nao_lidos: true` e "
    "`desde` nos últimos 3 dias úteis. Só o que é DO SEU DONO: as tarefas, "
    "cards, OS e e-mails dele. Total do sistema inteiro (\"11.559 OS\", "
    "\"129 cards parados no quadro geral\") não é pendência dele — não cite."
)

_REGISTRO = (
    "Depois chame `varredura_registrar` com `resumo` e `numeros`. Os números são "
    "só contagens que as ferramentas devolveram — nunca estime. Sistema que "
    "falhou vai em `numeros.falhas` e o resumo diz \"não consegui ler o X\". Do "
    "e-mail, pode citar assunto e remetente, nunca o corpo."
)

_CARDAPIO = (
    "Então escreva ao seu dono um cardápio curto do dia: primeiro o que está "
    "atrasado, depois o que vence logo, e no fim UMA ÚNICA oferta de preparar "
    "algo (que vira cartão para ele aprovar, como sempre) — a mais útil; não "
    "ofereça mais de uma coisa."
)

_TARDE = ("Se a ferramenta responder `novidade: false`, responda só `NO_REPLY` "
          "— não há o que dizer de novo desde a manhã.")

_PEDIDA = "A Nina pediu este resumo; a pessoa vai ver isto."

_QUADRO = (
    "Chame `pendencias_da_equipe` e escreva o quadro da equipe de hoje: uma "
    "linha para CADA pessoa da lista (todas, mesmo sem pendência — confira a "
    "contagem antes de enviar), com o que está atrasado e o que vence logo, e no fim os "
    "destaques. Nunca invente número — use só o que a ferramenta devolveu. Diga "
    "nominalmente quem ficou sem varredura hoje e por quê (sistema fora, o "
    "Guardi não registrou, pulada). Sistema \"não ligado\" é escolha da "
    "empresa, não falha — não o trate como problema. Responda aqui no chat — NUNCA publique "
    "em página (`publicar_pagina` gera link público)."
)


def mensagem(tipo: str, nome: str, pedida_por: str | None) -> str:
    """O texto do turno. O cabeçalho é saneado (nome é texto livre); a
    instrução é nossa, fixa."""
    primeiro = _primeiro_nome(nome)
    if tipo == "quadro":
        return f"[Quadro da equipe para {primeiro}]\n{_QUADRO}"
    partes = [_CONSULTAS, _REGISTRO, _CARDAPIO]
    if tipo == "tarde":
        cab = f"[Conferência da tarde — {primeiro}]"
        partes.append(_TARDE)
    elif tipo == "pedida" and pedida_por == "nina":
        cab = f"[Varredura pedida pela Nina — {primeiro}]"
        partes.append(_PEDIDA)
    else:  # manhã, e a pedida de ensaio do admin
        cab = f"[Varredura da manhã — {primeiro}]"
    return cab + "\n" + "\n".join(partes)


async def disparar_varredura(sessao_fn, v: dict, agora: datetime, disparar=None) -> None:
    """Decide e dispara uma varredura reservada. Cada passo, transação curta."""
    if disparar is None:
        from app.routers.conversations import disparar_turno as disparar

    carimbo = v["disparando_em"]

    async def marcar(status, **kw):
        async with sessao_fn(role="service_role") as conn:
            ok = await dominio.marcar(conn, v["id"], status, carimbo, **kw)
        if not ok:
            logger.info("Varredura %s: posse perdida ao marcar %s.", v["id"], status)
        return ok

    if velha(v["tipo"], v["proximo_em"], agora):
        await marcar("pulada", limpar_pendente=True)
        return

    agente = normalizar_agent_id(v["agent_id"])
    async with sessao_fn(role="service_role") as conn:
        if v["tipo"] == "quadro":
            # A Nina não tem dono: confere que o destinatário segue ativo e
            # ainda é atendido por ela — semeado ontem não é autorização hoje.
            valido = bool(await conn.fetchval(SQL_DONO_ATIVO, v["user_id"])) and \
                bool(await conn.fetchval(SQL_ATENDIDO_PELA_NINA, v["user_id"]))
        else:
            # O dono pode ter sido desligado, e o bot pode ter mudado de dono.
            ativo = bool(await conn.fetchval(SQL_DONO_ATIVO, v["user_id"]))
            guardi = await guardi_de(conn, v["user_id"])
            valido = ativo and bool(guardi) and normalizar_agent_id(guardi) == agente
        if valido:
            aberto = bool(await conn.fetchval(SQL_TURNO_ABERTO, agente, float(JANELA_TURNO_S)))
            nome = await conn.fetchval(SQL_NOME, v["user_id"])

    if not valido:
        logger.info("Varredura %s pulada: dono inativo ou %s não é mais o Guardi dele.",
                    v["id"], v["agent_id"])
        await marcar("pulada", limpar_pendente=True)
        return

    if aberto:
        desde = v.get("turno_pendente_desde")
        if desde is not None and agora - desde >= ADIAMENTO_MAX:
            await marcar("pulada", limpar_pendente=True)
        else:
            await marcar("agendada", proximo_em=agora + ADIAMENTO,
                         pendente_desde=desde or agora)
        return

    if v["tipo"] == "pedida" and v.get("pedida_por") == "nina":
        async with sessao_fn(role="service_role") as conn:
            await conn.execute(SQL_RECADO, v["agent_id"], v["user_id"],
                               LINHA_PEDIDA, MEDIA_PEDIDA)

    if not await marcar("rodando", limpar_pendente=True):
        return
    try:
        run_id = await disparar(v["agent_id"], v["user_id"],
                                mensagem(v["tipo"], nome, v.get("pedida_por")),
                                prefixo=PREFIXO_RUN)
    except Exception as e:  # noqa: BLE001 — ErroGateway ou qualquer outra
        logger.warning("Varredura %s: turno não abriu: %s", v["id"], e)
        await marcar("erro")
        return
    # ⚠️ Não é `marcar("rodando")`: o registro pode já ter acontecido.
    async with sessao_fn(role="service_role") as conn:
        if not await dominio.gravar_run_id(conn, v["id"], carimbo, run_id):
            logger.info("Varredura %s: posse perdida ao gravar o run_id.", v["id"])


async def etapa_varredura(sessao_fn, agora: datetime, disparar=None) -> int:
    """Semeia (se ligada), fecha as sem registro e dispara. Devolve quantas
    foram processadas. Um item quebrado vira `erro` e não para os outros.

    ⚠️ Desligada, só a `pedida` dispara: a agendada já semeada fica parada (e
    vira `pulada` pelo limite) — desligar tem que parar, não só não semear."""
    async with sessao_fn(role="service_role") as conn:
        cfg = await dominio.ler_config(conn)
        if cfg.ligada:
            await dominio.semear(conn, cfg, agora)
        await dominio.fechar_sem_registro(conn)
        reservadas = await dominio.reservar(conn, so_pedidas=not cfg.ligada)
    for v in reservadas:
        try:
            await disparar_varredura(sessao_fn, v, agora, disparar=disparar)
        except Exception:  # noqa: BLE001 — uma varredura não derruba a etapa
            logger.exception("Varredura %s quebrou no disparo.", v["id"])
            try:
                async with sessao_fn(role="service_role") as conn:
                    await dominio.marcar(conn, v["id"], "erro", v["disparando_em"])
            except Exception as e:  # noqa: BLE001
                logger.warning("Varredura %s: não registrei o erro: %s", v["id"], e)
    return len(reservadas)
