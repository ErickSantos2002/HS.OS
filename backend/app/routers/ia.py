"""Áudio, imagem e extração de texto — o que saía do Lovable AI Gateway.

Três coisas que a plataforma pede a uma LLM **fora** do caminho dos agentes:

- transcrever um áudio gravado no chat
- ler uma imagem colada no chat, para o agente (que é de texto) saber o que ela mostra
- extrair um perfil de empresa estruturado a partir de texto livre no onboarding

⚠️ **Isto não é o mesmo que os agentes usam.** Eles rodam no OpenClaw com o
provedor configurado lá (DeepSeek). Aqui é a plataforma chamando uma LLM
diretamente, e por isso precisa de credencial própria.

**Por que OpenAI e não DeepSeek.** Duas das três exigem multimodal: áudio e
visão. O DeepSeek é modelo de texto — serviria só a extração de perfil, e manter
dois provedores para economizar numa chamada rara não se paga.

**A chave** sai de `OPENAI_API_KEY`, pelo `ler_segredo` — banco primeiro, ambiente
depois. Sem ela, os três respondem 503 dizendo o que falta, em vez de 500.
"""

import base64
import json
import logging

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.dependencies import Usuario, usuario_atual
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ia", tags=["ia"])

_BASE = "https://api.openai.com/v1"

# Modelo de texto e visão. O `-mini` dá conta destas três tarefas — ler uma tela,
# resumir e extrair JSON — e custa uma fração do modelo cheio. Trocar aqui muda
# as três de uma vez.
_MODELO = "gpt-4o-mini"

# ⚠️ Transcrição usa o endpoint **dedicado**, não o de chat. A edge mandava o
# áudio como `input_audio` para um modelo multimodal; o endpoint próprio é mais
# barato, aceita o arquivo direto (sem base64) e devolve só o texto.
_MODELO_AUDIO = "whisper-1"

_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


async def _chave() -> str:
    valor = await ler_segredo("OPENAI_API_KEY")
    if not valor:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "A chave da OpenAI não está configurada. Cadastre OPENAI_API_KEY em "
            "Configurações → Integrações, ou no .env do backend.",
        )
    return valor


async def _completar(mensagens: list[dict], **extra) -> str:
    """Uma chamada de chat, com o erro do provedor preservado.

    O corpo do erro da OpenAI diz exatamente o que houve — cota estourada, chave
    revogada, imagem grande demais. Engolir isso num 502 genérico transformaria
    cada falha numa investigação.
    """
    chave = await _chave()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as cliente:
            r = await cliente.post(
                f"{_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {chave}"},
                json={"model": _MODELO, "messages": mensagens, **extra},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"A OpenAI não respondeu: {e}")

    if r.status_code >= 400:
        detalhe = ""
        try:
            detalhe = (r.json().get("error") or {}).get("message") or ""
        except ValueError:
            detalhe = r.text[:300]
        logger.warning("OpenAI %s: %s", r.status_code, detalhe)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"A OpenAI recusou a chamada ({r.status_code}). {detalhe}".strip(),
        )

    escolhas = r.json().get("choices") or []
    if not escolhas:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "A OpenAI respondeu vazio.")
    return (escolhas[0].get("message") or {}).get("content") or ""


# ─────────────────────────────────────────────────────────────────────────────
# Transcrição
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/transcrever")
async def transcrever(
    arquivo: UploadFile = File(description="O áudio gravado no chat."),
    _: Usuario = Depends(usuario_atual),
):
    """Transcreve um áudio. Devolve `{ text }`.

    Áudio vazio ou incompreensível volta como string vazia, não como erro — é o
    que a tela espera para não mostrar falha quando a pessoa simplesmente não
    falou nada.
    """
    conteudo = await arquivo.read()
    if not conteudo:
        return {"text": ""}

    chave = await _chave()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as cliente:
            r = await cliente.post(
                f"{_BASE}/audio/transcriptions",
                headers={"Authorization": f"Bearer {chave}"},
                files={"file": (arquivo.filename or "audio.webm", conteudo,
                                arquivo.content_type or "application/octet-stream")},
                data={"model": _MODELO_AUDIO, "language": "pt"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"A OpenAI não respondeu: {e}")

    if r.status_code >= 400:
        detalhe = ""
        try:
            detalhe = (r.json().get("error") or {}).get("message") or ""
        except ValueError:
            detalhe = r.text[:300]
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Não foi possível transcrever ({r.status_code}). {detalhe}".strip(),
        )

    texto = (r.json().get("text") or "").strip()
    logger.info("Áudio de %d bytes transcrito em %d caracteres.", len(conteudo), len(texto))
    return {"text": texto}


# ─────────────────────────────────────────────────────────────────────────────
# Leitura de imagem
# ─────────────────────────────────────────────────────────────────────────────

_PROMPT_VISAO = (
    "Você é um analisador visual para um chat com IA. Leia screenshots e imagens "
    "com máxima precisão. Extraia todo texto legível e descreva os elementos "
    "visuais necessários para que outro modelo de texto entenda a imagem sem "
    "vê-la. Para interfaces, informe títulos, labels, campos, opções "
    "selecionadas, avisos, badges e qualquer item destacado. Responda em "
    "português, de forma objetiva e fiel ao conteúdo da imagem."
)


class ImagemIn(BaseModel):
    image_data_url: str = Field(description="`data:image/…;base64,…`")
    file_name: str | None = None


@router.post("/descrever-imagem")
async def descrever_imagem(dados: ImagemIn, _: Usuario = Depends(usuario_atual)):
    """Descreve uma imagem em texto, para o agente entender o que ela mostra.

    ⚠️ **Isto existe porque o agente é de texto.** A descrição vai junto da
    mensagem, no lugar da imagem — não é um recurso de acessibilidade, é a
    tradução que faz um modelo sem visão participar da conversa.
    """
    if not dados.image_data_url.startswith("data:image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Envie a imagem como data URL (`data:image/...;base64,...`).",
        )

    rotulo = f" ({dados.file_name})" if dados.file_name else ""
    texto = await _completar([
        {"role": "system", "content": _PROMPT_VISAO},
        {"role": "user", "content": [
            {"type": "text", "text":
                f"Analise esta imagem{rotulo}. Retorne um resumo estruturado em "
                "2 partes: 1) Texto visível; 2) O que está acontecendo na "
                "interface/na imagem."},
            {"type": "image_url", "image_url": {"url": dados.image_data_url}},
        ]},
    ])
    return {"description": texto.strip()}


# ─────────────────────────────────────────────────────────────────────────────
# Perfil da empresa a partir de texto livre
# ─────────────────────────────────────────────────────────────────────────────

_PROMPT_EMPRESA = """Você extrai informações estruturadas sobre uma empresa a partir de texto livre em português.

Retorne APENAS um objeto JSON válido (sem markdown, sem explicações) com EXATAMENTE estas chaves:
- company_name (string|null): nome da empresa
- founder_name (string|null): nome do fundador ou CEO
- segment (string|null): setor/segmento (ex: "tecnologia", "saúde")
- description (string|null): o que a empresa faz (2-3 frases)
- target_audience (string|null): para quem é o produto/serviço
- products_services (string|null): o que vende ou oferece
- tone (string|null): apenas um de: "formal","informal","técnico","descontraído"
- revenue (string|null): ex "R$ 2M/ano"
- employees_count (string|null): ex "15", "50-100"
- extra_context (string|null): qualquer outra informação relevante

Use null para campos não mencionados. NUNCA invente dados."""

_CAMPOS = {
    "company_name", "founder_name", "segment", "description", "target_audience",
    "products_services", "tone", "revenue", "employees_count", "extra_context",
}


class TextoDaEmpresaIn(BaseModel):
    text: str = Field(min_length=1)


@router.post("/perfil-da-empresa")
async def perfil_da_empresa(dados: TextoDaEmpresaIn, _: Usuario = Depends(usuario_atual)):
    """Transforma um texto solto sobre a empresa nos campos do perfil.

    O `response_format: json_object` obriga a resposta a ser JSON — sem ele o
    modelo às vezes embrulha em markdown e a tela recebe uma cerca de código.

    Só as chaves conhecidas passam. O modelo eventualmente inventa um campo a
    mais, e mandá-lo ao `PUT /integracoes/empresa/perfil` faria a gravação falhar
    inteira por causa de uma chave extra.
    """
    bruto = await _completar(
        [
            {"role": "system", "content": _PROMPT_EMPRESA},
            {"role": "user", "content": dados.text},
        ],
        response_format={"type": "json_object"},
    )
    try:
        extraido = json.loads(bruto)
    except ValueError:
        logger.warning("Perfil da empresa não veio como JSON: %s", bruto[:200])
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "A resposta não veio no formato esperado. Tente de novo.",
        )
    if not isinstance(extraido, dict):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "A resposta não veio como objeto.")

    return {k: v for k, v in extraido.items() if k in _CAMPOS}
