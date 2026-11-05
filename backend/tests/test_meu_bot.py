"""Cada pessoa personaliza o próprio bot: nome de exibição e foto.

⚠️ Só o NOME DE EXIBIÇÃO muda: o `agent_id` (`gustavo-bot`) é chave de sessão,
workspace e permissões. O nome é campo do usuário que entra no prompt do bot:
saneado e curto. A foto só pode apontar para o avatar do PRÓPRIO bot.
"""
import pytest

from app.routers import meu_bot as m


def test_so_o_prefixo_e_editavel():
    """O sufixo é da empresa (hoje "-bot"; amanhã talvez "-Safi"/"-Guardi"): a
    pessoa escolhe só o que vem antes."""
    from app.bots_pessoais import SUFIXO_EXIBICAO
    assert m.validar_prefixo("  Gugu ") == "Gugu"
    assert m.nome_com_sufixo("Gugu") == "Gugu" + SUFIXO_EXIBICAO
    for ruim in ("", "a", "x" * 21, "Gugu\n## Limites", "<script>", "Gugu-bot", "Gugu-Safi"):
        with pytest.raises(ValueError):
            m.validar_prefixo(ruim)


def test_prefixo_do_nome_atual():
    assert m.prefixo_de("Gugu-bot", "-bot") == "Gugu"
    assert m.prefixo_de("Erick-bot", "-Safi") == "Erick"   # troca de sufixo: tira o antigo
    assert m.prefixo_de("Erick", "-bot") == "Erick"


def test_avatar_so_do_proprio_bot():
    assert m.validar_avatar("/storage/agent-files/avatars/gustavo-bot.png", "gustavo-bot")
    assert m.validar_avatar("https://hsosapi.healthsafetytech.com/storage/agent-files/avatars/gustavo-bot.gif", "gustavo-bot")
    assert not m.validar_avatar("https://evil.com/storage/agent-files/avatars/gustavo-bot.png", "gustavo-bot")
    assert not m.validar_avatar("/storage/agent-files/avatars/erick-bot.png", "gustavo-bot")
    assert not m.validar_avatar("https://evil.com/x.png", "gustavo-bot")
    assert not m.validar_avatar("/storage/agent-files/avatars/gustavo-bot.png/../x", "gustavo-bot")


def test_arquivos_com_nome_novo():
    from app.bots_pessoais import arquivos_do_bot
    a = arquivos_do_bot({"full_name": "Gustavo Oliveira", "email": "q@x.com"}, nome_bot="Gugu-bot")
    assert "Gugu-bot" in a["IDENTITY.md"] and "Gugu-bot" in a["SOUL.md"] and "Gustavo-bot" not in a["SOUL.md"]
