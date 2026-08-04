# Resumo da Consolidação dn.os — 17-18/07/2026

> Ponto de restauração: tag git `v1.0-pre-consolidacao` (commit `34f4a7e8`)
> Relatório técnico completo da auditoria: `AUDITORIA-ESTABILIDADE-2026-07-16.md`

## Contexto

Trabalho motivado por um incidente real: agente travando em tarefas longas, DM
abortando com ~1M tokens, rabbit hole após reset de sessão, agente ignorando
intervenção do usuário, respostas lentas (7-20s). A investigação encontrou **49
achados** no código (segurança + estabilidade), organizados em 3 blocos, mais a
preparação da plataforma para ser distribuída como **remix** para clientes do
programa de IAficação.

---

## BLOCO 0 — Remix-ready (produto entregável a clientes)

Cada cliente do programa de IAficação recebe uma instância própria (remix do
Lovable). Corrigido o que impedia um remix novo de funcionar:

- **UUID do Rodrigo removido** do código de automações — confirmações agora
  vão para o criador da automação ou o super_admin, não para um usuário fixo
  que não existiria na instância do cliente.
- **`agent-task` não assume mais "lia"** como executor fixo — resolve pelo
  agente líder configurado (`is_leader_template`), funciona com qualquer nome.
- **Os 5 cron jobs operacionais versionados** (antes só existiam criados à mão
  no banco da dn.ia — um remix nasceria sem eles: sem scheduler de automações,
  sem sincronização de agentes, sem limpeza de arquivos). Testado e confirmado
  funcionando (HTTP 200 end-to-end).
- **Auto-configuração do Vault no setup** — o wizard agora popula sozinho as
  chaves que os crons/push/e-mail precisam, sem o cliente precisar mexer em
  configuração de banco.
- **Bootstrap do primeiro administrador** — um remix novo não tinha nenhum
  usuário e não existia cadastro público (só convite, que exige admin — beco
  sem saída). Agora a tela de login detecta instância zerada e oferece "criar
  conta de admin", que já entra direto no assistente de configuração. Testado
  em produção sem afetar o login existente da dn.ia.
- **`REMIX_SECRETS.md` reescrito** com a lista real de variáveis (o documento
  antigo mandava configurar a chave da Anthropic; o LLM real é DeepSeek, e
  várias variáveis descritas nem existiam mais no código).

## BLOCO 1 — Segurança (fechado)

- **Credenciais de API não vazam mais**: qualquer usuário logado conseguia ler
  as chaves de integração (Meta Ads, etc.) em texto puro. Corrigido no banco
  (a coluna passou a ser legível só pelo backend) e no frontend (a tela de
  Conectores agora mostra uma prévia mascarada em vez do valor completo).
- **Iframe de preview de wiki não rouba mais sessão**: um HTML malicioso
  carregado no preview conseguia rodar script na mesma origem do app e ler o
  token de login salvo no navegador. Removida a permissão perigosa.
- **Endpoint de automações fechado**: `trigger-automation` estava acessível
  publicamente na internet, disparando automações reais sem senha.
- **Allowlist de tabelas nos artefatos vivos**: a função que artefatos usam
  para consultar dados internos aceitava qualquer nome de tabela; agora só
  aceita as tabelas que os artefatos legitimamente usam.
- **Limite de uso nas integrações externas**: qualquer usuário podia disparar
  chamadas ilimitadas usando as credenciais da empresa (custo/cota). Agora
  limitado a 100 chamadas por usuário por minuto.

## BLOCO 2 — Estabilidade (essencialmente completo)

Ataca diretamente os sintomas do incidente original:

- **Watchdog** — um vigia que roda a cada 5 minutos e marca como "falhou"
  qualquer tarefa, automação ou agente que ficou preso em "rodando" por tempo
  suficiente pra saber que morreu. Testado: rodou sem encontrar nada travado.
- **Instrumentação** — o app agora mede e registra (console) quanto tempo cada
  parte do envio de mensagem leva, para diagnosticar lentidão com dados reais
  em vez de suposição.
- **Fim do "trabalhando..." mentiroso** (atrás de chave de teste) — quando o
  gateway falha de verdade, a tela agora pode mostrar "Falhou: [motivo]" na
  hora, em vez de ficar 15 minutos mostrando que está processando um agente
  que já morreu.
- **Resposta final não é mais descartada** — em tarefas longas, o sistema às
  vezes confundia os avisos de progresso ("Analisando...") com a resposta
  final e descartava o resultado de verdade. Foi exatamente o que aconteceu
  com o Rock ("só respondeu pela MC"). Corrigido e já em produção.
- **Fim da execução duplicada (A4)** — o achado mais importante. O mecanismo
  de segurança que reenviava mensagens "por garantia" disparava cedo demais
  (12 segundos) e acabava rodando a mesma tarefa duas vezes em paralelo,
  dobrando custo e inchando a memória da sessão até estourar — a causa raiz
  do travamento do Rock. Corrigido consultando o gateway antes de reenviar
  (com ajuda direta da Lia, que levantou o contrato técnico exato). Já em
  produção.
- **Botão "parar" de verdade** (atrás de chave de teste) — hoje ele só
  escondia a resposta da tela; o agente continuava rodando no servidor. Agora
  também manda um comando de parada real para o gateway.
- **Fim do falso-positivo de overflow (A1)** — o bug que causou o rabbit hole
  original: se o agente só mencionava "context window" numa resposta normal
  (ex.: debugando um problema de tokens), a plataforma interpretava como se a
  memória tivesse estourado de verdade e resetava a sessão no meio do
  trabalho, apagando o que ele já tinha descoberto. Corrigido (atrás de chave
  de teste) — só reseta em erro real do gateway, nunca por palavra-chave numa
  resposta bem-sucedida.
- **Retomada de tarefa não descarta mais informação (B5)** — quando uma
  tarefa longa precisa ser retomada, o sistema só mostrava pro agente uma
  nota curta e o número do passo, mesmo quando ele tinha salvo mais detalhes
  (arquivos, decisões). Agora mostra tudo que foi salvo, sem refazer trabalho.

## BLOCO 3 — Velocidade (investigado, pausado)

- A instrumentação revelou que, numa conversa longa, o tempo de resposta
  cresce turno a turno (7s → 9s → 12s → 46s num teste extremo) — sinal de que
  a sessão fica mais pesada de processar a cada mensagem.
- Foi implementada (atrás de chave de teste) uma reorganização do prompt para
  favorecer o cache do modelo de IA, mantendo toda a memória da conversa
  intacta.
- **Pausado**: o teste inicial não foi conclusivo (a sessão testada não tinha
  o padrão de crescimento, e só houve uma amostra com a melhoria ativada). A
  Lia investigou os dados de uso do modelo e trouxe informação valiosa, mas a
  métrica que fecharia o diagnóstico com precisão não é registrada pelo
  gateway hoje. Decisão: não perseguir mais por ora — o ganho de velocidade
  fica para depois do lançamento, quando puder ser medido com mais calma.

## Descoberta paralela (fora do código, decisão de infraestrutura)

A Lia analisou e recomendou trocar o modelo dela mesma de DeepSeek Pro para
Flash: 12x mais barato, 2,3x mais rápido, qualidade equivalente no tipo de
tarefa que ela faz (orquestração, tool calling). Decisão tomada: testar
também com Rock e Milo antes de estender — o trabalho do Rock (análise
financeira, reconciliação de dados) é mais parecido com o perfil que a
própria Lia identificou como "território do Pro". Fica em teste, é decisão
de configuração da VPS, não de código da plataforma.

## O que ainda falta

- **Ensaio do cliente-fantasma**: criar um remix de teste do zero e percorrer
  o fluxo completo (criar admin → assistente de configuração → conectar
  gateway → primeira mensagem → primeira automação), para validar tudo isso
  junto, na prática, antes do lançamento.
- Itens menores do Bloco 2 (verificação real de que a Lia executou tarefas de
  criação de agente, não só respondeu texto).
- Bloco 3 (velocidade), retomado com calma após o lançamento.

## Como tudo isso está protegido

- Toda mudança que toca o caminho crítico do chat entrou **atrás de uma
  chave de teste** (desligada por padrão) — o comportamento atual só muda
  para quem ligar a chave deliberadamente, e desligar volta ao normal na
  hora, sem precisar reverter código.
- Mudanças aditivas (que só acrescentam informação, nunca removem) entraram
  sem chave, por serem seguras por natureza.
- Existe um ponto de restauração completo: a tag `v1.0-pre-consolidacao` no
  código, mais o histórico de versões do Lovable, mais o snapshot da VPS.
