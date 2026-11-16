"""Banco da varredura (conexão falsa que registra SQL e argumentos).

O que custa caro aqui: duas passadas semeando ao mesmo tempo (ON CONFLICT),
o Guardi registrando fora de varredura (recusa sem gravar), e o resumo indo ao
banco em claro (tem que ir cifrado: o usuário de leitura enxerga a tabela).
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from app.email import cifra
from app.varredura import dominio as d
from app.varredura.regras import TETO_RESUMO, config

SEG = datetime(2026, 11, 16, 10, 0, tzinfo=timezone.utc)  # 07:00 em Brasília, segunda
SAB = datetime(2026, 11, 14, 10, 0, tzinfo=timezone.utc)
RODANDO = {"id": "v-1", "tipo": "manha", "dia": date(2026, 11, 16)}


@pytest.fixture(autouse=True)
def chave(monkeypatch):
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", Fernet.generate_key().decode())


class Conn:
    def __init__(self, rodando=None, manha=None, guardis=(), linhas=(), pedidas=()):
        self.rodando, self.manha = rodando, manha
        self.guardis, self.linhas, self.pedidas = guardis, linhas, pedidas
        self.exec = []

    async def execute(self, sql, *a):
        self.exec.append((sql, a))
        return "INSERT 0 1"

    async def fetchrow(self, sql, *a):
        return self.manha if sql == d.SQL_MANHA else self.rodando

    async def fetchval(self, sql, *a):
        assert sql == d.SQL_GUARDI_DE
        return "erick-bot"

    async def fetch(self, sql, *a):
        if sql == d.SQL_GUARDIS:
            return list(self.guardis)
        if sql == d.SQL_PEDIDAS:
            return [{"criado_em": p} for p in self.pedidas]
        return list(self.linhas)


def rodar(c):
    return asyncio.run(c)


def test_semear_fim_de_semana_nao_insere():
    c = Conn()
    assert rodar(d.semear(c, config({"ligada": True}), SAB)) == 0
    assert c.exec == []


def test_semear_usa_on_conflict():
    """Dois workers semeando: o índice único + ON CONFLICT impedem duplicata."""
    c = Conn()
    assert rodar(d.semear(c, config({"ligada": True}), SEG)) == 3
    assert all("ON CONFLICT DO NOTHING" in sql for sql, _ in c.exec)


def test_semear_pula_o_que_ja_passou_do_limite():
    c = Conn()
    tarde = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)  # 12:00 em Brasília
    rodar(d.semear(c, config({"ligada": True}), tarde))
    tipos = [a[1] for sql, a in c.exec if sql == d.SQL_SEMEAR_GUARDIS]
    assert tipos == ["tarde"]


def test_registrar_sem_varredura_rodando_levanta():
    with pytest.raises(LookupError):
        rodar(d.registrar(Conn(rodando=None), "erick-bot", "u1", "oi", {}))


def test_registrar_cifra_o_resumo():
    c = Conn(rodando=RODANDO)
    rodar(d.registrar(c, "erick-bot", "u1", "tenho 3 tarefas", {"taskhs": {"atrasadas": 3}}))
    gravado = c.exec[0][1][1]
    assert gravado != "tenho 3 tarefas"
    assert cifra.decifrar(gravado) == "tenho 3 tarefas"


def test_registrar_corta_em_4000():
    c = Conn(rodando=RODANDO)
    rodar(d.registrar(c, "erick-bot", "u1", "x" * 9000, {}))
    assert len(cifra.decifrar(c.exec[0][1][1])) == TETO_RESUMO


def test_registrar_tarde_sem_novidade_vira_nada_novo():
    n = {"taskhs": {"atrasadas": 3}}
    c = Conn(rodando={**RODANDO, "tipo": "tarde"}, manha={"numeros": n})
    r = rodar(d.registrar(c, "erick-bot", "u1", "igual", n))
    assert r["status"] == "nada_novo" and r["novidade"] is False
    assert c.exec[0][1][3] == "nada_novo"


def test_do_dia_lista_quem_nao_tem_varredura():
    g = {"user_id": "u1", "agent_id": "erick-bot", "nome": "Erick", "cargo": "TI", "departamento": "TI"}
    r = rodar(d.do_dia(Conn(guardis=[g]), date(2026, 11, 16)))
    assert r[0]["status"] == "sem_varredura" and r[0]["resumo"] is None


def test_do_dia_decifra_e_prefere_entregue():
    g = {"user_id": "u1", "agent_id": "erick-bot", "nome": "Erick", "cargo": None, "departamento": None}
    h = SEG
    linhas = [
        {"user_id": "u1", "tipo": "manha", "status": "entregue", "numeros": None,
         "resumo_cifrado": cifra.cifrar("manhã"), "hora": h},
        {"user_id": "u1", "tipo": "tarde", "status": "erro", "numeros": None,
         "resumo_cifrado": None, "hora": h + timedelta(hours=6)},
    ]
    r = rodar(d.do_dia(Conn(guardis=[g], linhas=linhas), date(2026, 11, 16)))
    assert r[0]["resumo"] == "manhã" and r[0]["status"] == "entregue"


def test_do_dia_resumo_ilegivel_nao_levanta():
    g = {"user_id": "u1", "agent_id": "erick-bot", "nome": "E", "cargo": None, "departamento": None}
    linhas = [{"user_id": "u1", "tipo": "manha", "status": "entregue", "numeros": None,
               "resumo_cifrado": "lixo", "hora": SEG}]
    assert rodar(d.do_dia(Conn(guardis=[g], linhas=linhas), date(2026, 11, 16)))[0]["resumo"] is None


def test_pedir_terceira_recusa_sem_inserir():
    c = Conn(pedidas=[SEG - timedelta(hours=3), SEG - timedelta(hours=2)])
    ok, _ = rodar(d.pedir(c, "u1", SEG))
    assert ok is False and c.exec == []


def test_pedir_do_admin_nao_conta_no_teto():
    c = Conn(pedidas=[SEG - timedelta(hours=3), SEG - timedelta(minutes=1)])
    ok, _ = rodar(d.pedir(c, "u1", SEG, por="agenda"))
    assert ok is True and c.exec[0][1][3] == "agenda"


def test_registrar_passa_o_dict_ao_codec_jsonb():
    """O pool já codifica jsonb com json.dumps; passar string gravava string jsonb."""
    c = Conn(rodando=RODANDO)
    n = {"taskhs": {"atrasadas": 3}}
    rodar(d.registrar(c, "erick-bot", "u1", "x", n))
    assert c.exec[0][1][2] == n


def test_marcar_solta_o_lease_fora_de_rodando_e_limpa_pendente():
    """Adiamento de 2 min só funciona com o lease livre; `rodando` mantém o
    carimbo (janela do SQL_RODANDO). `limpar_pendente` zera o adiamento."""
    assert "CASE WHEN $2 = 'rodando' THEN disparando_em ELSE NULL END" in d.SQL_MARCAR
    assert "CASE WHEN $7 THEN NULL" in d.SQL_MARCAR

    visto = []

    class C:
        async def fetchval(self, sql, *a):
            visto.append(a)
            return "id"
    assert rodar(d.marcar(C(), "v-1", "entregue", SEG, limpar_pendente=True)) is True
    assert visto[0][-1] is True


def test_fechar_sem_registro_pega_rodando_antigo_sem_run():
    """Run nunca gravado (run_id nulo) não casa com o EXISTS: o corte de 30 min
    no próprio `disparando_em` é o que o fecha."""
    assert "v.disparando_em < now() - interval '30 minutes'" in d.SQL_FECHAR
    assert "OR EXISTS" in d.SQL_FECHAR
