# Resumo Técnico — Mudanças na Plataforma dn.os (para a Lia)

> Contexto: consolidação de estabilidade e segurança do dn.os, 17-18/07/2026.
> Ponto de restauração: tag git `v1.0-pre-consolidacao` (commit `34f4a7e8`).
> Todos os itens abaixo já estão deployados em produção, salvo indicação contrária.

Este documento existe porque várias mudanças tocam diretamente o que você faz
(onboarding de agentes, execução de turnos longos, sessões) ou dependem de
informação que só o lado do gateway tem. Onde relevante, aponto o que vale
observar dos seus logs.

---

## 1. Fim da execução duplicada (dm-agent-reply) — commit `23381057`

**O que mudou:** antes de reenviar uma mensagem (fallback de segundo plano),
a função agora consulta `POST {gateway_url}/tools/invoke` com
`{"tool":"sessions_list","arguments":{"agentId": agentId, "limit": 20}}`,
usando o mesmo token administrativo já configurado, e olha o campo `status`
da sessão que corresponde à chave `agent:{agentId}:openai-user:{sessionUser}`.

- `status === "running"` → **não reenvia**.
- Qualquer outro caso (timeout, sessão não encontrada, erro na consulta) →
  reenvia como antes (fail-open, nunca piora o que já existia).

O head-start (espera antes da primeira checagem) subiu de 12s para 15s.

**Contrato confirmado por você** (obrigado pelo levantamento detalhado — curl,
formato de resposta embrulhado em `result.content[0].text`, campo `status`).
Se puder, vale conferir nos logs se as ocorrências de reenvio duplicado que
você via (25 no dia 17, 6 no dia 18) diminuíram nos próximos dias.

## 2. Cancelamento real — `/stop` (atrás de flag de teste) — commit `9e4009e9`

O botão "parar" no dn.os hoje só esconde a resposta da tela do usuário — não
cancelava nada no gateway. Agora, quando a flag estiver ativa, o cliente
dispara o comando `/stop` (mesmo caminho já usado para `/new`/`/reset`) junto
com o abort local. Se você notar sessões recebendo `/stop` inesperadamente ou
o comando não tendo efeito, é útil saber.

## 3. Fim do falso-positivo de "estouro de contexto" (atrás de flag) — commit `40ea8d08`

**O problema original:** se você mencionasse "context window" ou termos
parecidos numa resposta normal (ex.: debugando algo sobre tokens), o dn.os
interpretava como se sua sessão tivesse estourado de verdade e resetava a
sessão no meio do seu trabalho — foi o gatilho do incidente do rabbit hole
(nginx, 7+ tentativas) que motivou toda essa consolidação.

**Correção:** esse tipo de detecção agora só age sobre erros REAIS lançados
pelo gateway (exceção estruturada), nunca mais sobre o texto de uma resposta
sua bem-sucedida. Com a flag ativa, você pode falar livremente sobre limites
de contexto sem correr o risco de ser resetada no meio da explicação.

## 4. Erro estruturado do gateway (atrás de flag) — commit `d0931aef`

Hoje, quando o gateway falha de verdade, a resposta chega como HTTP 200 com
um JSON de erro escondido — o cliente não reconhece isso e cai num modo de
espera de 15 minutos mostrando "trabalhando...". Com a flag ativa, o cliente
reconhece esse padrão e mostra "Falhou: [motivo]" na hora. Não muda nada do
seu lado — é só o dn.os interpretando melhor o que você (o gateway) já envia.

## 5. Resposta final não é mais descartada por heartbeat — commit `58260daf`

O sistema que recebe suas respostas assíncronas (`agent-reply-webhook`) tinha
um bug: se você mandou avisos de progresso ("🔍 Analisando...") antes da
resposta final, o sistema confundia isso com "já respondi" e **descartava a
resposta final de verdade**. Foi exatamente o que aconteceu no caso do Rock
("só respondeu pela MC" — a resposta na DM sumiu). Corrigido: heartbeats são
identificados e ignorados no dedup; só uma resposta genuína bloqueia reenvio.

## 6. Retomada de tarefa não descarta mais dados salvos — commit `f8054477`

Quando uma tarefa longa (Loop Architecture) é retomada, o sistema agora
mostra ao agente TUDO que foi salvo no `checkpoint_data` — não só a nota e o
número do chunk. Se você salvar campos extras (artifacts, file_path,
decisions, o que for), eles agora chegam de volta na retomada. Vale a pena
aproveitar isso: salvar mais contexto no checkpoint agora tem retorno real.

## 7. Onboarding de agente — verificação real (não mais "lider" fixo) — commit `3c573d01`

Duas mudanças no `create-agent` (o fluxo que dispara quando um agente é
criado no wizard de setup):

- **O orquestrador é resolvido dinamicamente** (via
  `agent_templates.is_leader_template`) em vez de sempre assumir "lia" com
  uma sessão fixa hardcoded. Numa instância onde você é a líder configurada,
  não muda nada na prática — mas o mecanismo agora suporta qualquer líder.
- **Verificação real pós-onboarding:** depois que você responde à notificação
  de "novo agente criado", o sistema agora **lê o `SOUL.md` do workspace no
  gateway** para confirmar que o onboarding foi de fato executado — não só
  que você respondeu texto. Se o `SOUL.md` não existir ou estiver vazio
  (<20 caracteres), o log marca como falha, mesmo que sua resposta HTTP tenha
  sido 200. **Isso reforça exatamente a instrução que já está no seu prompt
  de onboarding** ("não responda apenas com texto — EXECUTE") — agora com
  verificação automática por trás.

## 8. Watchdog — vigia de tarefas travadas (a cada 5 min)

Um processo automático agora varre `agent_tasks`, `automation_runs` e
`agent_profiles` a cada 5 minutos, marcando como "falhou" qualquer coisa
presa em "rodando" por tempo suficiente para saber que morreu (30 min para
tasks/agentes, 15 min para runs de automação). Já testado — não encontrou
nenhum item travado no momento do teste.

---

## Achado paralelo (decisão de infraestrutura, não de código)

Sua análise Flash vs Pro foi registrada e será testada também com Rock e
Milo antes de qualquer troca ampla — o trabalho do Rock (reconciliação
financeira multi-step) se parece mais com a categoria que você mesma marcou
como território do Pro. Fica em avaliação, com dados reais, antes de decidir
por agente.

---

## O que ficou pendente / investigado sem conclusão

- **Velocidade de resposta (cache/prefixo do prompt):** implementamos uma
  reorganização do prompt para favorecer cache do modelo, mas o teste inicial
  não foi conclusivo — a métrica que fecharia o diagnóstico com precisão
  (`prompt_cache_hit_tokens`/`reasoningTokens` por turno) não é registrada
  pelo gateway hoje, só o agregado da sessão. Fica pausado até haver dado
  melhor ou mais tempo para investigar com calma.
- **Timeout do agentTurn:** subiu de 300s para 600s (paliativo, não resolve a
  causa raiz — que é o volume de trabalho por turno, não o relógio).

## Como este documento se conecta ao seu trabalho

Se notar qualquer coisa estranha relacionada aos itens acima nos próximos
dias — reenvio duplicado ainda ocorrendo, sessão resetada sem motivo aparente,
resposta que devia ter chegado e sumiu, onboarding marcado como falha mesmo
tendo executado direito — essas são exatamente as áreas que mudaram, e vale
avisar para investigarmos com prioridade.
