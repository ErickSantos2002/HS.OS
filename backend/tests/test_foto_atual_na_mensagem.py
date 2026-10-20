"""A mensagem mostra a foto ATUAL de quem escreveu.

Até 20/10/2026 voltava o `author_avatar` gravado no envio: quem trocava a foto
seguia com a antiga — ou com a letra — em tudo que já tinha escrito. As
colunas são reaproveitadas num RETURNING com `.replace('m.', '')`, então a
expressão tem que sobreviver às duas formas.
"""
from app.routers.channels import _COLUNAS_MSG


def test_a_foto_vem_do_perfil_com_a_gravada_de_recuo():
    sql = " ".join(_COLUNAS_MSG.split())
    assert "COALESCE((SELECT pf.avatar_url FROM public.profiles pf" in sql
    assert "m.author_avatar) AS author_avatar" in sql


def test_so_pessoa_tem_perfil():
    # Agente não tem linha em `profiles`; sem o filtro, um id de agente que
    # colidisse com um uuid de pessoa pegaria a foto dela.
    assert "m.author_type::text = 'human'" in _COLUNAS_MSG


def test_a_forma_do_returning_nao_sobra_alias():
    returning = _COLUNAS_MSG.replace("m.", "")
    assert "m." not in returning
    assert "pf.avatar_url" in returning and "pf.id::text = author_id" in returning
