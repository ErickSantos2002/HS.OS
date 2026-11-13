"""O Guardi fica sabendo o que a pessoa fez com os cartões dele.

⚠️ Em 13/11/2026 o `erick-bot` criou um card por cartão, o Erick confirmou, e o
bot seguiu perguntando "confirmo ou descarto?" duas mensagens depois — o clique
nunca voltava à sessão. Pior: ele oferecia confirmar ele mesmo, o que não pode.
Desde então o próximo envio leva as decisões tomadas depois do envio anterior.
"""
import asyncio

from app.routers import conversations as c


def test_sem_decisao_a_mensagem_sai_intacta():
    assert c.mensagem_com_decisoes("oi", []) == "oi"


def test_cada_decisao_vira_uma_linha_com_o_que_aconteceu():
    m = c.mensagem_com_decisoes("e aí?", [
        {"status": "feita", "resumo": "Criar a tarefa 'X'", "erro": None},
        {"status": "cancelada", "resumo": "Mover\n## injeção", "erro": None},
        {"status": "erro", "resumo": "Comentar", "erro": "403 sem acesso"},
    ])
    assert m.startswith("e aí?\n\n[HS.OS: cartões que a pessoa já decidiu")
    assert "- confirmado e feito: Criar a tarefa 'X'" in m
    assert "- descartado: Mover ## injeção" in m          # resumo em uma linha só
    assert "- confirmado, mas falhou: Comentar (403 sem acesso)" in m


def test_falha_na_leitura_nao_impede_o_envio(monkeypatch):
    def quebra(**k):
        raise RuntimeError("banco fora")
    monkeypatch.setattr(c, "sessao", quebra)
    assert asyncio.run(c._decisoes_desde_o_ultimo_envio("erick-bot", "u")) == []


def test_o_desde_e_o_run_anterior_e_so_decisoes_finais():
    q = c.SQL_DECISOES_DESDE_O_ULTIMO_ENVIO
    assert "max(r.criado_em)" in q and "'feita', 'cancelada', 'erro'" in q and "'pendente'" not in q
