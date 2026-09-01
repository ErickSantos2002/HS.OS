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


# ── Faixa de agentes ─────────────────────────────────────────────────────────

def test_agente_aparece_com_nome_na_faixa():
    faixa = w.bloco_agentes(
        [{"agent_id": "iris", "status": "ok"}],
        [{"agent_id": "iris", "total_tokens": 250_000, "context_tokens": 1_000_000}],
    )
    assert faixa[0]["agente"] == "iris"


def test_ocupacao_de_contexto_e_fracao_da_janela():
    faixa = w.bloco_agentes(
        [{"agent_id": "iris", "status": "ok"}],
        [{"agent_id": "iris", "total_tokens": 250_000, "context_tokens": 1_000_000}],
    )
    assert faixa[0]["ocupacao"] == 25.0


def test_janela_desconhecida_nao_vira_zero_por_cento():
    """`0%` afirma 'contexto vazio'. Sem a janela não se sabe nada — e foi
    exatamente esta confusão que fez o gateway declarar 6,5% do contexto real."""
    faixa = w.bloco_agentes(
        [{"agent_id": "nina", "status": "ok"}],
        [{"agent_id": "nina", "total_tokens": 900, "context_tokens": 0}],
    )
    assert faixa[0]["ocupacao"] is None


def test_agente_sem_linha_de_contexto_continua_na_faixa():
    """A faixa é a lista de agentes, não a lista de quem tem contexto medido."""
    faixa = w.bloco_agentes([{"agent_id": "flow", "status": "ok"}], [])
    assert len(faixa) == 1 and faixa[0]["ocupacao"] is None


# ── Publicado hoje ───────────────────────────────────────────────────────────

def test_publicado_traz_hora_agente_e_titulo():
    from datetime import datetime, timezone
    item = w.bloco_publicado([{
        "agent_id": "iris",
        "title": "Faturamento · 01/09",
        "created_at": datetime(2026, 9, 1, 10, 36, tzinfo=timezone.utc),
    }])[0]
    assert item["agente"] == "iris"
    assert item["titulo"] == "Faturamento · 01/09"
    assert item["hora"] == "07:36"


# ── Agora ────────────────────────────────────────────────────────────────────

def test_agora_identifica_quem_falou():
    linha = w.bloco_agora([{"role": "user", "agent_id": "iris",
                            "content": "e o funil?", "created_at": None}])[0]
    assert linha["de"] == "pessoa" and linha["para"] == "iris"


def test_agora_encurta_texto_longo():
    """É uma TV vista de longe: parágrafo inteiro não cabe e não se lê."""
    linha = w.bloco_agora([{"role": "agent", "agent_id": "iris",
                            "content": "x" * 400, "created_at": None}])[0]
    assert len(linha["texto"]) <= 120


# ── Consumo do dia ───────────────────────────────────────────────────────────

def test_consumo_soma_tokens_e_custo():
    uso = w.bloco_consumo({"tokens": 170_909, "custo": 0.052})
    assert uso["tokens"] == 170_909 and uso["custo"] == 0.052


def test_dia_sem_evento_e_zero_de_verdade():
    """Aqui zero é medido, não inventado: nenhum evento significa nenhum token.
    A distinção que importa é contra campo que ninguém apurou."""
    assert w.bloco_consumo({"tokens": 0, "custo": 0})["tokens"] == 0


# ── Quem pode ver o painel ───────────────────────────────────────────────────
# Dois caminhos, como na tela original: a TV entra por token; quem já está
# logado entra pela sessão. Nada além disso.

def test_tv_com_token_valido_ve():
    assert w.pode_ver(token="segredo", segredo="segredo", tem_sessao=False) is True


def test_pessoa_logada_ve_sem_token():
    """Quem abre o painel do próprio navegador já se autenticou no sistema."""
    assert w.pode_ver(token=None, segredo="segredo", tem_sessao=True) is True


def test_sem_token_e_sem_sessao_nao_ve():
    assert w.pode_ver(token=None, segredo="segredo", tem_sessao=False) is False


def test_token_errado_com_sessao_ainda_ve():
    """A sessão é credencial independente; token torto não deve derrubar quem
    já entrou pela porta da frente."""
    assert w.pode_ver(token="errado", segredo="segredo", tem_sessao=True) is True


def test_segredo_nao_configurado_nao_abre_para_a_tv():
    """Sem `WARROOM_TOKEN` configurado, a TV não entra — mas quem tem sessão
    continua entrando. Esquecer a config não pode virar porta aberta nem
    derrubar o painel de quem está logado."""
    assert w.pode_ver(token="qualquer", segredo=None, tem_sessao=False) is False
    assert w.pode_ver(token=None, segredo=None, tem_sessao=True) is True


# ── "Online" não sai de `status` ─────────────────────────────────────────────
# Descoberto ao conferir o feed contra o banco: `agent_stats.status` vale "ok"
# nas 5 linhas — é o resultado da última execução, não sinal de vida. Lido como
# liveness, a faixa inteira ficaria apagada para sempre e a parede diria que os
# agentes estão mortos enquanto eles publicam cinco briefings por manhã.
# O sinal é `last_active`.

from datetime import datetime, timedelta, timezone

AGORA = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def test_atividade_recente_acende_o_agente():
    faixa = w.bloco_agentes(
        [{"agent_id": "iris", "status": "ok", "last_active": AGORA - timedelta(minutes=5)}],
        [], agora=AGORA)
    assert faixa[0]["online"] is True


def test_atividade_antiga_apaga_o_agente():
    faixa = w.bloco_agentes(
        [{"agent_id": "iris", "status": "ok", "last_active": AGORA - timedelta(hours=4)}],
        [], agora=AGORA)
    assert faixa[0]["online"] is False


def test_status_ok_sozinho_nao_acende():
    """O bug que este bloco existe para impedir: `status` é "ok" em toda linha,
    inclusive nas de agente parado há horas."""
    faixa = w.bloco_agentes(
        [{"agent_id": "iris", "status": "ok", "last_active": AGORA - timedelta(days=2)}],
        [], agora=AGORA)
    assert faixa[0]["online"] is False


def test_sem_atividade_registrada_e_desconhecido_e_nao_apagado():
    """Agente que nunca rodou não é o mesmo que agente parado. `None` deixa a
    parede mostrar 'não sei' em vez de afirmar que está fora."""
    faixa = w.bloco_agentes(
        [{"agent_id": "novo", "status": "ok", "last_active": None}], [], agora=AGORA)
    assert faixa[0]["online"] is None
