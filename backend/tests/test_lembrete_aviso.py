"""Adiar/Feito de um aviso de lembrete — domínio e rotas (spec 2026-11-13).

Em 13/11/2026 a Sandra não viu o lembrete das 14:00: a notificação apareceu e
sumiu. O lembrete agora fica na frente até a pessoa decidir, e é aqui que a
decisão vira estado. O que se tranca:

- a decisão só vale sobre o aviso ATUAL e ainda não respondido — senão um botão
  de notificação velha desfaz o que a pessoa decidiu depois, e o segundo clique
  adia de novo;
- com login, só o lembrete da própria pessoa (a tabela não tem RLS);
- sem login, só o que o token assina — e sem segredo a rota não abre.
"""
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agenda import aviso, token_acao
from app.agenda.regras import ADIAR, JANELA_PENDENTE
from app.dependencies import Usuario, usuario_atual
from app.routers import agenda as rota

UID = "11111111-1111-1111-1111-111111111111"
LID = "22222222-2222-2222-2222-222222222222"
OUTRO = "33333333-3333-3333-3333-333333333333"
AVISO = datetime(2026, 11, 13, 17, 0, 27, 123456, tzinfo=timezone.utc)
AGORA = AVISO + timedelta(minutes=1)
SEGREDO = "k" * 64


def _sem_espaco(sql):
    return " ".join(sql.split())


class Conn:
    """Banco falso com UMA linha de lembrete, que aplica a guarda do UPDATE."""

    def __init__(self, dono=UID, aviso_em=AVISO, reconhecido_em=None):
        self.linha = {"id": LID, "user_id": dono, "agent_id": "sandra-bot",
                      "aviso_em": aviso_em, "reconhecido_em": reconhecido_em}
        self.notificados = []

    async def fetchrow(self, sql, *a):
        assert sql == aviso.SQL_RECONHECER
        lid, aviso_em, agora, como, reaviso, user_id = a
        l = self.linha
        if lid != l["id"] or aviso_em != l["aviso_em"] or l["reconhecido_em"] is not None:
            return None
        if user_id is not None and user_id != l["user_id"]:
            return None
        l.update(reconhecido_em=agora, reconhecido_como=como, reaviso_em=reaviso)
        return {"user_id": l["user_id"], "agent_id": l["agent_id"]}

    async def execute(self, sql, *a):
        assert sql == aviso.SQL_AVISAR_TELAS
        self.notificados.append(json.loads(a[0]))

    async def fetch(self, sql, *a):
        assert sql == aviso.SQL_PENDENTES
        self.pendentes_args = a
        return [{"id": LID, "titulo": "Retornar contato para Hildon", "instrucao": None,
                 "agent_id": "sandra-bot", "aviso_em": AVISO, "reavisos": 0,
                 "agente_nome": "Sandra-Guardi"}]


def _rodar(coro):
    import asyncio
    return asyncio.run(coro)


# --- domínio -----------------------------------------------------------------

def test_adiar_marca_10_min_e_feito_zera_o_reaviso():
    """Feito zera `reaviso_em`: sem isso a insistência de 5 min, já marcada no
    disparo, tocaria de novo um lembrete que a pessoa acabou de resolver."""
    assert aviso.efeito("adiar", AGORA) == ("adiado", AGORA + ADIAR)
    assert aviso.efeito("feito", AGORA) == ("feito", None)
    with pytest.raises(ValueError):
        aviso.efeito("apagar", AGORA)


def test_segundo_clique_e_inocuo_e_nao_avisa_as_telas():
    conn = Conn()
    r1 = _rodar(aviso.reconhecer(conn, LID, AVISO, "adiar", AGORA, user_id=UID))
    r2 = _rodar(aviso.reconhecer(conn, LID, AVISO, "feito", AGORA, user_id=UID))
    assert r1["aplicado"] is True and r1["reaviso_em"] == AGORA + ADIAR
    assert r2 == {"aplicado": False}
    assert conn.linha["reconhecido_como"] == "adiado"
    # Um aviso só às telas, do clique que valeu — e pelo banco (2 workers).
    assert conn.notificados == [{"tabela": "lembretes", "op": "UPDATE", "id": LID,
                                 "user_id": UID, "agent_id": "sandra-bot"}]
    assert "pg_notify('hsos_mudancas'" in aviso.SQL_AVISAR_TELAS


def test_botao_de_aviso_velho_nao_mexe_no_aviso_novo():
    """A notificação das 14:00 ficou na bandeja; às 14:10 saiu o re-aviso. O
    "Feito" do velho não pode responder pelo novo."""
    conn = Conn(aviso_em=AVISO + timedelta(minutes=10))
    assert _rodar(aviso.reconhecer(conn, LID, AVISO, "feito", AGORA)) == {"aplicado": False}
    assert conn.linha["reconhecido_em"] is None


def test_com_login_so_o_proprio_lembrete():
    conn = Conn(dono=OUTRO)
    assert _rodar(aviso.reconhecer(conn, LID, AVISO, "feito", AGORA, user_id=UID)) == {"aplicado": False}
    sql = _sem_espaco(aviso.SQL_RECONHECER)
    for trecho in ("aviso_em = $2", "reconhecido_em IS NULL",
                   "($6::uuid IS NULL OR user_id = $6::uuid)"):
        assert trecho in sql


def test_pendentes_sao_os_nao_respondidos_das_ultimas_6h_da_pessoa():
    conn = Conn()
    [p] = _rodar(aviso.pendentes(conn, UID, AGORA))
    assert conn.pendentes_args == (UID, AGORA - JANELA_PENDENTE)
    assert p["titulo"].startswith("Retornar")
    sql = _sem_espaco(aviso.SQL_PENDENTES)
    for trecho in ("l.user_id = $1::uuid", "l.reconhecido_em IS NULL", "l.aviso_em > $2"):
        assert trecho in sql


# --- rotas -------------------------------------------------------------------

@pytest.fixture
def banco(monkeypatch):
    conn = Conn()

    @asynccontextmanager
    async def sessao_falsa(**_):
        yield conn

    monkeypatch.setattr(rota, "sessao", sessao_falsa)
    monkeypatch.setattr(rota, "_agora", lambda: AGORA)
    monkeypatch.setattr(rota.settings, "LEMBRETE_ACAO_SEGREDO", SEGREDO)
    return conn


def _cli(logado=True):
    app = FastAPI()
    app.include_router(rota.router)
    if logado:
        app.dependency_overrides[usuario_atual] = lambda: Usuario(UID, "a@b.com", "colaborador")
    return TestClient(app)


def test_rotas_com_login_adiam_e_marcam_feito(banco):
    cli = _cli()
    r = cli.post(f"/agenda/lembretes/{LID}/adiar", json={"aviso_em": AVISO.isoformat()})
    assert r.status_code == 200 and r.json()["aplicado"] is True
    assert r.json()["reaviso_em"].startswith("2026-11-13T14:11")  # Brasília
    # o aviso volta pelo re-aviso; aqui o mesmo aviso já foi respondido
    r2 = cli.post(f"/agenda/lembretes/{LID}/feito", json={"aviso_em": AVISO.isoformat()})
    assert r2.json() == {"aplicado": False}


def test_rota_com_login_recusa_aviso_sem_fuso(banco):
    r = _cli().post(f"/agenda/lembretes/{LID}/feito", json={"aviso_em": "2026-11-13T14:00:27"})
    assert r.status_code == 400


def test_pendentes_pela_rota(banco):
    r = _cli().get("/agenda/lembretes/pendentes")
    assert r.status_code == 200
    [p] = r.json()["pendentes"]
    assert p["aviso_em"].endswith("-03:00") and p["agente_nome"] == "Sandra-Guardi"


def test_rota_do_token_e_publica_e_so_faz_o_que_o_token_diz(banco):
    """Sem login: o corpo NÃO escolhe lembrete, aviso nem ação — só o token."""
    tok = token_acao.emitir(SEGREDO, LID, AVISO, "feito", AGORA)
    cli = _cli(logado=False)
    r = cli.post("/agenda/lembretes/acao", json={"token": tok, "lembrete_id": OUTRO,
                                                 "acao": "adiar"})
    assert r.status_code == 200 and r.json() == {"aplicado": True}
    assert banco.linha["reconhecido_como"] == "feito" and banco.linha["reaviso_em"] is None
    # segundo clique: inócuo, e não diz de quem é o lembrete
    r2 = cli.post("/agenda/lembretes/acao", json={"token": tok})
    assert r2.json() == {"aplicado": False}


def test_token_de_outro_lembrete_nao_mexe_neste(banco):
    tok = token_acao.emitir(SEGREDO, OUTRO, AVISO, "feito", AGORA)
    r = _cli(logado=False).post("/agenda/lembretes/acao", json={"token": tok})
    assert r.json() == {"aplicado": False}
    assert banco.linha["reconhecido_em"] is None


def test_token_forjado_403_e_sem_segredo_503(banco, monkeypatch):
    cli = _cli(logado=False)
    tok = token_acao.emitir("outro-segredo", LID, AVISO, "feito", AGORA)
    assert cli.post("/agenda/lembretes/acao", json={"token": tok}).status_code == 403
    vencido = token_acao.emitir(SEGREDO, LID, AVISO, "feito", AGORA - timedelta(hours=25))
    assert cli.post("/agenda/lembretes/acao", json={"token": vencido}).status_code == 403
    assert banco.linha["reconhecido_em"] is None
    monkeypatch.setattr(rota.settings, "LEMBRETE_ACAO_SEGREDO", "")
    ok = token_acao.emitir(SEGREDO, LID, AVISO, "feito", AGORA)
    assert cli.post("/agenda/lembretes/acao", json={"token": ok}).status_code == 503
