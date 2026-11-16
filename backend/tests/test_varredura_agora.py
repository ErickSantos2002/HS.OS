"""O script de ensaio da varredura (`scripts/varredura-agora.py --so`).

Dois defeitos que a revisão final achou antes do primeiro uso:

- ⚠️ Ele usava `pool.acquire()` cru. O backend conecta como `hsos_app`, que é
  NOINHERIT e não tem privilégio em `public`: sem o `SET LOCAL ROLE` do
  `sessao()`, a primeira consulta morre com permissão negada. E com uma
  conexão só, a pedida nem seria comitada antes do fim da espera — o
  disparador nunca a veria.
- ⚠️ Imprimia o resumo decifrado no terminal por padrão. O resumo cita
  assunto e remetente de e-mail do dono; terminal vai parar em transcript.
  Por padrão sai status, números e o tamanho; o texto só com
  `--mostrar-resumo`.
"""
import asyncio
import importlib.util
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "varredura-agora.py"
_spec = importlib.util.spec_from_file_location("varredura_agora", SCRIPT)
va = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(va)

UID = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"
RESUMO = "Assunto: proposta Acme — de fulano@cliente.com"


@pytest.fixture
def ambiente(monkeypatch):
    import dotenv

    from app import database
    from app.email import cifra
    from app.varredura import dominio

    papeis, transacoes = [], []

    class Conn:
        async def fetchrow(self, sql, *a):
            return {"status": "entregue", "numeros": {"taskhs": {"atrasadas": 2}},
                    "resumo_cifrado": "token"}

    @asynccontextmanager
    async def sessao(role="anon", user_id=None):
        papeis.append(role)
        transacoes.append("abre")
        yield Conn()
        transacoes.append("commit")

    async def nada(*_a, **_k):
        return None

    async def pedir(conn, user_id, agora, por="nina"):
        assert por == "agenda"
        return True, "ok"

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: None)
    monkeypatch.setattr(database, "init_db", nada)
    monkeypatch.setattr(database, "close_db", nada)
    monkeypatch.setattr(database, "sessao", sessao)
    monkeypatch.setattr(database, "get_pool",
                        lambda: (_ for _ in ()).throw(AssertionError("pool cru")))
    monkeypatch.setattr(dominio, "pedir", pedir)
    monkeypatch.setattr(dominio, "ler_config", lambda conn: _cfg())
    monkeypatch.setattr(cifra, "decifrar", lambda t: RESUMO)
    monkeypatch.setattr(va.asyncio, "sleep", nada)
    return papeis, transacoes


async def _cfg():
    from types import SimpleNamespace
    return SimpleNamespace(ligada=False)


def test_ensaio_usa_sessao_service_role_em_cada_passo(ambiente, capsys):
    papeis, transacoes = ambiente
    assert asyncio.run(va._ensaio(UID, True)) == 0
    # config, pedir e uma leitura de status: três transações, todas service_role
    assert papeis == ["service_role"] * 3
    assert transacoes == ["abre", "commit"] * 3


def test_resumo_nao_sai_por_padrao(ambiente, capsys):
    asyncio.run(va._ensaio(UID, True))
    saida = capsys.readouterr().out
    assert RESUMO not in saida and "fulano@" not in saida
    assert f"{len(RESUMO)} caracteres" in saida and "atrasadas" in saida


def test_mostrar_resumo_imprime_o_texto(ambiente, capsys):
    asyncio.run(va._ensaio(UID, True, mostrar_resumo=True))
    assert RESUMO in capsys.readouterr().out
