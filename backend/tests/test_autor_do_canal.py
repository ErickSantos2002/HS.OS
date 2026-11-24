"""Quem assina mensagem de canal é o token, não o corpo (PK-48, 24/11/2026).

⚠️ **O que custaria:** o `POST /channels/{id}/messages` aceitava
`author_type="agent"` de qualquer pessoa, com `author_id` e `author_name`
livres — um colaborador postava no canal **como a `nina`**. E em mensagem
humana o `author_name` do corpo valia: escrever como "Nicholson" fazia o agente
do canal, que lê esse nome como autor (`_montar_pedido`), tratar o pedido como
vindo do CEO. É o DB-06 da auditoria do DN.OS ("postar como outro") numa forma
mais fraca, conferido em 23/11.

O front nunca mandou `agent` nem nome alheio — o buraco era só pela API. Por
isso a regra pode ser dura: mensagem de agente só nasce em
`_publicar_do_agente`, com `service_role`, e nome de pessoa sai do perfil.
"""
import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers.channels import MensagemCanalIn, autor_da_mensagem, nome_de_quem_envia

EU = Usuario(id="11111111-1111-1111-1111-111111111111", email="ana@hs.com", papel="colaborador")
PERFIL = {"full_name": "Ana Souza", "avatar_url": "https://exemplo/ana.png"}


def test_pessoa_nao_posta_como_agente():
    with pytest.raises(HTTPException) as e:
        autor_da_mensagem(MensagemCanalIn(content="oi", author_type="agent",
                                          author_id="nina", author_name="Nina"), EU, PERFIL)
    assert e.value.status_code == 403


def test_pessoa_nao_posta_com_o_id_de_outra():
    with pytest.raises(HTTPException) as e:
        autor_da_mensagem(MensagemCanalIn(content="oi", author_id="22222222-2222-2222-2222-222222222222"),
                          EU, PERFIL)
    assert e.value.status_code == 403


def test_o_nome_do_corpo_nao_vale_o_do_perfil_sim():
    tipo, autor, nome, avatar = autor_da_mensagem(
        MensagemCanalIn(content="aprovado", author_name="Nicholson", author_avatar="https://x/ceo.png"),
        EU, PERFIL)
    assert (tipo, autor, nome, avatar) == ("human", EU.id, "Ana Souza", "https://exemplo/ana.png")


def test_tipo_invalido_continua_400():
    with pytest.raises(HTTPException) as e:
        autor_da_mensagem(MensagemCanalIn(content="oi", author_type="sistema"), EU, PERFIL)
    assert e.value.status_code == 400


def test_perfil_sem_nome_cai_no_email_nunca_no_corpo():
    assert nome_de_quem_envia({"full_name": "", "avatar_url": None}, EU) == "ana@hs.com"
    assert nome_de_quem_envia(None, EU) == "ana@hs.com"
    assert nome_de_quem_envia(PERFIL, EU) == "Ana Souza"
