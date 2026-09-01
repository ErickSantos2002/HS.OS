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

# Rótulo de nó lido a quatro metros. `specialty` costuma ser uma frase inteira.
_LIMITE_PAPEL = 40

# A tarefa é uma linha de SVG embaixo do nó. Mensagem de agente pode trazer
# tabela, markdown ou CSS de artefato publicado — sem corte, atravessa a parede.
_LIMITE_TAREFA = 46

# Pergunta sem resposta além disto é demora que a parede precisa destacar.
# É o `LONGO_MIN_PADRAO` da edge original, mantido.
_LONGO = timedelta(minutes=8)

# Depois disso a conversa não é mais "agora": o nó apaga e a curva some.
_ESQUECE = timedelta(hours=2)


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


def _encurtar(texto: str, limite: int) -> str:
    """Corta no limite com reticências. Parede não é catálogo."""
    if len(texto) <= limite:
        return texto
    return texto[: limite - 1].rstrip(" ,;:—-") + "…"


def estado_do_agente(ultima, agora: datetime) -> str:
    """`ocioso`, `pensando` ou `longo` — é quem manda no desenho.

    Nó ocioso não emite rota; `longo` é o que a parede destaca. A régua dos 8
    minutos vem do `LONGO_MIN_PADRAO` da edge original, e o motivo dela é o item
    5 do roadmap de 31/08: pergunta engolida foi a queixa que o CEO mais sentiu.

    Última fala do agente significa que ele entregou — volta a ocioso. Nó aceso
    sem trabalho vira ruído numa parede vista o dia inteiro.
    """
    if not ultima or not isinstance(ultima.get("created_at"), datetime):
        return "ocioso"
    idade = agora - ultima["created_at"]
    if idade > _ESQUECE or (ultima.get("role") or "") != "user":
        return "ocioso"
    return "longo" if idade >= _LONGO else "pensando"


def montar_agentes(perfis: list, contexto: list, ultimas: dict,
                   agora: datetime) -> list[dict]:
    """Os nós da constelação, no formato que a tela espera.

    ⚠️ **`filhos` sai sempre vazio, e não é esquecimento.** Os satélites que
    orbitam quem os criou liam a `subagent_watch` — 0 linha e **nenhum
    escritor**, medido em 01/09/2026. Desenhar órbita de sub-agente inventado
    seria pior que não desenhar.
    """
    por_agente = {c.get("agent_id"): c for c in contexto if c.get("agent_id")}
    nos = []
    for p in perfis:
        agente = p.get("agent_id")
        if not agente:
            continue
        ultima = ultimas.get(agente)
        estado = estado_do_agente(ultima, agora)
        ativo = estado != "ocioso"
        c = por_agente.get(agente) or {}
        janela = int(c.get("context_tokens") or 0)
        nos.append({
            "id": agente,
            "nome": p.get("name") or agente,
            # ⚠️ `role` está vazio nos cinco agentes (medido em 01/09); quem
            # carrega o papel é `specialty`. Lendo só `role`, os nós subiriam
            # sem rótulo — e o rótulo é o que faz a parede ser lida de longe.
            "papel": _encurtar((p.get("role") or p.get("specialty") or "").strip(),
                               _LIMITE_PAPEL),
            "estado": estado,
            # A pergunta em aberto é o que o agente está fazendo. Sem conversa
            # não há tarefa, e a tela cai no papel.
            #
            # ⚠️ Encurtar aqui não é estética. Visto na parede em 01/09: uma
            # mensagem trazia o CSS de um artefato publicado e o rótulo do nó
            # saiu cuspindo `{ color:#E41A11; } .green {…` de ponta a ponta.
            "tarefa": (_encurtar(" ".join(((ultima or {}).get("content") or "").split()),
                                 _LIMITE_TAREFA) or None) if ativo else None,
            "desde": (ultima or {}).get("created_at").isoformat() if ativo else None,
            # Fração, não porcento: o anel desenha `1 - contexto`. Sem janela
            # conhecida é `None` — `0` desenharia anel vazio, lido na parede
            # como "contexto limpo".
            "contexto": (round(int(c.get("total_tokens") or 0) / janela, 4)
                         if janela > 0 else None),
            "filhos": [],
            "parceiro": (ultima or {}).get("autor") if ativo else None,
            # Agente falando com agente não tem fonte: a delegação acontece no
            # gateway e não deixa linha nossa.
            "parceiroAgente": None,
        })
    return nos


def montar_eventos(publicados: list, conversas: list, limite: int = 12) -> list[dict]:
    """A coluna que rola: o que aconteceu, do mais novo para o mais velho."""
    eventos = []
    for d in publicados:
        eventos.append({
            "ts": d.get("created_at"),
            "tipo": "entrega",
            "texto": f"{d.get('agent_id')} publicou {d.get('title')}",
        })
    for c in conversas:
        texto = (c.get("content") or "").strip().replace("\n", " ")
        if len(texto) > _LIMITE_TEXTO:
            texto = texto[: _LIMITE_TEXTO - 1].rstrip() + "…"
        quem = c.get("agent_id") if (c.get("role") == "agent") else (c.get("autor") or "alguém")
        eventos.append({"ts": c.get("created_at"), "tipo": "conversa",
                        "texto": f"{quem}: {texto}"})
    eventos.sort(key=lambda e: e["ts"] or datetime.min.replace(tzinfo=timezone.utc),
                 reverse=True)
    for e in eventos:
        e["ts"] = e["ts"].isoformat() if isinstance(e["ts"], datetime) else None
    return eventos[:limite]


def montar_numeros(total: dict, entregas: int, conversas: int) -> dict:
    """O rodapé. Zero de token é medido; taxa de cache não é.

    ⚠️ `cacheTaxa` fica **nula** enquanto ninguém escrever `cached_tokens` — o
    campo está zerado nas linhas todas e o `coletor_uso` não o menciona. `0%` na
    parede afirmaria que o cache nunca acerta, que é o mesmo erro que o coletor
    de métricas cometeu com `messages_total` até hoje.
    """
    return {
        "entregas": int(entregas),
        "conversas": int(conversas),
        "tokens": int(total.get("tokens") or 0),
        "custo": float(total.get("custo") or 0),
        "cacheTaxa": None,
    }
