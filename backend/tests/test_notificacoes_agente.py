"""A notificação de agente precisa sair da API com o `agent_id`.

⚠️ 16/11/2026: o `GET /notificacoes` não devolvia o campo. A tela conta a
não lida de conversa com agente por ele (`unreadByAgentOnly`, notificação sem
canal e com agente) — sem ele, ao carregar a página, toda notificação de agente
era invisível para o badge: o cardápio do Guardi chegava com push e a conversa
não acendia, e os alertas do `hsos-alerta` (que só têm `agent_id`) também não.
"""
from app.routers import chat_extras as ce


def test_modelo_e_colunas_levam_agent_id():
    assert "agent_id" in ce.NotificacaoOut.model_fields
    assert "agent_id" in ce._COLUNAS_NOTIF


def test_notificacao_so_de_agente_valida_no_modelo():
    n = ce.NotificacaoOut(id="1", user_id="u", agent_id="erick-bot", channel_id=None,
                          author_name="pip-Guardi", content_preview="x", read=False,
                          created_at="2026-11-16T18:28:12.322Z")
    assert n.agent_id == "erick-bot" and n.channel_id is None
