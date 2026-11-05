"""Cada pessoa personaliza o próprio bot: nome de exibição e foto.

⚠️ Só o NOME DE EXIBIÇÃO muda: o `agent_id` (`gustavo-bot`) é chave de sessão,
workspace e permissões. O nome é campo do usuário que entra no prompt do bot:
saneado e curto. A foto só pode apontar para o avatar do PRÓPRIO bot.
"""
import pytest

from app.routers import meu_bot as m


def test_nome_valido():
    assert m.validar_nome("  Gugu-bot ") == "Gugu-bot"
    for ruim in ("", "a", "x" * 31, "Gugu\n## Limites", "<script>"):
        with pytest.raises(ValueError):
            m.validar_nome(ruim)


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
