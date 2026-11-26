"""Aviso de pedido de ausência no Guardi do RH (spec 2026-11-26).

O anti-objetivo é o pedido que fica dias esperando porque ninguém abriu o
TalentHS — e o seu avesso, o RH recebendo o mesmo aviso duas vezes. A decisão
de quem avisar é pura e testada aqui; a etapa com banco e rede, mais abaixo,
com conexão e TalentHS falsos.
"""
from datetime import datetime, timedelta, timezone

from app import avisos_ausencia as av

AGORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
EMAIL_RH = "adm01@healthsafetytech.com"


def _pedido(**kw):
    base = {"id": "p-1", "user_name": "Ana Souza", "user_email": "ana@x.com",
            "department": "Comercial", "type_name": "Férias",
            "start_date": "2026-12-02", "end_date": "2026-12-06",
            "start_time": None, "end_time": None, "days": 5,
            "reason": "Viagem", "status": "pending"}
    base.update(kw)
    return base


# --- config ------------------------------------------------------------------

def test_config_ausente_e_desligado():
    """Chave ausente ou corrompida tem que DESLIGAR, não estourar: a etapa
    roda a cada 30 s junto dos lembretes, e um `KeyError` aqui viraria um
    traceback no log a cada passada."""
    assert av.config(None) == av.Config(ligado=False, destinatarios=())
    assert av.config("x") == av.Config(ligado=False, destinatarios=())
    c = av.config({"ligado": True, "destinatarios": [1, "u-1", None]})
    assert c == av.Config(ligado=True, destinatarios=("u-1",))


# --- decidir -----------------------------------------------------------------

def test_decidir_novo_e_reaviso():
    """O cartão vence em 24 h. Sem o reaviso, o pedido esquecido some de novo
    — exatamente o problema que o aviso existe para resolver."""
    novo = _pedido(id="p-novo")
    velho = _pedido(id="p-velho")
    recente = _pedido(id="p-recente")
    avisados = {"p-velho": AGORA - timedelta(hours=25), "p-recente": AGORA - timedelta(hours=2)}
    assert av.decidir([novo, velho, recente], avisados, EMAIL_RH, AGORA) == \
        [(novo, False), (velho, True)]


def test_decidir_pula_o_proprio_pedido():
    """A Lidisay pedindo férias não deve receber cartão para aprovar a si
    mesma — a comparação é por e-mail e sem caixa."""
    meu = _pedido(user_email="ADM01@healthsafetytech.com")
    assert av.decidir([meu], {}, EMAIL_RH, AGORA) == []


def test_decidir_pula_nao_pendente():
    """Aprovado entre a leitura e a decisão: avisar seria pedir uma decisão
    que já foi tomada."""
    assert av.decidir([_pedido(status="approved")], {}, EMAIL_RH, AGORA) == []


# --- recado ------------------------------------------------------------------

def test_recado_formato():
    """O recado é o que o RH lê no celular antes de decidir: quem, o quê,
    quando e por quê, numa linha."""
    assert av.texto_recado(_pedido(), False) == (
        "📅 Pedido de ausência — Ana Souza (Comercial): Férias, 02/12 a 06/12 (5 dias). "
        "Motivo: Viagem")
    um_dia = _pedido(start_date="2026-12-03", end_date="2026-12-03", days=1)
    assert "03/12 (1 dia)" in av.texto_recado(um_dia, False)
    horas = _pedido(start_date="2026-12-03", end_date="2026-12-03", days=1,
                    start_time="08:00", end_time="12:00")
    assert "03/12, 08:00–12:00" in av.texto_recado(horas, False)
    assert av.texto_recado(_pedido(), True).startswith("📅 Ainda pendente — Ana Souza")
    assert "Motivo" not in av.texto_recado(_pedido(reason=None), False)
    assert "Motivo" not in av.texto_recado(_pedido(reason="   "), False)


def test_recado_saneia_motivo():
    """O motivo é digitado por qualquer colaborador no TalentHS: quebras de
    linha viram espaço e o tamanho tem teto, senão um texto colado vira uma
    bolha de tela inteira no chat do RH."""
    t = av.texto_recado(_pedido(reason="linha 1\n\nlinha 2\r\n" + "x" * 500), False)
    motivo = t.split("Motivo: ", 1)[1]
    assert "\n" not in t and "\r" not in t
    assert motivo.startswith("linha 1 linha 2 ")
    assert len(motivo) == 300 and motivo.endswith("…")


# --- a etapa (banco e TalentHS falsos) ---------------------------------------

import asyncio  # noqa: E402
import copy  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

import pytest  # noqa: E402

from app.sistemas import talenths  # noqa: E402

DEST = "u-lidisay"
BOT = "lidisay-bot"


class Banco:
    """Estado compartilhado pelos dois "workers". Cada `sessao` é uma
    transação: exceção dentro dela devolve o estado de antes."""

    def __init__(self, ligado=True, sistemas=("talenths",), guardi=True):
        self.config = {"ligado": ligado, "destinatarios": [DEST]}
        self.guardi = ({"agent_id": BOT, "sistemas_ligados": list(sistemas),
                        "email": EMAIL_RH} if guardi else None)
        self.avisos: dict[str, datetime] = {}
        self.conversas: list[dict] = []
        self.acoes: list[dict] = []
        # Corrida: o que este worker LEU antes de o outro gravar ({pedido: hora}).
        self.leitura_velha: dict | None = None

    def _estado(self):
        return copy.deepcopy((self.avisos, self.conversas, self.acoes))

    @asynccontextmanager
    async def sessao(self, role="anon", user_id=None):
        antes = self._estado()
        try:
            yield Conn(self)
        except BaseException:
            self.avisos, self.conversas, self.acoes = antes
            raise


class Conn:
    def __init__(self, b: Banco):
        self.b = b

    async def fetchval(self, sql, *a):
        b = self.b
        if sql == av.SQL_CONFIG:
            return b.config
        if sql == av.SQL_TRAVAR_NOVO:
            if a[1] in b.avisos:
                return None
            b.avisos[a[1]] = a[2]
            return a[1]
        if sql == av.SQL_TRAVAR_REAVISO:
            if b.avisos.get(a[1]) != a[3]:
                return None
            b.avisos[a[1]] = a[2]
            return a[1]
        if "INSERT INTO public.acoes_pendentes" in sql:
            b.acoes.append({"acao": a[3], "payload": a[4]})
            return f"acao-{len(b.acoes)}"
        if "INSERT INTO public.conversations" in sql:
            b.conversas.append({"content": a[2], "created_at": a[-1], "cartao": True})
            return f"conv-{len(b.conversas)}"
        raise AssertionError(sql)

    async def fetchrow(self, sql, *a):
        assert sql == av.SQL_GUARDI
        return self.b.guardi

    async def fetch(self, sql, *a):
        assert sql == av.SQL_AVISADOS
        if self.b.leitura_velha is not None:
            return [{"pedido_id": k, "ultimo_aviso_em": v} for k, v in self.b.leitura_velha.items()]
        return [{"pedido_id": k, "ultimo_aviso_em": v} for k, v in self.b.avisos.items() if k in a[1]]

    async def execute(self, sql, *a):
        if sql == av.SQL_RECADO:
            self.b.conversas.append({"content": a[2], "created_at": a[3], "cartao": False})
        elif "UPDATE public.acoes_pendentes" in sql:
            pass
        else:
            raise AssertionError(sql)


@pytest.fixture(autouse=True)
def _ritmo_limpo():
    av._ultima_leitura.clear()
    av._avisou.clear()


def _ler(pedidos):
    async def ler(email, bot, dono):
        assert (email, bot, dono) == (EMAIL_RH, BOT, DEST)
        return pedidos
    return ler


async def _preparar(ctx, bot, args):
    return ({"acao": args["acao"], "ids": args["ids"]}, f"TalentHS · {args['acao']}", None)


class _Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _rodar(banco, pedidos, agora=AGORA, preparar=_preparar, relogio=None):
    return asyncio.run(av.etapa_avisos(banco.sessao, agora, ler=_ler(pedidos), preparar=preparar,
                                       relogio=relogio or _Relogio()))


def test_aviso_grava_recado_e_dois_cartoes():
    """O pedido vira o que a Lidisay pediu: um recado que explica e os dois
    botões. Os cartões são as ações de sempre do Guardi — o clique executa no
    TalentHS como ela, pelo executor que já confere `pending` de novo."""
    b = Banco()
    assert _rodar(b, [_pedido()]) == 1
    assert [a["acao"] for a in b.acoes] == ["talenths_aprovar_ausencia", "talenths_recusar_ausencia"]
    assert all('"p-1"' in a["payload"] for a in b.acoes)
    assert b.conversas[0]["content"].startswith("📅 Pedido de ausência — Ana Souza")
    assert list(b.avisos) == ["p-1"]


def test_recado_vem_antes_dos_cartoes():
    """Na mesma transação `now()` é um só: sem hora explícita a conversa
    ordenaria as três mensagens pelo id aleatório."""
    b = Banco()
    _rodar(b, [_pedido()])
    horas = [c["created_at"] for c in b.conversas]
    assert [c["cartao"] for c in b.conversas] == [False, True, True]
    assert horas == sorted(horas) and len(set(horas)) == 3


def test_dois_workers_um_aviso():
    """São dois workers rodando a mesma passada, e os dois podem LER antes de
    qualquer um gravar. Quem segura é a chave primária no INSERT: o segundo não
    recebe linha e não grava nada — senão a Lidisay recebe tudo em dobro."""
    b = Banco()
    _rodar(b, [_pedido()])
    av._ultima_leitura.clear()  # o "outro worker" tem o próprio relógio
    b.leitura_velha = {}        # ...e leu antes do primeiro gravar
    assert _rodar(b, [_pedido()]) == 0
    assert len(b.conversas) == 3 and len(b.acoes) == 2


def test_talenths_fora_nao_marca_avisado():
    """TalentHS fora não pode deixar linha de "avisado": o pedido nunca mais
    seria avisado quando ele voltasse."""
    b = Banco()

    async def caiu(email, bot, dono):
        raise talenths.ErroSistema(503, "fora")
    assert asyncio.run(av.etapa_avisos(b.sessao, AGORA, ler=caiu, preparar=_preparar,
                                       relogio=_Relogio())) == 0
    assert b.avisos == {} and b.conversas == []


def test_preparo_recusa_nao_grava_nada():
    """Aprovado no TalentHS entre a leitura e o preparo: nada de recado órfão
    nem trava — e o próximo da lista segue."""
    b = Banco()

    async def recusa_o_primeiro(ctx, bot, args):
        if args["ids"] == ["p-1"]:
            raise ValueError("já não está pendente")
        return await _preparar(ctx, bot, args)
    assert _rodar(b, [_pedido(), _pedido(id="p-2")], preparar=recusa_o_primeiro) == 1
    assert list(b.avisos) == ["p-2"] and len(b.conversas) == 3


def test_falha_no_meio_desfaz_a_transacao():
    """Cartão que falha ao gravar depois da trava: a transação desfaz a trava
    junto, e o pedido volta a ser avisado na próxima leitura."""
    b = Banco()

    async def payload_quebrado(ctx, bot, args):
        if args["acao"] == "recusar_ausencia":
            return ({"x": object()}, "quebra", None)  # json.dumps estoura no criar_pendente
        return await _preparar(ctx, bot, args)
    assert _rodar(b, [_pedido()], preparar=payload_quebrado) == 0
    assert b.avisos == {} and b.conversas == [] and b.acoes == []


def test_desligado_nao_le():
    """Desligado tem que parar de verdade — nem bater no TalentHS."""
    b = Banco(ligado=False)

    async def nao_pode(*a):
        raise AssertionError("leu desligado")
    assert asyncio.run(av.etapa_avisos(b.sessao, AGORA, ler=nao_pode, preparar=_preparar)) == 0


def test_ritmo_120s():
    """A passada roda a cada 30 s; ler o TalentHS nesse ritmo seria 2.880
    chamadas por dia para quase nenhum pedido."""
    b, rel, leituras = Banco(), _Relogio(), []

    async def ler(email, bot, dono):
        leituras.append(rel.t)
        return []
    for t in (1000.0, 1060.0, 1121.0):
        rel.t = t
        asyncio.run(av.etapa_avisos(b.sessao, AGORA, ler=ler, preparar=_preparar, relogio=rel))
    assert leituras == [1000.0, 1121.0]


def test_destinatario_sem_talenths_pula():
    """Guardi sem o TalentHS ligado não tem token que veja os pedidos: pula
    em vez de errar a cada passada."""
    b = Banco(sistemas=("taskhs",))

    async def nao_pode(*a):
        raise AssertionError("leu sem talenths")
    assert asyncio.run(av.etapa_avisos(b.sessao, AGORA, ler=nao_pode, preparar=_preparar)) == 0
    assert asyncio.run(av.etapa_avisos(Banco(guardi=False).sessao, AGORA, ler=nao_pode,
                                       preparar=_preparar)) == 0


def test_reaviso_24h_usa_compare_and_set():
    """Cartão vencido e pedido ainda pendente: aviso novo, uma vez — o
    segundo worker vê o `ultimo_aviso_em` já mudado e não repete."""
    b = Banco()
    velho = AGORA - timedelta(hours=25)
    b.avisos["p-1"] = velho
    assert _rodar(b, [_pedido()]) == 1
    assert b.conversas[0]["content"].startswith("📅 Ainda pendente — ")
    assert b.avisos["p-1"] == AGORA
    av._ultima_leitura.clear()
    b.leitura_velha = {"p-1": velho}  # o outro leu antes: viu 25 h e tenta reavisar
    assert _rodar(b, [_pedido()]) == 0


def test_sql_do_reaviso_compara_o_que_foi_lido():
    """O banco falso acima simula o compare-and-set; quem o faz de verdade é
    esta condição no UPDATE. Sem ela, dois workers reavisam juntos."""
    assert "AND ultimo_aviso_em = $4" in av.SQL_TRAVAR_REAVISO
    assert "ON CONFLICT DO NOTHING RETURNING" in av.SQL_TRAVAR_NOVO


def test_passada_chama_avisos_ausencia(monkeypatch):
    """A etapa só existe se a `passada` a chamar — e exceção dela não pode
    subir: o `rodar` trata `UndefinedTableError` parando TUDO por 60 s, e
    código no ar antes da 044 pararia os lembretes junto."""
    import asyncpg

    from app import disparador_lembretes as d
    from app.varredura import disparo as varredura_disparo

    async def nada(*a, **k):
        return 0
    monkeypatch.setattr(varredura_disparo, "etapa_varredura", nada)

    class _C:
        async def fetch(self, sql, *a):
            return []

    @asynccontextmanager
    async def sessao(role="anon", user_id=None):
        yield _C()

    chamadas = []

    async def etapa(sessao_fn, agora):
        chamadas.append(agora)
        return 2
    monkeypatch.setattr(av, "etapa_avisos", etapa)
    assert asyncio.run(d.passada(sessao, AGORA)) == 2 and chamadas == [AGORA]

    async def sem_tabela(sessao_fn, agora):
        raise asyncpg.UndefinedTableError("avisos_ausencia")
    monkeypatch.setattr(av, "etapa_avisos", sem_tabela)
    assert asyncio.run(d.passada(sessao, AGORA)) == 0

    async def quebra(sessao_fn, agora):
        raise RuntimeError("qualquer")
    monkeypatch.setattr(av, "etapa_avisos", quebra)
    assert asyncio.run(d.passada(sessao, AGORA)) == 0
