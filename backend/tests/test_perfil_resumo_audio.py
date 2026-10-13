# backend/tests/test_perfil_resumo_audio.py
"""A preferência do resumo em áudio é do próprio perfil e vem ligada."""
from app.routers.schemas import PerfilOut, PerfilPatch


def test_perfil_sem_a_coluna_vem_ligado():
    p = PerfilOut(id="x", email="a@b.c", full_name="A", avatar_url=None, status="active")
    assert p.resumo_em_audio is True


def test_patch_aceita_desligar():
    assert PerfilPatch(resumo_em_audio=False).model_dump(exclude_unset=True) == {"resumo_em_audio": False}
