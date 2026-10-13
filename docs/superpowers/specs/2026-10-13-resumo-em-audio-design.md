# Resumo em áudio nas respostas dos agentes — design

**Data:** 2026-10-13 · **Escopo:** `backend/` (geração, armazenamento, preferência),
`frontend/` (player na conversa com agente e no canal, interruptor no perfil).

## Objetivo

Pedido do CEO: toda resposta de agente sai com **um áudio embaixo do texto**, o
próprio agente falando um **resumo** — não a leitura do texto inteiro, que numa
resposta com tabela seria longa demais.

**Sucesso =** o agente responde, o texto aparece na hora como hoje, e alguns
segundos depois surge por baixo um player com 15 a 40 segundos do agente
contando o essencial, na voz dele. Quem não quiser desliga no perfil.

## Decisões (conversa de 13/10/2026)

| decisão | escolha |
|---|---|
| quem recebe | todo mundo, **ligado por padrão**; cada pessoa pode desligar |
| onde | conversa direta com agente **e** canal — um áudio por resposta |
| voz | **edge-tts** (vozes neurais da Microsoft, gratuito, uso não oficial) |
| voz por agente | nome feminino → voz feminina, masculino → masculina; sem tom grave |
| resumo | **DeepSeek** (`deepseek-chat`), chave própria no backend |
| se o edge-tts cair | a resposta sai sem áudio; registra no log e ajustamos depois |

**Por que edge-tts sendo não oficial:** foi a melhor voz das três comparadas
(Piper, edge-tts, Kokoro), com amostras ouvidas pelo Erick. O risco — a
Microsoft bloquear o uso sem aviso — foi aceito explicitamente: a falha só tira
o áudio, nunca a resposta.

## Fora do escopo

- Áudio para mensagem de pessoa, briefings agendados e `sessions_send` entre
  agentes (não têm tela).
- Escolher a voz pela tela. A voz fica em `agent_profiles.tts_voice_id` e se
  muda pelo `PATCH /agents/{id}`, que já aceita o campo.
- Repetir a tentativa quando a geração falha.
- Reaproveitar o áudio entre pessoas na conversa direta (cada conversa é de uma
  pessoa só).

## Fluxo

```
resposta do agente gravada            (_gravar_resposta | canal: INSERT agent)
        │  asyncio.create_task — não segura a resposta
        ▼
gerar_audio(texto, agente)            app/voz.py
  ├─ texto curto (≤ 300 chars) → fala inteiro
  └─ longo → DeepSeek: 2 a 4 frases, 1ª pessoa, português, sem markdown
  └─ edge-tts (voz do agente) → mp3
        ▼
anexo privado (bucket `anexos`, linha em public.anexos)
        ▼
UPDATE da mensagem (media | audio_url)  → trigger de tempo real → tela
```

## Backend

### `app/voz.py` (novo)

- `VOZ_PADRAO = "pt-BR-AntonioNeural"`; a voz do agente vem de
  `agent_profiles.tts_voice_id` quando começa com `pt-BR-`; senão, padrão.
- `texto_para_falar(texto) -> str` — **puro**: tira markdown (cabeçalhos,
  negrito, tabelas, links, blocos de código, emojis), e decide: até 300
  caracteres fala inteiro; acima, devolve `None` para pedir resumo.
- `async resumir(texto, nome_agente) -> str` — `POST
  https://api.deepseek.com/chat/completions`, `model: deepseek-chat`,
  `max_tokens: 200`, `temperature: 0.3`, `timeout: 30s`. Prompt de sistema:
  "Você é {nome}. Resuma a sua própria resposta abaixo em 2 a 4 frases curtas,
  em primeira pessoa, em português do Brasil, para ser OUVIDA: sem markdown, sem
  listas, sem ler tabela; números grandes arredondados ('cerca de 441 mil
  reais'); termine dizendo onde está o detalhe se houver tabela ou arquivo."
- `async sintetizar(texto, voz) -> bytes` — `edge_tts.Communicate(texto, voz)`,
  junta os pedaços de áudio; `timeout: 30s`. Teto de 1.500 caracteres de
  entrada (corta na última frase inteira antes).
- `async gerar_audio(texto, agente) -> bytes | None` — compõe os três; qualquer
  exceção vira `None` com `logger.warning` nomeando a etapa (resumo ou voz) e o
  agente. **Nunca levanta.**
- Chave: `DEEPSEEK_API_KEY` por `ler_segredo` (banco primeiro, ambiente
  depois), declarada em `config.py` — o pydantic-settings recusa chave
  desconhecida no `.env` e derruba o boot local. Sem chave, resposta longa fica
  sem áudio e a curta continua falada.

### Armazenamento

Reaproveita o que existe para anexo de agente (`_entregar` mostra o padrão):

- conversa direta: `public.anexos` com `contexto='conversa_agente'`,
  `agent_id`, `dono_conversa` = a pessoa, `enviado_por_agent` = o agente;
- canal: `contexto='canal'`, `channel_id`, `enviado_por_agent`;
- arquivo `audio.mp3`, `audio/mpeg` (está em `_INLINE_EXATOS`, toca inline).

### Ligação na mensagem

- **Conversa direta:** depois do `INSERT` em `_gravar_resposta`, a tarefa faz
  `UPDATE conversations SET media = coalesce(media,'[]') || [{type:"audio",
  id, name, mimeType, size}]`. Mídia com `id` já é o formato que a tela usa para
  anexo privado. Só roda se `profiles.resumo_em_audio` da pessoa for `true`.
- **Canal:** depois do `INSERT` da resposta de agente (`channels.py`, o
  `INSERT … 'agent'`), `UPDATE channel_messages SET audio_url = 'anexo:<id>'` e
  `hub.publicar(..., "mensagem-editada", …)` — o front já aplica esse evento.
  Gera sempre (o canal tem várias pessoas; quem desligou só não vê).
- A tarefa roda **depois do commit** da resposta — senão o `UPDATE` corre contra
  uma linha que outra conexão ainda não vê.

### Preferência

Migração `019_resumo_em_audio.sql`: `ALTER TABLE public.profiles ADD COLUMN IF
NOT EXISTS resumo_em_audio boolean NOT NULL DEFAULT true`. Exposta no `GET/PATCH
/profiles/me` (o mesmo endpoint que hoje troca nome e avatar) — o front lê de lá,
então o `GET /auth/me` não precisou mudar.

### Vozes iniciais (dado, no deploy)

| agente | voz |
|---|---|
| `nina` | `pt-BR-FranciscaNeural` |
| `iris` | `pt-BR-ThalitaNeural` |
| `atlas`, `flow`, `bruce` | `pt-BR-AntonioNeural` |

Gravadas pela própria migração `019` (`UPDATE agent_profiles SET tts_voice_id`
onde a voz **não** começa com `pt-BR-` — nula ou id herdado do ElevenLabs, que o
edge-tts não entende; uma voz `pt-BR-` escolhida depois é preservada).

### Dependência

`edge-tts==7.3.0` no `requirements.txt`.

## Frontend

- **Conversa com agente:** a bolha do agente passa a desenhar mídia
  `type: "audio"` com o `AudioMessagePlayer` (URL pelo `AnexoResolvido`, como
  imagem e arquivo já fazem), **embaixo do texto**. Precisa também aplicar o
  evento de **UPDATE** de `conversations` à mensagem já na tela — confirmar que
  o assinante atual não descarta update.
- **Canal:** mensagem de **agente** com `audio_url` mostra o texto inteiro
  (markdown) e o player embaixo. Mensagem de pessoa com áudio continua como é
  (player + transcrição recolhida).
- **Quem desligou** não vê o player de agente no canal.
- **Configurações → Perfil:** interruptor "Receber resumo em áudio das
  respostas dos agentes".

## Erros

| falha | efeito |
|---|---|
| DeepSeek fora / sem chave | resposta longa sem áudio; curta continua falada |
| edge-tts bloqueado ou fora | sem áudio; `warning` com a etapa `voz` |
| R2 fora | sem áudio; `warning` |
| pessoa desligou | conversa direta: nada é gerado |

Nenhuma delas afeta a resposta em texto, que já foi gravada e entregue.

## Testes

**Pytest, sem rede:**
- `texto_para_falar`: markdown e tabela somem; até 300 fala inteiro; acima pede
  resumo; emoji sai.
- voz do agente: `tts_voice_id` válido é usado; nulo ou lixo cai no padrão.
- `gerar_audio` com DeepSeek e edge-tts falsos: caminho feliz; DeepSeek falha →
  `None` sem levantar; edge-tts falha → `None`; texto curto não chama DeepSeek.
- teto de 1.500 caracteres corta em fim de frase.
- conversa direta: pessoa com `resumo_em_audio = false` não gera.

**Vitest:** bolha do agente desenha o player de mídia `audio` com `id`;
mensagem de agente no canal com `audio_url` mostra texto inteiro e player.

**Ao vivo:** uma pergunta à `nina` (curta e longa) e uma menção a agente num
canal, conferindo voz, resumo e tempo até o áudio aparecer.

## Arquivos

| arquivo | mudança |
|---|---|
| `backend/app/voz.py` | criar |
| `backend/app/config.py` | `DEEPSEEK_API_KEY` |
| `backend/requirements.txt` | `edge-tts==7.3.0` |
| `backend/migrations/019_resumo_em_audio.sql` | coluna + vozes iniciais |
| `backend/app/routers/conversations.py` | disparo depois de `_gravar_resposta` |
| `backend/app/routers/channels.py` | disparo depois da resposta de agente |
| `backend/app/auth/router.py`, `routers/profiles.py` | expor a preferência |
| `backend/tests/test_voz.py` | criar |
| `frontend/…` bolha do agente, `ChannelChat.tsx`, perfil | player e interruptor |
