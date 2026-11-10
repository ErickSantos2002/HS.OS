"""Conversa consigo mesmo (10/11/2026) — as guardas do backend.

A conversa pessoal é do tipo `pessoal`, uma por pessoa, e só a dona lê. Quem
a cria é a função `minha_conversa_pessoal()` do banco (035); estes testes
trancam as portas do lado do Python, cada uma das quais abriria a anotação
de alguém para outra pessoa ou para um agente.
"""
import pytest
from fastapi import HTTPException

from app.routers import broadcast, channels, conversations


def test_pessoal_nao_se_cria_por_post():
    """`POST /channels` aceitando `pessoal` criaria uma segunda conversa pessoal
    fora da função — sem a membresia certa e furando o "uma por pessoa"."""
    assert "pessoal" not in channels._TIPOS


def test_dm_e_pessoal_nao_mexem_em_membros():
    """Pôr alguém na conversa pessoal de outra pessoa é ler as anotações dela.
    A guarda que já existia para DM ("duas pessoas por construção") vale igual."""
    assert channels.TIPOS_SEM_MEMBROS == {"dm", "pessoal"}


def test_dm_consigo_mesmo_recusada():
    """O `find_or_create_dm` casa `cm1` e `cm2` na MESMA linha quando o alvo é
    quem chama, e devolveria uma DM qualquer da pessoa — a conversa com outra
    pessoa abrindo no lugar do "bloco de notas". A tela não oferece; a API
    aceitava."""
    with pytest.raises(HTTPException) as erro:
        conversations.conferir_alvo_da_dm("u1", "u1")
    assert erro.value.status_code == 400
    conversations.conferir_alvo_da_dm("u2", "u1")


def test_broadcast_nao_alcanca_conversa_pessoal():
    """A API de broadcast roda como `service_role` e acha canal por
    `name ILIKE`. Toda conversa pessoal se chama "Anotações": sem o filtro, um
    agente com o segredo lia (e escrevia) na de qualquer pessoa pelo nome."""
    assert "type <> 'pessoal'" in broadcast.SQL_CANAL_POR_NOME
