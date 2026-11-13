"""Token de ação do push de lembrete (spec 2026-11-13, "Camada 1").

Os botões "Adiar 10 min" e "Feito" da notificação chamam uma rota SEM login: o
service worker não tem a sessão. O token que viaja no payload do push é a
autorização inteira dessa rota. Se ele servisse para outro lembrete, outro
aviso ou outra ação, qualquer notificação velha na bandeja — ou um payload
copiado — mexeria no lembrete de outra pessoa ou desfaria o que a pessoa
decidiu. É o anti-objetivo "token de ação que serve para outra coisa".
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.agenda import token_acao as t

SEGREDO = "s" * 64
LID = "22222222-2222-2222-2222-222222222222"
OUTRO = "33333333-3333-3333-3333-333333333333"
AVISO = datetime(2026, 11, 13, 17, 0, 27, 123456, tzinfo=timezone.utc)
AGORA = AVISO + timedelta(seconds=2)


def test_ida_e_volta_devolve_o_escopo_exato():
    """O microssegundo do `aviso_em` sobrevive: é com igualdade exata que a rota
    acha o aviso no banco. Perder precisão faria todo clique virar "inócuo"."""
    tok = t.emitir(SEGREDO, LID, AVISO, "adiar", AGORA)
    assert t.conferir(SEGREDO, tok, AGORA) == (LID, AVISO, "adiar")
    # aviso em outro fuso é o mesmo instante
    local = AVISO.astimezone(timezone(timedelta(hours=-3)))
    assert t.conferir(SEGREDO, t.emitir(SEGREDO, LID, local, "feito", AGORA), AGORA)[1] == AVISO


def test_vale_24h_e_nao_mais():
    """Notificação esquecida na bandeja por dias não pode adiar um lembrete hoje."""
    tok = t.emitir(SEGREDO, LID, AVISO, "feito", AGORA)
    assert t.conferir(SEGREDO, tok, AGORA + timedelta(hours=23, minutes=59))
    with pytest.raises(t.TokenInvalido):
        t.conferir(SEGREDO, tok, AGORA + timedelta(hours=24, seconds=1))


def _trocar_carga(tok: str, **mudar) -> str:
    """Reescreve a carga mantendo a assinatura original — o que um atacante faria."""
    import base64
    import json
    corpo, assinatura = tok.split(".")
    carga = json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4)))
    carga.update(mudar)
    novo = base64.urlsafe_b64encode(json.dumps(carga).encode()).rstrip(b"=").decode()
    return f"{novo}.{assinatura}"


def test_nao_serve_para_outro_lembrete_outro_aviso_nem_outra_acao():
    """Cada campo do escopo está dentro do HMAC: trocar qualquer um invalida."""
    tok = t.emitir(SEGREDO, LID, AVISO, "adiar", AGORA)
    for mudar in ({"l": OUTRO},
                  {"a": (AVISO + timedelta(minutes=5)).isoformat()},
                  {"x": "feito"},
                  {"e": int((AGORA + timedelta(days=30)).timestamp())}):
        with pytest.raises(t.TokenInvalido):
            t.conferir(SEGREDO, _trocar_carga(tok, **mudar), AGORA)


def test_segredo_errado_ou_ausente_recusa():
    tok = t.emitir(SEGREDO, LID, AVISO, "feito", AGORA)
    for segredo in ("outro-segredo", ""):
        with pytest.raises(t.TokenInvalido):
            t.conferir(segredo, tok, AGORA)
    with pytest.raises(ValueError):
        t.emitir("", LID, AVISO, "feito", AGORA)


def test_lixo_e_acao_desconhecida_recusam():
    for lixo in ("", "abc", "a.b.c", None, "x" * 2000, ".", "e30.e30"):
        with pytest.raises(t.TokenInvalido):
            t.conferir(SEGREDO, lixo, AGORA)
    with pytest.raises(ValueError):
        t.emitir(SEGREDO, LID, AVISO, "apagar", AGORA)


def test_tokens_das_duas_acoes_sao_diferentes():
    """O botão "Adiar" não pode carregar um token que também marca "Feito"."""
    a = t.emitir(SEGREDO, LID, AVISO, "adiar", AGORA)
    f = t.emitir(SEGREDO, LID, AVISO, "feito", AGORA)
    assert a != f
    assert t.conferir(SEGREDO, a, AGORA)[2] == "adiar"
    assert t.conferir(SEGREDO, f, AGORA)[2] == "feito"
