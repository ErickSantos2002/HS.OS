"""A forma da chave de sessão do gateway, que não é escolha nossa.

⚠️ **O gateway extrai o agente da própria chave e confere contra o `agentId`.**
Chave que não comece com `agent:<agentId>:` é recusada com
`agentId "X" does not match session key "Y"` — e a recusa vem do `chat.send`,
antes de o agente rodar. Sem `agentId`, pior: ele aceita a chave crua e manda
para o agente padrão, que foi como uma sondagem acabou falando com a `nina` por
engano.

Este teste existe porque a regra estava escrita **num** dos três lugares que
montam chave. Os outros dois montavam `channel:…` e `arena:…`:

- mencionar um agente num canal nunca funcionou — o canal recebia
  "⚠️ Não consegui responder agora", 8 segundos depois, sem sessão nenhuma
  nascer no gateway (medido em produção, 02/09/2026);
- a Arena devolvia 502.

A regra agora mora em `app.gateway.client.chave_de_sessao` e os três a chamam.
O que este arquivo protege é a **forma**: se alguém montar chave à mão de novo,
o teste reprova aqui em vez de o defeito aparecer como agente mudo em produção.
"""
from uuid import UUID

from app.gateway.client import chave_de_sessao
from app.routers.channels import _chave_do_canal
from app.routers.conversations import _chave_arena, _chave_sessao

AGENTE = "flow"
PESSOA = "11111111-1111-1111-1111-111111111111"
CANAL = "22222222-2222-2222-2222-222222222222"

PREFIXO = f"agent:{AGENTE}:"


def test_a_chave_e_composta_com_o_agente_na_frente():
    assert chave_de_sessao(AGENTE, "seja-o-que-for") == "agent:flow:seja-o-que-for"


def test_todos_os_montadores_respeitam_o_prefixo():
    """A tabela inteira: é o prefixo que o gateway confere."""
    for rotulo, chave in [
        ("DM com agente", _chave_sessao(AGENTE, PESSOA)),
        ("menção em canal", _chave_do_canal(AGENTE, CANAL)),
        ("Arena", _chave_arena(AGENTE, PESSOA)),
    ]:
        assert chave.startswith(PREFIXO), f"{rotulo}: {chave!r} não começa com {PREFIXO!r}"


def test_a_dm_e_a_mesma_sessao_a_cada_chamada():
    """Conversa de DM tem memória: a chave não pode mudar entre um envio e outro."""
    assert _chave_sessao(AGENTE, PESSOA) == _chave_sessao(AGENTE, PESSOA)


def test_canal_e_arena_nascem_de_sessao_nova_a_cada_vez():
    """O contexto vai inteiro na mensagem; sessão persistente repetiria a conversa.

    É o oposto da DM de propósito — por isso as duas formas convivem.
    """
    assert _chave_do_canal(AGENTE, CANAL) != _chave_do_canal(AGENTE, CANAL)
    assert _chave_arena(AGENTE, PESSOA) != _chave_arena(AGENTE, PESSOA)


def test_a_pessoa_separa_as_conversas_de_dm():
    outra = "33333333-3333-3333-3333-333333333333"
    assert _chave_sessao(AGENTE, PESSOA) != _chave_sessao(AGENTE, outra)


def test_o_canal_aparece_na_chave_do_canal():
    """Para dar para achar a sessão pelo canal ao depurar no gateway."""
    assert CANAL in _chave_do_canal(AGENTE, CANAL)
