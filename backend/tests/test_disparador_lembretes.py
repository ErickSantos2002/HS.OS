"""O disparador de lembretes (spec 2026-11-09, "Disparador").

O anti-objetivo da agenda é o **lembrete que some**. Por isso o recado sai
antes de tudo, sem agente, e é comitado antes de qualquer chamada ao gateway:
com o gateway fora, a pessoa ainda recebe o push do recado. O turno do Guardi é
o extra — adiado quando há outra conversa em curso com ele, cortado pelo teto
diário. Conexão, sessão e `disparar_turno` falsos.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from app import disparador_lembretes as d
from app.agenda.regras import ADIAMENTO, TETO_TURNOS_DIA
from app.gateway.client import ErroGateway

AGORA = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)  # 09:00 em Brasília


def _lembrete(**kw):
    base = {
        "id": "l-1", "user_id": "u-erick", "agent_id": "erick-bot",
        "titulo": "Ligar para a ACME", "instrucao": "Veja os e-mails da ACME e me resuma.",
        "regra": {"tipo": "diario", "hora": "09:00"},
        "proximo_em": AGORA, "turno_pendente_desde": None,
    }
    base.update(kw)
    return base


# --- decidir (pura) ---------------------------------------------------------

def test_atraso_de_7h_vira_perdido_sem_recado():
    """Backend fora a manhã inteira: disparar às 16h o "bom dia" das 9h é pior
    que não disparar. Acima de 6 h não sai nem o recado."""
    l = _lembrete(proximo_em=AGORA - timedelta(hours=7))
    assert d.decidir(l, AGORA, turno_aberto=False, turnos_hoje=0) == \
        d.Decisao(recado=False, turno=False, adiar_ate=None, status="perdido")


def test_sem_instrucao_so_recado():
    """Lembrete sem instrução é só o recado: abrir turno de IA para nada
    gastaria token e poria um texto do Guardi que ninguém pediu."""
    dec = d.decidir(_lembrete(instrucao=None), AGORA, turno_aberto=False, turnos_hoje=0)
    assert dec == d.Decisao(recado=True, turno=False, adiar_ate=None, status="entregue")


def test_teto_diario_vira_so_recado():
    """Acima de 12 turnos no dia o lembrete não morre: sai como recado e o
    status registra que o agente ficou de fora."""
    dec = d.decidir(_lembrete(), AGORA, turno_aberto=False, turnos_hoje=TETO_TURNOS_DIA)
    assert dec == d.Decisao(recado=True, turno=False, adiar_ate=None, status="entregue_sem_agente")
    assert d.decidir(_lembrete(), AGORA, False, TETO_TURNOS_DIA - 1).turno is True


def test_turno_aberto_adia_2_min_e_recado_sai_na_hora():
    """Com outra conversa em curso com o Guardi, abrir o turno faria o coletor
    perder a resposta da pergunta em curso ou colar as duas numa bolha. O
    recado sai na hora; o turno espera 2 min. Na segunda passada o recado NÃO
    sai de novo — seria push duplicado."""
    dec = d.decidir(_lembrete(), AGORA, turno_aberto=True, turnos_hoje=0)
    assert dec == d.Decisao(recado=True, turno=False, adiar_ate=AGORA + ADIAMENTO, status=None)

    pendente = _lembrete(turno_pendente_desde=AGORA - timedelta(minutes=4))
    dec2 = d.decidir(pendente, AGORA, turno_aberto=True, turnos_hoje=0)
    assert dec2 == d.Decisao(recado=False, turno=False, adiar_ate=AGORA + ADIAMENTO, status=None)

    dec3 = d.decidir(pendente, AGORA, turno_aberto=False, turnos_hoje=0)
    assert dec3 == d.Decisao(recado=False, turno=True, adiar_ate=None, status="entregue")


def test_adiado_ha_30_min_desiste_do_turno():
    """A espera conta do disparo ORIGINAL, não do último adiamento — senão o
    teto de 30 min nunca chegaria. Passou dele: fica só o recado, que já saiu."""
    l = _lembrete(turno_pendente_desde=AGORA - timedelta(minutes=30), proximo_em=AGORA)
    dec = d.decidir(l, AGORA, turno_aberto=True, turnos_hoje=0)
    assert dec == d.Decisao(recado=False, turno=False, adiar_ate=None, status="entregue_sem_agente")


# --- disparar_um (conexão falsa) --------------------------------------------

class Conn:
    def __init__(self, log, turno_aberto=False, turnos_hoje=0, nome="Erick Santos"):
        self.log = log
        self.turno_aberto, self.turnos_hoje, self.nome = turno_aberto, turnos_hoje, nome
        self.concluidos = []

    async def fetchval(self, sql, *a):
        if sql == d.SQL_TURNO_ABERTO:
            return self.turno_aberto
        if sql == d.SQL_TURNOS_HOJE:
            return self.turnos_hoje
        if sql == d.SQL_NOME:
            return self.nome
        raise AssertionError(sql)

    async def execute(self, sql, *a):
        if sql == d.SQL_RECADO:
            self.log.append(("recado", a))
        elif sql == d.SQL_CONCLUIR:
            self.log.append(("concluir", a))
            self.concluidos.append(a)
        else:
            raise AssertionError(sql)


def _sessao(conn):
    @asynccontextmanager
    async def falsa(**_):
        yield conn
        conn.log.append(("commit",))
    return falsa


def _disparar(log, falha=None):
    async def disparar(agent_id, user_id, mensagem, pergunta_id=None, prefixo="hsos-"):
        log.append(("chat.send", agent_id, user_id, mensagem, prefixo))
        if falha:
            raise falha
        return f"{prefixo}x"
    return disparar


def test_recado_e_gravado_antes_do_chat_send():
    """O recado é COMITADO antes de falar com o gateway: é o INSERT que dispara
    o push. Com o gateway fora, o lembrete chega mesmo assim — e o status diz
    que o agente ficou de fora, não "erro"."""
    log = []
    conn = Conn(log)
    asyncio.run(d.disparar_um(_sessao(conn), _lembrete(), AGORA,
                              disparar=_disparar(log, ErroGateway("conexão recusada"))))

    eventos = [e[0] for e in log]
    i_recado = eventos.index("recado")
    assert eventos.index("commit", i_recado) < eventos.index("chat.send")

    _, args = log[i_recado]
    agent_id, user_id, conteudo, media = args
    assert (agent_id, user_id, conteudo) == ("erick-bot", "u-erick", "⏰ Lembrete: Ligar para a ACME")
    assert '"type": "lembrete"' in media and '"id": "l-1"' in media

    [(_, _, _, mensagem, prefixo)] = [e for e in log if e[0] == "chat.send"]
    assert mensagem == ('[Lembrete agendado por Erick — "Ligar para a ACME"] '
                        "Veja os e-mails da ACME e me resuma.")
    assert prefixo == "hsos-lembrete-"

    [concluir] = conn.concluidos
    assert concluir[4] == "entregue_sem_agente"


def test_unico_encerra_recorrente_avanca():
    """Único: `proximo_em` NULL, senão volta a disparar. Recorrente: o próximo
    pela regra, a partir de agora — e o pendente volta a nulo."""
    log = []
    conn = Conn(log)
    unico = _lembrete(regra={"tipo": "unico", "em": "2026-11-10T09:00"}, instrucao=None)
    asyncio.run(d.disparar_um(_sessao(conn), unico, AGORA, disparar=_disparar(log)))
    lid, proximo_em, pendente, ultimo_em, status = conn.concluidos[-1]
    assert (lid, proximo_em, pendente, ultimo_em, status) == ("l-1", None, None, AGORA, "entregue")

    asyncio.run(d.disparar_um(_sessao(conn), _lembrete(), AGORA, disparar=_disparar(log)))
    _, proximo_em, pendente, _, status = conn.concluidos[-1]
    assert proximo_em == datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
    assert pendente is None and status == "entregue"


def test_adiado_guarda_o_instante_original_e_nao_repete_recado():
    log = []
    conn = Conn(log, turno_aberto=True)
    asyncio.run(d.disparar_um(_sessao(conn), _lembrete(), AGORA, disparar=_disparar(log)))
    assert [e[0] for e in log].count("recado") == 1
    assert not any(e[0] == "chat.send" for e in log)
    _, proximo_em, pendente, _, status = conn.concluidos[-1]
    assert (proximo_em, pendente, status) == (AGORA + ADIAMENTO, AGORA, None)

    original = AGORA - timedelta(minutes=6)
    log.clear()
    asyncio.run(d.disparar_um(_sessao(conn), _lembrete(turno_pendente_desde=original),
                              AGORA, disparar=_disparar(log)))
    assert not any(e[0] == "recado" for e in log)
    assert conn.concluidos[-1][2] == original


def test_perdido_nao_grava_recado_e_avanca():
    log = []
    conn = Conn(log)
    asyncio.run(d.disparar_um(_sessao(conn), _lembrete(proximo_em=AGORA - timedelta(hours=7)),
                              AGORA, disparar=_disparar(log)))
    assert not any(e[0] in ("recado", "chat.send") for e in log)
    _, proximo_em, _, _, status = conn.concluidos[-1]
    assert status == "perdido" and proximo_em == datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)


# --- passada e SQL ----------------------------------------------------------

def test_lembrete_que_quebra_nao_para_a_passada(monkeypatch):
    """Um lembrete com defeito vira `erro`, solta a reserva e o seguinte sai."""
    vistos, erros = [], []

    class ConnReserva:
        async def fetch(self, sql, *a):
            assert sql == d.SQL_RESERVAR
            return [_lembrete(id="l-1"), _lembrete(id="l-2")]

        async def execute(self, sql, *a):
            assert sql == d.SQL_ERRO
            erros.append(a[0])

    @asynccontextmanager
    async def sessao_fn(**_):
        yield ConnReserva()

    async def um(sessao_fn, l, agora, disparar=None):
        vistos.append(l["id"])
        if l["id"] == "l-1":
            raise RuntimeError("bug")

    monkeypatch.setattr(d, "disparar_um", um)
    assert asyncio.run(d.passada(sessao_fn, AGORA)) == 2
    assert vistos == ["l-1", "l-2"] and erros == ["l-1"]
    assert "disparando_em = NULL" in " ".join(d.SQL_ERRO.split())


def _sem_espaco(sql):
    return " ".join(sql.split())


def test_reserva_tem_a_guarda_no_where_externo():
    """Os 2 workers rodam o disparador. A guarda de `ativo` e de `disparando_em`
    tem que estar no UPDATE de fora: é ela que faz o segundo worker, que leu o
    mesmo lembrete antes do commit do primeiro, sair sem nada — sem ela, recado
    e turno saíam em dobro."""
    sql = _sem_espaco(d.SQL_RESERVAR)
    externo = sql.split("FOR UPDATE SKIP LOCKED)")[1].split("RETURNING")[0]
    assert "l.ativo" in externo
    assert "l.disparando_em IS NULL OR l.disparando_em < now() - interval '2 minutes'" in externo
    assert "proximo_em <= now()" in sql
    assert "FOR UPDATE SKIP LOCKED" in sql and "LIMIT 20" in sql and "RETURNING" in sql


def test_turno_aberto_olha_qualquer_pessoa_com_o_agente():
    """O turno do lembrete colide com a conversa de QUALQUER pessoa com o
    Guardi (o coletor só colhe o run mais novo), não só a do dono."""
    sql = _sem_espaco(d.SQL_TURNO_ABERTO)
    assert "user_id" not in sql
    for cond in ("message_id IS NULL", "redireciona_para IS NULL", "coleta_encerrada_em IS NULL",
                 "regexp_replace(lower(btrim(agent_id)), '^openclaw:', '') = $1"):
        assert cond in sql


def test_turnos_hoje_conta_so_os_do_disparador_desde_a_meia_noite_de_brasilia():
    sql = _sem_espaco(d.SQL_TURNOS_HOJE)
    assert "run_id LIKE 'hsos-lembrete-%'" in sql
    assert "America/Sao_Paulo" in sql


def test_intervalo_padrao_30_e_zero_desliga(monkeypatch):
    monkeypatch.delenv("DISPARADOR_LEMBRETES_SEGUNDOS", raising=False)
    assert d.intervalo() == 30
    monkeypatch.setenv("DISPARADOR_LEMBRETES_SEGUNDOS", "0")
    assert d.intervalo() == 0
