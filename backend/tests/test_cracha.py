"""Crachá assinado do turno (PK-11, 26/11/2026).

⚠️ **O que custava:** o gateway não diz ao MCP de que sessão veio a chamada, e
o Guardi só usa e-mail e sistemas "no turno do dono" — o que o backend DEDUZIA
olhando `agent_runs`: turno aberto do dono e nenhum de outra pessoa. Com o
admin e o dono conversando com o bot ao mesmo tempo, a dedução não sabe de
quem é a chamada; a saída era bloquear os dois. O plugin `hsos-cracha` do
gateway carimba a chamada com agente, sessão e run, assinados; aqui se confere.

O que o teste tranca: assinatura de outro segredo, crachá vencido, crachá de
outro agente e crachá que o MODELO tentou forjar não passam — e a falta de
crachá não é erro (volta a dedução de antes, até o plugin estar no ar).
"""
import hashlib
import hmac

import pytest

from app import cracha as c

SEG = "segredo-de-teste"
AGORA = 1_800_000_000
DONO = "77071556-7a52-41d5-805a-cbbd3923da45"


def _cracha(agente="erick-bot", sessao=f"agent:erick-bot:hsos-{DONO}", run="r1", ts=AGORA, seg=SEG):
    msg = "\n".join([agente, sessao, run, str(ts)]).encode()
    return {"agente": agente, "sessao": sessao, "run": run, "ts": ts,
            "sig": hmac.new(seg.encode(), msg, hashlib.sha256).hexdigest()}


def test_sem_cracha_nao_e_erro_e_os_args_ficam_iguais():
    args, cr = c.ler({"x": 1}, "erick-bot", SEG, AGORA)
    assert cr is None and args == {"x": 1}


def test_cracha_valido_da_a_pessoa_e_sai_dos_args():
    args, cr = c.ler({"x": 1, c.CAMPO: _cracha()}, "erick-bot", SEG, AGORA + 10)
    assert args == {"x": 1}
    assert cr.pessoa == DONO and cr.run == "r1"


def test_sessao_que_nao_e_de_pessoa_da_pessoa_vazia():
    """Varredura, cron, sessão entre agentes: o crachá é real, mas não há
    pessoa — quem chama cai na dedução de antes."""
    _, cr = c.ler({c.CAMPO: _cracha(sessao="agent:erick-bot:varredura-manha")}, "erick-bot", SEG, AGORA)
    assert cr.pessoa is None


@pytest.mark.parametrize("ruim", [
    _cracha(seg="outro-segredo"),                      # forjado
    _cracha(ts=AGORA - c.PRAZO_S - 1),                 # vencido
    _cracha(agente="ana-bot"),                         # de outro agente
    {**_cracha(), "sessao": f"agent:erick-bot:hsos-{'0' * 8}-0000-0000-0000-{'0' * 12}"},  # sessão trocada
    {"agente": "erick-bot", "sessao": "x", "run": "r", "ts": AGORA},   # sem sig
    "não é um objeto",
])
def test_cracha_invalido_e_recusado(ruim):
    with pytest.raises(c.CrachaInvalido):
        c.ler({c.CAMPO: ruim}, "erick-bot", SEG, AGORA)


def test_sem_segredo_configurado_cracha_presente_e_recusado():
    """Segredo faltando não pode virar "aceito qualquer crachá"."""
    with pytest.raises(c.CrachaInvalido):
        c.ler({c.CAMPO: _cracha()}, "erick-bot", None, AGORA)


def test_pessoa_da_sessao():
    assert c.pessoa_da_sessao(f"agent:x:hsos-{DONO}") == DONO
    assert c.pessoa_da_sessao(f"agent:x:hsos-{DONO}-extra") is None
    assert c.pessoa_da_sessao("agent:x:main") is None


def test_recusa_do_cracha_no_bot_e_recusa_e_nao_falha_interna():
    """O bot tem `_Recusa` própria; a do crachá nasce no e-mail. Sem estar no
    `except`, ela cairia no genérico e a pessoa leria "falha interna"."""
    import inspect
    from app.routers import mcp_bot
    fonte = inspect.getsource(mcp_bot._executar_cru)
    assert "_RecusaDoCracha" in fonte and "ler_cracha" in fonte


def test_e_mail_e_bot_passam_o_cracha_ao_contexto():
    import inspect
    from app.routers import mcp_bot, mcp_email
    assert "_contexto(conn, agent_id, cr)" in inspect.getsource(mcp_email.executar)
    assert "_contexto(conn, agent_id, cr)" in inspect.getsource(mcp_bot._executar_cru)


class _Conn:
    def __init__(self, linha):
        self.linha = linha

    async def fetchrow(self, *_):
        return self.linha


def _rodar(coro):
    import asyncio
    return asyncio.run(coro)


@pytest.mark.parametrize("modulo", ["mcp_email", "mcp_bot"])
def test_contexto_com_cracha_decide_pela_pessoa_e_nao_pela_deducao(modulo, monkeypatch):
    """O caso que a dedução não resolvia: dono e admin com turno aberto ao mesmo
    tempo. Com crachá, a chamada do dono passa e a da outra pessoa é recusada —
    e a dedução (`turno_em_curso`/`outro_turno_aberto`) nem é consultada."""
    import importlib
    m = importlib.import_module(f"app.routers.{modulo}")
    linha = {"dono_id": DONO, "full_name": "Erick Santos", "email_ligado": True, "email": "e@x",
             "sistemas_ligados": [], "email_conectado": True}

    async def nao_consulte(*_):
        raise AssertionError("a dedução não devia rodar com crachá de pessoa")
    monkeypatch.setattr(m, "turno_em_curso", nao_consulte)
    monkeypatch.setattr(m, "outro_turno_aberto", nao_consulte)
    if modulo == "mcp_email":   # depois da guarda, o e-mail busca o token da conta
        async def token(*_):
            return "tok", "e@x"

        async def caixas(*_):
            return None, []
        monkeypatch.setattr(m.contas, "access_token", token)
        monkeypatch.setattr(m.contas, "caixas", caixas)

    do_dono = c.Cracha(agente="erick-bot", sessao=f"agent:erick-bot:hsos-{DONO}", run="r", pessoa=DONO)
    ctx = _rodar(m._contexto(_Conn(linha), "erick-bot", do_dono))
    assert ctx["dono"] == DONO

    outro = "11111111-2222-3333-4444-555555555555"
    de_outro = c.Cracha(agente="erick-bot", sessao=f"agent:erick-bot:hsos-{outro}", run="r", pessoa=outro)
    with pytest.raises(m._Recusa):
        _rodar(m._contexto(_Conn(linha), "erick-bot", de_outro))
