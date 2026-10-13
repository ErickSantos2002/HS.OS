# backend/app/voz.py
"""Resumo em áudio das respostas dos agentes — pedido do CEO, 13/10/2026.

O texto sai na hora; este módulo produz, depois, o áudio que vai embaixo dele:
o próprio agente falando um resumo. Resposta curta é falada inteira; longa
passa antes pelo DeepSeek. A voz é do **edge-tts** — as vozes neurais da
Microsoft, gratuitas por um uso não oficial do serviço. O risco de a Microsoft
bloquear sem aviso foi aceito: a falha só tira o áudio.

⚠️ **Nada aqui levanta para quem chamou.** O áudio é acabamento de uma resposta
que já foi entregue; qualquer falha vira `None` e uma linha de log.
"""
from __future__ import annotations

import logging
import re

import httpx

from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

VOZ_PADRAO = "pt-BR-AntonioNeural"
LIMITE_CURTO = 300
TETO_FALA = 1500
_TIMEOUT = 30

_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF‍️]")


_SEPARADOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
_REGUA = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")


def limpar_markdown(texto: str) -> str:
    """O que se fala: sem tabela, código, link cru, marcação nem emoji."""
    t = re.sub(r"```.*?```", " ", texto or "", flags=re.S)
    linhas = t.splitlines()
    # Tabela também existe sem `|` nas pontas ("Mês | Valor / --- | ---"): quando
    # há linha separadora, toda linha com `|` é tabela. Linha horizontal sai.
    tem_tabela = any(_SEPARADOR.match(l) and "|" in l for l in linhas)
    t = "\n".join(l for l in linhas
                  if not l.lstrip().startswith("|")
                  and not (tem_tabela and "|" in l)
                  and not _REGUA.match(l))
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)        # [texto](url) → texto
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"[*_~]{1,3}", "", t)
    t = _EMOJI.sub("", t)
    partes = []
    for linha in t.splitlines():
        linha = re.sub(r"^\s*(#{1,6}|[-*+]|\d+[.)])\s+", "", linha).strip()
        if not linha:
            continue
        if not re.search(r"[.!?:;]$", linha):
            linha += "."
        partes.append(linha)
    return re.sub(r"\s+", " ", " ".join(partes)).replace(" .", ".").strip()


def texto_para_falar(texto: str) -> str | None:
    """O texto curto já limpo, ou `None` quando a resposta pede resumo."""
    limpo = limpar_markdown(texto)
    if not limpo or len(limpo) > LIMITE_CURTO:
        return None
    return limpo


def voz_do_agente(tts_voice_id: str | None) -> str:
    """Só voz do edge-tts. O id do ElevenLabs herdado na mesma coluna não serve."""
    return tts_voice_id if (tts_voice_id or "").startswith("pt-BR-") else VOZ_PADRAO


def cortar_em_frase(texto: str, teto: int = TETO_FALA) -> str:
    if len(texto) <= teto:
        return texto
    corte = texto[:teto]
    fim = max(corte.rfind(". "), corte.rfind("! "), corte.rfind("? "))
    return corte[: fim + 1] if fim > 0 else corte


async def resumir_deepseek(texto: str, nome_agente: str) -> str:
    chave = await ler_segredo("DEEPSEEK_API_KEY")
    if not chave:
        raise RuntimeError("DEEPSEEK_API_KEY ausente")
    sistema = (
        f"Você é {nome_agente}. Resuma a sua própria resposta abaixo em 2 a 4 frases "
        "curtas, em primeira pessoa, em português do Brasil, para ser OUVIDA: sem "
        "markdown, sem listas, sem ler tabela; números grandes arredondados ('cerca "
        "de 441 mil reais'); se houver tabela, planilha ou arquivo, termine dizendo "
        "que o detalhe está na mensagem.")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as cliente:
        r = await cliente.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {chave}"},
            json={"model": "deepseek-chat", "max_tokens": 200, "temperature": 0.3,
                  "messages": [{"role": "system", "content": sistema},
                               {"role": "user", "content": texto[:12000]}]},
        )
    r.raise_for_status()
    resumo = (r.json()["choices"][0]["message"]["content"] or "").strip()
    if not resumo:
        raise RuntimeError("DeepSeek devolveu resumo vazio")
    return limpar_markdown(resumo)


async def sintetizar_edge(texto: str, voz: str) -> bytes:
    import asyncio

    import edge_tts

    async def falar() -> bytes:
        partes = []
        async for pedaco in edge_tts.Communicate(texto, voz).stream():
            if pedaco.get("type") == "audio":
                partes.append(pedaco["data"])
        return b"".join(partes)

    return await asyncio.wait_for(falar(), timeout=_TIMEOUT)


async def gerar_audio(texto: str, nome_agente: str, voz: str,
                      resumir=resumir_deepseek, sintetizar=sintetizar_edge) -> bytes | None:
    """O mp3 do resumo falado, ou `None`. Nunca levanta."""
    etapa = "resumo"
    try:
        falar = texto_para_falar(texto)
        if falar is None:
            falar = await resumir(texto, nome_agente)
        etapa = "voz"
        audio = await sintetizar(cortar_em_frase(falar), voz)
        if not audio:
            raise RuntimeError("edge-tts devolveu zero bytes")
        return audio
    except Exception as e:  # noqa: BLE001 — acabamento; nunca derruba a resposta
        logger.warning("Resumo em áudio de %s falhou na etapa %s: %s", nome_agente, etapa, e)
        return None
