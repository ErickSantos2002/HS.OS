# Resumo em áudio nas respostas dos agentes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda resposta de agente ganha, segundos depois, um áudio embaixo do texto com o agente falando um resumo — na conversa direta e no canal —, com voz por agente e preferência por pessoa.

**Architecture:** `app/voz.py` é puro + duas chamadas externas injetáveis (DeepSeek para resumir, edge-tts para falar). `app/voz_entrega.py` grava o mp3 como anexo privado e liga à mensagem com um `UPDATE` — o trigger de tempo real que já existe leva à tela. Os disparos são `asyncio.create_task` depois do commit da resposta, então o texto nunca espera o áudio.

**Tech Stack:** Python 3 · FastAPI · asyncpg · httpx · edge-tts 7.3.0 · React + Vite · Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-resumo-em-audio-design.md`

## Global Constraints

- Código, comentários, mensagens e testes em português; nenhum dado real de pessoa em teste.
- Resposta curta = **até 300 caracteres** depois de limpar o markdown → falada inteira, sem DeepSeek.
- Entrada do edge-tts: teto de **1.500 caracteres**, cortado na última frase inteira.
- DeepSeek: `POST https://api.deepseek.com/chat/completions`, `model: "deepseek-chat"`, `max_tokens: 200`, `temperature: 0.3`, timeout 30 s. Chave `DEEPSEEK_API_KEY` por `ler_segredo`.
- Voz padrão `pt-BR-AntonioNeural`; voz do agente = `agent_profiles.tts_voice_id` **só se começar com `pt-BR-`**.
- Vozes iniciais: `nina` → `pt-BR-FranciscaNeural`, `iris` → `pt-BR-ThalitaNeural`, `atlas`/`flow`/`bruce` → `pt-BR-AntonioNeural`. Sem ajuste de tom.
- Arquivo `audio.mp3`, mime `audio/mpeg`, anexo privado (bucket `anexos`).
- Falha em qualquer etapa → sem áudio + `logger.warning`; **nunca** levanta para quem chamou.
- `profiles.resumo_em_audio boolean NOT NULL DEFAULT true`. Conversa direta: `false` → nada é gerado. Canal: gera sempre; quem desligou não vê o player.
- Backend: `.venv/bin/python -m pytest tests -q` de `backend/`. Front: `npx vitest run` de `frontend/`.

## Review Focus

1. **Resposta do agente que é só tabela ou bloco de código** — depois de limpar o markdown não sobra texto; deve ir ao DeepSeek com o texto original (não falar vazio nem ler `|---|`).
2. **Mesma resposta gravada duas vezes pelo `/recuperar` e pelo `/reply`** (o `_gravar_resposta` devolve `nova=False`) — não pode gerar dois áudios.
3. **Áudio chega depois que a pessoa já recarregou a conversa** — a sincronização por tempo real tem que trocar a mensagem existente (com `media` nova), não ignorá-la por ter o mesmo id.
4. **edge-tts devolve zero bytes sem erro** — tratar como falha, não gravar anexo vazio.
5. **Agente com `tts_voice_id` herdado do ElevenLabs** (id opaco, não `pt-BR-…`) — cair na voz padrão, não mandar o id ao edge-tts.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `backend/app/voz.py` (criar) | limpar texto, decidir resumo, resumir (DeepSeek), sintetizar (edge-tts), compor |
| `backend/app/voz_entrega.py` (criar) | gravar mp3 como anexo, ligar à mensagem, disparar em segundo plano |
| `backend/migrations/019_resumo_em_audio.sql` (criar) | coluna da preferência + vozes iniciais |
| `backend/app/config.py`, `requirements.txt` | chave e dependência |
| `backend/app/routers/schemas.py`, `routers/profiles.py` | expor a preferência |
| `backend/app/routers/conversations.py`, `routers/channels.py` | disparos |
| `frontend/src/hooks/use-resumo-em-audio.ts` (criar) | ler e alterar a preferência |
| `frontend/src/components/settings/PreferenciaResumoEmAudio.tsx` (criar) | interruptor |
| `frontend/src/pages/ChatPage.tsx`, `components/chat/ChannelChat.tsx`, `pages/SettingsPage.tsx` | player e interruptor |

---

### Task 1: `app/voz.py` — texto, resumo e voz

**Files:**
- Create: `backend/app/voz.py`, `backend/tests/test_voz.py`
- Modify: `backend/app/config.py` (declarar `DEEPSEEK_API_KEY`), `backend/requirements.txt` (`edge-tts==7.3.0`)

**Interfaces:**
- Produces:
  - `VOZ_PADRAO: str`, `LIMITE_CURTO = 300`, `TETO_FALA = 1500`
  - `limpar_markdown(texto: str) -> str`
  - `texto_para_falar(texto: str) -> str | None` — `None` = precisa de resumo
  - `voz_do_agente(tts_voice_id: str | None) -> str`
  - `cortar_em_frase(texto: str, teto: int = TETO_FALA) -> str`
  - `async gerar_audio(texto: str, nome_agente: str, voz: str, resumir=..., sintetizar=...) -> bytes | None`
  - `async resumir_deepseek(texto: str, nome_agente: str) -> str`
  - `async sintetizar_edge(texto: str, voz: str) -> bytes`

- [ ] **Step 1: Write the failing tests**

```python
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
    assert voz.limpar_markdown(t) == "Faturamento. Setembro fechou em R$ 441 mil. Veja o painel. item"


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_voz.py -q`
Expected: FAIL — `ImportError: cannot import name 'voz'`

- [ ] **Step 3: Implement**

```python
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


def limpar_markdown(texto: str) -> str:
    """O que se fala: sem tabela, código, link cru, marcação nem emoji."""
    t = re.sub(r"```.*?```", " ", texto or "", flags=re.S)
    t = "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("|"))
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
```

Em `backend/app/config.py`, junto da `OPENAI_API_KEY`:

```python
    # DeepSeek — resume a resposta do agente para o áudio (`app/voz.py`). Os
    # agentes não passam por aqui; usam o provedor do OpenClaw. Declarada pelo
    # mesmo motivo da OPENAI_API_KEY: chave desconhecida no `.env` derruba o boot.
    DEEPSEEK_API_KEY: str = ""
```

Em `backend/requirements.txt`, no fim:

```
# Voz do resumo em áudio dos agentes (app/voz.py) — vozes neurais da Microsoft.
edge-tts==7.3.0
```

- [ ] **Step 4: Run tests and install**

Run: `.venv/bin/pip install -q edge-tts==7.3.0 && .venv/bin/python -m pytest tests/test_voz.py -q`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/voz.py backend/tests/test_voz.py backend/app/config.py backend/requirements.txt
git commit -m "feat(voz): resumo falado da resposta do agente — DeepSeek + edge-tts"
```

---

### Task 2: preferência e vozes iniciais (migração 019 + perfil)

**Files:**
- Create: `backend/migrations/019_resumo_em_audio.sql`, `~/aplicar-hsos-019.py` (fora do repo)
- Modify: `backend/app/routers/schemas.py` (`PerfilOut`, `PerfilPatch`), `backend/app/routers/profiles.py` (`_COLUNAS`), `backend/migrations/README.md`
- Test: `backend/tests/test_perfil_resumo_audio.py`

**Interfaces:**
- Produces: `PerfilOut.resumo_em_audio: bool = True`; `PerfilPatch.resumo_em_audio: bool | None`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_perfil_resumo_audio.py
"""A preferência do resumo em áudio é do próprio perfil e vem ligada."""
from app.routers.schemas import PerfilOut, PerfilPatch


def test_perfil_sem_a_coluna_vem_ligado():
    p = PerfilOut(id="x", email="a@b.c", full_name="A", avatar_url=None, status="active")
    assert p.resumo_em_audio is True


def test_patch_aceita_desligar():
    assert PerfilPatch(resumo_em_audio=False).model_dump(exclude_unset=True) == {"resumo_em_audio": False}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_perfil_resumo_audio.py -q`
Expected: FAIL (`resumo_em_audio` desconhecido / atributo inexistente)

- [ ] **Step 3: Implement**

`schemas.py`: em `PerfilOut`, `resumo_em_audio: bool = True`; em `PerfilPatch`, `resumo_em_audio: bool | None = None`.
`profiles.py`: acrescentar `p.resumo_em_audio,` ao `_COLUNAS`.

```sql
-- backend/migrations/019_resumo_em_audio.sql — resumo em áudio dos agentes
--
-- Pedido do CEO (13/10/2026): toda resposta de agente sai com o agente falando
-- um resumo. Ligado por padrão; cada pessoa desliga no perfil. Ver
-- `app/voz.py` e a spec 2026-10-13-resumo-em-audio-design.md.
--
-- As vozes iniciais só preenchem quem está sem voz: não sobrescrevem escolha
-- feita depois pelo PATCH /agents/{id}.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO — python3 ~/aplicar-hsos-019.py

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS resumo_em_audio boolean NOT NULL DEFAULT true;

UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-FranciscaNeural'
 WHERE agent_id = 'nina' AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';
UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-ThalitaNeural'
 WHERE agent_id = 'iris' AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';
UPDATE public.agent_profiles SET tts_voice_id = 'pt-BR-AntonioNeural'
 WHERE agent_id IN ('atlas', 'flow', 'bruce') AND coalesce(tts_voice_id, '') NOT LIKE 'pt-BR-%';

COMMIT;
```

`~/aplicar-hsos-019.py`: mesmo molde do `aplicar-hsos-018.py`, conferindo ao fim
`SELECT count(*) FROM information_schema.columns WHERE table_name='profiles' AND column_name='resumo_em_audio'` = 1
e `SELECT agent_id, tts_voice_id FROM agent_profiles ORDER BY 1` com as cinco vozes.

- [ ] **Step 4: Testes, aplicar a migração e conferir**

Run: `.venv/bin/python -m pytest tests -q` → PASS
Run: `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-019.py` → `✅ aplicada e conferida`

(A coluna precisa existir antes do deploy: o `_COLUNAS` de `profiles.py` passa a consultá-la.)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/019_resumo_em_audio.sql backend/migrations/README.md backend/app/routers/schemas.py backend/app/routers/profiles.py backend/tests/test_perfil_resumo_audio.py
git commit -m "feat(voz): preferência resumo_em_audio no perfil e vozes iniciais dos agentes"
```

---

### Task 3: entrega — anexo, ligação à mensagem e disparos

**Files:**
- Create: `backend/app/voz_entrega.py`, `backend/tests/test_voz_entrega.py`
- Modify: `backend/app/routers/conversations.py` (`/reply`, `/recuperar`), `backend/app/routers/channels.py` (`_publicar_do_agente`)

**Interfaces:**
- Consumes: `voz.gerar_audio`, `voz.voz_do_agente` (Task 1)
- Produces:
  - `async audio_da_conversa(message_id: str, agent_id: str, user_id: str, texto: str, gerar=voz.gerar_audio) -> bool`
  - `async audio_do_canal(message_id: str, channel_id: str, agent_id: str, texto: str, gerar=voz.gerar_audio) -> bool`
  - `disparar(coro) -> None` — `asyncio.create_task` guardando a referência

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_voz_entrega.py
"""O áudio vira anexo privado e entra na mensagem por UPDATE — o trigger de
tempo real leva à tela. Quem desligou a preferência não ganha áudio na conversa
direta; no canal o áudio é um só para todos."""
import asyncio

from app import voz_entrega as ve

PESSOA = "00000000-0000-4000-8000-0000000000a1"
CANAL = "00000000-0000-4000-8000-0000000000c1"
MSG = "00000000-0000-4000-8000-0000000000d1"


class Conn:
    def __init__(self, estado):
        self.e = estado

    async def fetchrow(self, sql, *a):
        self.e["sql"].append(sql)
        if "agent_profiles" in sql:
            return {"name": "Nina", "tts_voice_id": "pt-BR-FranciscaNeural"}
        if "resumo_em_audio" in sql:
            return {"resumo_em_audio": self.e["pref"]}
        return None

    async def execute(self, sql, *a):
        self.e["sql"].append(sql)
        self.e["args"].append(a)


class Sessao:
    def __init__(self, e):
        self.e = e

    async def __aenter__(self):
        return Conn(self.e)

    async def __aexit__(self, *a):
        return False


def _ambiente(monkeypatch, pref=True):
    e = {"sql": [], "args": [], "gravados": [], "pref": pref, "publicado": []}
    monkeypatch.setattr(ve, "sessao", lambda **k: Sessao(e))

    async def gravar(chave, dados, mime):
        e["gravados"].append((chave, len(dados), mime))
    monkeypatch.setattr(ve.arm, "gravar", gravar)
    monkeypatch.setattr(ve.arm, "chave", lambda b, c: f"{b}/{c}")
    monkeypatch.setattr(ve.hub, "publicar", lambda *a: e["publicado"].append(a))
    return e


async def _gerar_ok(texto, nome, voz):
    assert (nome, voz) == ("Nina", "pt-BR-FranciscaNeural")
    return b"ID3mp3"


async def _gerar_falha(texto, nome, voz):
    return None


def test_conversa_grava_anexo_e_acrescenta_a_midia(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_da_conversa(MSG, "nina", PESSOA, "Feito.", gerar=_gerar_ok))
    [(chave, tamanho, mime)] = e["gravados"]
    assert chave.startswith("anexos/") and mime == "audio/mpeg" and tamanho == 6
    assert any("INSERT INTO public.anexos" in s and "conversa_agente" in s for s in e["sql"])
    assert any("UPDATE public.conversations" in s and "media" in s for s in e["sql"])


def test_quem_desligou_nao_ganha_audio_na_conversa(monkeypatch):
    e = _ambiente(monkeypatch, pref=False)

    async def proibido(*a):
        raise AssertionError("gerou áudio para quem desligou")
    assert asyncio.run(ve.audio_da_conversa(MSG, "nina", PESSOA, "Feito.", gerar=proibido)) is False
    assert e["gravados"] == []


def test_canal_grava_anexo_troca_audio_url_e_avisa_a_tela(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_do_canal(MSG, CANAL, "nina", "Feito.", gerar=_gerar_ok))
    assert any("UPDATE public.channel_messages" in s and "audio_url" in s for s in e["sql"])
    assert any(a[1] == "mensagem-editada" for a in e["publicado"])


def test_falha_na_geracao_nao_grava_nada(monkeypatch):
    e = _ambiente(monkeypatch)
    assert asyncio.run(ve.audio_do_canal(MSG, CANAL, "nina", "Feito.", gerar=_gerar_falha)) is False
    assert e["gravados"] == [] and not any("UPDATE" in s for s in e["sql"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_voz_entrega.py -q`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement**

```python
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
```

> Nota: confira o nome real do módulo que exporta `hub` e `topico_canal` (`grep -n "topico_canal" backend/app/routers/channels.py` mostra o import) e use o mesmo.
> ⚠️ O evento `mensagem-editada` no front faz `reconcileMessages` com o payload — um payload parcial `{id, audio_url}` precisa ser mesclado sem apagar o resto. `reconcileMessages` já faz `{...existente, ...novo}`; confirme no teste do Task 4.

Disparos (fora de qualquer `async with sessao`):

- `conversations.py`, `/reply`: trocar `linha, _ = await _gravar_resposta(...)` por
  `linha, nova = ...` e, logo depois de `saida = _para_saida(linha)`, **só se `nova`**
  (se o `/recuperar` gravou antes, ele já disparou o áudio — Review Focus 2):
  ```python
  if nova:
      voz_entrega.disparar(voz_entrega.audio_da_conversa(linha["id"], agent_id, usuario.id, texto))
  ```
- `conversations.py`, `/recuperar`: no fim, para cada `m` em `recuperadas` (só as **novas**):
  ```python
  for m in recuperadas:
      voz_entrega.disparar(voz_entrega.audio_da_conversa(m.id, agent_id, usuario.id, m.content))
  ```
- `channels.py`, `_publicar_do_agente`: depois do `hub.publicar(..., "mensagem", ...)`:
  ```python
  voz_entrega.disparar(voz_entrega.audio_do_canal(saida.id, channel_id, agent_id, texto))
  ```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/python -m pytest tests -q` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/voz_entrega.py backend/tests/test_voz_entrega.py backend/app/routers/conversations.py backend/app/routers/channels.py
git commit -m "feat(voz): resumo em áudio entra na mensagem como anexo privado, em segundo plano"
```

---

### Task 4: front — player e interruptor

**Files:**
- Create: `frontend/src/hooks/use-resumo-em-audio.ts`, `frontend/src/components/settings/PreferenciaResumoEmAudio.tsx`, testes ao lado
- Modify: `frontend/src/pages/ChatPage.tsx` (`MediaBubble`: ramo de áudio), `frontend/src/components/chat/ChannelChat.tsx` (mensagem de agente com áudio), `frontend/src/pages/SettingsPage.tsx` (interruptor na aba Perfil)

**Interfaces:**
- Consumes: `GET/PATCH /profiles/me` com `resumo_em_audio` (Task 2); `AudioDaMensagem`, `AudioMessagePlayer` (já existem)
- Produces: `useResumoEmAudio(): { ligado: boolean; alterar: (v: boolean) => Promise<void> }`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/settings/PreferenciaResumoEmAudio.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }));

import PreferenciaResumoEmAudio from "@/components/settings/PreferenciaResumoEmAudio";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PreferenciaResumoEmAudio /></QueryClientProvider>);
}

describe("PreferenciaResumoEmAudio", () => {
  it("mostra ligado quando o perfil diz ligado, e desligar manda PATCH", async () => {
    api.mockImplementation(async (rota: string, op?: { method?: string }) =>
      op?.method === "PATCH" ? { resumo_em_audio: false } : { resumo_em_audio: true });
    montar();
    const chave = await screen.findByRole("switch");
    await waitFor(() => expect(chave).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(chave);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/profiles/me",
      expect.objectContaining({ method: "PATCH", body: { resumo_em_audio: false } })));
  });
});
```

E, para o `MediaBubble` (exportá-lo de `ChatPage.tsx`), um teste com `vi.hoisted` definindo `DOMMatrix` (como em `ChannelChat.thread-apagada.test.tsx`): mídia `{type: "audio", url: "https://x/a.mp3"}` renderiza um `<audio>` com esse `src`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/settings/PreferenciaResumoEmAudio.test.tsx src/pages/ChatPage.media.test.tsx`
Expected: FAIL (módulo inexistente / `<audio>` ausente)

- [ ] **Step 3: Implement**

```ts
// frontend/src/hooks/use-resumo-em-audio.ts
/**
 * A preferência "receber resumo em áudio das respostas dos agentes".
 * Ligada por padrão (coluna `profiles.resumo_em_audio`, migração 019).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const CHAVE = ["perfil", "resumo_em_audio"];

export function useResumoEmAudio() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api<{ resumo_em_audio?: boolean }>("/profiles/me")).resumo_em_audio !== false,
    staleTime: 5 * 60_000,
  });
  const m = useMutation({
    mutationFn: async (ligado: boolean) =>
      api("/profiles/me", { method: "PATCH", body: { resumo_em_audio: ligado } }),
    onMutate: (ligado) => qc.setQueryData(CHAVE, ligado),
    onError: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
  return { ligado: data ?? true, alterar: (v: boolean) => m.mutateAsync(v).then(() => undefined) };
}
```

```tsx
// frontend/src/components/settings/PreferenciaResumoEmAudio.tsx
import { Switch } from "@/components/ui/switch";
import { useResumoEmAudio } from "@/hooks/use-resumo-em-audio";

export default function PreferenciaResumoEmAudio() {
  const { ligado, alterar } = useResumoEmAudio();
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      <div>
        <h3 className="text-sm font-display font-semibold text-foreground">Resumo em áudio</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cada resposta dos agentes vem com um áudio curto do agente resumindo o que escreveu.
        </p>
      </div>
      <Switch checked={ligado} onCheckedChange={(v) => void alterar(v)} aria-label="Receber resumo em áudio" />
    </div>
  );
}
```

`SettingsPage.tsx`: `<PreferenciaResumoEmAudio />` logo abaixo do bloco "Tema da interface".

`ChatPage.tsx`, `MediaBubble` — antes do `if (attachment.type === "file")`:

```tsx
  if (effectiveType === "audio") {
    // Resumo em áudio do agente (ou voz antiga): toca pela URL que o
    // AnexoResolvido já resolveu; se vencer, `onErroImagem` renova.
    return <div className="mt-2"><AudioMessagePlayer src={attachment.url || ""} onErro={onErroImagem} /></div>;
  }
```

`ChannelChat.tsx`, na mensagem: se `isAgent && hasAudio`, renderizar o conteúdo como texto de agente (o ramo `MarkdownMessageContent` do agente) e, **depois** da bolha, `{resumoLigado && <AudioDaMensagem audioUrl={msg.audio_url!} />}`; o ramo atual (`hasAudio` → `CollapsibleTranscription`) fica só para pessoa. `resumoLigado` vem de `useResumoEmAudio()` no componente pai e desce como prop.

- [ ] **Step 4: Run all front tests, types and lint count**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS; tsc só com o erro antigo de `DocumentEditor.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(voz): player do resumo em áudio no chat e no canal, e interruptor no perfil"
```

---

### Task 5: conferência e registro

- [ ] **Step 1:** Com o backend local (`uvicorn` na 8002, `DEEPSEEK_API_KEY` no `.env`), rodar `gerar_audio` de verdade sobre uma resposta longa real da `nina` (lida do banco) e uma curta; salvar os mp3 no scratchpad e tocar com `ffplay`. Expected: resumo em português, primeira pessoa, voz Francisca; curta lida inteira.
- [ ] **Step 2:** `CLAUDE.md` — seção curta "Resumo em áudio": onde nasce, a chave, o risco aceito do edge-tts, a preferência; `docs/CONTINUAR-AQUI.md` — estado.
- [ ] **Step 3:** Commit `docs(voz): registro do resumo em áudio`.
- [ ] **Step 4 (depois do deploy):** pergunta curta e longa à `nina` e uma menção num canal; conferir tempo até o áudio e a voz de cada agente.
