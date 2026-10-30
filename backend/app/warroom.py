"""Painel de parede — o que os agentes estão fazendo, para uma TV do escritório.

**Por que não é a `warroom-feed` portada.** A original (582 linhas, em
`functions/_pausado/`) lê 12 tabelas, e em 01/09/2026 **seis estavam vazias** —
inclusive as duas do conteúdo principal: `agent_results` (entregas concluídas) e
`agent_activity` (ações autônomas), zeradas nos 14 dias anteriores. As
automações reais moram no gateway (`cron_jobs`), não na tabela `automations`;
`subagent_watch` não tem escritor nenhum. Portar fiel — que é o princípio da
casa, e por bons motivos — teria subido uma TV em branco.

Então as fontes mudaram, e só elas: o painel lê o que este sistema de fato
produz — briefings publicados, conversas, DMs, presença e o estado dos agentes.

⚠️ **Medido ou ausente, nunca zero inventado.** Mesma régua do
`coletor_metricas`, pela mesma razão: numa parede vista de longe, `0%` é lido
como fato. Ocupação de contexto sem janela conhecida é `None`, não zero.

⚠️ **O link é a credencial.** A TV não faz login — navegador de TV não manda
cabeçalho, então o token vai na URL. Quem tiver o link vê o painel. É aceitável
para uma tela interna e **não** para um link que circula; rotacionar o segredo
`WARROOM_TOKEN` é o que revoga.

⚠️ **TV pública desde 16/10/2026: nada de conteúdo.** O feed é montado só de
nomes, ids, horários, contagens e frases fixas — as consultas do router nem
selecionam `content`. Ver `docs/superpowers/specs/2026-10-16-warroom-tv-design.md`.
"""

import hmac
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Recife")

# Rótulo de nó lido a quatro metros. `specialty` costuma ser uma frase inteira.
_LIMITE_PAPEL = 40

# Pergunta sem resposta além disto é demora que a parede precisa destacar.
# É o `LONGO_MIN_PADRAO` da edge original, mantido.
_LONGO = timedelta(minutes=8)

# Depois disso a conversa não é mais "agora": o nó apaga e a curva some.
_ESQUECE = timedelta(hours=2)

# Conversa entre pessoas acesa, e janela de agrupamento do Fluxo.
_JANELA = timedelta(minutes=10)

# Ponto verde: o heartbeat do HS.OS (`use-presence`, a cada 60 s) bateu há
# menos disto. É o `ONLINE_THRESHOLD_MS` de `frontend/src/lib/presence-status.ts`
# — mude os dois juntos, senão a TV e a lista do chat discordam.
_ONLINE = timedelta(minutes=3)

_DOMINIO = "@healthsafetytech.com"

SETORES = (
    ("Diretoria", ("DIRETORIA",)),
    ("Comercial", ("COMERCIAL-VENDAS", "COMERCIAL-SERVIÇOS", "COMERCIAL-SDR", "MARKETING")),
    ("Operação", ("EXPEDIÇÃO", "LABORATÓRIO", "QUALIDADE")),
    ("Suporte", ("SUPORTE TÉCNICO AO CLIENTE",)),
    ("TI", ("TI",)),
    ("Administrativo", ("FINANCEIRO", "RECURSOS HUMANOS")),
)
OUTROS = "Outros"
_ORDEM = [nome for nome, _ in SETORES] + [OUTROS]
_SETOR_DE = {dep: nome for nome, deps in SETORES for dep in deps}

# Labels de `frontend/src/lib/user-status.ts`, copiados LITERALMENTE (mesma
# régua de `app/escritorio/status_wa.py`). ⚠️ `Doente` é dado de saúde: vira
# `ausente`, nunca aparece como é. O resto — `Home office` e texto livre —
# não vai para a TV.
_STATUS = {
    "Em reunião": "reuniao", "Foco / DND": "foco", "Almoço": "almoco",
    "Ausente": "ausente", "Doente": "ausente", "Férias / Folga": "ausente",
    "Viajando": "ausente",
}

# Briefing tem título fixo; documento qualquer pode ter título sensível.
_BRIEFING = re.compile(r"^(Operação|Faturamento|Vendedores|SDR|Serviços) · \d{2}/\d{2}$")


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


def setor_de(departamento: str | None) -> str:
    d = (departamento or "").strip().upper()
    if d in _SETOR_DE:
        return _SETOR_DE[d]
    return "Comercial" if d.startswith("COMERCIAL") else OUTROS


def status_publico(label: str | None) -> str | None:
    """Só os presets saem; texto livre de 200 caracteres não vai para a parede."""
    return _STATUS.get((label or "").strip())


def e_do_time(email: str | None) -> bool:
    """Domínio da empresa e sem conta de teste (`teste.ceo@`). A consultora
    externa tem login no HS.OS e não é do time."""
    e = (email or "").strip().lower()
    return e.endswith(_DOMINIO) and not e.startswith("teste")


def nomes_curtos(perfis: list[dict]) -> dict[str, str]:
    """Primeiro nome; quem divide o primeiro nome com alguém ganha o último
    sobrenome — dois nós com o mesmo rótulo não se distinguem de longe."""
    partes = {p["id"]: (p.get("full_name") or "").split() for p in perfis}
    contagem = Counter(ps[0].casefold() for ps in partes.values() if ps)
    nomes = {}
    for pid, ps in partes.items():
        if not ps:
            nomes[pid] = "—"
        elif contagem[ps[0].casefold()] > 1 and len(ps) > 1:
            nomes[pid] = f"{ps[0]} {ps[-1]}"
        else:
            nomes[pid] = ps[0]
    return nomes


def esta_online(ultimo_sinal, agora: datetime) -> bool:
    """Bateu o heartbeat dentro da janela. Sinal no "futuro" conta como agora:
    é o relógio do banco um pouco à frente, não uma pessoa offline."""
    if not isinstance(ultimo_sinal, datetime):
        return False
    return agora - ultimo_sinal < _ONLINE


def montar_pessoas(perfis: list[dict], agora: datetime) -> tuple[list[dict], list[dict]]:
    """Os hexágonos e os setores, na ordem do anel.

    ⚠️ O ponto verde é estar **no HS.OS** (`last_seen_at`), não no
    EscritorioHS: até 30/10/2026 era a presença do WorkAdventure, e quem usava
    o sistema sem abrir o escritório virtual aparecia apagado na TV."""
    do_time = [p for p in perfis if e_do_time(p.get("email"))]
    curtos = nomes_curtos(do_time)
    pessoas = [{
        "id": p["id"],
        "nome": curtos[p["id"]],
        "setor": setor_de(p.get("departamento")),
        "online": esta_online(p.get("last_seen_at"), agora),
        "status": status_publico(p.get("custom_status")),
    } for p in do_time]
    pessoas.sort(key=lambda x: (_ORDEM.index(x["setor"]), x["nome"].casefold()))
    setores = [{"nome": s, "pessoas": [x["id"] for x in pessoas if x["setor"] == s]}
               for s in _ORDEM]
    return pessoas, [s for s in setores if s["pessoas"]]


def montar_agentes(perfis: list, contexto: list, ultimas: dict,
                   agora: datetime, do_time: set[str]) -> list[dict]:
    """Os nós de agente. ⚠️ Sem `tarefa`: até 16/10/2026 o rótulo embaixo do
    nó era a pergunta em aberto, lida de longe por quem passasse pela TV."""
    por_agente = {c.get("agent_id"): c for c in contexto if c.get("agent_id")}
    nos = []
    for p in perfis:
        agente = p.get("agent_id")
        if not agente:
            continue
        ultima = ultimas.get(agente) or {}
        estado = estado_do_agente(ultima or None, agora)
        ativo = estado != "ocioso"
        c = por_agente.get(agente) or {}
        janela = int(c.get("context_tokens") or 0)
        quem = ultima.get("user_id")
        nos.append({
            "id": agente,
            "nome": p.get("name") or agente,
            # ⚠️ `role` está vazio nos cinco agentes (medido em 01/09); quem
            # carrega o papel é `specialty`.
            "papel": _encurtar((p.get("role") or p.get("specialty") or "").strip(),
                               _LIMITE_PAPEL),
            "estado": estado,
            "desde": ultima["created_at"].isoformat() if ativo else None,
            # Fração; sem janela conhecida é `None` — `0` seria lido "contexto limpo".
            "contexto": (round(int(c.get("total_tokens") or 0) / janela, 4)
                         if janela > 0 else None),
            "parceiroId": quem if ativo and quem in do_time else None,
        })
    return nos


def membros_do_time(linhas: list[dict], do_time: set[str]) -> dict[str, tuple[str, str]]:
    """DM com exatamente dois humanos, os dois do time."""
    out = {}
    for linha in linhas:
        membros = sorted(set(linha.get("membros") or []))
        if len(membros) == 2 and all(m in do_time for m in membros):
            out[linha["channel_id"]] = (membros[0], membros[1])
    return out


def dms_vivos(membros: dict, mensagens: list[dict], agora: datetime) -> list[dict]:
    """As linhas ciano: DM com mensagem nos últimos 10 min. Só quem — nunca o quê."""
    ultima: dict[str, datetime] = {}
    for m in mensagens:
        c = m.get("channel_id")
        if c in membros and (c not in ultima or m["created_at"] > ultima[c]):
            ultima[c] = m["created_at"]
    vivos = [{"a": membros[c][0], "b": membros[c][1], "ultima": t.isoformat()}
             for c, t in ultima.items() if agora - t <= _JANELA]
    return sorted(vivos, key=lambda d: d["ultima"], reverse=True)


def texto_entrega(agente: str, titulo: str | None) -> str:
    t = (titulo or "").strip()
    return f"{agente} publicou {t}" if _BRIEFING.match(t) else f"{agente} publicou um documento"


def _fins_de_janela(tempos: list[datetime]) -> list[datetime]:
    """Agrupa mensagens seguidas: pausa maior que a janela abre outra conversa.
    Devolve o horário da última mensagem de cada uma."""
    fins, anterior = [], None
    for t in sorted(tempos):
        if anterior is not None and t - anterior > _JANELA:
            fins.append(anterior)
        anterior = t
    if anterior is not None:
        fins.append(anterior)
    return fins


def montar_eventos(publicados: list, msgs_agente: list, msgs_dm: list, membros: dict,
                   nomes: dict, nomes_agente: dict, limite: int = 14) -> list[dict]:
    """O Fluxo: frases fixas montadas de nomes. `msgs_agente` são só as de
    `role = 'user'`; `nomes` são os nomes curtos de quem é do time."""
    eventos = []
    for d in publicados:
        agente = nomes_agente.get(d.get("agent_id"), d.get("agent_id") or "Agente")
        eventos.append((d["created_at"], "entrega", texto_entrega(agente, d.get("title"))))
    por_par = defaultdict(list)
    for m in msgs_agente:
        if m.get("user_id") in nomes:
            por_par[(m["user_id"], m.get("agent_id"))].append(m["created_at"])
    for (pessoa, agente), tempos in por_par.items():
        for fim in _fins_de_janela(tempos):
            eventos.append((fim, "agente",
                            f"{nomes[pessoa]} conversou com {nomes_agente.get(agente, agente)}"))
    por_dm = defaultdict(list)
    for m in msgs_dm:
        if m.get("channel_id") in membros:
            por_dm[m["channel_id"]].append(m["created_at"])
    for canal, tempos in por_dm.items():
        a, b = sorted((nomes.get(x, "—") for x in membros[canal]), key=str.casefold)
        for fim in _fins_de_janela(tempos):
            eventos.append((fim, "time", f"{a} e {b} conversaram"))
    eventos.sort(key=lambda e: e[0], reverse=True)
    return [{"ts": t.isoformat(), "tipo": tipo, "texto": texto}
            for t, tipo, texto in eventos[:limite]]


def montar_numeros(entregas: int, msgs_agente: list, msgs_dm: list,
                   membros: dict, do_time: set[str]) -> dict:
    """O rodapé. Saíram tokens e custo: métrica de operação, não de vitrine."""
    atendidas = {(m.get("user_id"), m.get("agent_id")) for m in msgs_agente
                 if m.get("role") == "agent" and m.get("user_id") in do_time}
    ativos = {m.get("user_id") for m in msgs_agente if m.get("role") == "user"}
    ativos |= {m.get("author_id") for m in msgs_dm if m.get("channel_id") in membros}
    return {
        "entregas": int(entregas),
        "atendidas": len(atendidas),
        "pessoasAtivas": len(ativos & do_time),
        "conversasTime": len({m["channel_id"] for m in msgs_dm if m.get("channel_id") in membros}),
    }
