# backend/tests/test_voz.py
"""Resumo em áudio das respostas dos agentes — pedido do CEO, 13/10/2026.

A resposta em texto sai na hora; o áudio vem depois e é acabamento. Por isso
nada aqui pode levantar: DeepSeek fora, edge-tts bloqueado (é uso não oficial
do serviço da Microsoft, risco aceito) ou zero bytes viram `None` e a resposta
segue sem áudio.
"""
import asyncio

import pytest

from app import voz


def test_limpa_markdown_que_nao_se_fala():
    t = "## Faturamento\n\n**Setembro** fechou em R$ 441 mil 🎉. Veja [o painel](https://x).\n\n- item"
    assert voz.limpar_markdown(t) == "Faturamento. Setembro fechou em R$ 441 mil. Veja o painel. item."


def test_tabela_e_codigo_somem():
    t = "Segue:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sql\nselect 1\n```\nFim."
    assert voz.limpar_markdown(t) == "Segue: Fim."


def test_resposta_curta_e_falada_inteira():
    assert voz.texto_para_falar("Pronto, Nicholson. Mandei a planilha.") == "Pronto, Nicholson. Mandei a planilha."


def test_resposta_longa_pede_resumo():
    assert voz.texto_para_falar("palavra " * 60) is None


def test_resposta_que_e_so_tabela_pede_resumo():
    """Limpa e não sobra nada: o DeepSeek recebe o original e diz o que a tabela mostra."""
    assert voz.texto_para_falar("| a | b |\n|---|---|\n| 1 | 2 |") is None


@pytest.mark.parametrize("valor,esperado", [
    ("pt-BR-FranciscaNeural", "pt-BR-FranciscaNeural"),
    (None, voz.VOZ_PADRAO),
    ("21m00Tcm4TlvDq8ikWAM", voz.VOZ_PADRAO),   # id herdado do ElevenLabs
    ("", voz.VOZ_PADRAO),
])
def test_voz_do_agente(valor, esperado):
    assert voz.voz_do_agente(valor) == esperado


def test_corta_na_ultima_frase_inteira():
    t = "Primeira frase. " * 200
    cortado = voz.cortar_em_frase(t, 100)
    assert len(cortado) <= 100 and cortado.endswith(".")


def _gerar(texto, resumo="Resumo curto.", audio=b"ID3mp3", falha_resumo=False, falha_voz=False):
    chamadas = {"resumo": 0}

    async def resumir(t, nome):
        chamadas["resumo"] += 1
        if falha_resumo:
            raise RuntimeError("deepseek fora")
        return resumo

    async def sintetizar(t, v):
        if falha_voz:
            raise RuntimeError("edge bloqueado")
        chamadas["falado"], chamadas["voz"] = t, v
        return audio

    r = asyncio.run(voz.gerar_audio(texto, "Nina", "pt-BR-FranciscaNeural",
                                    resumir=resumir, sintetizar=sintetizar))
    return r, chamadas


def test_curta_nao_chama_o_deepseek():
    r, c = _gerar("Feito, mandei.")
    assert r == b"ID3mp3" and c["resumo"] == 0 and c["falado"] == "Feito, mandei."


def test_longa_fala_o_resumo_na_voz_do_agente():
    r, c = _gerar("palavra " * 60)
    assert r == b"ID3mp3" and c["resumo"] == 1
    assert c["falado"] == "Resumo curto." and c["voz"] == "pt-BR-FranciscaNeural"


@pytest.mark.parametrize("kw", [{"falha_resumo": True}, {"falha_voz": True}, {"audio": b""}])
def test_falha_vira_none_e_nao_levanta(kw):
    r, _ = _gerar("palavra " * 60, **kw)
    assert r is None
