"""Prévia da lista do celular (`GET /channels/previas`, 03/11/2026).

O app do celular mostra, embaixo do nome de cada conversa, a última mensagem.
O que custaria errar aqui: markdown cru na lista (`**R$ 441.712,80**`), uma
mensagem que a pessoa apagou para si voltando pela prévia, e resposta de
thread aparecendo como se fosse a última mensagem do canal.
"""
import asyncio
import inspect
from contextlib import asynccontextmanager

from app.dependencies import Usuario
from app.previas import LIMITE, sem_markdown, texto_da_previa
from app.routers import channels as c


def test_markdown_vira_texto_corrido():
    bruto = "O faturamento foi de **R$ 441.712,80**.\n\n- **Phoebus** — 38\n- `Iblow`\n\nVer [painel](https://x)"
    assert sem_markdown(bruto) == "O faturamento foi de R$ 441.712,80. Phoebus — 38 Iblow Ver painel"


def test_titulo_citacao_e_lista_numerada():
    assert sem_markdown("# Resumo\n> citado\n1. um\n2) dois") == "Resumo citado um dois"


def test_asterisco_solto_nao_e_italico():
    """Multiplicação e nota de rodapé não podem perder o asterisco."""
    assert sem_markdown("2 * 3 = 6") == "2 * 3 = 6"
    assert sem_markdown("*itálico*") == "itálico"


def test_corta_em_120_com_reticencias():
    texto = texto_da_previa("a" * 200, None, None, False)
    assert texto == "a" * LIMITE + "…"
    assert texto_da_previa("a" * LIMITE, None, None, False) == "a" * LIMITE


def test_so_anexo_mostra_o_nome_do_arquivo():
    anexos = [{"name": "Laudo Sabesp.pdf", "url": "", "size": 1, "mimeType": "application/pdf"}]
    assert texto_da_previa("", anexos, None, False) == "📎 Laudo Sabesp.pdf"


def test_voz_de_pessoa_e_audio_mas_resumo_de_agente_e_texto():
    """O `content` da voz de pessoa é a transcrição; o do agente é a resposta."""
    assert texto_da_previa("transcrição longa", None, "anexo:1", False, "human") == "🎤 Áudio"
    assert texto_da_previa("**Pronto**, salvei.", None, "anexo:2", False, "agent") == "Pronto, salvei."


def test_apagada_nao_mostra_o_conteudo():
    assert texto_da_previa("segredo", None, None, True) == "Mensagem apagada"


def test_previa_respeita_apagar_para_mim_e_ignora_thread():
    assert c._VISIVEL_PARA_MIM in c.SQL_PREVIAS
    assert "thread_id IS NULL" in c.SQL_PREVIAS
    assert "eu.user_id = $1" in c.SQL_PREVIAS


def test_previa_busca_uma_mensagem_por_canal_e_nao_ordena_a_tabela():
    """`DISTINCT ON` sobre todas as mensagens dos meus canais ordenava tudo
    para ficar com uma de cada; o LATERAL para na primeira de cada canal."""
    sql = " ".join(c.SQL_PREVIAS.split())
    assert "JOIN LATERAL" in sql
    assert "ORDER BY m.created_at DESC LIMIT 1" in sql
    assert "DISTINCT ON" not in sql
    # O filtro "apagar para mim" fica DENTRO do LATERAL: senão a prévia seria
    # a mensagem escondida (e o canal sumiria da lista em vez de mostrar a anterior).
    dentro = sql.split("JOIN LATERAL", 1)[1].split(") m ON true", 1)[0]
    assert c._VISIVEL_PARA_MIM in dentro


class Conexao:
    def __init__(self, linhas):
        self.linhas = linhas
        self.args = None

    async def fetch(self, sql, *args):
        self.args = args
        return self.linhas


def test_rota_monta_a_previa_de_cada_canal(monkeypatch):
    conn = Conexao([
        {"channel_id": "c1", "author_id": "u1", "author_name": "Rafael", "author_type": "human",
         "content": "", "audio_url": None, "attachments": '[{"name": "laudo.pdf"}]',
         "apagada": False, "created_at": "2026-11-03T12:20:00.000Z"},
        {"channel_id": "c2", "author_id": "nina", "author_name": None, "author_type": "agent",
         "content": "**ok**", "audio_url": None, "attachments": None,
         "apagada": False, "created_at": "2026-11-03T12:21:00.000Z"},
    ])

    @asynccontextmanager
    async def falsa(**kw):
        assert kw.get("role") == "authenticated"
        yield conn

    monkeypatch.setattr(c, "sessao", falsa)
    saida = asyncio.run(c.previas(Usuario(id="lara", email="x@y", papel="colaborador")))
    assert conn.args == ("lara",)
    assert [(p.channel_id, p.texto, p.autor_nome) for p in saida] == [
        ("c1", "📎 laudo.pdf", "Rafael"),
        ("c2", "ok", ""),
    ]


def test_rota_previas_vem_antes_das_rotas_com_id():
    caminhos = [r.path for r in c.router.routes]
    assert caminhos.index("/channels/previas") < caminhos.index("/channels/{channel_id}/members")
    assert "previas" in inspect.getsource(c.previas)
