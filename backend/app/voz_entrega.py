# backend/app/voz_entrega.py
"""Leva o resumo em áudio até a mensagem: anexo privado + UPDATE.

O `UPDATE` em `conversations`/`channel_messages` dispara o trigger de tempo
real que já existe (003), e a tela troca a mensagem; no canal publicamos também
`mensagem-editada`, que o front aplica direto.

⚠️ **Roda depois do commit da resposta** (`disparar` é chamado fora da
transação): antes disso o `UPDATE` correria contra uma linha que outra conexão
ainda não vê. E nunca levanta — o texto já foi entregue.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid

from app import anexos as ax
from app import armazenamento as arm
from app import voz
from app.database import sessao
from app.realtime import hub, topico_canal

logger = logging.getLogger(__name__)

_MIME = "audio/mpeg"
_NOME = "audio.mp3"
_tarefas: set[asyncio.Task] = set()


def disparar(coro) -> None:
    """Segundo plano, guardando a referência — task sem dono é coletada no meio."""
    t = asyncio.create_task(coro)
    _tarefas.add(t)
    t.add_done_callback(_tarefas.discard)


async def _agente(conn, agent_id: str) -> tuple[str, str]:
    linha = await conn.fetchrow(
        "SELECT name, tts_voice_id FROM public.agent_profiles WHERE agent_id = $1", agent_id)
    nome = (linha and linha["name"]) or agent_id
    return nome, voz.voz_do_agente(linha and linha["tts_voice_id"])


async def _gravar(anexo_id: str, contexto: str, alvo: str, dados: bytes) -> str:
    caminho = ax.caminho_do_anexo(anexo_id, contexto, alvo, _NOME)
    await arm.gravar(arm.chave("anexos", caminho), dados, _MIME)
    return caminho


async def audio_da_conversa(message_id: str, agent_id: str, user_id: str, texto: str,
                            gerar=voz.gerar_audio) -> bool:
    try:
        async with sessao(role="service_role") as conn:
            pref = await conn.fetchrow(
                "SELECT resumo_em_audio FROM public.profiles WHERE id = $1::uuid", user_id)
            if pref is not None and not pref["resumo_em_audio"]:
                return False
            nome, voz_agente = await _agente(conn, agent_id)
        dados = await gerar(texto, nome, voz_agente)
        if not dados:
            return False
        anexo_id = str(uuid.uuid4())
        caminho = await _gravar(anexo_id, "conversa_agente", agent_id, dados)
        midia = [{"type": "audio", "id": anexo_id, "name": _NOME, "mimeType": _MIME,
                  "size": len(dados), "url": "", "base64": ""}]
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_agent,"
                "                           contexto, agent_id, dono_conversa)"
                " VALUES ($1::uuid, $2, $3, $4, $5, $6, 'conversa_agente', $6, $7::uuid)",
                anexo_id, caminho, _NOME, _MIME, len(dados), agent_id, user_id)
            await conn.execute(
                "UPDATE public.conversations"
                "   SET media = coalesce(media, '[]'::jsonb) || $2::text::jsonb"
                " WHERE id = $1::uuid",
                message_id, json.dumps(midia))
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("Resumo em áudio (conversa %s) não entregue: %s", message_id, e)
        return False


async def audio_do_canal(message_id: str, channel_id: str, agent_id: str, texto: str,
                         gerar=voz.gerar_audio) -> bool:
    try:
        async with sessao(role="service_role") as conn:
            nome, voz_agente = await _agente(conn, agent_id)
        dados = await gerar(texto, nome, voz_agente)
        if not dados:
            return False
        anexo_id = str(uuid.uuid4())
        caminho = await _gravar(anexo_id, "canal", channel_id, dados)
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO public.anexos (id, caminho, nome, mime, tamanho, enviado_por_agent,"
                "                           contexto, channel_id)"
                " VALUES ($1::uuid, $2, $3, $4, $5, $6, 'canal', $7::uuid)",
                anexo_id, caminho, _NOME, _MIME, len(dados), agent_id, channel_id)
            await conn.execute(
                "UPDATE public.channel_messages SET audio_url = $2 WHERE id = $1::uuid",
                message_id, f"anexo:{anexo_id}")
        hub.publicar(topico_canal(channel_id), "mensagem-editada",
                     {"id": message_id, "audio_url": f"anexo:{anexo_id}"})
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("Resumo em áudio (canal %s, mensagem %s) não entregue: %s",
                       channel_id, message_id, e)
        return False
