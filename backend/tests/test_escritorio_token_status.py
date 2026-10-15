"""Token da sala do escritório e o status do HS.OS traduzido para o WA.

O `userRoomToken` que a `room/access` devolve chega ao script do mapa
(`WA.player.userRoomToken`), que o manda em query string para
`/escritorio/meu-status`. Ele é um passe de **uma** coisa — ler o próprio
status — e por isso tem `aud: "escritorio-sala"`.

⚠️ **As duas pontas têm que se recusar.** É o mesmo cuidado do ticket de
upload (`aud: "hsos-upload"`): sem a audiência, o token da sala — que aparece em
log de acesso, por ir na query string — passaria pelo `ler_token` do login e
abriria a API inteira com a identidade da pessoa por 12 horas. E o token de
login, aceito pelo `ler_token_sala`, seria inofensivo mas confuso. Os dois
testes de recusa trancam isso.
"""
import time

import jwt
import pytest

from app.auth.security import emitir_token, ler_token
from app.escritorio.status_wa import status_wa
from app.escritorio.token_sala import emitir_token_sala, ler_token_sala


def test_token_da_sala_ida_e_volta():
    assert ler_token_sala(emitir_token_sala("a@hs.com")) == "a@hs.com"


def test_token_da_sala_vence_em_12_horas():
    treze_horas_atras = int(time.time()) - 13 * 3600
    token = emitir_token_sala("a@hs.com", agora=treze_horas_atras)
    with pytest.raises(jwt.ExpiredSignatureError):
        ler_token_sala(token)


def test_token_de_login_nao_serve_de_token_da_sala():
    token, _ = emitir_token("uuid-1", "colaborador", "a@hs.com")
    with pytest.raises(jwt.PyJWTError):
        ler_token_sala(token)


def test_token_da_sala_nao_serve_de_token_de_login():
    """O token da sala vai em query string e aparece em log: não pode abrir a API."""
    with pytest.raises(jwt.InvalidAudienceError):
        ler_token(emitir_token_sala("a@hs.com"))


def test_token_assinado_com_outro_segredo_e_recusado():
    falso = jwt.encode(
        {"sub": "a@hs.com", "aud": "escritorio-sala", "exp": int(time.time()) + 60},
        "outro-segredo",
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        ler_token_sala(falso)


@pytest.mark.parametrize(
    "label, esperado",
    [
        ("Em reunião", "BUSY"),
        ("Foco / DND", "DO_NOT_DISTURB"),
        ("Almoço", "BACK_IN_A_MOMENT"),
        ("Ausente", "BACK_IN_A_MOMENT"),
        ("Home office", "ONLINE"),
        ("Férias / Folga", "ONLINE"),
        (None, "ONLINE"),
        ("", "ONLINE"),
    ],
)
def test_status_do_hsos_vira_status_do_wa(label, esperado):
    assert status_wa(label) == esperado
