/**
 * Generates the official HS.OS documentation in YAML format.
 *
 * ⚠️  IMPORTANT — KEEP IN SYNC WITH src/pages/DocumentationPage.tsx
 *
 * Whenever you add/edit a section in the documentation page, update
 * this generator so both outputs stay identical.
 */

/**
 * ⚠️ **A data era `new Date()`, e isso era pior que não ter data.**
 *
 * Este arquivo é feito para virar contexto de uma LLM. Carimbar o dia do
 * download num conteúdo revisado em julho fazia o texto se apresentar como
 * atual — e uma LLM não tem como desconfiar. Ela geraria código chamando
 * `window.dnos` e edge functions que não existem, com toda a confiança.
 *
 * Agora a data é a da última revisão de verdade, e o aviso vem antes de tudo,
 * porque é a primeira coisa que precisa ser lida.
 */
const ULTIMA_REVISAO = "2026-07-18";

export function generateDocumentationYaml(): string {
  return `##############################################################################
# HS.OS — Documentação Oficial para IA
# Plataforma de Orquestração de Super agentes de IA
# Versão: 1.3 | Última revisão do conteúdo: ${ULTIMA_REVISAO}
#
# Este arquivo é otimizado para leitura por modelos de linguagem (LLMs).
##############################################################################
#
# ⚠️  ATENÇÃO — A PARTE TÉCNICA ESTÁ DESATUALIZADA
#
# A plataforma saiu do Supabase entre julho e agosto de 2026. As seções de
# arquitetura abaixo descrevem o desenho ANTERIOR. Em concreto:
#
#   - As "edge functions" citadas NÃO EXISTEM MAIS. Viraram rotas de uma API
#     própria em FastAPI. Nomes como gateway-chat, dm-agent-reply,
#     artifact-query e invoke-integration são históricos.
#   - A API dos artefatos passou de window.dnos para window.hsos. O nome
#     antigo segue funcionando, mas só como apelido de compatibilidade.
#   - O acesso ao banco não é mais direto do navegador com RLS; passa pela
#     API própria.
#
# CONTINUA VÁLIDO: visão geral, conceitos, papéis, e como as telas funcionam
# do ponto de vista de quem usa.
#
# Se você é uma LLM lendo isto para gerar ou revisar código: NÃO use os nomes
# de função, tabela ou chamada interna daqui sem conferir no repositório.
#
##############################################################################

# ═══════════════════════════════════════════════════════════════════════════
# 1. VISÃO GERAL
# ═══════════════════════════════════════════════════════════════════════════
plataforma:
  nome: HS.OS
  nome_completo: HS.OS Operating System
  descricao: >
    Plataforma central de orquestração de agentes de inteligência artificial da HS.OS.
    Permite que equipes interajam, coordenem e monitorem uma frota de agentes especializados
    em tempo real, através de uma interface unificada inspirada em sistemas operacionais de missão.
  proposta_de_valor:
    - Orquestração Centralizada — Um painel único para gerenciar todos os agentes de IA da organização.
    - Comunicação Nativa — Chat em tempo real com agentes, suporte a DMs, canais, threads e @menções.
    - Arenas de Simulação — Ambientes controlados para debates multi-agente e brainstorming.
    - Monitoramento Contínuo — Métricas de uso, saúde do gateway e logs de atividade.
    - Extensibilidade — Broadcast API para integração externa e Skills configuráveis por agente.

# ═══════════════════════════════════════════════════════════════════════════
# 2. ARQUITETURA
# ═══════════════════════════════════════════════════════════════════════════
arquitetura:
  stack:
    frontend: React 18, TypeScript 5, Vite 5
    estilizacao: Tailwind CSS v3, shadcn/ui, Design System glass/dark
    estado_cache: TanStack React Query v5
    backend: Supabase (PostgreSQL com RLS, Auth JWT, Storage, Realtime WebSocket)
    serverless: Supabase Edge Functions (Deno Runtime)
    gateway_ia: OpenClaw Gateway (configurável em Settings → Gateway)
    voz: ElevenLabs (TTS e Conversational AI)
  camadas:
    - nome: Frontend (React SPA)
      descricao: Interface do usuário com React 18, roteamento via React Router, estado via React Query
    - nome: Supabase (Backend-as-a-Service)
      componentes:
        - PostgreSQL com Row Level Security (RLS)
        - Auth com JWT
        - Realtime via WebSocket
        - Edge Functions (Deno)
        - Storage para arquivos
    - nome: OpenClaw Gateway
      descricao: Servidor central que hospeda os modelos de agentes
      endpoint: <gateway-url>/v1/chat/completions
      autenticacao: Bearer Token
      protocolo: API REST compatível com OpenAI
  diagrama: |
    ┌─────────────────────────────────────────────┐
    │              FRONTEND (React SPA)            │
    │  React 18 + Vite + Tailwind + React Query    │
    └──────────────────┬──────────────────────────┘
                       │ HTTPS / WSS
    ┌──────────────────▼──────────────────────────┐
    │           SUPABASE (Backend-as-a-Service)     │
    │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
    │  │PostgreSQL│  │ Auth     │  │ Realtime  │  │
    │  │ (RLS)    │  │ (JWT)    │  │ (WS)      │  │
    │  └──────────┘  └──────────┘  └───────────┘  │
    │  ┌──────────────────────────────────────┐    │
    │  │  Edge Functions (Deno Runtime)        │    │
    │  │  gateway-chat, channel-agent-reply,   │    │
    │  │  channel-broadcast, dm-agent-reply,   │    │
    │  │  transcribe-audio, etc.               │    │
    │  └──────────────┬───────────────────────┘    │
    └──────────────────┼──────────────────────────┘
                       │ HTTPS
    ┌──────────────────▼──────────────────────────┐
    │         OPENCLAW GATEWAY                     │
    │    <gateway-url>/v1/chat/completions          │
    │    Modelos: openclaw:{agentId}               │
    │    Auth: Bearer Token                        │
    └──────────────────────────────────────────────┘

# ═══════════════════════════════════════════════════════════════════════════
# 3. SISTEMA DE AGENTES
# ═══════════════════════════════════════════════════════════════════════════
agentes:
  descricao: >
    O HS.OS opera com 8 agentes oficiais, cada um com identidade e especialização únicas.
    Todos são acessados pelo modelo "openclaw:<agentId>".
  modelo_identidade:
    formato: "openclaw:<agentId>"
    normalizacao: >
      IDs são normalizados para lowercase, sem espaços.
      A função normalizeAgentId() remove prefixos "openclaw:" e espaços.
    exemplo: "openclaw:lia"
  catalogo:
    - id: lia
      nome: Lia
      especializacao: Orquestradora principal, coordenação de equipe, análise geral
    - id: radar
      nome: Radar
      especializacao: Inteligência de mercado, pesquisa competitiva, análise de tendências
    - id: rodrigo
      nome: RodrigoIA
      especializacao: Visão estratégica, tomada de decisão executiva
    - id: kira
      nome: Kira
      especializacao: Direção de conteúdo, copywriting, criação criativa
    - id: milo
      nome: Milo
      especializacao: Estratégia de tráfego, growth hacking, performance
    - id: sigma
      nome: Sigma
      especializacao: Pesquisa e dados, ciência de dados, análise quantitativa
    - id: cs
      nome: CS
      especializacao: Atendimento e sucesso do cliente, suporte especializado
    - id: rock
      nome: Rock
      especializacao: Agente auxiliar, tarefas complementares
  ciclo_de_vida:
    estados:
      - nome: online
        condicao: "última atividade < 5 minutos"
      - nome: idle
        condicao: "última atividade < 30 minutos"
      - nome: offline
        condicao: inativo
      - nome: error
        condicao: falhas detectadas
    metricas_tabela: agent_stats
    avatares_tabela: agent_avatars
  debate_multi_agente:
    descricao: >
      Mecanismo de orquestração multi-agente disparado por trigger no chat. Lia atua como
      mediadora: distribui a pergunta para múltiplos especialistas, coleta rebates entre
      rodadas e entrega uma síntese consolidada. Diferente de "debate" via prompting puro,
      cada agente é uma instância isolada com identidade, memória e especialização próprias.
    trigger:
      formato: "debate: @AgenteA @AgenteB @AgenteC <pergunta>"
      exemplo: "debate: @Kira @Milo @Sigma qual a melhor estratégia de conteúdo?"
    fluxo:
      - fase: Rodada 1
        descricao: >
          Cada agente responde de forma independente, sem ver as respostas dos colegas,
          aplicando sua especialidade.
      - fase: Rodada 2
        descricao: >
          Cada agente recebe as respostas da Rodada 1 e rebate — concorda, discorda
          ou complementa. Aqui emerge divergência real entre perspectivas.
      - fase: Síntese
        descricao: >
          Lia compila tudo em visão consolidada: consenso, divergências, recomendação
          final e próximo passo acionável.
      - fase: Progresso
        descricao: >
          DM em tempo real para o solicitante a cada evento — "✅ @Kira respondeu na R1",
          "🔄 Rodada 1 completa", "🌙 Sintetizando...".
    diferenciais:
      - Super agentes isolados com personalidade real (não simulação dentro do mesmo prompt)
      - Mediação por agente terceiro (Lia)
      - Rebates com divergência real entre rodadas
      - Síntese orquestrada com recomendação final
      - Progresso assíncrono via DM com timeout por agente e fallback se offline



# ═══════════════════════════════════════════════════════════════════════════
# 4. CHAT E COMUNICAÇÃO
# ═══════════════════════════════════════════════════════════════════════════
chat:
  descricao: >
    Sistema de comunicação em tempo real com agentes de IA.
    Suporta DMs, canais, threads, @menções, streaming SSE, reações e áudio.
  dual_storage:
    conversations:
      descricao: DMs diretas entre usuário e agente (1:1)
      campos: [agent_id, user_id, role (user/agent), content, media]
      uso: Chat DM clássico
    channel_messages:
      descricao: Mensagens em canais (públicos, privados, DMs de canal)
      campos: [channel_id, author_id, author_type (human/agent), content, thread_id, attachments, audio_url]
      uso: Canais, threads, DMs de canal
  streaming:
    protocolo: Server-Sent Events (SSE)
    proxy: Edge function gateway-chat
    descricao: >
      Respostas de agentes no Chat DM são recebidas via SSE através da edge function gateway-chat,
      que proxia o stream do OpenClaw Gateway. O frontend renderiza tokens incrementalmente
      com formatação Markdown em tempo real.
  mencoes:
    descricao: >
      Em canais com múltiplos agentes, @menções direcionam mensagens a agentes específicos.
      A função extractMentionedAgents() detecta @agentId ou @NomeDoAgente no texto.
      Em DMs, o agente responde automaticamente sem necessidade de menção.
  reacoes:
    descricao: >
      Mensagens em canais suportam reações com emojis. Usuários podem adicionar/remover
      reações via tabela message_reactions, com atualização em tempo real para todos os participantes.
  threads:
    descricao: >
      Mensagens em canais suportam threads (respostas aninhadas) via campo thread_id.
      A thread é exibida em painel lateral dedicado (ThreadPanel).
  notificacoes:
    descricao: >
      Cada mensagem de agente gera notificações automáticas para todos os membros humanos do canal.
      Badge na sidebar com contagem unificada de não-lidas (suporte a "99+").
    tabela: notifications
    campos: [user_id, channel_id, author_name, content_preview (100 chars), read]
  audio:
    descricao: >
      Gravação de áudio diretamente no navegador, upload ao storage,
      transcrição automática via edge function transcribe-audio.
      Transcrição exibida como texto colapsável junto ao player de áudio.
  auto_reset_sessao:
    descricao: >
      Quando uma sessão atinge o limite de tokens do agente, o HS.OS detecta automaticamente
      o erro de context overflow ("context overflow", "prompt too large", "context length",
      "token limit", "input too long", entre outros) e renova a sessão de forma transparente,
      sem expor o erro técnico ao usuário.
    fluxo:
      - Detecção automática do erro de context overflow no chat-sender (na exceção ou no texto da resposta)
      - Toast discreto exibido ao usuário "♻️ Sessão renovada automaticamente. Continuando..."
      - Chamada a POST /v1/sessions/reset (proxiada pela edge function gateway-chat com action=reset_session)
      - Reenvio automático da última mensagem do usuário com histórico reduzido (últimas 6 mensagens)
      - Salvaguarda contra loops via flag contextResetInFlight por agentId (1 tentativa)
    fallback: >
      Se o gateway não expuser o endpoint /v1/sessions/reset (404/501), a edge function retorna
      soft-ack e o reenvio prossegue. A nova requisição inicia naturalmente uma sessão fresca.
    endpoint_reset:
      url: "POST {gateway.url}/v1/sessions/reset"
      body: '{ "agentId": "<leader-agent-id>" }'
      auth: "Bearer <token>"
  aac:
    nome: Agent Activity Card
    descricao: >
      Cartão de atividade em tempo real exibido logo abaixo da mensagem do usuário quando o agente
      inicia o processamento. Consolida eventos internos (raciocínio, buscas web, tool calls, geração
      de artefatos, uso de skills) em uma linha do tempo compacta, dando transparência ao que acontece
      enquanto a resposta é gerada.
    escopo_por_turno: >
      Cada nova mensagem enviada zera o AAC — exibe apenas as atividades da interação atual, sem acúmulo
      de turnos anteriores. Um turnStartByAgentRef registra o timestamp de início por agente e o feed é
      filtrado por created_at >= currentTurnStartTs.
    estado_padrao: >
      Inicia colapsado. Processamento acontece internamente e o usuário vê apenas um badge compacto
      (ActivityStatusBadge) com contagem de eventos e chevron. Clicando no header, o AAC expande e
      revela a linha do tempo detalhada. Substitui indicadores redundantes como "pensando…" ou "buscando web…"
      enquanto ativo.
    tipos_de_evento:
      - reasoning / thinking
      - web_search
      - web_fetch
      - tool_call
      - artifact_generation
      - skill_invocation
      - media (imagem/áudio)
      - file_read
    campos_evento: [status (running/done/error), timestamp, payload_resumido]
    ui_limpa: >
      Header do AAC não repete foto nem nome do agente — essa informação já aparece na mensagem do agente
      abaixo do card. Mostra apenas badge de status, contagem de atividades, timestamp e chevron.
    persistencia:
      tabela: agent_activities
      campos: [session_id, agent_id, type, status, payload, created_at]
      uso: Revisão histórica e telemetria via /monitoring



# ═══════════════════════════════════════════════════════════════════════════
# 5. ARTEFATOS
# ═══════════════════════════════════════════════════════════════════════════
artefatos:
  descricao: >
    Conteúdos visuais ricos (dashboards, relatórios, landing pages, gráficos) gerados pelos agentes
    diretamente nas conversas. São uma das funcionalidades mais poderosas do HS.OS, permitindo que agentes
    entreguem resultados concretos e visuais sob demanda.
  geracao:
    formato: Código HTML completo dentro de blocos \`\`\`html na resposta do agente
    extrator: artifact-extractor detecta blocos automaticamente
    preview: Renderizado em ArtifactPanel dedicado
    cores_institucionais:
      azul_primario: "#3D61FF"
      vermelho: "#E41A11"
      fundo_dark: "#0a0a0a"
    regra: >
      URLs ou nomes de arquivo nunca substituem código inline.
      O extrator detecta menções a arquivos .html órfãos e exibe fallback
      orientando o usuário a solicitar o código completo.
  galeria:
    componente: ArtifactsList
    escopo: Escaneia até 200 mensagens do histórico da conversa
    funcionalidades:
      - Navegação entre artefatos
      - Exclusão individual (remove mensagem correspondente)
      - Visualização em tela cheia
  exportacao:
    formatos:
      - tipo: PDF
        biblioteca: html2pdf.js
        detalhes: Estilos otimizados para impressão com fundo claro forçado
      - tipo: DOCX
        biblioteca: docx.js
        detalhes: Conversão estruturada de tags HTML para parágrafos Word
    feedback: Toasts visuais durante processamento
  publicacao:
    descricao: >
      Artefatos podem ser publicados com URLs únicas e acessíveis sem autenticação,
      através da rota /artifact/:id.
    rota: "/artifact/:id"
    configuracoes:
      - titulo: Nome personalizado para o artefato publicado
      - expiracao: Data limite de disponibilidade do link (opcional)
      - url: Gerada automaticamente, copiável com um clique
    tabela: artifacts_published
    campos: [html_content, created_by, title, expires_at, is_public, views]
    anti_duplicidade: >
      O sistema detecta automaticamente se o conteúdo já foi publicado pelo usuário
      para exibir o link existente e evitar duplicidade.
    gerenciamento: Aba centralizada nas configurações

  artefatos_vivos:
    descricao: >
      HTML/JS que se atualiza sozinho consumindo dados reais — do banco interno via RLS
      ou de APIs externas (Meta Ads, Google Analytics, etc.) através das integrações
      configuradas na empresa. Diferente do artefato estático em bloco html, o artefato
      vivo tem um sandbox com bridge para chamar dados no servidor.
    tag_emitida_pelo_agente:
      formato: '<live_artifact title="..." refresh="60">HTML+JS</live_artifact>'
      atributos:
        - title: Título exibido no card e no viewer
        - refresh: Intervalo de auto-refresh em segundos (0 = manual)
        - id: (opcional) UUID de um artefato existente para UPDATE
      parser: src/hooks/useLiveArtifactParser.ts
      persistencia: >
        INSERT em live_artifacts para novos; UPDATE quando o atributo id é informado.
        Dedup via sessionStorage para não reinserir a cada re-render da mensagem.
    bridge_window_dnos:
      escopo: Injetada pelo LiveArtifactViewer no iframe (srcDoc) via postMessage
      metodos:
        - nome: query(tabela, opts)
          descricao: Consulta tabelas internas do usuário com RLS aplicada
          backend: Edge Function artifact-query (usa o JWT do usuário)
          opts: [select, filters, order, limit]
        - nome: invoke(integracao, opts)
          descricao: Chama APIs externas via integração configurada
          backend: Edge Function invoke-integration
          seguranca: >
            Descriptografa a credencial no servidor e injeta Authorization Bearer
            na chamada externa. A credencial nunca é exposta ao artefato/browser.
          opts: [endpoint, params]
          resolucao_endpoint: >
            Lê integration_templates.playbook.data_endpoints[nome] com path e query
            params substituíveis por opts.params.
        - nome: onRefresh(cb)
          descricao: Registra callback disparado pelo timer de auto-refresh
    galeria_e_publicacao:
      rota_privada: /artefatos
      rota_publica: /p/:slug
      modo_publico:
        invoke: Desabilitado (sem integrações para visitantes)
        query: Restrito ao que a policy public_read permite
    contexto_injetado_no_agente:
      arquivo: src/lib/live-artifacts-context.ts
      blocos:
        - Especificação técnica da tag <live_artifact> e da bridge window.dnos
        - Lista dos últimos artefatos vivos do usuário (id + título) para UPDATE por id
        - Integrações disponíveis com seus data_endpoints (nome, método, path)
        - Protocolo de geração de documentos PDF/DOCX dentro do artefato
    geracao_documentos:
      descricao: >
        Padrão oficial: agente emite a tag <generate_document type="pdf|docx" title="…">JSON</generate_document>.
        O HS.OS extrai a tag, chama a edge function generate-document (gera com pdfmake ou docx.js
        no backend Deno), sobe o arquivo em bucket privado generated-documents e renderiza um card
        com botão "Baixar" no chat. Cada clique gera signed URL fresh (1h) via sign-generated-document.
        Link nunca é persistido.
      formato_pdf: |
        <generate_document type="pdf" title="Relatório">
        { "content": [{"text": "Título", "style": "header"}, {"text": "Corpo..."}],
          "styles": {"header": {"fontSize": 18, "bold": true}} }
        </generate_document>
      formato_docx: |
        <generate_document type="docx" title="Proposta">
        { "title": "Proposta", "sections": [
          {"heading": "H1", "text": "Contexto"},
          {"text": "Parágrafo..."} ] }
        </generate_document>
      persistencia:
        tabela: public.generated_documents (id, user_id, agent_id, title, doc_type, storage_path, size_bytes, created_at)
        bucket: generated-documents (privado, RLS owner-only por primeira pasta = user_id)
        rls: usuário vê/deleta apenas próprios documentos
      edge_functions:
        - generate-document: valida JWT, gera arquivo, upload, insert row → retorna { document }
        - sign-generated-document: valida ownership, retorna signed URL 1h com Content-Disposition attachment
      regras_agente:
        - PROIBIDO responder "PDF gerado com sucesso" sem emitir a tag <generate_document>
        - PROIBIDO colar conteúdo do documento como texto/markdown no lugar do arquivo
        - PROIBIDO usar <live_artifact> para entregar PDF/DOCX (essa tag é só para painéis interativos)
        - PROIBIDO usar window.dnos.downloadPDF/downloadDOCX para entregar arquivo (obsoletos como via de download)
        - JSON dentro da tag deve ser válido; PDF segue formato pdfmake, DOCX segue { title, sections: [] }
      arquitetura_dupla_ponta:
        frontend_lovable:
          - src/hooks/useGenerateDocumentParser.ts (parser + invoke)
          - src/components/chat/GeneratedDocumentCard.tsx (card com loading/ready/error)
          - src/components/chat/ArtifactMessage.tsx (integração)
          - src/lib/live-artifacts-context.ts (bloco imperativo injetado no prompt)
        backend_dnia_vps:
          - SOUL.md de cada agente deve referenciar <generate_document> e remover instruções antigas
            de gerar PDF via <live_artifact> ou window.dnos.downloadPDF.

    filtro_contexto:
      arquivo: src/lib/chat-sender.ts (função toChatMessages)
      motivo: >
        HTML de artefatos (~15KB por live_artifact) era reinjetado no contexto do
        modelo em todo turno seguinte, causando timeouts e travamento do thinking.
      filtros_aplicados_em_ordem:
        - Limitar histórico às 3 mensagens mais recentes (slice(-3))
        - stripArtifacts substitui <live_artifact>/<artifact> por [Artifact: título]
        - capMessage trunca cada mensagem de histórico a 2KB
      escopo: >
        Afeta apenas o payload enviado ao gateway OpenClaw. A UI, o LiveArtifactCard
        e o viewer continuam renderizando o HTML completo normalmente.
    tabela: live_artifacts
    campos: [id, user_id, agent_id, title, html_content, refresh_interval, is_published, published_slug, published_at, last_refreshed_at, view_count, metadata]




# ═══════════════════════════════════════════════════════════════════════════
# 6. SISTEMA DE CANAIS
# ═══════════════════════════════════════════════════════════════════════════
canais:
  tipos:
    - tipo: public
      descricao: Canais abertos para todos os membros autenticados
    - tipo: private
      descricao: Canais restritos a membros convidados
    - tipo: dm
      descricao: Mensagens diretas (1:1 ou com agente)
  membros:
    tabela: channel_members
    campo_tipo: member_type (human | agent)
    descricao: >
      Super agentes podem ser adicionados a qualquer canal.
      Respondem a @menções em canais ou automaticamente em DMs.
  realtime:
    protocolo: Supabase Realtime (WebSocket)
    tabelas_publicadas: [channel_messages, notifications]
    descricao: >
      Novas mensagens são sincronizadas em tempo real via Supabase Realtime (WebSocket).
      Mensagens aparecem instantaneamente para todos os participantes.

# ═══════════════════════════════════════════════════════════════════════════
# 7. ARENAS
# ═══════════════════════════════════════════════════════════════════════════
arenas:
  descricao: >
    Ambientes de simulação multi-agente onde até 7 agentes debatem, colaboram ou analisam
    um tema específico em conjunto. Cada arena possui configuração própria de agentes, papéis e comportamento.
  fluxo_criacao:
    descricao: >
      Chamada síncrona ao endpoint que retorna metadados estruturados da persona.
      Usuário seleciona agentes, atribui papéis, define prompts base e escolhe templates.
    templates_categorias: [Vendas, Conteúdo, Estratégia, etc.]
  tabelas:
    arenas:
      descricao: Definição da arena (nome, prompt, agentes, configuração de persona/voz)
      campos_especiais: [react_code, voice_id, convai_agent_id, system_prompt, opening_message]
    arena_agents:
      descricao: Relacionamento arena ↔ agente com papéis
      campos: [arena_id, agent_id, role_name, role_description, is_primary]
    arena_sessions:
      descricao: Sessões de conversa com suporte a sub-sessões
      campos: [arena_id, parent_session_id, context_summary, title]
    arena_messages:
      descricao: Mensagens da sessão
      campos: [session_id, agent_id, agent_role, content, artifact_html, role]
    arena_templates:
      descricao: Templates pré-configurados
      campos: [name, base_prompt, agents (JSON), suggested_sessions, emoji]
  modo_debate:
    descricao: >
      Fluxo sequencial onde cada agente contribui com sua perspectiva especializada,
      citando colegas nominalmente para criar um diálogo coerente. Ao final da rodada,
      gera automaticamente uma síntese executiva consolidando os pontos principais
      de todos os participantes.
  heranca_contexto:
    descricao: >
      Sub-sessões herdam contexto da sessão pai via parent_session_id e context_summary.
      Permite ramificações de conversa sem perder contexto acumulado.
  sandbox_react:
    descricao: >
      Arenas podem gerar artefatos visuais em HTML/React renderizados em sandbox isolado.
      O campo react_code permite interfaces customizadas por arena.
      O campo artifact_html nas mensagens permite visualização inline de resultados.
      Artefatos de arena também podem ser exportados em PDF/DOCX e publicados com links públicos.
  voz:
    provedor: ElevenLabs (ConvAI)
    ativacao: Toggle explícito; se desativado, opera em modo texto puro
    campos: [voice_id, convai_agent_id]

# ═══════════════════════════════════════════════════════════════════════════
# 8. GATEWAY E PROXY
# ═══════════════════════════════════════════════════════════════════════════
gateway:
  descricao: >
    O OpenClaw Gateway é o servidor central que hospeda todos os modelos de agentes.
    A URL é configurada por install em Settings → Gateway (tabela public.vps_config).
    O HS.OS se comunica via API REST compatível com OpenAI.
  endpoint:
    url: "<gateway-url>/v1/chat/completions"
    metodo: POST
    autenticacao: "Bearer <token>"
    content_type: "application/json"
    body:
      model: "openclaw:<agentId>"
      messages: "array de mensagens"
      stream: "boolean (true para SSE, false para síncrono)"
      userId: "string (opcional)"
  proxy:
    edge_function: gateway-chat
    descricao: >
      Proxy CORS entre frontend e gateway. Carrega config da tabela app_settings (chave "gateway_config").
      Suporta requisições síncronas e streaming SSE. Timeout: 180 segundos.
      Erros traduzidos em mensagens amigáveis.
  health_check:
    endpoint: "GET /api/health"
    indicador: Sidebar mostra "Gateway Online/Offline"
    tabela: gateway_health (latência, uptime, versão)
  control_plane_admin:
    descricao: >
      Plugin admin-http-rpc do OpenClaw (bundled, desligado por padrão — setup.sh
      ativa na instalação). Expõe POST /api/v1/admin/rpc para gerenciar o Gateway
      via HTTP: criação/config de agentes, crons, status de sessões e credenciais
      de provedores de LLM (models.providers.*).
    metodos_confirmados:
      - "config.get — lê a config completa (payload.parsed.models.providers)"
      - "config.patch — params: { raw: <objeto de config> }, SEM hash — faz merge aditivo"
      - "gateway.restart.request — recarrega o Gateway (derruba sessões ativas)"
      - "sessions_list (via /tools/invoke) — status de sessão: running/done/timeout/aborted"
    rate_limit: "3 requisições por 60s no método config.patch"
    aviso: >
      config.patch NÃO aceita array de operações RFC 6902 — só o formato raw
      (objeto de config completo do trecho alterado, mesclado por cima do atual).

# ═══════════════════════════════════════════════════════════════════════════
# 9. EDGE FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════
edge_functions:
  runtime: Supabase Edge Functions (Deno)
  catalogo:
    - nome: gateway-chat
      descricao: >
        Proxy CORS para OpenClaw Gateway. Streaming SSE e síncrono.
        Timeout: 180s. Traduz erros do gateway em mensagens amigáveis.
    - nome: channel-agent-reply
      descricao: >
        Gera resposta de agente em canal. Carrega histórico (últimas N mensagens),
        envia ao gateway, insere mensagem e notifica membros humanos.
        Valida que agente é do catálogo oficial.
    - nome: channel-broadcast
      descricao: >
        API externa para envio de mensagens a canais/DMs.
        Suporta POST (mensagem/resultado), GET (histórico/usuários), DELETE.
        Auth via header x-api-key. Suporta DMs agente-agente (A2A).
    - nome: dm-agent-reply
      descricao: >
        Resposta de agente em DMs diretas (tabela conversations). Fire-and-forget:
        dá um head-start de 15s ao streaming em primeiro plano e, se nenhuma
        resposta foi persistida, consulta o status real da sessão no gateway
        (sessions_list via /tools/invoke) antes de agir — evita execução
        duplicada quando o agente ainda está processando um turno longo.
    - nome: transcribe-audio
      descricao: >
        Transcrição de áudio usando serviço externo.
        Recebe arquivo de áudio e retorna texto transcrito.
    - nome: chat-image-vision
      descricao: Processamento de imagens enviadas no chat usando modelos de visão.
    - nome: collect-agent-stats
      descricao: Coleta periódica de métricas dos agentes (mensagens, tokens, custos, erros).
    - nome: cleanup-expired-files
      descricao: Limpeza automática de arquivos expirados no storage (>6h).
    - nome: invite-user
      descricao: Convite de novos usuários ao sistema com geração de link de acesso.
    - nome: monitoring-proxy
      descricao: Proxy para coleta de dados de monitoramento do gateway.
    - nome: auth-email-hook
      descricao: >
        Hook de e-mail customizado para templates de autenticação
        (signup, recovery, magic-link, etc).
    - nome: process-email-queue
      descricao: Processamento de fila de e-mails transacionais com retry e DLQ.
    - nome: send-push
      descricao: Envio de notificações Web Push (VAPID) para subscriptions registradas.
    - nome: admin-reset-password
      descricao: Reset de senha administrativo (super_admin) para usuários da plataforma.
    - nome: artifact-query
      descricao: >
        Backend da bridge window.dnos.query() dos artefatos vivos. Consulta tabelas
        internas usando o JWT do usuário (RLS aplicada). Suporta table, select, filters,
        order e limit.
    - nome: invoke-integration
      descricao: >
        Backend da bridge window.dnos.invoke(). Autentica o usuário, lê credenciais da
        tabela integrations (service role), resolve o endpoint pelo data_endpoints do
        playbook em integration_templates e chama a API externa com Authorization Bearer.
        Credenciais nunca saem do servidor.
    - nome: agent-task
      descricao: >
        CRUD do Loop Architecture (tarefas autônomas de longa duração dos agentes).
        Aceita JWT do usuário OU o secret compartilhado dos agentes para chamadas
        do gateway (autonomia total entre agentes — é assim que o orquestrador
        coordena os demais). Humanos com papel abaixo de "member" não conseguem
        mais retomar/concluir/falhar/pausar/apagar tarefa alheia (checagem de role).
        Ações: create, checkpoint, resume, complete, fail, pause, delete, list, get.
        Persiste chunks + checkpoint_data (qualquer campo extra é preservado e
        reexibido na retomada) em agent_tasks para retomada sem memória de sessão.
    - nome: configure-llm-provider
      descricao: >
        Escreve a api_key de um conector LLM (categoria "llm" em integrations) no
        cofre do Gateway do cliente via admin-http-rpc (config.patch), reinicia e
        confirma que a chave ficou gravada. Fecha a ponte que faltava para um
        remix novo: a área de Conectores só gravava a chave no Supabase, nunca
        no Gateway — "configurar a LLM" não fazia a plataforma funcionar. Só
        super_admin. Aditiva até ser ligada a um botão na UI.

# ═══════════════════════════════════════════════════════════════════════════
# 10. BANCO DE DADOS
# ═══════════════════════════════════════════════════════════════════════════
banco_de_dados:
  engine: PostgreSQL (via Supabase)
  rls: Ativado em todas as tabelas
  funcoes_seguranca:
    - nome: has_role(_user_id, _role)
      tipo: SECURITY DEFINER
      descricao: Verifica se usuário tem role específico sem recursão RLS
    - nome: is_channel_member(_channel_id, _user_id)
      tipo: SECURITY DEFINER
      descricao: Verifica participação em canal
    - nome: is_public_channel(_channel_id)
      tipo: SECURITY DEFINER
      descricao: Verifica se canal é público
    - nome: get_user_role(_user_id)
      descricao: Retorna o role do usuário
    - nome: find_or_create_dm(_target_user_id, _target_name)
      descricao: Cria ou encontra canal DM entre dois usuários
    - nome: find_or_create_agent_dm(_agent_id, _agent_name, _target_user_id)
      descricao: Cria ou encontra canal DM humano-agente
    - nome: find_or_create_agent_agent_dm(_sender_agent_id, _recipient_agent_id)
      descricao: Cria ou encontra canal DM agente-agente
    - nome: get_fleet_productivity(_since)
      descricao: Retorna métricas de produtividade dos agentes
    - nome: get_agents_last_activity(_agent_ids)
      descricao: Retorna última atividade de cada agente
  nota_rls: >
    Todas as tabelas possuem RLS ativado. As políticas utilizam funções SECURITY DEFINER
    como has_role(), is_channel_member() e is_public_channel() para verificar permissões sem recursão.
    Edge Functions utilizam SUPABASE_SERVICE_ROLE_KEY para bypass de RLS quando necessário.
  enums:
    - nome: app_role
      valores: [super_admin, member, user]
    - nome: author_type
      valores: [human, agent]
    - nome: channel_type
      valores: [public, private, dm]
  tabelas:
    - nome: profiles
      descricao: Perfis de usuários (nome, email, avatar, status)
    - nome: user_roles
      descricao: Papéis dos usuários (super_admin, member, user) — tabela separada do perfil
    - nome: channels
      descricao: Canais de comunicação (public, private, dm)
    - nome: channel_messages
      descricao: Mensagens em canais com suporte a threads e anexos
    - nome: channel_members
      descricao: Associação de usuários/agentes a canais
    - nome: conversations
      descricao: DMs diretas entre usuário e agente (dual-storage)
    - nome: notifications
      descricao: Notificações de novas mensagens para usuários
    - nome: message_reactions
      descricao: Reações (emojis) em mensagens de canal
    - nome: arenas
      descricao: Definição de arenas multi-agente
    - nome: arena_sessions
      descricao: Sessões de conversa em arenas
    - nome: arena_messages
      descricao: Mensagens nas sessões de arena com suporte a artifact_html
    - nome: arena_agents
      descricao: Configuração de agentes por arena com papéis
    - nome: arena_templates
      descricao: Templates pré-configurados de arena
    - nome: agent_stats
      descricao: Métricas coletadas dos agentes (mensagens, tokens, custo, erros)
    - nome: agent_avatars
      descricao: Avatares customizados dos agentes
    - nome: agent_results
      descricao: Resultados/entregas registradas pelos agentes
    - nome: agent_crons
      descricao: Tarefas agendadas dos agentes
    - nome: agent_tasks
      descricao: >
        Loop Architecture — tarefas autônomas de longa duração. Guarda chunks (lista de
        passos), status (running/checkpoint/done/failed), checkpoint_data (contexto de
        retomada) e agent_id/created_by. Populada e retomada pela edge function agent-task.
    - nome: teams
      descricao: Definição de times
    - nome: team_agents
      descricao: Associação de agentes a times
    - nome: app_settings
      descricao: Configurações da aplicação (gateway, branding, etc.)
    - nome: branding
      descricao: Identidade visual (logo, cor primária, nome da empresa)
    - nome: gateway_health
      descricao: Saúde do gateway (latência, uptime, versão)
    - nome: usage_daily
      descricao: Métricas de uso diário agregadas
    - nome: cron_jobs
      descricao: Jobs agendados do sistema
    - nome: access_logs
      descricao: Logs de acesso e ações dos usuários
    - nome: drafts
      descricao: Rascunhos de mensagens persistidos por usuário
    - nome: artifacts_published
      descricao: Artefatos HTML publicados com link público
    - nome: live_artifacts
      descricao: >
        Artefatos vivos (HTML/JS com auto-refresh). Consumidos via bridge window.dnos
        no LiveArtifactViewer. Publicáveis por slug em /p/:slug.
    - nome: integrations / integration_templates
      descricao: >
        Credenciais criptografadas de APIs externas e playbooks (com data_endpoints)
        consumidos pela Edge Function invoke-integration.
    - nome: wiki_spaces
      descricao: Espaços (categorias) da Base de Conhecimento
    - nome: wiki_documents
      descricao: Documentos da Base de Conhecimento (TipTap JSON/HTML, anexos, vídeos)
    - nome: push_subscriptions
      descricao: Assinaturas Web Push (endpoint, keys p256dh/auth) por usuário
    - nome: access_logs
      descricao: Logs de acesso e ações
    - nome: email_send_log / email_send_state / suppressed_emails / email_unsubscribe_tokens
      descricao: Pipeline transacional de e-mails (envio, deduplicação, supressão, unsubscribe)

# ═══════════════════════════════════════════════════════════════════════════
# 11. AUTENTICAÇÃO E PERMISSÕES
# ═══════════════════════════════════════════════════════════════════════════
autenticacao:
  metodo: Supabase Auth com JWT
  roles:
    - nome: super_admin
      acesso: >
        Acesso total: todos os módulos, monitoramento, gestão de usuários, settings
    - nome: member
      acesso: >
        Acesso operacional: agentes, chat, arenas, files, sessions, skills, teams, documentação
    - nome: user
      acesso: >
        Acesso básico: chat, perfil, resultados
  implementacao:
    roles_tabela: user_roles (separada do perfil para evitar privilege escalation)
    verificacao_rls: Função has_role() com SECURITY DEFINER
    componente_frontend: ProtectedRoute verifica autenticação e roles
    sidebar: Filtra dinamicamente itens de navegação com base no role
    sessoes: Sem logout automático por inatividade; encerramento manual
    logs: Registros em access_logs
  seguranca:
    - Roles armazenados em tabela separada (user_roles), nunca no perfil
    - Função has_role() com SECURITY DEFINER para evitar recursão RLS
    - Sessões sem logout automático por inatividade; encerramento apenas via comando manual
    - Logs de acesso registrados na tabela access_logs

# ═══════════════════════════════════════════════════════════════════════════
# 12. SKILLS E BROADCAST API
# ═══════════════════════════════════════════════════════════════════════════
skills:
  descricao: >
    Capacidades modulares que estendem o comportamento dos agentes. Cada skill descreve um conjunto de
    instruções, ferramentas ou padrões de resposta que o agente passa a incorporar. A página /skills
    oferece um catálogo com busca, filtros e gestão completa (criar, editar, ativar/desativar, excluir).
  pagina: /skills
  ativacao_por_agente: >
    Skills são globais no catálogo mas ativadas por agente. Cada agente possui seu próprio conjunto de
    skills ativas, injetadas no prompt de sistema (SOUL.md / AGENTS.md) no momento da requisição ao gateway.
    Se um agente não tiver skills configuradas, um catálogo fallback é aplicado conforme o perfil oficial.
  estrutura:
    name: Identificador legível (ex. "web_research", "financial_analysis")
    description: Resumo do que a skill faz e quando o agente deve acioná-la
    instructions: Bloco de instruções injetado no prompt de sistema do agente
    category: [research, analytics, communication, productivity, custom]
    enabled: Flag global (skill disponível no catálogo)
    agent_mappings: Relação N:N entre skills e agentes
  gerenciamento_ui:
    dialogo: ManageSkillDialog
    edicao: [name, description, instructions, agent_mappings]
    exclusao: >
      Ação isolada em "Zona de perigo" no final do diálogo, com AlertDialog de confirmação secundária.
      Nunca próxima ao botão de fechar (X), para evitar remoção acidental. Remove também todos os
      mapeamentos agente↔skill associados.
  fluxo_runtime: >
    Ao enviar mensagem para um agente, o gateway carrega o catálogo de skills ativas e anexa as instruções
    ao prompt de sistema. O AAC (Agent Activity Card) sinaliza a invocação como eventos skill_invocation,
    permitindo observabilidade em tempo real. Estatísticas de uso ficam disponíveis em /monitoring → aba Skills.



broadcast_api:
  descricao: >
    API REST externa autenticada via header x-api-key que permite sistemas externos
    interagirem com o HS.OS.
  edge_function: channel-broadcast
  autenticacao: "Header x-api-key com valor da secret BROADCAST_API_KEY"
  endpoints:
    - metodo: POST
      acao: Enviar mensagem a canal
      body: '{ "channel": "nome_ou_id", "sender_name": "Nome", "message": "texto" }'
    - metodo: POST
      acao: Enviar DM a usuário
      body: '{ "channel": "dm", "to": "email_ou_uuid", "sender_name": "Nome", "message": "texto" }'
    - metodo: POST
      acao: DM agente-agente (A2A)
      body: '{ "channel": "dm", "to": "agent_id", "sender_name": "Nome", "message": "texto" }'
      nota: Dispara resposta automática do agente destinatário
    - metodo: POST
      acao: Registrar resultado de agente
      body: '{ "type": "result", "agent_id": "id", "title": "Título", "description": "Desc", "category": "cat" }'
    - metodo: GET
      acao: Listar mensagens de canal
      params: "?channel=nome_ou_id&limit=50"
    - metodo: GET
      acao: Listar usuários ativos
      params: "(sem parâmetros)"
    - metodo: DELETE
      acao: Excluir mensagem
      body: '{ "message_id": "uuid" }'
      nota: Remove mensagem com verificação prévia e limpeza de notificações associadas
  exemplo_uso: |
    # Enviar mensagem a um canal
    curl -X POST \\
      https://<supabase-url>/functions/v1/channel-broadcast \\
      -H "x-api-key: <BROADCAST_API_KEY>" \\
      -H "Content-Type: application/json" \\
      -d '{
        "channel": "geral",
        "sender_name": "Lia",
        "message": "Olá equipe! 👋"
      }'

    # Registrar resultado de agente
    curl -X POST \\
      https://<supabase-url>/functions/v1/channel-broadcast \\
      -H "x-api-key: <BROADCAST_API_KEY>" \\
      -H "Content-Type: application/json" \\
      -d '{
        "type": "result",
        "agent_id": "radar",
        "title": "Relatório Semanal",
        "description": "Análise completa de mercado",
        "category": "report"
      }'

# ═══════════════════════════════════════════════════════════════════════════
# 13. MONITORAMENTO
# ═══════════════════════════════════════════════════════════════════════════
monitoramento:
  pagina: /monitoring
  acesso: Restrito a super_admin
  abas:
    - nome: Super agentes
      descricao: Status em tempo real de cada agente (online/idle/offline/error), última atividade, modelo em uso
    - nome: Gateway
      descricao: Saúde do OpenClaw Gateway (latência, uptime, versão, status de conexão)
    - nome: Uso
      descricao: Métricas diárias (total de mensagens, tokens consumidos, custo, taxa de erro, cache hit rate)
    - nome: Cron
      descricao: Jobs agendados (expressão cron, última/próxima execução, status ativo/inativo)
    - nome: Skills
      descricao: Inventário de skills disponíveis e ativas por agente
  coleta:
    edge_function: collect-agent-stats
    tabelas: [agent_stats, gateway_health, usage_daily]
    descricao: >
      A edge function collect-agent-stats é responsável pela coleta periódica de métricas.
      Os dados permitem análise histórica e detecção de anomalias.
  resiliencia_automatica:
    descricao: >
      O HS.OS tem mecanismos automáticos de recuperação, sem exigir intervenção manual do usuário.
    mecanismos:
      - nome: Fim da execução duplicada
        descricao: >
          Antes de reenviar uma mensagem que demora, o sistema pergunta ao Gateway se o agente
          ainda está processando; só reenvia se tiver certeza de que não está.
      - nome: Vigia de tarefas travadas
        descricao: >
          A cada 5 minutos, um processo automático varre tarefas, automações e agentes presos
          em "rodando" por tempo suficiente pra saber que morreram, e marca como falha sozinho.
      - nome: Erro real em vez de "processando" falso
        descricao: >
          Quando o Gateway falha de verdade, o usuário vê o motivo na hora, em vez de aguardar
          minutos por um agente que já parou.
      - nome: Aviso de falha visível
        descricao: >
          Tanto em DMs quanto em canais, se a resposta não chegar, aparece uma mensagem de erro
          visível — nunca silêncio total.
    limite_conhecido: >
      Se um agente concluir uma tarefa longa mas a conexão cair exatamente na entrega, hoje não
      existe forma de recuperar o texto da resposta sem o agente reexecutar — a correção definitiva
      depende do Gateway (fora do HS.OS) empurrar o resultado ativamente ao concluir um turno.

# ═══════════════════════════════════════════════════════════════════════════
# 14. ARQUIVOS E STORAGE
# ═══════════════════════════════════════════════════════════════════════════
arquivos:
  storage:
    provedor: Supabase Storage
    bucket: agent-files
    signed_url_validade: 6 horas (21600 segundos)
  upload:
    fluxo: >
      Ao enviar arquivo, gera signed URL e encaminha referência ao agente:
      "O usuário enviou o arquivo <nome>. Acesse em: <signed_url>. Use web_fetch para ler quando necessário."
    tipos_suportados:
      - Imagens (preview inline, lightbox, processamento via chat-image-vision)
      - PDFs (preview integrado via pdfjs-dist)
      - Documentos Word (extração via mammoth.js)
      - Arquivos genéricos
  ciclo_de_vida:
    limpeza: >
      Um cron job automático (cleanup-expired-files) limpa arquivos com mais de 6 horas
      para manter conformidade com o tempo de expiração dos links e economizar espaço no bucket.
    pagina: /files para gerenciamento centralizado
  rascunhos:
    tabela: drafts
    descricao: >
      Mensagens em composição salvas automaticamente como rascunhos,
      associadas ao usuário e ao canal/conversa.
      Ao retornar a uma conversa, o rascunho é restaurado automaticamente.
  acesso_pasta_local:
    descricao: >
      Recurso que permite ao agente ler, criar, editar e listar arquivos diretamente
      em uma pasta do computador do usuário, via File System Access API do navegador.
      Não há upload — os arquivos nunca saem da máquina do usuário.
    suporte:
      browsers: [Chrome, Edge, Brave, Opera] # desktop apenas
      nao_suportado: [Safari, Firefox] # botão é ocultado automaticamente
    fluxo:
      conexao: >
        Usuário clica no botão de pasta no composer (RichComposer) e escolhe um diretório.
        O handle é persistido em IndexedDB (db: dnos-fs, store: folder-handles) e
        restaurado automaticamente nas próximas sessões enquanto a permissão estiver ativa.
      operacoes: >
        O agente emite tags <file_op>{"action":"...","path":"...","content":"..."}</file_op>
        em suas respostas. Ações suportadas: read, write, create, list. O navegador
        executa localmente e devolve o resultado na próxima mensagem do usuário com
        prefixo "[Resultado de file_op ...]" ou "[Erro em file_op ...]".
      feedback_loop: >
        ArtifactMessage dispara CustomEvent "dnos:file-op-result" após executar a operação.
        ChatPage escuta e envia mensagem sintética ao agente automaticamente, eliminando
        timeouts. EXECUTED_OPS (Set global) deduplica execuções durante streaming/re-render.
      desconexao: >
        Usuário pode desconectar via FolderBadge (X) no header ou botão "Desconectar pasta"
        no FilePanelDrawer. Ao desconectar, ArtifactMessage bloqueia qualquer file_op novo
        e ChatPage notifica o agente via mensagem de sistema para que ele pare de tentar
        acessar arquivos.
    componentes:
      hook: src/hooks/useFileSystem.ts (readFile, writeFile, listFiles, requestAccess, revokeAccess)
      contexto: src/contexts/FileSystemContext.tsx (FileSystemProvider envolvendo App)
      botao_composer: src/components/chat/FolderButton.tsx
      badge_header: src/components/chat/FolderBadge.tsx
      drawer: src/components/chat/FilePanelDrawer.tsx
      card_operacao: src/components/chat/FileOpCard.tsx
      parser: src/hooks/useFileOpParser.ts (stripFileOps + execução)
      executor: src/components/chat/ArtifactMessage.tsx (FileOpsRenderer)
      injecao_prompt: src/lib/file-system-state.ts (buildLocalFolderSystemPrompt)
    persistencia: >
      Tudo é local. Não há tabelas Supabase nem migrations. O handle da pasta vive em
      IndexedDB; o conteúdo dos arquivos vive na máquina do usuário.
    limitacoes:
      - Conteúdo grande de arquivos passa pelo contexto do agente (limite de tokens aplica).
      - Apenas texto puro hoje (md, txt, html, csv, json). Sem geração de .docx/.pdf binário.
      - Permissão da File System Access API pode expirar — o useFileSystem revalida via queryPermission e exige nova autorização se negada.



# ═══════════════════════════════════════════════════════════════════════════
# 15. BASE DE CONHECIMENTO (WIKI)
# ═══════════════════════════════════════════════════════════════════════════
base_de_conhecimento:
  pagina: /base-de-conhecimento
  descricao: >
    Módulo de documentos colaborativos no estilo Notion/Confluence. Organiza conteúdo
    em Espaços (spaces) com documentos editáveis via TipTap, suportando rich text,
    imagens redimensionáveis, vídeos, anexos (PDF, DOCX, HTML) e preview.
  componentes:
    editor: DocumentEditor (TipTap) — guarda contra editor destruído em onUpdate/setContent
    sidebar: SpacesSidebar — navegação de spaces e documentos
    home: WikiHome — landing com documentos recentes
    preview: PreviewModal e rota dedicada /wiki-html-preview para abrir HTML em nova aba
  tabelas:
    wiki_spaces:
      campos: [id, name, icon, description, created_by]
    wiki_documents:
      campos: [id, space_id, title, content (JSON TipTap), html, attachments, created_by, updated_at]
  preview_html:
    rota: "/wiki-html-preview"
    descricao: >
      Anexos HTML são abertos em nova aba renderizando o conteúdo via iframe srcDoc
      com sandbox (allow-scripts, allow-forms, allow-popups, allow-modals, allow-downloads).
      URL/filename trafegam via localStorage chave wiki-html-preview:<ts>:<rand> ou query params.
  persistencia_selecao:
    descricao: >
      A seleção de space/documento é persistida em sessionStorage (chave wiki:selection)
      e refletida na URL via query params, sobrevivendo a refetch por refoco de aba.

# ═══════════════════════════════════════════════════════════════════════════
# 16. BRANDING / WHITE-LABEL
# ═══════════════════════════════════════════════════════════════════════════
branding:
  descricao: >
    Identidade visual configurável dinamicamente: nome da empresa, logo e cor primária.
    Aplicado em sidebar, header, e-mails transacionais e telas públicas.
  tabela: branding
  campos: [company_name, logo_url, primary_color]
  hook: useBranding()
  configuracao: Aba "Branding" em /settings (super_admin)

# ═══════════════════════════════════════════════════════════════════════════
# 17. TTS ELEVENLABS (GLOBAL)
# ═══════════════════════════════════════════════════════════════════════════
tts:
  provedor: ElevenLabs
  escopo: Global (chat DM, canais, arenas)
  descricao: >
    Síntese de voz para respostas de agentes. Cada agente possui voice_id padrão
    configurável. Toggle por usuário; sem auto-play obrigatório.
  configuracao: app_settings (chave elevenlabs_config) e voice_id por agente

# ═══════════════════════════════════════════════════════════════════════════
# 18. NOTIFICAÇÕES PUSH (WEB PUSH)
# ═══════════════════════════════════════════════════════════════════════════
push_notifications:
  descricao: >
    Notificações fora da aba via Web Push API. Service Worker (src/sw.ts) registra
    subscription com chaves VAPID; backend envia via edge function send-push.
  componentes:
    service_worker: src/sw.ts
    cliente: src/lib/push-notifications.ts
    banner: NotificationsPermissionBanner (solicita permissão)
  tabela: push_subscriptions (endpoint, p256dh, auth, user_id)
  envio: Edge function send-push (payload web-push com VAPID)

# ═══════════════════════════════════════════════════════════════════════════
# 19. INTEGRAÇÕES EXTERNAS (CONECTORES)
# ═══════════════════════════════════════════════════════════════════════════
integracoes_conectores:
  descricao: >
    Aba "Integrações" em /settings (restrita a super_admin) para cadastrar credenciais
    de serviços externos consumidos pelos agentes via gateway e edge functions.
    As chaves são armazenadas de forma segura na tabela integrations e nunca expostas no frontend.
  tipos:
    - tipo: api_key
      descricao: Credencial única (uma chave por serviço)
      exemplos: OpenAI, Anthropic, DeepSeek, Groq, ElevenLabs
    - tipo: multi_key
      descricao: Múltiplos campos obrigatórios/opcionais (templates pré-definidos + Personalizada)
      exemplos: AWS (Access Key + Secret), Twilio, SendGrid
    - tipo: mcp
      descricao: Servidores MCP (Model Context Protocol) — URL + token de autenticação
      exemplos: MCPs personalizados, conectores próprios
  fluxo_cadastro: >
    Modal em 3 passos — categoria (LLM, Comunicação, Pagamento, MCP, etc.) → integração
    (template conhecido ou Personalizada) → formulário com campos derivados do template.
    Para categoria MCP, o tipo é fixo. Cards listam cada integração com badge (ícones Lucide, sem emojis).

# ═══════════════════════════════════════════════════════════════════════════
# 20. INTEGRAÇÕES EXTERNAS DE AGENTES (TELEGRAM, SLACK, WHATSAPP)
# ═══════════════════════════════════════════════════════════════════════════
integracoes_agentes:
  descricao: >
    Cada agente pode estar conectado a canais externos (Telegram, Slack, WhatsApp).
    A informação NÃO é armazenada no Supabase — vive no OpenClaw Gateway e é consultada
    em tempo real via endpoints /api/agents/:id/integrations e /api/agents/integrations.
  hook: useAgentIntegrations / useAllIntegrations (use-integrations.ts)
  ui: Badges de conexão no detalhe do agente e na lista da frota

# ═══════════════════════════════════════════════════════════════════════════
# 21. SETTINGS — ABAS UNIFICADAS
# ═══════════════════════════════════════════════════════════════════════════
settings:
  rota: /settings
  descricao: >
    Página única com abas controladas via query param ?tab=. Rotas antigas
    (/profile, /users, /documentation, /mission-control, /dnos) são redirects
    para abas específicas.
  abas:
    - profile — Dados pessoais, avatar, e-mail
    - users — Gestão de usuários (super_admin), convites, roles
    - dnos — Mission Control / configurações da operação
    - documentation — Documentação técnica (YAML gerado por dnos-documentation-yaml.ts)
    - integrations — Conectores externos
    - identity — White-label / Branding (logo, cor, nome)
    - artifacts — Artefatos criados (preview em iframe srcDoc) e publicados
    - gateway — Configuração do OpenClaw Gateway (URL, token)
    - tts — ElevenLabs e vozes por agente
    - empresa — Perfil da empresa (Onboarding — nome, segmento, oferta, tom, docs)
  rbac: ProtectedRoute + filtragem de abas conforme role do usuário

# ═══════════════════════════════════════════════════════════════════════════
# 22. UI GLOBAL
# ═══════════════════════════════════════════════════════════════════════════
ui_global:
  tema:
    descricao: Dark por padrão (Glass Aurora), com toggle dark/light no header (ThemeToggle)
    primaria: "#3D61FF"
    background: "#0A0A0A"
  busca_global:
    componente: GlobalSearch (header, próximo ao toggle de tema)
    descricao: Mapeia IDs (agentes, canais, usuários) para nomes amigáveis
  navegacao_mobile:
    componente: BottomNav (rotas principais), header simplificado com safe-area iOS
  notificacoes_in_app:
    provider: NotificationsProvider
    badge: Contagem unificada (suporta "99+") na sidebar e bottom nav

# ═══════════════════════════════════════════════════════════════════════════
# 23. PWA E MOBILE
# ═══════════════════════════════════════════════════════════════════════════
pwa_mobile:
  distribuicao: Progressive Web App (sem Capacitor / sem build nativo iOS/Android)
  manifest:
    arquivo: public/manifest.json
    name: HS.OS HS.OS
    short_name: HS.OS
    display: standalone
    background_color: "#0A0A0A"
    theme_color: "#3D61FF"
    orientation: portrait-primary
    icons:
      - /icons/icon-192.png (192x192, any maskable)
      - /icons/icon-512.png (512x512, any maskable)
  instalacao:
    desktop: Chrome/Edge — ícone "Instalar" na barra de endereços
    android: Banner automático "Adicionar à tela inicial" via Chrome
    ios: Safari → Compartilhar → "Adicionar à Tela de Início" (push exige iOS 16.4+)
  service_worker:
    arquivo: src/sw.ts
    plugin: vite-plugin-pwa (^1.2.0)
    estrategias:
      html_navigation: NetworkFirst (sem cache agressivo de HTML)
      hashed_assets: CacheFirst (assets com hash em nome)
    guardas:
      - Registrado apenas em produção (import.meta.env.PROD)
      - Nunca registra em iframes (Lovable preview)
      - Nunca registra em hosts *.lovableproject.com / *.lovable.dev
      - Kill-switch via ?sw=off (desregistra worker existente)
    autoUpdate: Atualiza para nova versão automaticamente no foco
  ui_mobile:
    bottom_nav: Rotas principais (Chat, Canais, Super agentes, etc.)
    safe_area: padding-top com env(safe-area-inset-top) para notch iOS
    drawer: Lista lateral de canais/DMs ocultável

# ═══════════════════════════════════════════════════════════════════════════
# 24. API PÚBLICA
# ═══════════════════════════════════════════════════════════════════════════
api_publica:
  existe: false
  observacao: >
    O HS.OS NÃO expõe uma API REST/GraphQL pública genérica para que outras
    plataformas consumam recursos (agentes, canais, artefatos) por endpoint
    próprio. A única superfície pública é a Broadcast API.
  superficies_disponiveis:
    broadcast_api:
      edge_function: channel-broadcast
      auth: Header x-api-key
      uso: Sistemas externos postam mensagens em canais/DMs e registram resultados de agentes
    integracoes_inversas:
      descricao: HS.OS → sistemas externos via credenciais cadastradas em Settings → Integrações
      tipos: api_key, multi_key, mcp
  recomendacao: >
    Caso seja necessária API pública completa (CRUD de agentes/conversas/artefatos),
    deve ser projetada como nova camada — não existe hoje no projeto.

# ═══════════════════════════════════════════════════════════════════════════
# 25. ONBOARDING DA EMPRESA
# ═══════════════════════════════════════════════════════════════════════════
onboarding_empresa:
  descricao: >
    Fluxo de cadastro do contexto do negócio para que todos os agentes conheçam a empresa.
    Singleton armazenado em public.company_profile (RLS restrita a super_admin), com bucket
    privado company-docs para anexos.
  interface:
    rota: /settings?tab=empresa
    formas_de_preencher:
      - Edição manual dos campos
      - Descrição livre em texto ou voz (Web Speech API) normalizada por IA
      - Upload de documento (PDF, DOCX, TXT, MD — drag & drop) com extração e normalização por IA
    sanitizacao_nome_arquivo: NFD, remoção de acentos e caracteres não alfanuméricos antes do upload
  edge_functions:
    - nome: parse-company-context
      responsabilidade: Transforma texto livre em JSON estruturado via Lovable AI Gateway (google/gemini-3-flash-preview)
    - nome: extract-file-text
      responsabilidade: >
        Baixa o arquivo do bucket company-docs, extrai texto (pdf-parse, mammoth com opção buffer
        Uint8Array, leitura direta para TXT/MD) e encaminha ao parse
    - nome: notify-orchestrator-onboarding
      responsabilidade: >
        Localiza o agente líder (agent_profiles.is_leader = true), gera COMPANY.md e dispara
        cron.add (kind agentTurn) no gateway para propagar o contexto à frota
  banner:
    componente: CompanyOnboardingBanner (no AppLayout quando o perfil não está preenchido)
    dismiss: localStorage (dnos:company-onboarding-banner-dismissed)
  regras:
    - Soft trigger — agentes nunca bloqueados esperando onboarding
    - Orquestrador sempre via is_leader = true (nunca string literal)
    - Apenas super_admin cria/edita perfil e anexos da empresa
    - Sem emojis — sempre ícones Lucide

# ═══════════════════════════════════════════════════════════════════════════
# 26. GOAL VS LOOP — MODOS DE AUTONOMIA
# ═══════════════════════════════════════════════════════════════════════════
goal_vs_loop:
  descricao: >
    Os agentes HS.OS têm dois mecanismos para executar tarefas de forma autônoma.
  goal:
    titulo: "🎯 Goal (OpenClaw Nativo)"
    o_que_e: >
      Feature built-in do runtime OpenClaw. O agente define um objetivo e executa
      todas as etapas automaticamente dentro da mesma sessão, sem intervenção humana.
    quem_gerencia: 100% OpenClaw. Sem dependência externa (sem tabelas, sem EFs, sem frontend).
    quando_usar: Tarefas médias (~5-15 tool calls) que cabem em uma única sessão.
    frontend: >
      NÃO precisa de UI. Goal é invisível pro Lovable — roda dentro do runtime e
      morre com a sessão.
    exemplo: >
      "Faz um relatório de status de todos os agentes" — ~10 ferramentas, termina
      na mesma conversa.
  loop:
    titulo: "🔄 Loop Architecture (HS.OS)"
    o_que_e: >
      Infraestrutura customizada construída pela HS.OS sobre Supabase. Tarefas grandes
      são divididas em chunks, com checkpoints salvos no banco. Se a sessão cair ou
      o agente parar, a tarefa é retomada automaticamente de onde parou.
    quem_gerencia: >
      Supabase (agent_tasks) + Edge Function (agent-task) + cron de retomada + UI do Lovable.
    quando_usar: >
      Tarefas grandes (15+ tool calls) ou quando um Goal falha por timeout / queda de sessão.
    frontend: >
      ESSA é a parte que o Lovable precisa enxergar. O frontend já mostra cards de
      tarefas em andamento e injeta a system message [HS.OS] Task pendente encontrada
      no início da sessão para o agente retomar automaticamente.
    exemplo: >
      "Audita os workspaces de todos os 8 agentes" — 3 dias, ~60 ferramentas,
      múltiplas sessões.
  comparativo:
    - aspecto: Runtime
      goal: OpenClaw nativo
      loop: Infra HS.OS (Supabase + EF)
    - aspecto: Persistência
      goal: "❌ Morre com a sessão"
      loop: "✅ Checkpoints no banco"
    - aspecto: Frontend
      goal: "❌ Não precisa de UI"
      loop: "✅ Já implementado no Lovable"
    - aspecto: Gatilho
      goal: "/goal ou agente decide"
      loop: agent-task create
    - aspecto: Retomada
      goal: "Manual (refaz)"
      loop: "Automática (cron + system message)"
    - aspecto: Uso típico
      goal: "5-15 tool calls, mesma sessão"
      loop: "15+ tool calls, multi-sessão"
  arvore_decisao: |
    Tarefa chegou ->
      ├─ Simples (1-5 tool calls) -> Executa direto
      ├─ Média (5-15 tool calls) -> 🎯 Goal (mesma sessão)
      ├─ Grande (15+ tool calls) -> 🔄 Loop (checkpoint + retomada)
      └─ Goal travou -> 🔄 Loop (fallback automático)
  lovable_ja_implementa:
    - Cards de task em andamento na UI
    - 'System message [HS.OS] Task pendente encontrada: "<título>" (ID: <uuid>) injetada no início da sessão'
    - "Status visual: running / checkpoint / completed / failed"
  nao_precisa_implementar:
    - Qualquer UI para Goal — é 100% runtime, invisível pro frontend

# ═══════════════════════════════════════════════════════════════════════════
# 27. EXPORTAÇÃO E IMPORTAÇÃO DE SUPER AGENTES (.dnos)
# ═══════════════════════════════════════════════════════════════════════════
export_import_super_agentes:
  formato:
    extensao: ".dnos"
    tipo: "JSON estruturado com metadados + arquivos do agente"
    versao_atual: "1.0"
    conteudo:
      - "agent: agent_id, name, role, department, description, color, emoji, author"
      - "required_connectors: lista de conectores detectados (Meta Ads, Slack, Telegram, etc.)"
      - "capabilities: capacidades extraídas do SOUL.md"
      - "files: SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md (quando disponíveis)"
  exportacao:
    endpoint: "supabase.functions.invoke('export-agent', { agent_id, app_origin })"
    ui: "Botão de download no card do agente (ExportAgentButton) e na tela de detalhes"
    pipeline:
      - "1. Lê arquivos vivos do workspace via gateway (SOUL, IDENTITY, TOOLS, AGENTS)"
      - "2. Fallback para /templates/<agent>/ (SOUL/IDENTITY/TOOLS) e /templates/AGENTS.md quando o gateway não responde"
      - "3. Fallback final para snapshot em .templates/ do gateway"
      - "4. Sanitiza dados de empresa via company_profile (substitui por {{COMPANY_NAME}}, {{FOUNDER_NAME}}, {{COMPANY_SEGMENT}}, etc.)"
      - "5. Sanitiza UUIDs de plataforma (boards, listas, membros, crons) por placeholders contextuais"
      - "6. Retorna JSON .dnos pronto para download"
    sanitizacao_uuids:
      board: "{{DN_TASK_BOARD_ID}}"
      lista: "{{DN_TASK_LIST_ID}}"
      membro: "{{DN_TASK_MEMBER_ID}}"
      card: "{{DN_TASK_CARD_ID}}"
      cron: "{{CRON_ID}}"
      agent: "{{AGENT_UUID}}"
      generico: "{{PLATFORM_UUID}}"
  importacao:
    ui: "ImportAgentDialog (upload de arquivo .dnos na tela de Super agentes)"
    validacao:
      - "dnos_version presente"
      - "agent.agent_id no formato [a-z0-9-]{2,32}"
      - "agent.name e files.SOUL.md obrigatórios"
    fluxo:
      - "1. Usuário faz upload do .dnos"
      - "2. Sistema valida estrutura e mostra conectores requeridos"
      - "3. Cria agent_profiles + workspace no gateway com SOUL/IDENTITY/TOOLS/AGENTS"
      - "4. Placeholders {{COMPANY_*}} são substituídos pelos dados da empresa local"
      - "5. Usuário conecta os conectores requeridos que ainda não existem"
  seguranca:
    - "Nenhum dado sensível de empresa vaza — tudo vira placeholder no export"
    - "Nenhum UUID de instância vaza — sanitização contextual em SOUL/IDENTITY/TOOLS/AGENTS"
    - "Nenhuma chave de API é exportada — apenas os nomes dos conectores requeridos"
  casos_de_uso:
    - "Compartilhar agentes entre empresas/instâncias HS.OS"
    - "Backup completo de um agente antes de mudanças estruturais"
    - "Distribuir agentes especializados como templates (via /templates/<id>/)"
    - "Migrar agentes entre ambientes (dev → prod)"

`;
}



