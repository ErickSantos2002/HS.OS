"""Regras puras da Admin API do WorkAdventure (`app/escritorio/wa.py`).

Com `ADMIN_API_URL` no `play`, o WA para de decidir sozinho quem entra, quem
edita e para onde a raiz redireciona: pergunta a nós. Cada resposta daqui é
validada por um schema zod do lado de lá (`isFetchMemberDataByUuidResponse`,
`isMapDetailsData`, `ErrorApiData`), e resposta fora do formato vira a tela
"Invalid server response" para **todo mundo** — o escritório inteiro fora do ar
por uma chave a mais ou a menos. Por isso os testes conferem chave por chave.

⚠️ **`username: null` apaga o nome que veio do Entra.** O schema aceita
`nullable().optional()`, e o null é tratado como "a admin mandou apagar". A
chave tem que ser omitida, e é o teste mais importante deste arquivo.
"""
import json
from pathlib import Path

import pytest

from app.escritorio import wa

MS = "https://e.com/map-storage"
SALA = "/~/hs/hs.wam"


def _um_id_real() -> tuple[str, str]:
    dados = json.loads((Path(wa.__file__).parent / "wokas.json").read_text())
    textura = dados["woka"]["collections"][0]["textures"][0]
    return textura["id"], textura["url"]


# --- normalizar_email ---------------------------------------------------------

def test_normaliza_email_com_espaco_e_maiuscula():
    assert wa.normalizar_email(" Fulano@HS.com ") == "fulano@hs.com"


def test_email_vazio_ou_sem_arroba_vira_none_sem_excecao():
    """O WA manda `userIdentifier` = `sub` quando o Entra não traz e-mail: não é e-mail."""
    assert wa.normalizar_email(None) is None
    assert wa.normalizar_email("") is None
    assert wa.normalizar_email("semarroba") is None


# --- dominio_permitido ---------------------------------------------------------

def test_dominio_da_empresa_entra():
    assert wa.dominio_permitido("a@healthsafetytech.com", ["healthsafetytech.com"])


def test_dominio_de_fora_nao_entra():
    """É isto que fecha a porta aos convidados B2B que hoje entram."""
    assert not wa.dominio_permitido("a@gmail.com", ["healthsafetytech.com"])


def test_subdominio_nao_conta_como_o_dominio():
    assert not wa.dominio_permitido("a@x.healthsafetytech.com", ["healthsafetytech.com"])


def test_dominio_comparado_sem_diferenciar_maiusculas():
    assert wa.dominio_permitido("a@HealthSafetyTech.com", ["healthsafetytech.com"])
    assert wa.dominio_permitido("a@healthsafetytech.com", ["HealthSafetyTech.com"])


def test_dominio_com_email_sem_arroba_e_recusa_sem_excecao():
    assert not wa.dominio_permitido("semarroba", ["healthsafetytech.com"])


# --- lista_de_config ---------------------------------------------------------------

def test_lista_de_config_limpa_espacos_vazios_e_maiusculas():
    assert wa.lista_de_config("a, B ,,") == ["a", "b"]
    assert wa.lista_de_config(None) == []
    assert wa.lista_de_config("") == []


# --- detalhes_do_mapa ---------------------------------------------------------------

def test_raiz_redireciona_para_a_sala_inicial():
    """Com a Admin API ligada, o `START_ROOM_URL` do WA para de valer: a raiz é nossa."""
    assert wa.detalhes_do_mapa("https://e.com/", MS, SALA) == {
        "redirectUrl": "https://e.com/~/hs/hs.wam"
    }


def test_tmj_redireciona_para_wam():
    assert wa.detalhes_do_mapa("https://e.com/~/hs/hs.tmj", MS, SALA) == {
        "redirectUrl": "https://e.com/~/hs/hs.wam"
    }


def test_wam_monta_a_url_do_map_storage():
    r = wa.detalhes_do_mapa("https://e.com/~/hs/hs.wam", MS, SALA)
    assert r["wamUrl"] == "https://e.com/map-storage/hs/hs.wam"
    # `group` é `z.string().nullable()` SEM optional: omitir reprova o schema.
    assert "group" in r and r["group"] is None
    assert r["authenticationMandatory"] is True
    assert r["opidWokaNamePolicy"] == "force_opid"
    assert "mapUrl" not in r or r["mapUrl"] is None


def test_mapa_de_host_externo_e_recusado():
    """O `LocalAdmin` aceita `/_/<host>/<caminho>` e monta `mapUrl` no host que vier
    na URL: qualquer link poria a pessoa num mapa de terceiro, com scripts dele
    rodando dentro do escritório. Aqui só há mapa do nosso map-storage."""
    r = wa.detalhes_do_mapa("https://e.com/_/global/exemplo.com/mapa.tmj", MS, SALA)
    assert r["status"] == "error"
    assert r["code"] == "UNSUPPORTED_URL_FORMAT"
    assert "mapUrl" not in r


@pytest.mark.parametrize(
    "caminho",
    [
        "/~/../segredo.wam",
        "/~/hs/../../x.wam",
        "/~/hs//hs.wam",
        "/~/%2e%2e/x.wam",
        "/~/%2E%2E/x.wam",
        "/~/hs/%2e/x.wam",
        "/~/hs\\..\\x.wam",
        "/~/",
    ],
)
def test_caminho_que_escapa_do_map_storage_e_recusado(caminho):
    """Sem isto, `..` ou o equivalente codificado montaria um `wamUrl` fora da pasta
    dos mapas — e é o `back` do WA que o busca, de dentro da rede."""
    r = wa.detalhes_do_mapa("https://e.com" + caminho, MS, SALA)
    assert r.get("code") == "UNSUPPORTED_URL_FORMAT"
    assert "wamUrl" not in r


def test_caminho_desconhecido_e_erro_de_formato():
    r = wa.detalhes_do_mapa("https://e.com/qualquer", MS, SALA)
    assert r["status"] == "error"
    assert r["type"] == "error"
    assert r["code"] == "UNSUPPORTED_URL_FORMAT"
    for campo in ("title", "subtitle", "details"):
        assert isinstance(r[campo], str)


# --- resolver_texturas ---------------------------------------------------------------

def test_sem_textura_e_valido_e_vazio():
    assert wa.resolver_texturas([]) == (True, [])


def test_textura_real_resolve_com_url():
    ident, url = _um_id_real()
    assert wa.resolver_texturas([ident]) == (True, [{"id": ident, "url": url}])


def test_textura_inventada_invalida_o_conjunto():
    """Como no `LocalWokaService`: um id desconhecido manda a pessoa escolher o woka de novo."""
    ident, _ = _um_id_real()
    valido, _lista = wa.resolver_texturas([ident, "nao-existe-xyz"])
    assert valido is False


# --- respostas ------------------------------------------------------------------------

def _acesso(editor: bool) -> dict:
    return wa.resposta_de_acesso(
        "a@hs.com", editor=editor, texturas=(True, []), token_sala="tok"
    )


def test_acesso_nao_traz_username():
    """`username: null` apaga o nome do Entra. A chave não pode existir."""
    assert "username" not in _acesso(False)


def test_acesso_de_quem_nao_edita():
    r = _acesso(False)
    assert r["status"] == "ok"
    assert r["userUuid"] == r["email"] == "a@hs.com"
    assert r["tags"] == []
    assert r["canEdit"] is False
    assert r["world"] == "localWorld"
    assert "visitCardUrl" in r and r["visitCardUrl"] is None
    assert r["messages"] == []
    assert r["userRoomToken"] == "tok"
    assert r["isCharacterTexturesValid"] is True
    assert r["characterTextures"] == []
    assert r["isCompanionTextureValid"] is True
    assert r["activatedInviteUser"] is True
    assert r["canRecord"] is False


def test_acesso_de_editor():
    r = _acesso(True)
    assert r["canEdit"] is True
    assert r["tags"] == ["admin", "editor"]


def test_recusa_no_formato_unauthorized():
    r = wa.recusa("FORA_DA_EMPRESA", "Acesso negado", "Só da HS", "Entre com a conta da empresa.")
    assert r == {
        "status": "error",
        "type": "unauthorized",
        "code": "FORA_DA_EMPRESA",
        "title": "Acesso negado",
        "subtitle": "Só da HS",
        "details": "Entre com a conta da empresa.",
        "buttonTitle": "Sair",
    }


def test_espera_no_formato_retry():
    r = wa.espera("BANCO_FORA", "Um instante", "Sub", "Det")
    assert r["status"] == "error"
    assert r["type"] == "retry"
    assert r["timeToRetry"] == 10000
    assert r["canRetryManual"] is True
    assert r["code"] == "BANCO_FORA"
    assert {"title", "subtitle", "details"} <= set(r)


def test_recusa_e_espera_tem_texto_no_botao():
    """A tela de erro do WA desenha o botão mesmo sem `buttonTitle` — saía um botão
    em branco, e quem é recusado não sabia que ele fazia logout."""
    assert wa.recusa("X", "t", "s", "d")["buttonTitle"] == "Sair"
    assert wa.espera("X", "t", "s", "d")["buttonTitle"] == "Tentar agora"


def test_mapa_desliga_chat_matrix():
    """Sem a chave, o front assume `enableMatrixChat ?? true` (com OpenID ligado) e
    mostra botões de mensagem que não funcionam — não temos Matrix."""
    r = wa.detalhes_do_mapa("https://e.com/~/hs/hs.wam", MS, SALA)
    assert r["enableMatrixChat"] is False


def test_mapas_do_mundo():
    lista = wa.mapas_do_mundo(MS)
    assert [m["roomUrl"] for m in lista] == ["/~/hs/hs.wam", "/~/office.wam"]
    assert lista[1]["wamUrl"] == "https://e.com/map-storage/office.wam"
