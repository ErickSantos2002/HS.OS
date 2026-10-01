"""O `solicitante` que o agente manda nem sempre é um uuid.

O agente tira o `solicitante` da própria chave de sessão (`hsos-<id>`). Sessão
que não nasceu de uma pessoa — cron, `sessions_send` entre agentes, uma sessão
de conferência aberta à mão — manda outra coisa, e até 01/10/2026 isso ia
direto para `WHERE id = $1::uuid`. O Postgres recusa o cast, a exceção escapava
como 500 e a `iris` respondia "a ferramenta de listagem está com erro interno",
avisando o administrador de um defeito que parecia ser da régua recém-trocada.
Foi assim que apareceu: conferindo a `compradores_produto` depois do deploy da
régua do `gold`, numa sessão `agent:iris:conferencia-compradores-20261001`.

O desenho sempre foi "sem solicitante válido, cai no administrador" — só que o
"válido" não era conferido antes de chegar ao banco.
"""
from app.routers.relatorios import _uuid_ou_none


def test_uuid_valido_passa_normalizado():
    u = "6F1C2B3A-1234-4ABC-9DEF-0123456789AB"
    assert _uuid_ou_none(u) == u.lower()
    assert _uuid_ou_none(f"  {u}  ") == u.lower()


def test_o_que_nao_e_uuid_vira_none_em_vez_de_estourar_no_banco():
    for lixo in ("conferencia-compradores-20261001", "cron:abc", "hsos-",
                 "", "   ", None, "123"):
        assert _uuid_ou_none(lixo) is None


def test_o_prefixo_da_chave_de_sessao_e_aceito():
    # O agente às vezes manda o `hsos-<id>` inteiro em vez de tirar o prefixo,
    # apesar da description pedir sem. Não custa aceitar.
    u = "6f1c2b3a-1234-4abc-9def-0123456789ab"
    assert _uuid_ou_none(f"hsos-{u}") == u
