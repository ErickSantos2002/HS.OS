"""A War room voltou do `_legado/` em 01/09/2026, re-fonteada.

⚠️ **Portar fiel teria subido uma tela em branco.** A `warroom-feed` original
(582 linhas) lê 12 tabelas; medido em 01/09, **seis estão vazias** — entre elas
as duas que davam o conteúdo principal do painel: `agent_results` (entregas) e
`agent_activity` (ações autônomas), ambas em 0 linha nos últimos 14 dias. As
automações reais moram no gateway (`cron_jobs`, 5 briefings por dia útil), não
na tabela `automations`, que está zerada; e `subagent_watch` não tem escritor
nenhum, igual à `agent_turns` que se descobriu no mesmo dia ser entulho
arquivado.

O que o sistema de fato produz: 432 conversas, 134 eventos de consumo, 68
briefings em `wiki_documents` e 21 artefatos, em 14 dias. É daí que o painel lê.

A régua da casa vale aqui como valeu no coletor: **medido ou ausente, nunca
zero inventado.**
"""
from app import warroom as w


# ── O token da TV ────────────────────────────────────────────────────────────
# A TV não faz login: o token vai na URL, porque navegador de TV não manda
# cabeçalho. O link é a credencial.

def test_token_correto_entra():
    assert w.confere_token("abc123", "abc123") is True


def test_token_errado_nao_entra():
    assert w.confere_token("abc124", "abc123") is False


def test_token_ausente_nao_entra():
    """Sem token e sem sessão, ninguém entra — o contrário transformaria
    esquecer a configuração em porta aberta."""
    assert w.confere_token(None, "abc123") is False


def test_segredo_nao_configurado_nao_libera_geral():
    assert w.confere_token("qualquer", None) is False


def test_token_com_acento_nao_explode():
    """`hmac.compare_digest` levanta TypeError em `str` não-ASCII. Já mordeu no
    SSO do GestorHS; aqui o segredo é digitado por gente e pode vir torto."""
    assert w.confere_token("señha", "señha") is True


# ── O estado do agente, e a linha até a pessoa ───────────────────────────────
# A tela original é uma constelação: cada agente é um nó e, quando conversa com
# alguém, nasce uma curva até a pessoa. Quem manda no desenho é `estado` — nó
# ocioso não emite rota — e `parceiro`, que diz para onde a curva vai.
#
# `longo` existe porque a parede precisa mostrar demora: o `LONGO_MIN_PADRAO`
# da edge original era 8 minutos, e é a régua mantida aqui.

from datetime import datetime, timedelta, timezone

AGORA = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def _msg(role, minutos, texto="e o funil?"):
    return {"role": role, "content": texto, "created_at": AGORA - timedelta(minutes=minutos),
            "autor": "Nicholson"}


def test_agente_sem_conversa_esta_ocioso():
    assert w.estado_do_agente(None, AGORA) == "ocioso"


def test_pergunta_recente_deixa_o_agente_pensando():
    assert w.estado_do_agente(_msg("user", 2), AGORA) == "pensando"


def test_pergunta_parada_ha_muito_vira_demora():
    """Oito minutos sem resposta é o que a parede precisa destacar — é a queixa
    que o CEO mais sentiu, e virou item 5 do roadmap de 31/08."""
    assert w.estado_do_agente(_msg("user", 9), AGORA) == "longo"


def test_agente_que_ja_respondeu_volta_a_ficar_ocioso():
    """A última fala é dele: entregou. Nó aceso sem trabalho vira ruído."""
    assert w.estado_do_agente(_msg("agent", 1), AGORA) == "ocioso"


def test_conversa_de_ontem_nao_acende_a_parede():
    assert w.estado_do_agente(_msg("user", 60 * 26), AGORA) == "ocioso"


# ── Montagem dos agentes ─────────────────────────────────────────────────────

PERFIL = {"agent_id": "iris", "name": "Iris", "role": "Faturamento"}


def test_agente_conversando_ganha_parceiro():
    """`parceiro` é a ponta da curva — sem ele a linha não tem para onde ir."""
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA)[0]
    assert a["parceiro"] == "Nicholson"


def test_agente_ocioso_nao_tem_parceiro():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 1)}, AGORA)[0]
    assert a["parceiro"] is None


def test_a_pergunta_aberta_vira_a_tarefa_na_tela():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA)[0]
    assert a["tarefa"] == "e o funil?"


def test_sem_conversa_a_tarefa_e_nula_e_a_tela_mostra_o_papel():
    a = w.montar_agentes([PERFIL], [], {}, AGORA)[0]
    assert a["tarefa"] is None and a["papel"] == "Faturamento"


def test_contexto_e_fracao_entre_zero_e_um():
    """O anel do nó desenha `1 - contexto`; a tela quer fração, não porcento."""
    a = w.montar_agentes(
        [PERFIL], [{"agent_id": "iris", "total_tokens": 250_000, "context_tokens": 1_000_000}],
        {}, AGORA)[0]
    assert a["contexto"] == 0.25


def test_contexto_sem_janela_conhecida_e_nulo():
    """`0` desenharia anel vazio, que na parede se lê como 'contexto limpo'.
    Nulo faz a tela não desenhar anel nenhum."""
    a = w.montar_agentes(
        [PERFIL], [{"agent_id": "iris", "total_tokens": 900, "context_tokens": 0}], {}, AGORA)[0]
    assert a["contexto"] is None


def test_sub_agentes_ficam_vazios_por_falta_de_fonte():
    """Os satélites orbitando quem os criou dependem da `subagent_watch`, que
    tem 0 linha e **nenhum escritor** — medido em 01/09/2026. Lista vazia é a
    verdade; inventar filho seria desenhar órbita de coisa que não existe."""
    assert w.montar_agentes([PERFIL], [], {}, AGORA)[0]["filhos"] == []


# ── Eventos e números ────────────────────────────────────────────────────────

def test_briefing_publicado_e_uma_entrega():
    ev = w.montar_eventos(
        [{"agent_id": "iris", "title": "Faturamento · 01/09", "created_at": AGORA}], [])[0]
    assert ev["tipo"] == "entrega" and "Faturamento · 01/09" in ev["texto"]


def test_eventos_vem_do_mais_novo_para_o_mais_velho():
    evs = w.montar_eventos(
        [{"agent_id": "iris", "title": "antigo", "created_at": AGORA - timedelta(hours=3)}],
        [_msg("agent", 1, "recente")])
    assert evs[0]["texto"].endswith("recente") or "recente" in evs[0]["texto"]


def test_taxa_de_cache_sem_fonte_fica_nula():
    """`cached_tokens` está zerado nas 217 linhas e nada escreve o campo — o
    mesmo buraco achado no coletor hoje. `0%` na parede afirmaria que o cache
    nunca acerta."""
    assert w.montar_numeros({"tokens": 1, "custo": 0}, entregas=5, conversas=9)["cacheTaxa"] is None


def test_numeros_contam_entregas_e_conversas():
    n = w.montar_numeros({"tokens": 170_909, "custo": 0.052}, entregas=5, conversas=9)
    assert n["entregas"] == 5 and n["conversas"] == 9 and n["tokens"] == 170_909


# ── O rótulo do nó ───────────────────────────────────────────────────────────
# Conferido contra o banco em 01/09: `agent_profiles.role` está VAZIO nos cinco
# agentes; quem carrega o papel é `specialty`. Lendo `role`, os nós subiriam sem
# rótulo nenhum — e o rótulo é o que faz a parede ser lida de longe.

PERFIL_REAL = {"agent_id": "iris", "name": "Iris", "role": "",
               "specialty": "Dados do ERP Tiny e notas de serviço — consulta e análise do DataCoreHS"}


def test_papel_sai_de_specialty_quando_role_esta_vazio():
    a = w.montar_agentes([PERFIL_REAL], [], {}, AGORA)[0]
    assert a["papel"].startswith("Dados do ERP Tiny")


def test_papel_e_encurtado_para_caber_no_no():
    """É rótulo de nó numa TV, não descrição de catálogo."""
    a = w.montar_agentes([PERFIL_REAL], [], {}, AGORA)[0]
    assert len(a["papel"]) <= 40


def test_role_preenchido_tem_preferencia():
    """Se um dia alguém preencher `role`, é ele que vale — é o campo específico."""
    a = w.montar_agentes(
        [{"agent_id": "x", "name": "X", "role": "Faturamento", "specialty": "outra coisa"}],
        [], {}, AGORA)[0]
    assert a["papel"] == "Faturamento"


# ── A tarefa também precisa caber ────────────────────────────────────────────
# Achado olhando a tela renderizada, não os testes: o rótulo do Atlas saiu
# cuspindo `{ color:#E41A11; } .green { color:#22c55e; } .blue.bar > span {…`
# atravessando a parede inteira. A mensagem era de um artefato publicado e
# levava CSS junto. Eu encurtava `papel` e não `tarefa`.

def test_tarefa_longa_e_encurtada():
    longa = {"role": "user", "content": "x" * 500, "created_at": AGORA, "autor": "Nicholson"}
    a = w.montar_agentes([PERFIL], [], {"iris": longa}, AGORA)[0]
    assert len(a["tarefa"]) <= 46


def test_tarefa_perde_a_quebra_de_linha():
    """Numa linha só de SVG, `\\n` vira caractere solto no meio da frase."""
    multi = {"role": "user", "content": "primeira\nsegunda", "created_at": AGORA, "autor": "N"}
    a = w.montar_agentes([PERFIL], [], {"iris": multi}, AGORA)[0]
    assert "\n" not in a["tarefa"]
