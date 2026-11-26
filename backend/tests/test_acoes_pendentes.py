"""Confirmação de ação do bot num sistema interno.

⚠️ O clique do dono é a única porta para o bot ALTERAR algo no TaskHS. O que
se tranca: só o dono vê e confirma (404 para os outros); o que executa é o
`payload` GRAVADO quando o bot preparou — nunca um argumento novo; não executa
duas vezes; vencida não executa; erro do sistema fica registrado.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import acoes
from app.dependencies import Usuario
from app.routers import acoes as rota

ERICK = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")
OUTRO = Usuario("u-outro", "x@healthsafetytech.com", "administrador")


def _acao(**k):
    base = {"id": "a1", "user_id": "u-erick", "agent_id": "erick-bot", "sistema": "taskhs",
            "acao": "comentar", "payload": {"list_id": 3, "card_id": 9, "texto": "ok"},
            "resumo": "Comentar no card 9", "status": "pendente", "erro": None, "resultado": None,
            "criado_em": datetime.now(timezone.utc), "email": "ti@healthsafetytech.com"}
    return {**base, **k}


class Conn:
    def __init__(self, a):
        self.a, self.sql = a, []

    async def fetchrow(self, sql, *args):
        self.sql.append(sql)
        if self.a and args[0] == self.a["id"] and args[1] == self.a["user_id"]:
            return self.a
        return None

    async def execute(self, sql, *args):
        self.sql.append(sql)
        for st in ("feita", "cancelada", "vencida", "erro"):
            if f"status = '{st}'" in sql and self.a["status"] == "pendente":
                self.a = {**self.a, "status": st}

    async def __aenter__(self):
        return self

    async def __aexit__(self, tipo, *a):
        # Registra se a transação terminou com exceção (= rollback de verdade).
        self.saiu_com_erro = tipo is not None
        return False


@pytest.fixture
def amb(monkeypatch):
    estado = {"conn": Conn(_acao()), "exec": []}
    monkeypatch.setattr(rota, "sessao", lambda **k: estado["conn"])

    async def executor(email, bot, payload, dono=None):
        estado["exec"].append((email, bot, payload))
        return "comentado"
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), executor)
    return estado


def test_outro_usuario_recebe_404(amb):
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.ver_acao("a1", OUTRO))
    assert e.value.status_code == 404


def test_confirmar_executa_o_payload_gravado(amb):
    r = asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert r["status"] == "feita"
    assert amb["exec"] == [("ti@healthsafetytech.com", "erick-bot", {"list_id": 3, "card_id": 9, "texto": "ok"})]
    assert any("FOR UPDATE" in s for s in amb["conn"].sql)


def test_nao_executa_duas_vezes(amb):
    asyncio.run(rota.confirmar_acao("a1", ERICK))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 409 and len(amb["exec"]) == 1


def test_vencida_nao_executa(amb):
    amb["conn"].a = _acao(criado_em=datetime.now(timezone.utc) - timedelta(hours=25))
    with pytest.raises(HTTPException):
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert amb["exec"] == []


def test_erro_do_sistema_fica_registrado(amb, monkeypatch):
    from app.sistemas.taskhs import ErroSistema

    async def falha(email, bot, payload, dono=None):
        raise ErroSistema(403, "o TaskHS não deixa o agente fazer isso")
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), falha)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 502 and amb["conn"].a["status"] == "erro"


def test_cancelar(amb):
    asyncio.run(rota.cancelar_acao("a1", ERICK))
    assert amb["conn"].a["status"] == "cancelada" and amb["exec"] == []


def test_erro_e_gravado_fora_do_rollback(amb, monkeypatch):
    """O 502 era levantado DENTRO da transação: o rollback desfazia o
    status='erro' e a ação voltava a 'pendente', pronta para rodar de novo.
    Exceção qualquer (não só ErroSistema) também tem que virar 'erro'."""
    async def explode(email, bot, payload, dono=None):
        raise RuntimeError("timeout de rede")
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), explode)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 502
    assert amb["conn"].a["status"] == "erro" and amb["conn"].saiu_com_erro is False


def test_vencida_fica_gravada_mesmo_com_o_409(amb):
    """O 409 era levantado dentro da transação e desfazia o 'vencida'."""
    amb["conn"].a = _acao(criado_em=datetime.now(timezone.utc) - timedelta(hours=25))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 409 and amb["conn"].saiu_com_erro is False


def test_criar_tarefa_poe_o_dono_como_membro(monkeypatch):
    """O card 2534 nasceu sem membro e o bot afirmou "responsável: você". O
    TaskHS não põe quem cria como membro — o executor põe."""
    from app.sistemas import taskhs
    chamadas = []

    async def chamar(email, bot, metodo, caminho, json=None, params=None, dono=None):
        chamadas.append((metodo, caminho))
        if caminho == "/auth/me":
            return {"id": 22}
        if metodo == "POST" and caminho == "/lists/368/cards":
            return {"id": 2534}
        return {}
    monkeypatch.setattr(taskhs, "chamar", chamar)
    r = asyncio.run(acoes.EXECUTORES[("taskhs", "criar")]("ti@x.com", "erick-bot",
                                                           {"list_id": 368, "title": "T"}, dono="u"))
    assert ("POST", "/lists/368/cards/2534/members/22") in chamadas and "membro" in r


def _gravar_chamadas(monkeypatch):
    feitas = []

    async def chamar(email, bot, metodo, caminho, json=None, params=None, dono=None):
        feitas.append((metodo, caminho, json))
        if caminho.endswith("/checklists"):
            return {"id": 5}
        if caminho == "/auth/me":
            return {"id": 1}
        if caminho.endswith("/cards") and metodo == "POST":
            return {"id": 9}
        return {}
    monkeypatch.setattr(acoes.taskhs, "chamar", chamar)
    return feitas


def test_criar_com_checklist_cria_o_checklist_do_taskhs(monkeypatch):
    feitas = _gravar_chamadas(monkeypatch)
    r = asyncio.run(acoes._taskhs_criar("e", "b", {"list_id": 3, "title": "T", "_exibir": {"lista": "X"},
                                                   "checklist": {"title": "Checklist", "items": ["a", "b"]}}))
    assert ("POST", "/lists/3/cards", {"title": "T"}) in feitas      # _exibir não vai ao TaskHS
    assert ("POST", "/lists/3/cards/9/checklists", {"title": "Checklist"}) in feitas
    assert [f[2] for f in feitas if f[1].endswith("/items")] == [{"text": "a"}, {"text": "b"}]
    assert "checklist com 2 itens" in r


def test_mover_chama_o_taskhs(monkeypatch):
    """`int(p["para_list_id"], dono=dono)` levantava TypeError: mover NUNCA funcionou."""
    feitas = _gravar_chamadas(monkeypatch)
    asyncio.run(acoes._taskhs_mover("e", "b", {"list_id": 3, "card_id": 9, "para_list_id": 4}))
    assert feitas == [("PATCH", "/lists/3/cards/9", {"list_id": 4})]


def test_atualizar_marca_item_sem_mexer_no_card(monkeypatch):
    feitas = _gravar_chamadas(monkeypatch)
    asyncio.run(acoes._taskhs_atualizar("e", "b", {"list_id": 3, "card_id": 9, "campos": {},
                "marcar_itens": [{"checklist_id": 5, "item_id": 50, "checked": True}]}))
    assert feitas == [("PATCH", "/lists/3/cards/9/checklists/5/items/50", {"checked": True})]


# --- criar_pendente com hora marcada (aviso de ausência, 26/11/2026) ---------

class _ConnCriar:
    def __init__(self):
        self.chamadas = []

    async def fetchval(self, sql, *args):
        self.chamadas.append((sql, args))
        return "id-1"

    async def execute(self, sql, *args):
        self.chamadas.append((sql, args))


def _insert_da_conversa(conn):
    return next((s, a) for s, a in conn.chamadas if "INSERT INTO public.conversations" in s)


def test_criar_pendente_com_criado_em():
    """O aviso de ausência grava recado + dois cartões numa transação só, e
    dentro dela `now()` é o mesmo para os três: sem hora explícita a conversa
    os ordenaria pelo `id` aleatório e o cartão podia aparecer antes do recado
    que o explica."""
    conn = _ConnCriar()
    quando = datetime(2026, 11, 26, 12, 0, 0, 1000, tzinfo=timezone.utc)
    asyncio.run(acoes.criar_pendente(conn, "u-lid", "lidisay-bot", "talenths",
                                     "talenths_aprovar_ausencia", {"acao": "aprovar_ausencia"},
                                     "Aprovar", criado_em=quando))
    sql, args = _insert_da_conversa(conn)
    assert "created_at" in sql and quando in args


def test_criar_pendente_sem_criado_em_nao_muda():
    """Os chamadores de sempre (o Guardi preparando cartão) seguem com o
    `now()` do banco — nada de hora vinda do Python no caminho antigo."""
    conn = _ConnCriar()
    asyncio.run(acoes.criar_pendente(conn, "u-lid", "lidisay-bot", "talenths",
                                     "talenths_aprovar_ausencia", {"acao": "aprovar_ausencia"},
                                     "Aprovar"))
    sql, args = _insert_da_conversa(conn)
    assert "created_at" not in sql and len(args) == 4


def test_criar_pendente_silencioso_marca_o_cartao():
    """O push lê a marca no `media` do cartão (`cala_push`); sem ela o aviso
    de ausência vibraria três vezes no celular do RH."""
    import json as _json
    conn = _ConnCriar()
    asyncio.run(acoes.criar_pendente(conn, "u-lid", "lidisay-bot", "talenths",
                                     "talenths_aprovar_ausencia", {"acao": "aprovar_ausencia"},
                                     "Aprovar", silencioso=True))
    _sql, args = _insert_da_conversa(conn)
    assert _json.loads(args[3])[0]["silencioso"] is True
    conn = _ConnCriar()
    asyncio.run(acoes.criar_pendente(conn, "u-lid", "lidisay-bot", "talenths",
                                     "talenths_aprovar_ausencia", {"acao": "aprovar_ausencia"}, "Aprovar"))
    _sql, args = _insert_da_conversa(conn)
    assert "silencioso" not in _json.loads(args[3])[0]


# --- cartão em par: Recusar | Aprovar (aviso de ausência, 26/11/2026) --------
#
# O RH recebia dois cartões, cada um com Cancelar/Confirmar — quatro botões para
# uma decisão, e "Cancelar" lido como "recusar". Agora são duas ações ligadas
# por `par_id` num cartão só: escolher uma cancela a outra.

class ConnPar:
    def __init__(self, *linhas):
        self.a = {l["id"]: l for l in linhas}
        self.sql = []

    async def fetchrow(self, sql, *args):
        self.sql.append(sql)
        l = self.a.get(args[0])
        return l if l and l["user_id"] == args[1] else None

    async def fetch(self, sql, *args):
        self.sql.append(sql)
        return [{"id": i} for i in sorted(args[0])]

    async def execute(self, sql, *args):
        self.sql.append(sql)
        l = self.a.get(args[0])
        for st in ("feita", "cancelada", "erro"):
            if f"status = '{st}'" in sql and l and l["status"] == "pendente":
                self.a[args[0]] = {**l, "status": st}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def par(monkeypatch):
    aprovar = _acao(id="a-aprovar", sistema="talenths", acao="talenths_aprovar_ausencia",
                    payload={"acao": "aprovar_ausencia", "ids": ["p1"]}, par_id="a-recusar")
    recusar = _acao(id="a-recusar", sistema="talenths", acao="talenths_recusar_ausencia",
                    payload={"acao": "recusar_ausencia", "ids": ["p1"]}, par_id="a-aprovar")
    estado = {"conn": ConnPar(aprovar, recusar), "exec": []}
    monkeypatch.setattr(rota, "sessao", lambda **k: estado["conn"])
    for nome in ("talenths_aprovar_ausencia", "talenths_recusar_ausencia"):
        async def executor(email, bot, payload, dono=None, _n=nome):
            estado["exec"].append(_n)
            return "feito"
        monkeypatch.setitem(acoes.EXECUTORES, ("talenths", nome), executor)
    return estado


def test_par_confirmar_cancela_a_outra(par):
    """Aprovou: a opção Recusar do mesmo cartão não pode continuar clicável."""
    r = asyncio.run(rota.confirmar_acao("a-recusar", ERICK))
    a = par["conn"].a
    assert r["status"] == "feita" and par["exec"] == ["talenths_recusar_ausencia"]
    assert a["a-recusar"]["status"] == "feita" and a["a-aprovar"]["status"] == "cancelada"


def test_par_outra_ja_escolhida_409(par):
    """Dois cliques (ou duas telas abertas): a segunda escolha não executa —
    o TalentHS aprovaria e recusaria o mesmo pedido."""
    asyncio.run(rota.confirmar_acao("a-aprovar", ERICK))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a-recusar", ERICK))
    assert e.value.status_code == 409 and par["exec"] == ["talenths_aprovar_ausencia"]


def test_par_trava_as_duas_em_ordem(par):
    """As duas linhas travadas juntas e em ordem de id: travar cada uma na
    ordem do clique faria dois cliques simultâneos se esperarem (deadlock)."""
    asyncio.run(rota.confirmar_acao("a-recusar", ERICK))
    trava = [s for s in par["conn"].sql if "ORDER BY id FOR UPDATE" in s]
    assert len(trava) == 1


def test_par_falha_so_a_escolhida_vira_erro(par, monkeypatch):
    """O TalentHS recusou executar: a outra opção segue de pé — a decisão
    ainda não foi tomada."""
    from app.sistemas.taskhs import ErroSistema

    async def falha(email, bot, payload, dono=None):
        raise ErroSistema(502, "TalentHS fora")
    monkeypatch.setitem(acoes.EXECUTORES, ("talenths", "talenths_aprovar_ausencia"), falha)
    with pytest.raises(HTTPException):
        asyncio.run(rota.confirmar_acao("a-aprovar", ERICK))
    a = par["conn"].a
    assert a["a-aprovar"]["status"] == "erro" and a["a-recusar"]["status"] == "pendente"


def test_criar_par_uma_mensagem_com_os_dois(monkeypatch):
    """Duas pendências ligadas uma à outra e UMA mensagem na conversa, com os
    rótulos dos botões no `media` (o cartão não adivinha "Aprovar")."""
    import json as _json
    conn = _ConnCriar()
    ids = iter(["id-a", "id-b", "conv-1"])

    async def fetchval(sql, *args):
        conn.chamadas.append((sql, args))
        return next(ids)
    conn.fetchval = fetchval
    quando = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
    r = asyncio.run(acoes.criar_par(
        conn, "u-lid", "lidisay-bot", "talenths",
        ("talenths_aprovar_ausencia", {"acao": "aprovar_ausencia"}, "Aprovar ausência — Ana", "Aprovar"),
        ("talenths_recusar_ausencia", {"acao": "recusar_ausencia"}, "Recusar ausência — Ana", "Recusar"),
        "TalentHS · Pedido de ausência — Ana", criado_em=quando, silencioso=True))
    assert r == ("id-a", "id-b")
    inserts = [c for c in conn.chamadas if "INSERT INTO public.acoes_pendentes" in c[0]]
    assert len(inserts) == 2
    msgs = [c for c in conn.chamadas if "INSERT INTO public.conversations" in c[0]]
    assert len(msgs) == 1
    media = _json.loads(msgs[0][1][3])
    assert media == [{"type": "acao_aprovacao", "id": "id-a", "name": "TalentHS · Pedido de ausência — Ana",
                      "mimeType": "", "base64": "", "rotulo": "Aprovar",
                      "par": {"id": "id-b", "rotulo": "Recusar"}, "silencioso": True}]
    assert quando in msgs[0][1]
    ligacoes = [c for c in conn.chamadas if "par_id" in c[0]]
    assert ligacoes, "as duas pendências têm que apontar uma para a outra"
