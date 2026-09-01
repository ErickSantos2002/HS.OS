"""Painel de parede — o que os agentes estão fazendo, para uma TV do escritório.

**Por que não é a `warroom-feed` portada.** A original (582 linhas, em
`functions/_pausado/`) lê 12 tabelas, e em 01/09/2026 **seis estavam vazias** —
inclusive as duas do conteúdo principal: `agent_results` (entregas concluídas) e
`agent_activity` (ações autônomas), zeradas nos 14 dias anteriores. As
automações reais moram no gateway (`cron_jobs`), não na tabela `automations`;
`subagent_watch` não tem escritor nenhum. Portar fiel — que é o princípio da
casa, e por bons motivos — teria subido uma TV em branco.

Então as fontes mudaram, e só elas: o painel lê o que este sistema de fato
produz — briefings publicados, conversas, consumo e o estado dos agentes.

⚠️ **Medido ou ausente, nunca zero inventado.** Mesma régua do
`coletor_metricas`, pela mesma razão: numa parede vista de longe, `0%` é lido
como fato. Ocupação de contexto sem janela conhecida é `None`, não zero.

⚠️ **O link é a credencial.** A TV não faz login — navegador de TV não manda
cabeçalho, então o token vai na URL. Quem tiver o link vê o painel. É aceitável
para uma tela interna e **não** para um link que circula; rotacionar o segredo
`WARROOM_TOKEN` é o que revoga.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import hmac

FUSO = ZoneInfo("America/Recife")

# Uma TV é vista de longe: parágrafo não cabe e não se lê.
_LIMITE_TEXTO = 120

# Quanto tempo sem atividade ainda conta como "trabalhando". Os briefings saem
# em janelas de 5 minutos, e meia hora cobre uma conversa em andamento sem
# acender agente que só rodou de manhã.
_JANELA_ATIVO = timedelta(minutes=30)


def confere_token(recebido: str | None, esperado: str | None) -> bool:
    """Compara em tempo constante — `==` vaza, pelo tempo, quantos caracteres
    iniciais bateram.

    ⚠️ **Compara em bytes de propósito.** `hmac.compare_digest` levanta
    `TypeError` quando recebe `str` com caractere fora do ASCII, e o segredo é
    digitado por gente. Já custou tempo no SSO do GestorHS.

    Segredo ausente recusa todo mundo: liberar quando não há segredo
    transformaria um esquecimento de configuração em porta aberta.
    """
    if not recebido or not esperado:
        return False
    return hmac.compare_digest(recebido.encode("utf-8"), esperado.encode("utf-8"))


def pode_ver(token: str | None, segredo: str | None, tem_sessao: bool) -> bool:
    """Dois caminhos, como na tela original: a TV entra pelo token, quem já
    está logado entra pela sessão.

    A sessão vale sozinha **de propósito**: token torto não pode derrubar o
    painel de quem entrou pela porta da frente, e é assim que o segredo pode ser
    rotacionado sem ninguém ficar de fora.
    """
    return tem_sessao or confere_token(token, segredo)


def bloco_agentes(stats: list, contexto: list, agora: datetime | None = None) -> list[dict]:
    """A faixa do topo: um agente por coluna, com quanto da janela já gastou.

    A lista é a dos agentes — quem não tem linha de contexto continua aparecendo,
    sem ocupação. O contrário esconderia da parede justamente o agente que ainda
    não falou hoje.

    ⚠️ **`online` NÃO sai de `agent_stats.status`.** Conferido contra o banco em
    01/09/2026: `status` vale `"ok"` nas cinco linhas — é o resultado da última
    execução, não sinal de vida. Lido como liveness, a faixa ficaria apagada
    para sempre enquanto os agentes publicam cinco briefings por manhã. O sinal
    é `last_active`.

    Três estados, não dois: sem `last_active` o agente é **desconhecido**
    (`None`), não "fora". Agente que nunca rodou não é agente parado.
    """
    agora = agora or datetime.now(timezone.utc)
    por_agente = {c.get("agent_id"): c for c in contexto if c.get("agent_id")}
    faixa = []
    for s in stats:
        agente = s.get("agent_id")
        if not agente:
            continue
        c = por_agente.get(agente) or {}
        janela = int(c.get("context_tokens") or 0)
        gasto = int(c.get("total_tokens") or 0)
        visto = s.get("last_active")
        faixa.append({
            "agente": agente,
            "online": (agora - visto <= _JANELA_ATIVO) if isinstance(visto, datetime) else None,
            # Sem janela conhecida não se sabe a ocupação. `0%` seria uma
            # afirmação — e foi a janela errada que fez o gateway declarar 6,5%
            # do contexto que tinha.
            "ocupacao": round(100.0 * gasto / janela, 1) if janela > 0 else None,
        })
    return faixa


def _hora_local(quando) -> str | None:
    if not isinstance(quando, datetime):
        return None
    return quando.astimezone(FUSO).strftime("%H:%M")


def bloco_publicado(documentos: list) -> list[dict]:
    """Os briefings do dia. É o que esta plataforma entrega sem ninguém pedir —
    cinco por dia útil — e o que faz a parede ter o que mostrar de manhã."""
    return [
        {
            "hora": _hora_local(d.get("created_at")),
            "agente": d.get("agent_id"),
            "titulo": d.get("title"),
        }
        for d in documentos
    ]


def bloco_agora(conversas: list) -> list[dict]:
    """As últimas trocas, encurtadas para caber na parede."""
    linhas = []
    for c in conversas:
        texto = (c.get("content") or "").strip().replace("\n", " ")
        if len(texto) > _LIMITE_TEXTO:
            texto = texto[: _LIMITE_TEXTO - 1].rstrip() + "…"
        do_agente = (c.get("role") or "") == "agent"
        linhas.append({
            "de": c.get("agent_id") if do_agente else "pessoa",
            "para": "pessoa" if do_agente else c.get("agent_id"),
            "texto": texto,
            "hora": _hora_local(c.get("created_at")),
        })
    return linhas


def bloco_consumo(total: dict) -> dict:
    """Tokens e custo do dia.

    Zero aqui é medido, não inventado: nenhum evento significa nenhum token. A
    distinção que importa é contra campo que ninguém apurou — esses ficam nulos.
    """
    return {
        "tokens": int(total.get("tokens") or 0),
        "custo": float(total.get("custo") or 0),
    }
