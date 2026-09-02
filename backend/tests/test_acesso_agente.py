"""A regra de quem vê um agente, do lado do Python.

⚠️ **Esta tabela de casos é gêmea da que está em
`backend/migrations/_testes/014_acesso_a_agente.test.sql`.** São a mesma regra
escrita duas vezes: o SQL porque o trigger precisa dela no banco, o Python
porque `GET /agents` filtra uma lista já carregada e perguntar ao banco por
agente seriam N idas e voltas.

Mudou uma, muda a outra — é essa duplicação que faz uma divergência quebrar um
teste em vez de passar despercebida.
"""
from app.routers.agents import _pode_ver

DENTRO = "22222222-2222-2222-2222-222222222222"
FORA = "33333333-3333-3333-3333-333333333333"

RESTRITO = {"access_type": "specific_users", "allowed_user_ids": [DENTRO]}
ABERTO = {"access_type": "all", "allowed_user_ids": None}
SO_ADMIN = {"access_type": "admins_only", "allowed_user_ids": None}
# ⚠️ Duas formas de "sem lista", e as duas acontecem. No banco a coluna é
# `NOT NULL DEFAULT '{}'`, então de lá vem sempre a lista vazia; o `None` vem do
# `.get()` quando a chave nem existe no dicionário. A gêmea SQL usa `'{}'::uuid[]`.
SEM_LISTA_VAZIA = {"access_type": "specific_users", "allowed_user_ids": []}
SEM_LISTA_NULA = {"access_type": "specific_users", "allowed_user_ids": None}
SEM_PERFIL: dict = {}


def test_admin_passa_por_cima_de_specific_users():
    assert _pode_ver(RESTRITO, FORA, is_admin=True)


def test_quem_esta_na_lista_ve():
    assert _pode_ver(RESTRITO, DENTRO, is_admin=False)


def test_quem_esta_fora_da_lista_nao_ve():
    assert not _pode_ver(RESTRITO, FORA, is_admin=False)


def test_all_libera_colaborador():
    assert _pode_ver(ABERTO, FORA, is_admin=False)


def test_admins_only_recusa_colaborador():
    assert not _pode_ver(SO_ADMIN, FORA, is_admin=False)


def test_admins_only_libera_admin():
    assert _pode_ver(SO_ADMIN, FORA, is_admin=True)


def test_specific_users_com_lista_vazia_recusa():
    """É esta a forma que vem do banco: a coluna é NOT NULL DEFAULT '{}'."""
    assert not _pode_ver(SEM_LISTA_VAZIA, FORA, is_admin=False)


def test_specific_users_sem_a_chave_recusa():
    assert not _pode_ver(SEM_LISTA_NULA, FORA, is_admin=False)


def test_agente_sem_perfil_libera():
    """Regra herdada do código do remix: sem perfil no banco, não há restrição."""
    assert _pode_ver(SEM_PERFIL, FORA, is_admin=False)
