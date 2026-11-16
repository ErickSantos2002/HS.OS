"""O miolo do `/reply`, agora reaproveitado pelo coletor (spec 2026-11-03, B2).

Gateway, banco e áudio falsos. O que se tranca: a extração não mudou o
comportamento da tela, e a rota não quebra se a `024` não estiver aplicada.
"""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import asyncpg
import pytest

from app.routers import conversations as c

UID = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"
CFG = SimpleNamespace(url="ws://x", token="t", configurado=True)


class Gateway:
    def __init__(self, wait, historico=None):
        self.wait = wait
        self.historico = historico or []
        self.chamadas = []

    async def chamar(self, metodo, params):
        self.chamadas.append((metodo, params))
        if metodo == "agent.wait":
            return self.wait
        if metodo == "chat.history":
            return {"messages": self.historico}
        raise AssertionError(metodo)


class Conn:
    def __init__(self, reserva_ganha=True):
        self.reserva_ganha = reserva_ganha
        self.updates = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql, *a):
        pass

    async def fetchrow(self, sql, *a):
        if "INSERT" in sql:
            return {"id": "m1", "agent_id": "nina", "role": "agent", "content": a[2],
                    "media": None, "created_at": "2026-11-03T12:00:00.000Z"}
        return None

    async def fetchval(self, sql, *a):
        self.updates.append((sql, a))
        return self.reserva_ganha or None


@pytest.fixture
def ambiente(monkeypatch):
    estado = SimpleNamespace(conn=Conn(), publicados=[], audios=[], gateway=None)

    @asynccontextmanager
    async def sessao(**_):
        yield estado.conn

    async def seguir(run_id, _uid):
        return {"run_id": run_id, "message_id": None}

    monkeypatch.setattr(c, "sessao", sessao)
    monkeypatch.setattr(c, "_seguir_run", seguir)
    monkeypatch.setattr(c, "obter_cliente_de_espera", lambda *_: estado.gateway)
    monkeypatch.setattr(c, "obter_cliente", lambda *_: estado.gateway)
    monkeypatch.setattr(c, "_audio_se_nova", lambda *a: estado.audios.append(a))
    monkeypatch.setattr(c.hub, "publicar", lambda *a: estado.publicados.append(a))
    return estado


def _colher(espera_ms=c._ESPERA_MS):
    return asyncio.run(c.colher_resposta(CFG, "nina", "run-1", "agent:nina:x", 10, UID,
                                         espera_ms=espera_ms))


def test_timeout_devolve_executando(ambiente):
    ambiente.gateway = Gateway({"status": "timeout"})
    assert _colher().status == "executando"


def test_espera_e_parametro(ambiente):
    """O coletor espera pouco por run para não prender o laço; a tela, 20 s."""
    ambiente.gateway = Gateway({"status": "timeout"})
    _colher(espera_ms=1500)
    assert ambiente.gateway.chamadas[0] == ("agent.wait", {"runId": "run-1", "timeoutMs": 1500})


def test_resposta_e_gravada_com_a_reserva_e_o_seq_depois(ambiente):
    """Mesma leitura da tela: `limit=40` com `maxChars`, e o topo lido vira o
    `seq_depois` — o piso que impede a resposta anterior de voltar colada."""
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "user", "content": "oi", "__openclaw": {"seq": 11}},
        {"role": "assistant", "content": "Olá!", "__openclaw": {"seq": 12}},
    ])
    r = _colher()
    assert r.status == "pronta" and r.message.content == "Olá!"
    _, params = ambiente.gateway.chamadas[1]
    assert params["limit"] == 40 and params["maxChars"] == c._MAX_CHARS_HISTORICO
    sql, args = ambiente.conn.updates[0]
    assert "message_id IS NULL" in sql and args == ("run-1", "m1", 12)
    assert len(ambiente.audios) == 1 and ambiente.publicados


def test_quem_perde_a_reserva_nao_publica_nem_gera_audio(ambiente):
    """Coletor e tela no mesmo run, em workers diferentes: quem perde a reserva
    do `message_id` desfaz o INSERT e devolve a do outro — sem segunda bolha e
    sem segundo áudio."""
    ambiente.conn = Conn(reserva_ganha=False)
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "assistant", "content": "Olá!", "__openclaw": {"seq": 12}}])
    r = _colher()
    assert r.status == "executando"
    assert ambiente.audios == [] and ambiente.publicados == []


def test_reply_sobrevive_sem_a_coluna_da_tela(monkeypatch):
    """Código no ar antes da `024`: o `/reply` não pode quebrar por causa do
    carimbo — foi exatamente assim que o chat ficou duas semanas fora em 09/2026."""
    class SemColuna:
        async def execute(self, *_):
            raise asyncpg.UndefinedColumnError("column \"tela_perguntou_em\" does not exist")

    @asynccontextmanager
    async def sessao(**_):
        yield SemColuna()

    monkeypatch.setattr(c, "sessao", sessao)
    asyncio.run(c._marcar_tela("run-1", UID))


def test_rota_marca_a_tela_antes_de_colher(monkeypatch):
    ordem = []

    async def seguir(run_id, _uid):
        return {"run_id": run_id, "message_id": None, "agent_id": "nina",
                "session_key": "agent:nina:x", "seq_antes": 10}

    async def carregar():
        return CFG

    async def marcar(run_id, uid):
        ordem.append(("marcar", run_id))

    async def colher(cfg, agent_id, run_id, chave, seq, uid, **_):
        ordem.append(("colher", run_id, chave, seq))
        return c.RespostaOut(status="executando")

    monkeypatch.setattr(c, "_seguir_run", seguir)
    monkeypatch.setattr(c.cfg, "carregar", carregar)
    monkeypatch.setattr(c, "_marcar_tela", marcar)
    monkeypatch.setattr(c, "colher_resposta", colher)
    usuario = SimpleNamespace(id=UID)
    r = asyncio.run(c.resposta("nina", "run-1", usuario))
    assert r.status == "executando"
    assert ordem == [("marcar", "run-1"), ("colher", "run-1", "agent:nina:x", 10)]


def test_falha_de_compactacao_nao_grava_texto_quando_perde_a_reserva(ambiente, monkeypatch):
    """Tela e coletor no mesmo run: quem perdia a reserva da compactação caía no
    caminho normal e gravava "auto-compaction could not recover" como resposta
    — com push e resumo em áudio de um aviso interno."""
    async def perdeu(*_):
        return False
    monkeypatch.setattr(c, "_reservar_compactacao", perdeu)
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "assistant", "content": "Auto-compaction could not recover the session.",
         "__openclaw": {"seq": 12}}])
    r = _colher()
    assert r.status == "executando"
    assert ambiente.conn.updates == [] and ambiente.audios == [] and ambiente.publicados == []


def _comando(monkeypatch, texto):
    executado = []

    class Conn_:
        async def execute(self, sql, *a):
            executado.append((" ".join(sql.split()), a))

        async def fetchval(self, sql, *a):   # dono do bot: especialista não tem
            return None

    @asynccontextmanager
    async def sessao(**_):
        yield Conn_()

    async def carregar():
        return CFG

    class Gw:
        async def chamar(self, *_):
            return {}

    monkeypatch.setattr(c, "sessao", sessao)
    monkeypatch.setattr(c.cfg, "carregar", carregar)
    monkeypatch.setattr(c, "obter_cliente", lambda *_: Gw())
    asyncio.run(c.comando("nina", c.ComandoIn(comando=texto), SimpleNamespace(id=UID)))
    return executado


def test_parar_encerra_os_runs_abertos_para_o_coletor(monkeypatch):
    """A pessoa apertou Parar e fechou o app; sem isto o coletor buscava a
    resposta que ela mandou parar, gravava e ainda mandava push dela."""
    executado = _comando(monkeypatch, "/stop")
    assert len(executado) == 1
    sql, args = executado[0]
    assert "SET coleta_encerrada_em = now()" in sql
    assert "message_id IS NULL" in sql and "coleta_encerrada_em IS NULL" in sql
    assert args == (UID, "nina")


def test_outro_comando_nao_encerra_nada(monkeypatch):
    assert _comando(monkeypatch, "/compact") == []


class _GatewayFora:
    async def chamar(self, *_):
        raise c.ErroGateway("conexão recusada")


def test_erro_de_gateway_vira_erro_na_tela_e_excecao_no_coletor(ambiente):
    """Para a tela, gateway fora é `erro` como sempre. Para o coletor, `erro`
    agora significa "desista" — então a falha de rede tem que chegar como
    exceção, para ele tentar de novo em vez de perder a resposta."""
    ambiente.gateway = _GatewayFora()
    assert _colher().status == "erro"
    with pytest.raises(c.ErroGateway):
        asyncio.run(c.colher_resposta(CFG, "nina", "run-1", "agent:nina:x", 10, UID,
                                      levantar_erro_gateway=True))


# ── Varredura do Guardi (spec 2026-11-16) ──────────────────────────────────

# A tarde sem novidade: o Guardi narra, chama as ferramentas e termina em
# `NO_REPLY`. Depois de limpo o `NO_REPLY`, o turno final fica vazio.
_TARDE_SEM_NOVIDADE = [
    {"role": "user", "content": "[Conferência da tarde — Erick]", "__openclaw": {"seq": 11}},
    {"role": "assistant", "content": "Vou conferir o TaskHS e o e-mail.",
     "__openclaw": {"seq": 12}},
    {"role": "toolCall", "content": "varredura_registrar", "__openclaw": {"seq": 13}},
    {"role": "toolResult", "content": '{"novidade": false}', "__openclaw": {"seq": 14}},
    {"role": "assistant", "content": "NO_REPLY", "__openclaw": {"seq": 15}},
]


def _colher_run(run_id):
    return asyncio.run(c.colher_resposta(CFG, "erick-bot", run_id, "agent:erick-bot:x",
                                         10, UID))


def test_tarde_no_reply_nao_grava_a_narracao(ambiente):
    """Antes, o `NO_REPLY` limpo deixava o turno final vazio e o recuo do
    `_texto_da_resposta` pegava TODO o texto do turno — a pessoa recebia
    "Vou conferir o TaskHS e o e-mail." como mensagem, com push, às 16h, num
    dia sem nada novo. Para run de varredura não há recuo: vazio é silêncio."""
    ambiente.gateway = Gateway({"status": "ok"}, _TARDE_SEM_NOVIDADE)
    r = _colher_run("hsos-varredura-abc")
    assert r.status == "erro"          # o coletor encerra o run
    assert ambiente.conn.updates == [] and ambiente.audios == [] and ambiente.publicados == []


def test_run_comum_mantem_o_recuo_de_hoje(ambiente):
    """O mesmo histórico num run da tela (`hsos-`) continua caindo no recuo —
    engolir a resposta de quem responde antes da ferramenta seria pior."""
    ambiente.gateway = Gateway({"status": "ok"}, _TARDE_SEM_NOVIDADE)
    r = _colher_run("hsos-123")
    assert r.status == "pronta" and r.message.content == "Vou conferir o TaskHS e o e-mail."


class _ConnVarredura(Conn):
    def __init__(self, falha=False):
        super().__init__()
        self.falha = falha
        self.varredura = []

    async def execute(self, sql, *a):
        if "varreduras" in sql:
            if self.falha:
                raise RuntimeError("permission denied for table varreduras")
            self.varredura.append((" ".join(sql.split()), a))


def test_quadro_gravado_vira_entregue(ambiente):
    """O quadro da Nina não passa pelo `varredura_registrar` (não tem números):
    sem isto ele ficava `rodando` até o fechamento o marcar `sem_registro`, e
    a war-room dizia que o quadro nunca saiu."""
    ambiente.conn = _ConnVarredura()
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "assistant", "content": "Quadro de hoje…", "__openclaw": {"seq": 12}}])
    r = _colher_run("hsos-varredura-q1")
    assert r.status == "pronta"
    [(sql, args)] = ambiente.conn.varredura
    assert "status = 'entregue'" in sql and "entregue_em = now()" in sql
    assert "tipo = 'quadro'" in sql and "status = 'rodando'" in sql
    assert args == ("hsos-varredura-q1",)


def test_run_comum_nao_toca_varreduras(ambiente):
    ambiente.conn = _ConnVarredura()
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "assistant", "content": "Olá!", "__openclaw": {"seq": 12}}])
    assert _colher_run("hsos-123").status == "pronta"
    assert ambiente.conn.varredura == []


def test_falha_ao_marcar_o_quadro_nao_derruba_a_resposta(ambiente):
    """Best-effort: a resposta já foi gravada e publicada; perder o status do
    quadro é um log, não um 500 nem uma resposta que some."""
    ambiente.conn = _ConnVarredura(falha=True)
    ambiente.gateway = Gateway({"status": "ok"}, [
        {"role": "assistant", "content": "Quadro de hoje…", "__openclaw": {"seq": 12}}])
    r = _colher_run("hsos-varredura-q1")
    assert r.status == "pronta" and ambiente.publicados
