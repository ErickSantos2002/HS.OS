"""Confere se os backups estão saindo, e avisa o administrador quando não estão.

⚠️ **O backup do banco falhou todo dia de 08/09 a 26/11/2026 e ninguém soube.**
Oitenta dias sem cópia do banco do HS.OS: o script escolhia o container errado,
depois faltava permissão numa sequence, e cada falha deixava um dump de 0 byte
que na listagem parecia backup. Foi achado por acaso, escrevendo o plano de
emergência — e teria sido achado no dia de restaurar, que é tarde.

Cada backup grava o próprio resultado em `backups_execucao` (o do banco direto
pelo container; o do gateway por `POST /backups/registro`). Este laço lê o
último resultado de cada origem e avisa quando:

- a última execução **falhou** — com o motivo que ela mandou; ou
- não há execução **boa** há mais de `PRAZO` — inclusive nunca.

⚠️ **O segundo caso é o que importa.** Script que não roda não grava falha:
timer desligado, container renomeado, máquina fora do ar. Um alarme que só
reagisse a `ok = false` ficaria tão calado quanto o backup ficou.

Um aviso por origem por dia (reserva atômica em `app_settings`, como no
guardião dos briefings): o laço roda nos dois workers, a cada meia hora, e sem
teto o mesmo defeito viraria dezenas de mensagens.

Não depende do gateway: roda num laço próprio, e não na ronda do vigia, que só
acontece com o gateway alcançável. O backup do gateway tem que poder avisar
justamente quando o gateway está mal.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import asyncpg

from app.database import sessao

logger = logging.getLogger(__name__)

BRASILIA = timezone(timedelta(hours=-3))

# Os dois timers rodam uma vez por dia, com `RandomizedDelaySec`. 26 h é folga
# sobre a variação de horário sem deixar passar um dia inteiro sem cópia.
PRAZO = timedelta(hours=26)

ORIGENS = {
    "banco-hsos": "Backup do banco do HS.OS",
    "gateway": "Backup da VPS do gateway",
}

# Onde olhar quando o alerta chega — cada roteiro está no plano de emergência.
_ONDE_OLHAR = {
    "banco-hsos": ("Na VPS da aplicação: `journalctl -u hsos-backup -n 20` e "
                   "`ls -la /var/backups/hsos` (dump de 0 byte não é backup)."),
    "gateway": ("Na VPS do gateway: `journalctl -u backup-openclaw -n 20`. Se nunca "
                "registrou, falta o token do registro — ver `vps-gateway/backup/README.md`."),
}

# ⚠️ O `assunto` do alerta tem `maxLength: 60` no schema do MCP, e o detalhe
# vira prévia de notificação. O motivo da falha vem de fora: cortado aqui.
_LIMITE_DO_ASSUNTO = 60
_LIMITE_DO_MOTIVO = 500


def _horas(delta: timedelta) -> int:
    return int(delta.total_seconds() // 3600)


def veredito(origem: str, ultima: dict | None, ultimo_ok_em: datetime | None,
             agora: datetime) -> tuple[str, str, str] | None:
    """`(assunto, detalhe, gravidade)` se é para avisar, `None` se está tudo bem.

    `ultima` é a execução mais recente (`ok`, `em`, `detalhe`); `ultimo_ok_em`, o
    horário do último sucesso — separados porque a última pode ser uma falha
    depois de um sucesso recente, e as duas coisas dizem coisas diferentes.
    """
    nome = ORIGENS.get(origem, origem)
    onde = _ONDE_OLHAR.get(origem, "")

    if ultima is not None and not ultima["ok"]:
        motivo = str(ultima.get("detalhe") or "sem motivo informado")[:_LIMITE_DO_MOTIVO]
        assunto = f"{nome} falhou"
        desde = (f"O último backup bom foi há {_horas(agora - ultimo_ok_em)} h."
                 if ultimo_ok_em else "Não há registro de nenhum backup bom.")
        detalhe = (f"A execução de {ultima['em'].astimezone(BRASILIA):%d/%m %H:%M} "
                   f"falhou: {motivo}\n\n{desde}\n\n{onde}")
    elif ultimo_ok_em is None:
        assunto = f"{nome}: nenhum registro"
        detalhe = ("Não há registro de nenhum backup desta origem. Ou ele não está "
                   f"rodando, ou não está conseguindo avisar.\n\n{onde}")
    elif agora - ultimo_ok_em > PRAZO:
        assunto = f"{nome} parado"
        detalhe = (f"O último backup bom foi há {_horas(agora - ultimo_ok_em)} h e "
                   "não há falha registrada depois — o script provavelmente nem "
                   f"está rodando.\n\n{onde}")
    else:
        return None
    return assunto[:_LIMITE_DO_ASSUNTO], detalhe, "atencao"


def chave_reserva(origem: str, agora: datetime) -> str:
    return f"backup_alerta:{origem}:{agora.astimezone(BRASILIA):%Y-%m-%d}"


async def _reservar(conn, chave: str, agora: datetime) -> bool:
    """`ON CONFLICT DO NOTHING … RETURNING`: só um worker ganha a reserva."""
    return await conn.fetchval(
        "INSERT INTO public.app_settings (key, value, updated_at) "
        "VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO NOTHING RETURNING true",
        chave, json.dumps({"avisado_em": agora.isoformat()})) or False


async def conferir(agora: datetime | None = None) -> dict:
    """Uma passada: avisa, uma vez por dia, cada origem que está sem backup."""
    agora = agora or datetime.now(timezone.utc)
    avisos = []
    async with sessao(role="service_role") as conn:
        for origem in ORIGENS:
            ultima = await conn.fetchrow(
                "SELECT ok, em, detalhe FROM public.backups_execucao "
                "WHERE origem = $1 ORDER BY em DESC LIMIT 1", origem)
            ultimo_ok_em = await conn.fetchval(
                "SELECT max(em) FROM public.backups_execucao WHERE origem = $1 AND ok",
                origem)
            v = veredito(origem, dict(ultima) if ultima else None, ultimo_ok_em, agora)
            if v is None:
                continue
            if not await _reservar(conn, chave_reserva(origem, agora), agora):
                continue
            avisos.append((origem, v))
        # Linhas pequenas, mas sem fim; 90 dias bastam para ver o histórico.
        await conn.execute(
            "DELETE FROM public.backups_execucao WHERE em < now() - interval '90 days'")

    # Fora da conexão: o aviso abre a dele. Import tardio pelo mesmo motivo do
    # guardião dos briefings — não amarrar ordem de boot.
    from app.routers.mcp_alerta import avisar_administradores
    for origem, (assunto, detalhe, gravidade) in avisos:
        logger.warning("Guardião de backups: %s — %s", assunto, detalhe[:200])
        try:
            await avisar_administradores("nina", assunto, detalhe, gravidade)
        except Exception:  # noqa: BLE001
            logger.exception("Guardião de backups: não consegui avisar sobre %s.", origem)
    return {"ok": True, "avisos": [o for o, _ in avisos]}


def intervalo() -> int:
    try:
        return max(0, int(os.environ.get("GUARDIAO_BACKUPS_SEGUNDOS", "1800")))
    except ValueError:
        return 1800


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo do `lifespan`. Desligar: `GUARDIAO_BACKUPS_SEGUNDOS=0`."""
    seg = intervalo()
    if not seg:
        logger.info("Guardião de backups desligado (GUARDIAO_BACKUPS_SEGUNDOS=0).")
        return
    # Espera um pouco antes da primeira passada: o boot já tem trabalho que chegue.
    espera = 120
    avisou_sem_tabela = False
    while not parar.is_set():
        try:
            await asyncio.wait_for(parar.wait(), timeout=espera)
            return
        except asyncio.TimeoutError:
            pass
        espera = seg
        try:
            await conferir()
        except asyncpg.UndefinedTableError:
            if not avisou_sem_tabela:
                avisou_sem_tabela = True
                logger.warning("Guardião de backups parado: aplicar a migração 043.")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — o laço não pode morrer
            logger.warning("Guardião de backups: passada falhou: %s", e)
