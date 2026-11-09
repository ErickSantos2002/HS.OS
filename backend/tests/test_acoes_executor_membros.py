"""Executor de `taskhs/membros`: roda o payload GRAVADO, um por pessoa, e diz
o que entrou e o que falhou — não para no primeiro erro sem contar."""
import asyncio

from app import acoes


def test_executa_adicionar_e_remover(monkeypatch):
    chamadas = []

    async def chamar(email, bot, metodo, caminho, json=None, params=None, dono=None):
        chamadas.append((metodo, caminho))
        if caminho.endswith("/members/5"):
            raise acoes.taskhs.ErroSistema(403, "Essa pessoa não é membro deste quadro")
        return {"ok": True}
    monkeypatch.setattr(acoes.taskhs, "chamar", chamar)
    p = {"list_id": 3, "card_id": 9, "adicionar": [2, 5], "remover": [1],
         "_exibir": {"adicionar": ["Ellen", "Zé"], "remover": ["Erick"]}}
    r = asyncio.run(acoes.EXECUTORES[("taskhs", "membros")]("e", "b", p))
    assert ("POST", "/lists/3/cards/9/members/2") in chamadas
    assert ("DELETE", "/lists/3/cards/9/members/1") in chamadas
    assert "Ellen" in r and "Erick" in r and "Zé" in r and "não" in r.lower()
