"""Disparador de lembretes do Guardi (spec 2026-11-09, "Disparador").

A cada `DISPARADOR_LEMBRETES_SEGUNDOS` (padrão 30; 0 desliga), cada worker
reserva até 10 lembretes vencidos e, para cada um:

1. **o recado, sem agente** — `⏰ Lembrete: <titulo>` em `conversations`,
   comitado antes de qualquer chamada ao gateway. O push nasce do trigger do
   INSERT (`trg_push_pendente`). ⚠️ É isto que garante o anti-objetivo
   "lembrete que some": com o gateway fora, a pessoa recebe o recado igual;
2. **o turno do Guardi**, se há `instrucao` e o teto diário permite, pela porta
   única `disparar_turno` em nome do dono. A resposta é colhida pelo
   `coletor_respostas` — nada a fazer aqui;
3. **avança**: único → `proximo_em` NULL; recorrente → o próximo pela regra.

⚠️ **Turno já aberto com o Guardi** (de qualquer pessoa): o recado sai na hora
e o turno é adiado de 2 em 2 min, até 30 min contados do disparo ORIGINAL
(`turno_pendente_desde`). Abrir o turno no meio de outro faria o coletor perder
a resposta em curso (ele só colhe o run mais novo) ou colar duas respostas numa
bolha. Passou dos 30 min, fica só o recado (`entregue_sem_agente`).

**Re-aviso** (spec 2026-11-13, "lembrete que chama atenção"): cada recado
marca o aviso (`aviso_em`) e a insistência (`reaviso_em` = +5 min). Na mesma
passada, `reavisar_um` regrava `⏰ Lembrete (de novo): …` para quem não
respondeu (UMA vez) ou cujo "Adiar 10 min" venceu. ⚠️ **Re-aviso é só o
recado**: não chama o Guardi nem conta no teto de 12 turnos. Push e janela do
app nascem dele pelos mesmos caminhos do primeiro recado.

⚠️ **Reserva entre os 2 workers** por `disparando_em`, com a guarda repetida no
WHERE de fora — o mesmo desenho do `SQL_RESERVAR_RUNS` do coletor. Sem ela, o
recado e o turno saíam em dobro.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

from app.agenda.dominio import guardi_de
from app.agenda.regras import (ADIAMENTO, ADIAMENTO_MAX, ATRASO_MAX, INSISTENCIA,
                                TETO_TURNOS_DIA, proximo)
from app.bots_pessoais import _linha
from app.database import sessao
from app.dependencies import normalizar_agent_id
from app.gateway.client import ErroGateway
from app.routers.mcp_anexos import JANELA_TURNO_S

logger = logging.getLogger(__name__)

# Marca os runs abertos pelo disparador; é por ela que o teto diário conta.
PREFIXO_RUN = "hsos-lembrete-"

SQL_RESERVAR = """
    UPDATE public.lembretes l SET disparando_em = now()
     WHERE l.id IN (
           SELECT x.id FROM public.lembretes x
            WHERE x.ativo
              AND x.proximo_em <= now()
              AND (x.disparando_em IS NULL OR x.disparando_em < now() - interval '10 minutes')
            ORDER BY x.proximo_em
            LIMIT 10
            FOR UPDATE SKIP LOCKED)
       AND l.ativo
       AND (l.disparando_em IS NULL OR l.disparando_em < now() - interval '10 minutes')
    RETURNING l.id::text AS id, l.user_id::text AS user_id, l.agent_id, l.titulo,
              l.instrucao, l.regra, l.proximo_em, l.turno_pendente_desde, l.disparando_em
"""

# Run aberto com o agente, de QUALQUER pessoa — a regra do `turno_em_curso`
# (`routers/mcp_anexos.py`) sem o filtro de dono, e sem o run que o coletor já
# largou ou que a compactação redirecionou.
SQL_TURNO_ABERTO = """
    SELECT EXISTS (
        SELECT 1 FROM public.agent_runs
         WHERE regexp_replace(lower(btrim(agent_id)), '^openclaw:', '') = $1
           AND message_id IS NULL
           AND redireciona_para IS NULL
           AND coleta_encerrada_em IS NULL
           AND criado_em > now() - make_interval(secs => $2))
"""

SQL_TURNOS_HOJE = """
    SELECT count(*) FROM public.agent_runs
     WHERE user_id = $1::uuid
       AND run_id LIKE 'hsos-lembrete-%'
       AND criado_em >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                         AT TIME ZONE 'America/Sao_Paulo')
"""

SQL_NOME = "SELECT full_name FROM public.profiles WHERE id = $1::uuid"

SQL_DONO_ATIVO = "SELECT is_active FROM auth.users WHERE id = $1::uuid"

# Dono desligado ou Guardi que mudou de dono: o lembrete não vale mais.
SQL_DESATIVAR = """
    UPDATE public.lembretes
       SET ativo = false,
           ultimo_status = 'erro',
           turno_pendente_desde = NULL,
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid AND disparando_em = $2
"""

# ⚠️ O lease conta do item, não da passada: dez itens com `chat.send` em série
# podem passar dos 10 min, e o outro worker reservaria o último de novo. Por
# isso renovar exige o carimbo da NOSSA reserva — renovar só por `id` passaria
# por cima da reserva do outro worker, e os dois disparariam. Sem linha: o item
# não é mais nosso, ou foi pausado/apagado/editado (`editar` zera o carimbo).
#
# ⚠️ Toda escrita final (`SQL_CONCLUIR`, `SQL_ERRO`, `SQL_DESATIVAR`) exige o
# carimbo renovado: é o que impede a conclusão de pisar numa edição feita
# durante o disparo.
SQL_RENOVAR = """
    UPDATE public.lembretes SET disparando_em = now()
     WHERE id = $1::uuid AND disparando_em = $2 AND ativo
    RETURNING disparando_em
"""

SQL_RECADO = """
    INSERT INTO public.conversations (agent_id, user_id, role, content, media)
    VALUES ($1, $2::uuid, 'agent', $3, $4::text::jsonb)
"""

# O recado É o aviso: gravado na MESMA transação, zera o estado do aviso
# anterior (recorrente começa limpo) e marca a insistência de 5 min.
SQL_AVISO = """
    UPDATE public.lembretes
       SET aviso_em = $2,
           reconhecido_em = NULL,
           reconhecido_como = NULL,
           reaviso_em = $3,
           reavisos = 0
     WHERE id = $1::uuid AND disparando_em = $4
"""

# Re-aviso vencido: sem resposta ao aviso (insistência) ou "Adiar" que venceu.
# Mesmo lease do `SQL_RESERVAR` — é o `disparando_em` que exclui um do outro e
# os 2 workers entre si.
SQL_RESERVAR_REAVISO = """
    UPDATE public.lembretes l SET disparando_em = now()
     WHERE l.id IN (
           SELECT x.id FROM public.lembretes x
            WHERE x.ativo
              AND x.reaviso_em <= now()
              AND (x.reconhecido_em IS NULL OR x.reconhecido_como = 'adiado')
              AND (x.disparando_em IS NULL OR x.disparando_em < now() - interval '10 minutes')
            ORDER BY x.reaviso_em
            LIMIT 10
            FOR UPDATE SKIP LOCKED)
       AND l.ativo
       AND (l.disparando_em IS NULL OR l.disparando_em < now() - interval '10 minutes')
    RETURNING l.id::text AS id, l.user_id::text AS user_id, l.agent_id, l.titulo,
              l.reaviso_em, l.reconhecido_em, l.reconhecido_como, l.disparando_em
"""

# ⚠️ A guarda repete `reaviso_em` e `reconhecido_como` como foram reservados:
# se a pessoa clicou Feito ou Adiar entre a reserva e aqui, o clique ganha —
# nada é gravado e o recado não sai (ele só é inserido se esta linha mudou).
SQL_CONCLUIR_REAVISO = """
    UPDATE public.lembretes
       SET aviso_em = CASE WHEN $2 THEN $3 ELSE aviso_em END,
           reconhecido_em = CASE WHEN $2 THEN NULL ELSE reconhecido_em END,
           reconhecido_como = CASE WHEN $2 THEN NULL ELSE reconhecido_como END,
           reavisos = reavisos + CASE WHEN $2 THEN 1 ELSE 0 END,
           reaviso_em = $4,
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid AND disparando_em = $5
       AND reaviso_em = $6
       AND reconhecido_como IS NOT DISTINCT FROM $7
"""

# Solta a reserva de um re-aviso que não gravou (clique no meio, ou dono que
# não vale mais): sem isto o lease seguraria o lembrete por 10 min.
SQL_SOLTAR = """
    UPDATE public.lembretes SET disparando_em = NULL
     WHERE id = $1::uuid AND disparando_em = $2
"""

# `ultimo_disparo_em` e `ultimo_status` nulos mantêm o que estava (adiamento e
# perdido não são disparo novo).
SQL_CONCLUIR = """
    UPDATE public.lembretes
       SET proximo_em = $2,
           turno_pendente_desde = $3,
           ultimo_disparo_em = COALESCE($4, ultimo_disparo_em),
           ultimo_status = COALESCE($5, ultimo_status),
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid AND disparando_em = $6
"""

# Exceção inesperada: registra e AVANÇA como numa conclusão, sem nova tentativa.
# ⚠️ Soltar sem avançar fazia a passada seguinte regravar o recado a cada 30 s
# por até 6 h. Melhor perder um disparo que entrar em laço.
SQL_ERRO = """
    UPDATE public.lembretes
       SET ultimo_status = 'erro',
           proximo_em = $2,
           turno_pendente_desde = NULL,
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid AND disparando_em = $3
"""


@dataclass(frozen=True)
class Decisao:
    recado: bool
    turno: bool
    adiar_ate: datetime | None
    status: str | None


def decidir(l: dict, agora: datetime, turno_aberto: bool, turnos_hoje: int) -> Decisao:
    """O que fazer com um lembrete vencido. Pura.

    `status` None = adiado (ainda não concluiu).
    """
    if agora - l["proximo_em"] > ATRASO_MAX:
        return Decisao(False, False, None, "perdido")
    pendente_desde = l.get("turno_pendente_desde")
    recado = pendente_desde is None
    if not l.get("instrucao"):
        return Decisao(recado, False, None, "entregue")
    if turnos_hoje >= TETO_TURNOS_DIA:
        return Decisao(recado, False, None, "entregue_sem_agente")
    if turno_aberto:
        espera = agora - (pendente_desde or agora)
        if espera < ADIAMENTO_MAX:
            return Decisao(recado, False, agora + ADIAMENTO, None)
        return Decisao(recado, False, None, "entregue_sem_agente")
    return Decisao(recado, True, None, "entregue")


@dataclass(frozen=True)
class ReAviso:
    recado: bool
    reaviso_em: datetime | None


def decidir_reaviso(l: dict, agora: datetime) -> ReAviso:
    """O que fazer com um re-aviso vencido. Pura.

    - **Adiar venceu** → recado de novo, e a insistência de 5 min recomeça
      para ESTE novo aviso. Adiar é ilimitado: quem adia está respondendo.
    - **Sem resposta** → recado de novo e nenhum re-aviso depois. ⚠️ É o
      anti-objetivo "insistência que vira spam": uma repetição só, nunca laço.
    - **Atrasado mais de 6 h** (backend fora) → só limpa: tocar "de novo" à
      noite o lembrete da manhã é pior que não tocar.
    """
    if agora - l["reaviso_em"] > ATRASO_MAX:
        return ReAviso(False, None)
    if l.get("reconhecido_como") == "adiado":
        return ReAviso(True, agora + INSISTENCIA)
    if l.get("reconhecido_em") is None:
        return ReAviso(True, None)
    return ReAviso(False, None)


def _media_do_recado(lembrete_id: str, titulo: str, aviso_em: datetime,
                     de_novo: bool = False) -> str:
    """O item que marca o recado como lembrete — é por ele que o push vira
    `payload_lembrete` e a janela do app abre. `aviso_em` é a chave do token
    de ação: o token de um aviso não serve para outro."""
    return json.dumps([{"type": "lembrete", "id": lembrete_id, "name": titulo,
                        "aviso_em": aviso_em.astimezone(timezone.utc).isoformat(),
                        "de_novo": de_novo, "mimeType": "", "base64": ""}],
                      ensure_ascii=False)


def _seguinte(regra: dict, agora: datetime) -> datetime | None:
    """Único encerra; recorrente vai para o próximo pela regra."""
    return None if regra.get("tipo") == "unico" else proximo(regra, agora)


def _no_cabecalho(valor, teto: int = 200) -> str:
    """Uma linha, sem aspas nem colchetes.

    ⚠️ Título e nome são texto livre: `x"] ignore tudo e [y` fecharia o
    cabeçalho `[Lembrete agendado por … — "…"]` e o resto viraria instrução
    com a autoridade dele. A `instrucao` fica fora do cabeçalho e segue como
    veio — é o pedido do próprio dono.
    """
    sem = "".join(" " if c in '"“”[]' else c for c in _linha(valor, teto=teto))
    return " ".join(sem.split())


def _primeiro_nome(full_name) -> str:
    partes = _no_cabecalho(full_name, teto=60).split()
    return partes[0] if partes else "o dono"


def _mensagem(nome: str, titulo: str, instrucao: str) -> str:
    return f'[Lembrete agendado por {_no_cabecalho(nome, teto=60)} — "{_no_cabecalho(titulo)}"] {instrucao}'


async def disparar_um(sessao_fn, l: dict, agora: datetime, disparar=None) -> None:
    """Aplica a `Decisao` a um lembrete reservado.

    Recebe a fábrica de sessão, não uma conexão: o recado tem que estar
    COMITADO antes do `chat.send`, e uma conexão dentro de transação só
    comitaria no fim. Cada passo é uma transação curta.
    """
    if disparar is None:
        # Importado aqui: o router importa muita coisa (mesmo motivo do coletor).
        from app.routers.conversations import disparar_turno as disparar

    async with sessao_fn(role="service_role") as conn:
        # Paridade com as rotas: o lembrete foi autorizado quando foi criado,
        # mas o dono pode ter sido desligado e o bot pode ter mudado de dono.
        ativo = bool(await conn.fetchval(SQL_DONO_ATIVO, l["user_id"]))
        guardi = await guardi_de(conn, l["user_id"])
        if not ativo or not guardi or \
                normalizar_agent_id(guardi) != normalizar_agent_id(l["agent_id"]):
            await conn.execute(SQL_DESATIVAR, l["id"], l["disparando_em"])
            logger.warning("Lembrete %s desativado: dono inativo ou %s não é mais o Guardi dele.",
                           l["id"], l["agent_id"])
            return
        turno_aberto = bool(await conn.fetchval(
            SQL_TURNO_ABERTO, normalizar_agent_id(l["agent_id"]), float(JANELA_TURNO_S)))
        turnos_hoje = int(await conn.fetchval(SQL_TURNOS_HOJE, l["user_id"]) or 0)
        nome = _primeiro_nome(await conn.fetchval(SQL_NOME, l["user_id"]))

    dec = decidir(l, agora, turno_aberto, turnos_hoje)
    status = dec.status

    if dec.recado:
        media = _media_do_recado(l["id"], l["titulo"], agora)
        async with sessao_fn(role="service_role") as conn:
            await conn.execute(SQL_RECADO, l["agent_id"], l["user_id"],
                               f"⏰ Lembrete: {l['titulo']}", media)
            await conn.execute(SQL_AVISO, l["id"], agora, agora + INSISTENCIA,
                               l["disparando_em"])

    if dec.turno:
        try:
            await disparar(l["agent_id"], l["user_id"],
                           _mensagem(nome, l["titulo"], l["instrucao"]),
                           prefixo=PREFIXO_RUN)
        except ErroGateway as e:
            logger.warning("Lembrete %s: turno do agente falhou, ficou só o recado: %s",
                           l["id"], e)
            status = "entregue_sem_agente"

    if dec.adiar_ate is not None:
        # Mantém o instante ORIGINAL: é dele que a espera de 30 min é contada.
        args = (l["id"], dec.adiar_ate, l.get("turno_pendente_desde") or agora,
                agora if dec.recado else None, None)
    else:
        seguinte = _seguinte(l["regra"], agora)
        args = (l["id"], seguinte, None, None if status == "perdido" else agora, status)
    async with sessao_fn(role="service_role") as conn:
        feito = await conn.execute(SQL_CONCLUIR, *args, l["disparando_em"])
    if feito == "UPDATE 0":
        logger.info("Lembrete %s mudou durante o disparo; a conclusão não gravou.", l["id"])


async def reavisar_um(sessao_fn, l: dict, agora: datetime) -> bool:
    """Aplica o `ReAviso` a um lembrete reservado. Devolve se o recado saiu.

    ⚠️ Não chama o Guardi, nunca: o re-aviso é só o recado (anti-objetivo
    "re-aviso gastando turno"). O UPDATE vem ANTES do recado, na mesma
    transação, e o recado só é inserido se o UPDATE pegou a linha — clique de
    Feito/Adiar no meio do caminho ganha, e o recado não sai em dobro.
    """
    async with sessao_fn(role="service_role") as conn:
        ativo = bool(await conn.fetchval(SQL_DONO_ATIVO, l["user_id"]))
        guardi = await guardi_de(conn, l["user_id"])
        valido = ativo and guardi and \
            normalizar_agent_id(guardi) == normalizar_agent_id(l["agent_id"])
        dec = decidir_reaviso(l, agora) if valido else ReAviso(False, None)
        feito = await conn.execute(
            SQL_CONCLUIR_REAVISO, l["id"], dec.recado, agora, dec.reaviso_em,
            l["disparando_em"], l["reaviso_em"], l.get("reconhecido_como"))
        if feito == "UPDATE 0":
            await conn.execute(SQL_SOLTAR, l["id"], l["disparando_em"])
            return False
        if dec.recado:
            await conn.execute(SQL_RECADO, l["agent_id"], l["user_id"],
                               f"⏰ Lembrete (de novo): {l['titulo']}",
                               _media_do_recado(l["id"], l["titulo"], agora, de_novo=True))
    return dec.recado


async def passada(sessao_fn, agora: datetime, disparar=None) -> int:
    """Reserva e dispara. Um lembrete ruim não para os outros.

    Exceção inesperada vira `erro` e avança — antes ou depois do recado: sem
    nova tentativa, porque repetir regravaria o recado a cada passada. Isso
    inclui falha de banco DEPOIS do `chat.send`: o status fica `erro` mesmo
    com o recado (e talvez o turno) já entregue.
    """
    async with sessao_fn(role="service_role") as conn:
        lembretes = await conn.fetch(SQL_RESERVAR)
    for l in lembretes:
        l = dict(l)
        try:
            async with sessao_fn(role="service_role") as conn:
                carimbo = await conn.fetchval(SQL_RENOVAR, l["id"], l["disparando_em"])
            if carimbo is None:
                logger.info("Lembrete %s: reserva perdida ou pausado; pulando.", l["id"])
                continue
            l["disparando_em"] = carimbo
            await disparar_um(sessao_fn, l, agora, disparar=disparar)
        except Exception:  # noqa: BLE001 — um lembrete não derruba a passada
            logger.exception("Lembrete %s quebrou no disparo.", l["id"])
            try:
                seguinte = _seguinte(l["regra"], agora)
            except Exception:  # noqa: BLE001 — regra quebrada: encerra, não laça
                seguinte = None
            try:
                async with sessao_fn(role="service_role") as conn:
                    await conn.execute(SQL_ERRO, l["id"], seguinte, l["disparando_em"])
            except Exception as e:  # noqa: BLE001
                logger.warning("Lembrete %s: não registrei o erro: %s", l["id"], e)

    async with sessao_fn(role="service_role") as conn:
        reavisos = await conn.fetch(SQL_RESERVAR_REAVISO)
    for l in reavisos:
        l = dict(l)
        try:
            await reavisar_um(sessao_fn, l, agora)
        except Exception:  # noqa: BLE001 — um re-aviso não derruba a passada
            # Sem nova tentativa: soltar o re-aviso marcado faria a passada
            # seguinte tentar de novo a cada 30 s. Limpa e segue.
            logger.exception("Lembrete %s quebrou no re-aviso.", l["id"])
            try:
                async with sessao_fn(role="service_role") as conn:
                    await conn.execute(SQL_CONCLUIR_REAVISO, l["id"], False, agora, None,
                                       l["disparando_em"], l["reaviso_em"],
                                       l.get("reconhecido_como"))
                    await conn.execute(SQL_SOLTAR, l["id"], l["disparando_em"])
            except Exception as e:  # noqa: BLE001
                logger.warning("Lembrete %s: não limpei o re-aviso: %s", l["id"], e)
    return len(lembretes) + len(reavisos)


def intervalo() -> int:
    try:
        return max(0, int(os.environ.get("DISPARADOR_LEMBRETES_SEGUNDOS", "30")))
    except ValueError:
        return 30


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo do `lifespan`.

    Não espera o gateway estar configurado: o recado sai sem ele.
    """
    seg = intervalo()
    if not seg:
        logger.info("Disparador de lembretes desligado (DISPARADOR_LEMBRETES_SEGUNDOS=0).")
        return
    logger.info("Disparador de lembretes a cada %ds.", seg)
    avisou_sem_tabela = False
    while not parar.is_set():
        espera = seg
        try:
            await passada(sessao, datetime.now(timezone.utc))
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            # Código no ar antes da `032`/`036`: avisa uma vez e espera mais.
            if not avisou_sem_tabela:
                avisou_sem_tabela = True
                logger.warning("Disparador de lembretes parado: aplicar as migrações 032 e 036.")
            espera = 60
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — o laço não pode morrer
            logger.warning("Disparador de lembretes: passada falhou: %s", e)
        try:
            await asyncio.wait_for(parar.wait(), timeout=espera)
        except asyncio.TimeoutError:
            pass
