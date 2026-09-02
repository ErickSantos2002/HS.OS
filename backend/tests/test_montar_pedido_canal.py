"""A montagem do pedido mandado ao agente numa menção em canal.

**Medido em produção em 02/09/2026:** num canal com duas instruções no
histórico, o agente respondeu à mensagem anterior à que o mencionou — pediram
`pong 474611` e ele respondeu com o assunto da mensagem de antes. O texto
enviado listava as 30 últimas mensagens e dizia só "responda à última
mensagem", sem marcar qual linha era essa; o código já sabia (a variável
`gatilho`, que existe para a deduplicação), só não usava isso no texto.

Este teste cobre a função pura `_montar_pedido`, extraída de
`_responder_no_canal` só para isso: não toca banco nem gateway, então dá para
testar dentro da regra da casa (backend só tem teste de função pura com objeto
falso).
"""
from app.routers.channels import _MARCA_GATILHO, _montar_pedido

# Objetos falsos: dict cobre `m["campo"]` igual ao asyncpg.Record usado em
# produção, sem precisar de conexão nenhuma.


def _msg(autor_id: str, autor_nome: str, conteudo: str) -> dict:
    return {"author_id": autor_id, "author_name": autor_nome, "content": conteudo}


def _linhas_do_historico(texto: str) -> list[str]:
    """Só as linhas de conversa, sem a instrução — que também cita a marca."""
    return texto.split("--- conversa recente ---\n", 1)[1].splitlines()


def test_marca_a_mensagem_gatilho_entre_varias():
    historico = [
        _msg("agente-x", "Agente X", "diagnostico"),
        _msg("pessoa-1", "Fulano", "pong 474611"),
    ]
    gatilho = historico[1]

    texto = _montar_pedido(historico, gatilho)
    linhas = _linhas_do_historico(texto)

    assert f"{_MARCA_GATILHO} Fulano: pong 474611" in texto
    assert "Agente X: diagnostico" in texto
    # a linha marcada não pode ganhar a marca duas vezes nem a errada recebê-la
    assert sum(_MARCA_GATILHO in l for l in linhas) == 1


def test_funciona_com_historico_de_uma_mensagem_so():
    unica = _msg("pessoa-1", "Fulano", "oi, tudo bem?")

    texto = _montar_pedido([unica], unica)

    assert f"{_MARCA_GATILHO} Fulano: oi, tudo bem?" in texto


def test_mensagem_de_agente_no_meio_do_historico_nao_atrapalha_a_marca():
    historico = [
        _msg("pessoa-1", "Fulano", "alguém sabe o status?"),
        _msg("agente-x", "Agente X", "deixa eu checar"),
        _msg("pessoa-1", "Fulano", "pong 474611"),
    ]
    gatilho = historico[2]

    texto = _montar_pedido(historico, gatilho)
    linhas = _linhas_do_historico(texto)

    assert sum(_MARCA_GATILHO in l for l in linhas) == 1
    assert f"{_MARCA_GATILHO} Fulano: pong 474611" in texto
    assert "Agente X: deixa eu checar" in texto


def test_conteudo_vazio_e_descartado_como_hoje():
    historico = [
        _msg("pessoa-1", "Fulano", "   "),
        _msg("pessoa-1", "Fulano", ""),
        _msg("pessoa-1", "Fulano", "pong 474611"),
    ]
    gatilho = historico[2]

    texto = _montar_pedido(historico, gatilho)

    assert texto.count("Fulano:") == 1
    assert f"{_MARCA_GATILHO} Fulano: pong 474611" in texto


def test_duas_mensagens_com_mesmo_autor_e_conteudo_nao_confundem_a_marca():
    """A comparação é por identidade — não por conteúdo nem por autor."""
    primeira = _msg("pessoa-1", "Fulano", "oi")
    segunda = _msg("pessoa-1", "Fulano", "oi")
    historico = [primeira, segunda]

    texto = _montar_pedido(historico, primeira)
    linhas = _linhas_do_historico(texto)

    marcada = [l for l in linhas if _MARCA_GATILHO in l]
    nao_marcada = [l for l in linhas if l.strip() == "Fulano: oi"]
    assert len(marcada) == 1
    assert len(nao_marcada) == 1
