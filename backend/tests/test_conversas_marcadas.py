"""Marcar conversa como não lida pela lista (`/conversas/marcadas`, migração 039).

⚠️ O que se tranca: o "Marcar como não lida" por mensagem virava notificação e
o re-sweep de 2 s com a conversa aberta a apagava na hora — a Leticia marcava e
"já sumia". A marca nova é tabela própria, e estas rotas são a única porta.

- O alvo é exatamente um (canal OU agente). Sem isso a linha não cabe no CHECK
  da 039 e a rota estouraria com 500 em vez de dizer o que faltou.
- Canal exige ser membro humano: sem a guarda, qualquer pessoa marcaria (e, pelo
  GET, descobriria a existência de) um canal alheio pelo uuid.
- O `user_id` sai do token, nunca da query: senão uma pessoa marcaria ou
  desmarcaria a conversa de outra.
- Dois cliques rápidos, ou dois aparelhos, não podem errar: `ON CONFLICT DO
  NOTHING`, uma linha só.
- Quem saiu do canal com a marca ativa não a vê voltar: o GET junta com
  `channel_members` humano.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app import conversas_marcadas as cm
from app.dependencies import Usuario
from app.routers import conversas_marcadas as rota

EU = "11111111-1111-1111-1111-111111111111"
OUTRO = "22222222-2222-2222-2222-222222222222"
CANAL = "33333333-3333-3333-3333-333333333333"


# ─── regra pura ───────────────────────────────────────────────────────────────

def test_alvo_exige_exatamente_um():
    with pytest.raises(ValueError):
        cm.alvo_da_marca(None, None)
    with pytest.raises(ValueError):
        cm.alvo_da_marca(CANAL, "nina")
    with pytest.raises(ValueError):
        cm.alvo_da_marca("", "  ")
    assert cm.alvo_da_marca(CANAL, None) == ("canal", CANAL)
    assert cm.alvo_da_marca(None, " Nina ") == ("agente", "nina")


def test_canal_precisa_ser_uuid():
    """Sem validar, `$1::uuid` estoura no banco e a pessoa vê um 500."""
    with pytest.raises(ValueError):
        cm.alvo_da_marca("nao-e-uuid", None)


# ─── rotas com conexão falsa ─────────────────────────────────────────────────

class Conn:
    def __init__(self, membro=True, ve_agente=True, linhas=None):
        self.membro = membro
        self.ve_agente = ve_agente
        self.linhas = linhas or []
        self.executados: list[tuple[str, tuple]] = []
        self.consultas: list[tuple[str, tuple]] = []

    async def fetchval(self, sql, *a):
        if "channel_members" in sql:
            return self.membro
        if "pode_ver_agente" in sql:
            return self.ve_agente
        raise AssertionError(f"consulta inesperada: {sql}")

    async def execute(self, sql, *a):
        self.executados.append((sql, a))
        return "INSERT 0 1"

    async def fetch(self, sql, *a):
        self.consultas.append((sql, a))
        return self.linhas


class _Sessao:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def conn(monkeypatch):
    c = Conn()
    monkeypatch.setattr(rota, "sessao", lambda **k: _Sessao(c))
    return c


def _eu():
    return Usuario(EU, "eu@x", "colaborador")


def test_put_recusa_canal_de_quem_nao_e_membro(conn):
    conn.membro = False
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.marcar(canal_id=CANAL, agent_id=None, usuario=_eu()))
    assert e.value.status_code == 403
    assert conn.executados == []


def test_put_recusa_agente_que_a_pessoa_nao_ve(conn):
    conn.ve_agente = False
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.marcar(canal_id=None, agent_id="iris", usuario=_eu()))
    assert e.value.status_code == 403
    assert conn.executados == []


def test_put_sem_alvo_e_400(conn):
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.marcar(canal_id=None, agent_id=None, usuario=_eu()))
    assert e.value.status_code == 400


def test_put_duas_vezes_nao_erra(conn):
    r1 = asyncio.run(rota.marcar(canal_id=CANAL, agent_id=None, usuario=_eu()))
    r2 = asyncio.run(rota.marcar(canal_id=CANAL, agent_id=None, usuario=_eu()))
    assert r1.status_code == r2.status_code == 204
    assert len(conn.executados) == 2
    for sql, _ in conn.executados:
        assert "ON CONFLICT DO NOTHING" in sql


def test_user_id_vem_do_token(conn):
    """A rota não tem parâmetro `user_id`: o que vai para o banco é o do token."""
    import inspect
    for f in (rota.marcar, rota.desmarcar, rota.listar):
        assert "user_id" not in inspect.signature(f).parameters
    asyncio.run(rota.marcar(canal_id=None, agent_id="nina", usuario=_eu()))
    asyncio.run(rota.desmarcar(canal_id=CANAL, agent_id=None, usuario=_eu()))
    for _, args in conn.executados:
        assert args[0] == EU
        assert OUTRO not in args


def test_delete_sem_linha_e_204_e_nao_confere_acesso(conn):
    """Desmarcar o que não está marcado não é erro, e quem saiu do canal ainda
    consegue limpar a própria marca."""
    conn.membro = False
    r = asyncio.run(rota.desmarcar(canal_id=CANAL, agent_id=None, usuario=_eu()))
    assert r.status_code == 204
    sql, args = conn.executados[0]
    assert sql.lstrip().upper().startswith("DELETE")
    assert args == (EU, CANAL)


def test_get_so_devolve_canal_de_que_ainda_e_membro(conn):
    from datetime import datetime, timezone
    quando = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    conn.linhas = [
        {"canal_id": CANAL, "agent_id": None, "marcada_em": quando},
        {"canal_id": None, "agent_id": "nina", "marcada_em": quando},
    ]
    r = asyncio.run(rota.listar(usuario=_eu()))
    sql, args = conn.consultas[0]
    assert "channel_members" in sql and "member_type = 'human'" in sql
    assert args == (EU,)
    assert r == [
        {"canal_id": CANAL, "agent_id": None, "marcada_em": quando.isoformat()},
        {"canal_id": None, "agent_id": "nina", "marcada_em": quando.isoformat()},
    ]
