"""Aviso de pedido de ausência no Guardi do RH — spec
`docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md`.

A Lidisay controla as ausências no TalentHS, mas são sistemas demais para ela
ficar olhando. Pedido pendente novo vira, em até ~2 min, um recado e dois
cartões (Aprovar/Recusar) na conversa dela com o Guardi.

⚠️ **Etapa da `passada` do `disparador_lembretes`, não laço próprio** — a porta
única do trabalho autônomo do Guardi. E **sem turno de agente**: o servidor
monta recado e cartões pelo mesmo `talenths_preparo.preparar` que o Guardi usa,
então não gasta token e não depende de o modelo lembrar da ferramenta.

A parte de cima é pura (decidir e escrever o recado); a de baixo fala com banco
e TalentHS.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app import acoes, talenths_preparo
from app.sistemas import talenths

logger = logging.getLogger(__name__)

# O cartão vence em 24 h (`VALIDADE` em `routers/acoes.py`); pedido que segue
# pendente depois disso ganha aviso novo — senão some de novo.
REAVISO = timedelta(hours=24)
# Leitura do TalentHS por destinatário, por worker. A `passada` roda a cada 30 s.
RITMO_SEGUNDOS = 120
TETO_MOTIVO = 300
TETO_CAMPO = 120


@dataclass(frozen=True)
class Config:
    ligado: bool
    destinatarios: tuple[str, ...]


def config(valor) -> Config:
    """`app_settings` `avisos_ausencia`. Ausente ou malformada = desligado."""
    if not isinstance(valor, dict):
        return Config(ligado=False, destinatarios=())
    ids = valor.get("destinatarios")
    ids = tuple(i for i in ids if isinstance(i, str) and i) if isinstance(ids, list) else ()
    return Config(ligado=valor.get("ligado") is True, destinatarios=ids)


def decidir(pendentes: list[dict], avisados: dict[str, datetime], email_destinatario: str,
            agora: datetime) -> list[tuple[dict, bool]]:
    """Quais pedidos avisar agora: `(pedido, de_novo)`.

    Novo (sem aviso registrado) → `False`; avisado há 24 h ou mais e ainda
    pendente → `True`. O pedido do próprio destinatário não entra."""
    eu = (email_destinatario or "").strip().lower()
    saida = []
    for p in pendentes:
        if p.get("status") != "pending" or not p.get("id"):
            continue
        if eu and (p.get("user_email") or "").strip().lower() == eu:
            continue
        visto = avisados.get(str(p["id"]))
        if visto is None:
            saida.append((p, False))
        elif visto <= agora - REAVISO:
            saida.append((p, True))
    return saida


# A conversa renderiza markdown, e esses campos são digitados por qualquer
# colaborador no TalentHS: sem escape, `[texto](url)` vira link na voz do
# Guardi e `![](url)` uma imagem externa na conversa do RH.
_MARKDOWN = re.compile(r"([\\`*_\[\]()!<>#~|])")


def _limpo(valor, teto: int) -> str:
    s = " ".join(str(valor or "").split())
    return s if len(s) <= teto else s[: teto - 1].rstrip() + "…"


def _md(valor, teto: int) -> str:
    """Limpa, corta e só então escapa — o teto conta o texto, não as barras."""
    return _MARKDOWN.sub(r"\\\1", _limpo(valor, teto))


def _dia(iso) -> str:
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%d/%m")
    except ValueError:
        return _limpo(iso, 20)


def _quando(p: dict) -> str:
    ini, fim = _dia(p.get("start_date")), _dia(p.get("end_date") or p.get("start_date"))
    if ini == fim and p.get("start_time") and p.get("end_time"):
        return f"{ini}, {_limpo(p['start_time'], 5)}–{_limpo(p['end_time'], 5)}"
    datas = ini if ini == fim else f"{ini} a {fim}"
    dias = p.get("days")
    if isinstance(dias, (int, float)):
        n = int(dias) if float(dias).is_integer() else dias
        return f"{datas} ({n} {'dia' if n == 1 else 'dias'})"
    return datas


def texto_recado(pedido: dict, de_novo: bool) -> str:
    cabeca = "📅 Ainda pendente — " if de_novo else "📅 Pedido de ausência — "
    quem = _md(pedido.get("user_name") or "Alguém", TETO_CAMPO)
    depto = _md(pedido.get("department"), TETO_CAMPO)
    tipo = _md(pedido.get("type_name") or "Ausência", TETO_CAMPO)
    texto = f"{cabeca}{quem}{f' ({depto})' if depto else ''}: {tipo}, {_quando(pedido)}."
    motivo = _md(pedido.get("reason"), TETO_MOTIVO)
    return f"{texto} Motivo: {motivo}" if motivo else texto


# ── a etapa (banco + TalentHS) ───────────────────────────────────────────────
#
# Por destinatário: lê os pendentes como ele, decide, e para cada pedido
# PREPARA os dois cartões (só GET no TalentHS, fora de transação — não segurar
# conexão do pool durante HTTP) e só então abre a transação que trava o aviso
# e grava recado + cartões. Quem não ganha a trava não grava nada.

CHAVE = "avisos_ausencia"
# Espaçamento entre recado e cartões: dentro da transação `now()` é um só, e
# a conversa ordena por `created_at`.
_PASSO = timedelta(milliseconds=1)

SQL_CONFIG = "SELECT value FROM public.app_settings WHERE key = $1"
SQL_GUARDI = (
    "SELECT a.agent_id, a.sistemas_ligados, p.email "
    "  FROM public.agent_profiles a JOIN public.profiles p ON p.id = a.dono_id "
    " WHERE a.dono_id = $1::uuid ORDER BY a.agent_id LIMIT 1")
SQL_AVISADOS = (
    "SELECT pedido_id, ultimo_aviso_em FROM public.avisos_ausencia "
    " WHERE destinatario_id = $1::uuid AND pedido_id = ANY($2::text[])")
SQL_TRAVAR_NOVO = (
    "INSERT INTO public.avisos_ausencia (destinatario_id, pedido_id, avisado_em, ultimo_aviso_em) "
    "VALUES ($1::uuid, $2, $3, $3) ON CONFLICT DO NOTHING RETURNING pedido_id")
SQL_TRAVAR_REAVISO = (
    "UPDATE public.avisos_ausencia SET ultimo_aviso_em = $3 "
    " WHERE destinatario_id = $1::uuid AND pedido_id = $2 AND ultimo_aviso_em = $4 "
    "RETURNING pedido_id")
SQL_RECADO = (
    "INSERT INTO public.conversations (agent_id, user_id, role, content, created_at) "
    "VALUES ($1, $2::uuid, 'agent', $3, $4)")

# Ritmo por destinatário, por worker (relógio monotônico).
_ultima_leitura: dict[str, float] = {}
# Aviso de configuração quebrada: uma vez por processo, não a cada 30 s.
_avisou: set[str] = set()


def _avisar_uma_vez(chave: str, msg: str, *args) -> None:
    if chave not in _avisou:
        _avisou.add(chave)
        logger.warning(msg, *args)


async def _ler_pendentes(email: str, bot: str, dono: str) -> list[dict]:
    """⚠️ `/absences/team`, NÃO `/absences/team/pending`: o TalentHS só libera
    ao token de agente as rotas da lista dele (`auth/agente.py` de lá), e a
    `/pending` não está — volta 403, igual a login sem papel de RH. Foi o
    que deixou o aviso mudo na primeira ligação (26/11/2026)."""
    r = await talenths.chamar(email, bot, "/absences/team", dono=dono)
    if not isinstance(r, list):
        return []
    return [x for x in r if isinstance(x, dict) and x.get("status") == "pending"]


async def _avisar_um(sessao_fn, dest: str, bot: str, email: str, pedido: dict, de_novo: bool,
                     visto: datetime | None, agora: datetime, preparar) -> bool:
    ctx = {"email": email, "dono": dest}
    pid = str(pedido["id"])
    try:
        aprovar = await preparar(ctx, bot, {"acao": "aprovar_ausencia", "ids": [pid]})
        recusar = await preparar(ctx, bot, {"acao": "recusar_ausencia", "ids": [pid]})
    except ValueError as e:  # saiu de pending entre a leitura e o preparo
        logger.info("Aviso de ausência %s: não preparei (%s).", pid, e)
        return False
    async with sessao_fn(role="service_role") as conn:
        if de_novo:
            travou = await conn.fetchval(SQL_TRAVAR_REAVISO, dest, pid, agora, visto)
        else:
            travou = await conn.fetchval(SQL_TRAVAR_NOVO, dest, pid, agora)
        if travou is None:  # outro worker levou
            return False
        await conn.execute(SQL_RECADO, bot, dest, texto_recado(pedido, de_novo), agora)
        for n, (acao, (payload, resumo, _aviso)) in enumerate(
                (("talenths_aprovar_ausencia", aprovar), ("talenths_recusar_ausencia", recusar)), 1):
            await acoes.criar_pendente(conn, dest, bot, "talenths", acao, payload, resumo,
                                       criado_em=agora + _PASSO * n, silencioso=True)
    return True


async def _destinatario(sessao_fn, dest: str, agora: datetime, ler, preparar, relogio) -> int:
    async with sessao_fn(role="service_role") as conn:
        g = await conn.fetchrow(SQL_GUARDI, dest)
    if not g:
        _avisar_uma_vez(f"sem-guardi:{dest}", "Aviso de ausência: %s não tem Guardi; pulando.", dest)
        return 0
    if "talenths" not in list(g["sistemas_ligados"] or []):
        _avisar_uma_vez(f"sem-talenths:{dest}",
                        "Aviso de ausência: o Guardi %s não tem o TalentHS ligado; pulando.", g["agent_id"])
        return 0
    marca = relogio()
    ultima = _ultima_leitura.get(dest)
    if ultima is not None and marca - ultima < RITMO_SEGUNDOS:
        return 0
    _ultima_leitura[dest] = marca
    bot, email = g["agent_id"], g["email"]
    try:
        pendentes = await ler(email, bot, dest)
    except talenths.ErroSistema as e:
        if e.status != 403:
            raise
        _avisar_uma_vez(f"403:{dest}", "Aviso de ausência: o TalentHS recusou (403) a leitura dos pedidos "
                        "para o Guardi %s — o dono perdeu o papel de RH lá, ou a rota saiu da lista "
                        "liberada ao token de agente.", bot)
        return 0
    if not pendentes:
        return 0
    async with sessao_fn(role="service_role") as conn:
        linhas = await conn.fetch(SQL_AVISADOS, dest, [str(p.get("id")) for p in pendentes])
    avisados = {r["pedido_id"]: r["ultimo_aviso_em"] for r in linhas}
    feitos = 0
    for pedido, de_novo in decidir(pendentes, avisados, email, agora):
        try:
            if await _avisar_um(sessao_fn, dest, bot, email, pedido, de_novo,
                                avisados.get(str(pedido["id"])), agora, preparar):
                feitos += 1
        except Exception:  # noqa: BLE001 — um pedido não derruba os outros
            logger.exception("Aviso de ausência %s quebrou.", pedido.get("id"))
    return feitos


async def etapa_avisos(sessao_fn, agora: datetime, ler=None, preparar=None,
                       relogio=time.monotonic) -> int:
    """Uma passada: devolve quantos avisos gravou. Desligada, não lê nada."""
    ler = ler or _ler_pendentes
    preparar = preparar or talenths_preparo.preparar
    async with sessao_fn(role="service_role") as conn:
        valor = await conn.fetchval(SQL_CONFIG, CHAVE)
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError:
            valor = None
    cfg = config(valor)
    if not cfg.ligado:
        return 0
    total = 0
    for dest in cfg.destinatarios:
        try:
            total += await _destinatario(sessao_fn, dest, agora, ler, preparar, relogio)
        except Exception:  # noqa: BLE001 — TalentHS fora não derruba a etapa
            logger.exception("Aviso de ausência: destinatário %s falhou.", dest)
    return total
