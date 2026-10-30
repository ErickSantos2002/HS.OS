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


def _msg(role, minutos, user_id="u-nich"):
    return {"role": role, "created_at": AGORA - timedelta(minutes=minutos), "user_id": user_id}


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


def test_contexto_e_fracao_entre_zero_e_um():
    """O anel do nó desenha `1 - contexto`; a tela quer fração, não porcento."""
    a = w.montar_agentes(
        [PERFIL], [{"agent_id": "iris", "total_tokens": 250_000, "context_tokens": 1_000_000}],
        {}, AGORA, set())[0]
    assert a["contexto"] == 0.25


def test_contexto_sem_janela_conhecida_e_nulo():
    """`0` desenharia anel vazio, que na parede se lê como 'contexto limpo'.
    Nulo faz a tela não desenhar anel nenhum."""
    a = w.montar_agentes(
        [PERFIL], [{"agent_id": "iris", "total_tokens": 900, "context_tokens": 0}], {}, AGORA, set())[0]
    assert a["contexto"] is None


# ── O rótulo do nó ───────────────────────────────────────────────────────────
# Conferido contra o banco em 01/09: `agent_profiles.role` está VAZIO nos cinco
# agentes; quem carrega o papel é `specialty`. Lendo `role`, os nós subiriam sem
# rótulo nenhum — e o rótulo é o que faz a parede ser lida de longe.

PERFIL_REAL = {"agent_id": "iris", "name": "Iris", "role": "",
               "specialty": "Dados do ERP Tiny e notas de serviço — consulta e análise do DataCoreHS"}


def test_papel_sai_de_specialty_quando_role_esta_vazio():
    a = w.montar_agentes([PERFIL_REAL], [], {}, AGORA, set())[0]
    assert a["papel"].startswith("Dados do ERP Tiny")


def test_papel_e_encurtado_para_caber_no_no():
    """É rótulo de nó numa TV, não descrição de catálogo."""
    a = w.montar_agentes([PERFIL_REAL], [], {}, AGORA, set())[0]
    assert len(a["papel"]) <= 40


def test_role_preenchido_tem_preferencia():
    """Se um dia alguém preencher `role`, é ele que vale — é o campo específico."""
    a = w.montar_agentes(
        [{"agent_id": "x", "name": "X", "role": "Faturamento", "specialty": "outra coisa"}],
        [], {}, AGORA, set())[0]
    assert a["papel"] == "Faturamento"

import json

# ── TV pública: nada de conteúdo (16/10/2026) ────────────────────────────────
# A War Room foi para a TV da empresa, que visitante vê, e o link é a
# credencial. Até aqui o Fluxo mostrava "Nicholson: phoebus vendido em abril
# qual empresa" e o rótulo do agente era a pergunta em aberto — e o JSON do
# feed carregava esse texto para quem tivesse o link.

SENTINELA = "PERGUNTA-SECRETA-DO-CEO"
NOMES = {"u-nich": "Nicholson", "u-erick": "Erick", "u-welton": "Welton"}
DO_TIME = set(NOMES)


def test_nenhuma_funcao_deixa_o_conteudo_passar():
    """Mesmo que uma linha chegue com `content`, nada dele sai."""
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA, "content": SENTINELA}]
    dms = [{"channel_id": "c1", "created_at": AGORA, "author_id": "u-erick", "content": SENTINELA}]
    membros = {"c1": ("u-erick", "u-welton")}
    saida = {
        "agentes": w.montar_agentes([PERFIL], [], {"iris": {**msgs[0], "agent_id": "iris"}},
                                    AGORA, DO_TIME),
        "eventos": w.montar_eventos([], msgs, dms, membros, NOMES, {"nina": "Nina"}),
        "dms": w.dms_vivos(membros, dms, AGORA),
    }
    assert SENTINELA not in json.dumps(saida, default=str)


def test_agente_nao_tem_mais_tarefa():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA, DO_TIME)[0]
    assert "tarefa" not in a and "parceiro" not in a and "filhos" not in a


def test_agente_conversando_aponta_o_id_da_pessoa():
    """`parceiroId` é a ponta da curva — id, não nome: nome curto pode repetir."""
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA, DO_TIME)[0]
    assert a["parceiroId"] == "u-nich"


def test_agente_ocioso_nao_aponta_ninguem():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 1)}, AGORA, DO_TIME)[0]
    assert a["parceiroId"] is None


def test_agente_que_respondeu_mantem_a_linha_por_dez_minutos():
    """Até 30/10/2026 a linha pessoa–agente sumia no instante da resposta, e a
    entre pessoas fica 10 min: a Nina respondeu o Nicholson em 45 s e a TV
    mostrava "12:21 Nicholson conversou com Nina" no Fluxo sem nada no mapa.
    Agora a ponta vem em `recenteCom` — não em `parceiroId`, que segue sendo
    "esperando resposta" e é o que acende as partículas e o "conversando com"."""
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 4)}, AGORA, DO_TIME)[0]
    assert a["estado"] == "ocioso" and a["parceiroId"] is None
    assert a["recenteCom"] == "u-nich"
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 11)}, AGORA, DO_TIME)[0]
    assert a["recenteCom"] is None


def test_agente_trabalhando_nao_e_recente():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA, DO_TIME)[0]
    assert a["recenteCom"] is None


def test_conversa_com_conta_de_fora_do_time_nao_desenha_linha():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2, "u-teste")}, AGORA, DO_TIME)[0]
    assert a["estado"] == "pensando" and a["parceiroId"] is None
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 2, "u-teste")}, AGORA, DO_TIME)[0]
    assert a["recenteCom"] is None


# ── Status: só o que pode ir para a parede ───────────────────────────────────

def test_status_dos_presets():
    assert w.status_publico("Em reunião") == "reuniao"
    assert w.status_publico("Foco / DND") == "foco"
    assert w.status_publico("Almoço") == "almoco"
    assert w.status_publico("Ausente") == "ausente"


def test_doente_nunca_aparece_vira_ausente():
    """`Doente` é dado de saúde, numa TV que visitante vê."""
    for label in ("Doente", "Férias / Folga", "Viajando"):
        assert w.status_publico(label) == "ausente"


def test_texto_livre_e_home_office_nao_vao_para_a_tv():
    """`custom_status` aceita 200 caracteres de texto livre."""
    assert w.status_publico("resolvendo o caso do cliente X") is None
    assert w.status_publico("Home office") is None
    assert w.status_publico(None) is None


# ── Quem é do time, e como se chama na parede ────────────────────────────────

def test_so_o_dominio_da_empresa_e_sem_conta_de_teste():
    assert w.e_do_time("ti@healthsafetytech.com")
    assert not w.e_do_time("teste.ceo@healthsafetytech.com")
    assert not w.e_do_time("contato@ketlinscalco.com.br")
    assert not w.e_do_time(None)


def test_nome_curto_e_o_primeiro_nome():
    assert w.nomes_curtos([{"id": "1", "full_name": "Erick Santos"}]) == {"1": "Erick"}


def test_primeiro_nome_repetido_ganha_o_sobrenome():
    """Dois "Lucas" na parede seriam dois nós com o mesmo rótulo."""
    n = w.nomes_curtos([{"id": "1", "full_name": "Lucas Avezedo da Silva"},
                        {"id": "2", "full_name": "Lucas Pereira"}])
    assert n == {"1": "Lucas Silva", "2": "Lucas Pereira"}


def test_setor_pela_tabela_e_comercial_pelo_prefixo():
    assert w.setor_de("COMERCIAL-SDR") == "Comercial"
    assert w.setor_de("MARKETING") == "Comercial"
    assert w.setor_de("Expedição") == "Operação"
    assert w.setor_de("RECURSOS HUMANOS") == "Administrativo"
    assert w.setor_de("Consultoria") == "Outros"
    assert w.setor_de(None) == "Outros"


def test_montar_pessoas_ordena_por_setor_e_marca_presenca():
    agora = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
    perfis = [
        {"id": "a", "email": "ti@healthsafetytech.com", "full_name": "Erick Santos",
         "departamento": "TI", "custom_status": "Em reunião",
         "last_seen_at": agora - timedelta(minutes=10)},
        {"id": "b", "email": "np@healthsafetytech.com", "full_name": "Nicholson Pimentel",
         "departamento": "DIRETORIA", "custom_status": None,
         "last_seen_at": agora - timedelta(seconds=30)},
        {"id": "c", "email": "teste.ceo@healthsafetytech.com", "full_name": "Teste CEO",
         "departamento": None, "custom_status": None, "last_seen_at": agora},
    ]
    pessoas, setores = w.montar_pessoas(perfis, agora)
    assert [p["id"] for p in pessoas] == ["b", "a"]
    assert pessoas[0] == {"id": "b", "nome": "Nicholson", "setor": "Diretoria",
                          "online": True, "status": None}
    assert pessoas[1]["status"] == "reuniao" and pessoas[1]["online"] is False
    assert setores == [{"nome": "Diretoria", "pessoas": ["b"]}, {"nome": "TI", "pessoas": ["a"]}]


def test_ponto_verde_e_quem_esta_no_hsos_nao_no_escritorio_virtual():
    """Até 30/10/2026 o ponto verde da TV era "está no EscritorioHS" (o
    WorkAdventure). Com a TV na parede, o Erick viu gente usando o HS.OS sem
    ponto e leu como presença quebrada — a parede media a coisa errada. Hoje é
    o `last_seen_at` do heartbeat do HS.OS, a mesma régua da lista do chat.

    A janela de 3 min, e não os 60 s do heartbeat: aba em segundo plano tem o
    timer estrangulado pelo navegador para ~1 por minuto, com folga para
    atrasar. Janela igual ao intervalo faria o ponto piscar.
    """
    agora = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
    assert w.esta_online(agora - timedelta(seconds=170), agora) is True
    assert w.esta_online(agora - timedelta(seconds=190), agora) is False
    assert w.esta_online(None, agora) is False
    # Relógio do banco um pouco à frente do nosso não pode apagar quem acabou de bater.
    assert w.esta_online(agora + timedelta(seconds=2), agora) is True


# ── Conversa entre pessoas: só que existe ────────────────────────────────────

def test_dm_so_conta_com_dois_humanos_do_time():
    linhas = [{"channel_id": "c1", "membros": ["u-erick", "u-welton"]},
              {"channel_id": "c2", "membros": ["u-erick", "u-teste"]},
              {"channel_id": "c3", "membros": ["u-erick"]}]
    assert w.membros_do_time(linhas, DO_TIME) == {"c1": ("u-erick", "u-welton")}


def test_dm_com_mensagem_recente_vira_linha():
    membros = {"c1": ("u-erick", "u-welton")}
    msgs = [{"channel_id": "c1", "created_at": AGORA - timedelta(minutes=3)}]
    assert w.dms_vivos(membros, msgs, AGORA) == [
        {"a": "u-erick", "b": "u-welton", "ultima": (AGORA - timedelta(minutes=3)).isoformat()}]


def test_dm_parado_ha_mais_de_dez_minutos_some():
    membros = {"c1": ("u-erick", "u-welton")}
    msgs = [{"channel_id": "c1", "created_at": AGORA - timedelta(minutes=11)}]
    assert w.dms_vivos(membros, msgs, AGORA) == []


# ── Fluxo: fatos, nunca texto ────────────────────────────────────────────────

def test_briefing_mostra_o_titulo():
    assert w.texto_entrega("Atlas", "Serviços · 16/10") == "Atlas publicou Serviços · 16/10"


def test_documento_qualquer_nao_mostra_o_titulo():
    """A `nina` já publicou lista nominal de clientes perdidos."""
    assert w.texto_entrega("Nina", "Clientes que a Sandra perdeu") == "Nina publicou um documento"


def test_vinte_mensagens_seguidas_sao_uma_linha_no_fluxo():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA - timedelta(minutes=i)} for i in range(20)]
    ev = w.montar_eventos([], msgs, [], {}, NOMES, {"nina": "Nina"})
    assert ev == [{"ts": AGORA.isoformat(), "tipo": "agente", "texto": "Nicholson conversou com Nina"}]


def test_pausa_maior_que_a_janela_abre_outra_linha():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user", "created_at": AGORA},
            {"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA - timedelta(minutes=30)}]
    assert len(w.montar_eventos([], msgs, [], {}, NOMES, {"nina": "Nina"})) == 2


def test_dm_no_fluxo_diz_so_quem():
    dms = [{"channel_id": "c1", "created_at": AGORA}]
    ev = w.montar_eventos([], [], dms, {"c1": ("u-welton", "u-erick")}, NOMES, {})
    assert ev[0]["texto"] == "Erick e Welton conversaram" and ev[0]["tipo"] == "time"


def test_fluxo_do_mais_novo_para_o_mais_velho_e_com_limite():
    pub = [{"agent_id": "atlas", "title": "SDR · 16/10", "created_at": AGORA - timedelta(hours=3)}]
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user", "created_at": AGORA}]
    ev = w.montar_eventos(pub, msgs, [], {}, NOMES, {"nina": "Nina", "atlas": "Atlas"})
    assert [e["tipo"] for e in ev] == ["agente", "entrega"]
    muitos = [{"agent_id": "atlas", "title": "SDR · 16/10", "created_at": AGORA - timedelta(minutes=i)}
              for i in range(30)]
    assert len(w.montar_eventos(muitos, [], [], {}, NOMES, {})) == 14


def test_numeros_do_dia():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user"},
            {"user_id": "u-nich", "agent_id": "nina", "role": "agent"},
            {"user_id": "u-nich", "agent_id": "iris", "role": "agent"},
            {"user_id": "u-teste", "agent_id": "nina", "role": "user"}]
    dms = [{"channel_id": "c1", "author_id": "u-erick"}, {"channel_id": "c1", "author_id": "u-welton"}]
    n = w.montar_numeros(5, msgs, dms, {"c1": ("u-erick", "u-welton")}, DO_TIME)
    assert n == {"entregas": 5, "atendidas": 2, "pessoasAtivas": 3, "conversasTime": 1}
