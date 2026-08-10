# Roteiro de teste — 10/08/2026

Escrito em 07/08, ao fim de três dias de portagem. **Praticamente todo o front
foi reescrito para falar com a API própria em vez do Supabase**, e quase nada
disso foi verificado no navegador — só por `curl` contra o backend.

Este arquivo existe para a volta ser produtiva: o que checar, em que ordem, e o
que já se sabe que não funciona.

---

## Antes de abrir o sistema

```bash
# 1. O túnel SSH. Sem ele, tudo que toca o gateway responde 502.
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L 18789:127.0.0.1:18789 root@2.24.85.122

# 2. Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8002

# 3. Front
cd frontend && npm run dev     # http://localhost:8080
```

Login: `ti@healthsafetytech.com` / `admin123`.

---

## O que já se sabe que NÃO funciona

Não perca tempo com estes — são conhecidos e estão documentados:

| O quê | Por quê |
|---|---|
| Transcrição de áudio, visão de imagem, leitura do contexto da empresa | dependem do Lovable AI Gateway — decisão de produto pendente |
| Voz do agente (botão "ouvir" no chat) | depende da ElevenLabs — decisão futura |
| Arena e War room | **pausadas em 10/08** — mostram "em construção" de propósito. Ver `EM-CONSTRUCAO.md` |
| "Esqueci minha senha" (`/reset-password`) | o fluxo sumiu com o Supabase Auth |
| Consumo em tempo real no painel do agente | `usage_events` ficou fora dos gatilhos de propósito — atualiza ao abrir |
| Artefatos publicados no painel do agente | a tabela não tem vínculo com agente; a lista é vazia por construção |
| **Parar a resposta do agente** | o botão para a TELA de esperar, não o agente. Ver abaixo |

### Sobre parar a resposta

O botão de interromper **nunca parou o agente** — só a tela de esperar. Isso não
é regressão da migração: o `/stop` ao gateway está atrás da flag
`dnos_flag_real_stop`, desligada por padrão desde o remix.

E sondei o gateway em 10/08: **ele não tem método de parada**. `agent.stop`,
`chat.cancel`, `run.cancel` e outros quatro candidatos respondem `unknown
method`. O único caminho é mandar `/stop` como mensagem de chat e torcer para o
OpenClaw interpretar a barra.

⚠️ Não liguei a flag. Se o gateway **não** interpretar, a agente recebe o texto
"/stop" e responde a ele — pior que o sintoma atual, que é a resposta original
chegando atrasada. É um teste para fazermos juntos, num agente combinado.

---

## Ordem sugerida

A ordem importa: cada bloco depende do anterior estar de pé.

### 1. Entrar e navegar

- [ ] Login funciona
- [ ] O menu carrega e as telas abrem sem erro no console
- [ ] Trocar senha em **Configurações → Perfil** (pede a senha atual agora)

⚠️ **Este é o momento de trocar o `admin123`.** E a senha do banco
(`administrador`/`administrador`), que também é temporária.

### 2. Agentes

- [ ] A lista mostra os 5 agentes reais
- [ ] Abrir um agente: perfil, persona, skills, crons, acesso
- [ ] Editar nome/emoji/departamento e ver persistir
- [ ] O painel de consumo e estatísticas desenha
- [ ] Verificar modelo (o botão "testar")

### 3. Chat — o caminho crítico

- [ ] Mandar mensagem para um agente e receber resposta
- [ ] A resposta aparece **sem recarregar** (é o tempo real novo)
- [ ] Recarregar a página: o histórico está lá
- [ ] Navegar para outra tela e voltar durante uma resposta — ela não se perde
- [ ] `/stop` interrompe

### 4. Canais

- [ ] Criar canal, mandar mensagem, ver aparecer para outra aba
- [ ] Adicionar e remover membro
- [ ] Editar e apagar a própria mensagem
- [ ] Thread: responder, contar, abrir
- [ ] Reagir com emoji
- [ ] Anexar arquivo

### 5. Skills — refeita em 10/08

A tela mostrava **54 skills inventadas**: uma lista escrita à mão dentro do
`use-skills.ts`, servida como "fallback" para quando a API do gateway não
respondesse — e ela nunca respondia, porque o caminho REST morreu junto com o
resto da API HTTP do OpenClaw. Ou seja, o fallback *era* o normal.

Agora vem do `skills.status`: **53 skills reais**, com emoji, se o agente pode
usar cada uma e o que falta instalar quando não pode.

- [ ] O catálogo abre e as skills têm cara de reais (`1password`, `canvas`,
      `browser-automation` — não `whatsapp-send`)
- [ ] Criar uma skill gerenciada (markdown próprio), editar e excluir
- [ ] Atribuir a um agente — ⚠️ **isto instala de verdade, ver abaixo**

### 6. O resto

- [ ] Automações: criar, pausar, ver histórico
- [ ] Tarefas: abrir, checkpoint, concluir
- [ ] Wiki: criar espaço, documento, fixar
- [ ] Artefatos: publicar, abrir o link público, congelar
- [ ] Times: criar, pôr agente
- [ ] Integrações: criar conector, editar sem perder a chave
- [ ] Notificações: chegam e zeram ao abrir a conversa

---

## ⚠️ Fazer JUNTO comigo — têm efeito real

Estes disparam ação de verdade no gateway ou mandam mensagem a agente de
produção. Testei só as guardas (404, 401, 403); o caminho feliz nunca rodou.

1. **Mudar o acesso de um agente** — manda mensagem ao agente líder
2. **Mencionar um agente num canal** — dispara o agente de verdade
3. **Excluir um agente** — apaga no gateway e em três tabelas
4. **Disparar uma automação** — executa no gateway
5. **Atribuir uma skill a um agente** — `skills.install` grava no workspace
   dele. O formato do payload foi confirmado contra um agente inexistente
   (passa a validação, morre em `unknown agent id`); o caminho feliz nunca
   rodou.

---

## Verificação feita antes de entregar

Além dos testes por endpoint de cada lote:

- **Varredura das 48 rotas GET sem parâmetro** — 41 respondendo, 7 falhando pelo
  motivo certo (túnel fechado, segredo de teste apagado, parâmetro obrigatório)
- **Cruzamento de cada `api<T>("/rota")` do front com o formato real da
  resposta** — achou um bug real: `/agents` devolve `{agents, defaultId,
  gatewayOk}` e seis lugares religados hoje tratavam como array. Corrigido.
- **Audit de `functions.invoke` atravessando quebra de linha** — achou
  `notify-orchestrator-onboarding`, que dois audits anteriores tinham perdido
- `tsc` limpo, build limpo, o único teste passando

Nada disso substitui abrir a tela. É o que dá para garantir sem navegador.

---

## Como relatar

O que mais ajuda, em ordem:

1. **O erro do console do navegador** (F12 → Console) — a mensagem da API vem
   junto e costuma dizer exatamente o que falta
2. Qual tela e o que você fez
3. Se a página recarregada resolve (distingue "estado da tela" de "dado errado")

Se aparecer **"Bucket desconhecido"**, **"Agente não encontrado"** ou
**"Canal não encontrado"** onde o item claramente existe, é quase certo um
problema de rota no backend — anote a URL que falhou.

---

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
- [`ROADMAP.md`](ROADMAP.md) — o placar e os lotes
- [`PLANO-REALTIME.md`](PLANO-REALTIME.md) — como o tempo real funciona agora
