import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, BookOpen, FileCode, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateDocumentationYaml } from "@/lib/dnos-documentation-yaml";

const sections = [
  { id: "visao-geral", title: "1. Visão Geral" },
  { id: "arquitetura", title: "2. Arquitetura" },
  { id: "agentes", title: "3. Sistema de Super agentes" },
  { id: "chat", title: "4. Chat e Comunicação" },
  { id: "artefatos", title: "5. Artefatos" },
  { id: "canais", title: "6. Sistema de Canais" },
  { id: "arenas", title: "7. Arenas" },
  { id: "gateway", title: "8. Gateway e Proxy" },
  { id: "edge-functions", title: "9. Edge Functions" },
  { id: "banco-de-dados", title: "10. Banco de Dados" },
  { id: "autenticacao", title: "11. Autenticação e Permissões" },
  { id: "skills-broadcast", title: "12. Skills e Broadcast API" },
  { id: "monitoramento", title: "13. Monitoramento" },
  { id: "arquivos", title: "14. Arquivos e Storage" },
  { id: "wiki", title: "15. Base de Conhecimento (Wiki)" },
  { id: "branding", title: "16. Branding / White-Label" },
  { id: "tts", title: "17. TTS ElevenLabs (Global)" },
  { id: "notificacoes", title: "18. Notificações e Push" },
  { id: "integracoes", title: "19. Integrações Externas (Conectores)" },
  { id: "integracoes-agentes", title: "20. Integrações de Super agentes (Telegram/Slack/WhatsApp)" },
  { id: "settings", title: "21. Configurações (Settings)" },
  { id: "ui-global", title: "22. UI Global" },
  { id: "pwa-mobile", title: "23. PWA e Mobile" },
  { id: "api-publica", title: "24. API Pública" },
  { id: "onboarding-empresa", title: "25. Onboarding da Empresa" },
  { id: "goal-vs-loop", title: "26. Goal vs Loop — Modos de Autonomia" },
  { id: "export-import", title: "27. Exportação e Importação (.dnos)" },
];



function useActiveSection() {
  const [active, setActive] = useState(sections[0].id);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return active;
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="text-xl font-display font-bold text-foreground mt-10 mb-4 scroll-mt-20 border-b border-border pb-2">
      {title}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs font-mono text-foreground overflow-x-auto mb-4 whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-xs border-collapse">
        {children}
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left p-2 border-b border-border text-foreground font-semibold bg-secondary/30">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="p-2 border-b border-border text-muted-foreground">{children}</td>;
}

export default function DocumentationPage({ embedded }: { embedded?: boolean } = {}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const activeSection = useActiveSection();

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const el = contentRef.current;
      if (!el) return;

      // Clone and apply print-friendly styles
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.background = "#ffffff";
      clone.style.color = "#111111";
      clone.style.padding = "32px";
      clone.querySelectorAll("*").forEach((node) => {
        const htmlNode = node as HTMLElement;
        htmlNode.style.color = "#111111";
        htmlNode.style.borderColor = "#e5e5e5";
        if (htmlNode.style.backgroundColor) {
          htmlNode.style.backgroundColor = "#f8f8f8";
        }
      });

      const container = document.createElement("div");
      container.appendChild(clone);
      document.body.appendChild(container);

      const opts: Record<string, unknown> = {
          margin: [10, 10, 10, 10],
          filename: "HS.OS-Documentacao-Oficial.pdf",
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        };
      await html2pdf().set(opts).from(container).save();

      document.body.removeChild(container);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Sidebar TOC — desktop only */}
      <aside className="hidden lg:block w-56 shrink-0 border-r border-border p-4 overflow-y-auto h-full">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-xs font-display font-bold text-foreground uppercase tracking-wider">Sumário</span>
        </div>
        <nav className="space-y-0.5">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                "block text-xs py-1.5 px-2 rounded transition-colors",
                activeSection === s.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {s.title}
            </a>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto h-full">

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground">Documentação Oficial — HS.OS</h1>
              <p className="text-sm text-muted-foreground mt-1">Plataforma de orquestração de agentes de IA da HS.OS</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="glass"
                size="sm"
                onClick={handleExportPdf}
                disabled={exporting}
                className="shrink-0"
              >
                <Download className="h-4 w-4 mr-1" />
                {exporting ? "Gerando…" : "Baixar PDF"}
              </Button>
              <Button
                variant="glass"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  const yaml = generateDocumentationYaml();
                  const blob = new Blob([yaml], { type: "text/yaml" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "hs-os-documentacao.yaml";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <FileCode className="h-4 w-4 mr-1" />
                YAML para IA
              </Button>
            </div>
          </div>

          {/* ⚠️ Aviso de defasagem. Fica FORA do `contentRef` de propósito:
              o `contentRef` é o que vira PDF, e um PDF baixado hoje pode ser
              lido daqui a meses, quando este aviso já não fizer sentido — ou,
              pior, quando o texto tiver sido corrigido e o aviso desmentir
              algo que já está certo. Na tela ele é sempre atual; no papel,
              não. */}
          <div className="mb-8 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">
                  A parte técnica desta documentação está desatualizada — última revisão em julho de 2026.
                </p>
                <p className="text-muted-foreground mt-1.5">
                  A plataforma saiu do Supabase entre julho e agosto de 2026, e as seções de
                  arquitetura ainda descrevem o desenho anterior. Em concreto: as{" "}
                  <em>edge functions</em> citadas não existem mais — viraram rotas da API própria —
                  e a API dos artefatos passou de <code className="text-xs bg-secondary px-1 rounded">window.dnos</code>{" "}
                  para <code className="text-xs bg-secondary px-1 rounded">window.hsos</code>, com o
                  nome antigo mantido só como apelido.
                </p>
                <p className="text-muted-foreground mt-1.5">
                  <strong className="text-foreground">O que continua confiável:</strong> a visão geral,
                  os conceitos, os papéis e o funcionamento das telas. O que descreve nomes de função,
                  tabelas e chamadas internas, não.
                </p>
                <p className="text-muted-foreground mt-1.5">
                  Para o estado atual, o repositório é a fonte:{" "}
                  <code className="text-xs bg-secondary px-1 rounded">docs/CONTINUAR-AQUI.md</code>{" "}
                  e <code className="text-xs bg-secondary px-1 rounded">CLAUDE.md</code>.
                </p>
              </div>
            </div>
          </div>

          <div ref={contentRef}>
            {/* 1. VISÃO GERAL */}
            <SectionHeading id="visao-geral" title="1. Visão Geral" />
            <P>
              O <strong>HS.OS</strong> é a plataforma central de orquestração de agentes de inteligência
              artificial da HS.OS. Ele permite que equipes interajam, coordenem e monitorem uma frota de agentes especializados
              em tempo real, através de uma interface unificada inspirada em sistemas operacionais de missão.
            </P>
            <SubHeading>Proposta de Valor</SubHeading>
            <P>
              • <strong>Orquestração Centralizada</strong> — Um painel único para gerenciar todos os agentes de IA da organização.
            </P>
            <P>
              • <strong>Comunicação Nativa</strong> — Chat em tempo real com agentes, suporte a DMs, canais, threads e @menções.
            </P>
            <P>
              • <strong>Arenas de Simulação</strong> — Ambientes controlados para debates multi-agente e brainstorming.
            </P>
            <P>
              • <strong>Monitoramento Contínuo</strong> — Métricas de uso, saúde do gateway e logs de atividade.
            </P>
            <P>
              • <strong>Extensibilidade</strong> — Broadcast API para integração externa e Skills configuráveis por agente.
            </P>

            {/* 2. ARQUITETURA */}
            <SectionHeading id="arquitetura" title="2. Arquitetura" />
            <SubHeading>Stack Tecnológica</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Camada</Th><Th>Tecnologia</Th></tr>
              </thead>
              <tbody>
                <tr><Td>Frontend</Td><Td>React 18, TypeScript 5, Vite 5</Td></tr>
                <tr><Td>Estilização</Td><Td>Tailwind CSS v3, shadcn/ui, Design System glass/dark</Td></tr>
                <tr><Td>Estado/Cache</Td><Td>TanStack React Query v5</Td></tr>
                <tr><Td>Backend</Td><Td>Supabase (PostgreSQL, Auth, Storage, Realtime)</Td></tr>
                <tr><Td>Serverless</Td><Td>Supabase Edge Functions (Deno)</Td></tr>
                <tr><Td>Gateway IA</Td><Td>OpenClaw Gateway (configurável em Settings → Gateway)</Td></tr>
                <tr><Td>Voz</Td><Td>ElevenLabs (TTS e Conversational AI)</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Diagrama de Camadas</SubHeading>
            <Code>{`┌─────────────────────────────────────────────┐
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
└──────────────────────────────────────────────┘`}</Code>

            {/* 3. SISTEMA DE AGENTES */}
            <SectionHeading id="agentes" title="3. Sistema de Super agentes" />
            <SubHeading>Catálogo de Super agentes Oficiais</SubHeading>
            <P>
              O HS.OS opera com 8 agentes oficiais, cada um com uma identidade e especialização únicas.
              Todos são acessados pelo modelo <code className="text-xs bg-secondary px-1 rounded">openclaw:{'<agentId>'}</code>.
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>ID</Th><Th>Nome</Th><Th>Especialização</Th></tr>
              </thead>
              <tbody>
                <tr><Td>lia</Td><Td>Lia</Td><Td>Orquestradora principal, coordenação de equipe, análise geral</Td></tr>
                <tr><Td>radar</Td><Td>Radar</Td><Td>Inteligência de mercado, pesquisa competitiva, análise de tendências</Td></tr>
                <tr><Td>rodrigo</Td><Td>RodrigoIA</Td><Td>Visão estratégica, tomada de decisão executiva</Td></tr>
                <tr><Td>kira</Td><Td>Kira</Td><Td>Direção de conteúdo, copywriting, criação criativa</Td></tr>
                <tr><Td>milo</Td><Td>Milo</Td><Td>Estratégia de tráfego, growth hacking, performance</Td></tr>
                <tr><Td>sigma</Td><Td>Sigma</Td><Td>Pesquisa e dados, ciência de dados, análise quantitativa</Td></tr>
                <tr><Td>cs</Td><Td>CS</Td><Td>Atendimento e sucesso do cliente, suporte especializado</Td></tr>
                <tr><Td>rock</Td><Td>Rock</Td><Td>Agente auxiliar, tarefas complementares</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Modelo de Identidade</SubHeading>
            <P>
              Cada agente é identificado por um ID normalizado (lowercase, sem espaços). O modelo de IA correspondente
              é referenciado como <code className="text-xs bg-secondary px-1 rounded">openclaw:{'<id>'}</code> (ex: <code className="text-xs bg-secondary px-1 rounded">openclaw:lia</code>).
              A normalização é feita pela função <code className="text-xs bg-secondary px-1 rounded">normalizeAgentId()</code> que remove prefixos e espaços.
            </P>
            <SubHeading>Ciclo de Vida e Status</SubHeading>
            <P>
              Os agentes possuem estados monitorados via tabela <code className="text-xs bg-secondary px-1 rounded">agent_stats</code>:
              <strong> online</strong> (última atividade {"<"} 5min), <strong>idle</strong> ({"<"} 30min), <strong>offline</strong> (inativo), <strong>error</strong> (falhas detectadas).
              Avatares customizáveis são armazenados na tabela <code className="text-xs bg-secondary px-1 rounded">agent_avatars</code>.
            </P>

            <SubHeading>Debate Multi-Agente</SubHeading>
            <P>
              Mecanismo de orquestração disparado por trigger no chat. A <strong>Lia</strong> atua como mediadora:
              distribui a pergunta para múltiplos especialistas, coleta rebates entre rodadas e entrega uma síntese
              consolidada. Diferente de "debate" via prompting puro, cada agente é uma instância isolada com
              identidade, memória e especialização próprias.
            </P>
            <P>
              <strong>Trigger:</strong> <code className="text-xs bg-secondary px-1 rounded">debate: @AgenteA @AgenteB @AgenteC &lt;pergunta&gt;</code>
              <br />
              <strong>Exemplo:</strong> <code className="text-xs bg-secondary px-1 rounded">debate: @Kira @Milo @Sigma qual a melhor estratégia de conteúdo?</code>
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Fase</Th><Th>O que acontece</Th></tr>
              </thead>
              <tbody>
                <tr><Td>Rodada 1</Td><Td>Cada agente responde de forma independente, sem ver os colegas, aplicando sua especialidade.</Td></tr>
                <tr><Td>Rodada 2</Td><Td>Cada agente recebe as respostas da R1 e rebate — concorda, discorda ou complementa. Aqui emerge divergência real.</Td></tr>
                <tr><Td>Síntese</Td><Td>Lia compila tudo: consenso, divergências, recomendação final e próximo passo acionável.</Td></tr>
                <tr><Td>Progresso</Td><Td>DM em tempo real para o solicitante a cada evento ("✅ @Kira respondeu na R1", "🔄 Rodada 1 completa", "🌙 Sintetizando...").</Td></tr>
              </tbody>
            </TableWrapper>
            <P>
              <strong>Diferenciais:</strong> agentes isolados com personalidade real (não simulação dentro do mesmo prompt),
              mediação por agente terceiro, rebates com divergência real entre rodadas, síntese orquestrada com recomendação
              final e progresso assíncrono via DM com timeout por agente e fallback se offline.
            </P>


            {/* 4. CHAT E COMUNICAÇÃO */}
            <SectionHeading id="chat" title="4. Chat e Comunicação" />
            <SubHeading>Dual-Storage</SubHeading>
            <P>
              O sistema de chat opera com dois fluxos de armazenamento paralelos:
            </P>
            <P>
              • <strong>conversations</strong> — Armazena DMs diretas entre usuário e agente (1:1). Usada no Chat DM clássico.
              Cada registro contém <code className="text-xs bg-secondary px-1 rounded">agent_id</code>, <code className="text-xs bg-secondary px-1 rounded">user_id</code>, <code className="text-xs bg-secondary px-1 rounded">role</code> (user/agent) e <code className="text-xs bg-secondary px-1 rounded">content</code>.
            </P>
            <P>
              • <strong>channel_messages</strong> — Armazena mensagens em canais (públicos, privados, DMs de canal).
              Suporta <code className="text-xs bg-secondary px-1 rounded">author_type</code> (human/agent), threads via <code className="text-xs bg-secondary px-1 rounded">thread_id</code>,
              e anexos via campo JSON <code className="text-xs bg-secondary px-1 rounded">attachments</code>.
            </P>
            <SubHeading>Streaming SSE</SubHeading>
            <P>
              Respostas de agentes no Chat DM são recebidas via Server-Sent Events (SSE) através da edge function
              <code className="text-xs bg-secondary px-1 rounded">gateway-chat</code>, que proxia o stream do OpenClaw Gateway.
              O frontend renderiza tokens incrementalmente conforme chegam, com formatação Markdown em tempo real.
            </P>
            <SubHeading>@Menções</SubHeading>
            <P>
              Em canais com múltiplos agentes, o sistema de @menções permite direcionar mensagens a agentes específicos.
              A função <code className="text-xs bg-secondary px-1 rounded">extractMentionedAgents()</code> detecta @agentId ou @NomeDoAgente no texto
              e dispara respostas apenas dos agentes mencionados. Em DMs, o agente responde automaticamente.
            </P>
            <SubHeading>Reações</SubHeading>
            <P>
              Mensagens em canais suportam reações com emojis. Usuários podem adicionar/remover reações via a tabela
              <code className="text-xs bg-secondary px-1 rounded">message_reactions</code>, com atualização em tempo real para todos os participantes.
            </P>
            <SubHeading>Threads</SubHeading>
            <P>
              Mensagens em canais suportam threads (respostas aninhadas) via o campo <code className="text-xs bg-secondary px-1 rounded">thread_id</code>.
              A thread é exibida em um painel lateral dedicado (<code className="text-xs bg-secondary px-1 rounded">ThreadPanel</code>).
            </P>
            <SubHeading>Notificações</SubHeading>
            <P>
              Cada mensagem de agente gera notificações automáticas para todos os membros humanos do canal.
              A tabela <code className="text-xs bg-secondary px-1 rounded">notifications</code> registra <code className="text-xs bg-secondary px-1 rounded">author_name</code>,
              <code className="text-xs bg-secondary px-1 rounded">content_preview</code> (primeiros 100 caracteres) e status de leitura.
              O badge na sidebar mostra a contagem unificada de não-lidas, com suporte a "99+".
            </P>
            <SubHeading>Gravação e Transcrição de Áudio</SubHeading>
            <P>
              O chat suporta envio de mensagens de áudio com gravação direta no navegador.
              Arquivos gravados são enviados ao storage e transcritos automaticamente pela edge function
              <code className="text-xs bg-secondary px-1 rounded">transcribe-audio</code>. A transcrição fica disponível como texto colapsável junto ao player de áudio.
            </P>
            <SubHeading>Auto-reset de Sessão (Context Overflow)</SubHeading>
            <P>
              Quando uma sessão atinge o limite de tokens do agente, o HS.OS detecta automaticamente o erro
              de <em>context overflow</em> (padrões: <code className="text-xs bg-secondary px-1 rounded">context overflow</code>,
              <code className="text-xs bg-secondary px-1 rounded">prompt too large</code>,
              <code className="text-xs bg-secondary px-1 rounded">context length</code>,
              <code className="text-xs bg-secondary px-1 rounded">token limit</code>,
              <code className="text-xs bg-secondary px-1 rounded">input too long</code>) e renova a sessão de forma transparente — o usuário nunca vê o erro técnico.
            </P>
            <P>
              <strong>Fluxo:</strong> ao detectar o overflow (na exceção ou no texto da resposta), o
              <code className="text-xs bg-secondary px-1 rounded">chat-sender</code> exibe um toast discreto
              ("♻️ Sessão renovada automaticamente. Continuando..."), chama
              <code className="text-xs bg-secondary px-1 rounded">POST /v1/sessions/reset</code> (proxiado pela edge function
              <code className="text-xs bg-secondary px-1 rounded">gateway-chat</code> via <code className="text-xs bg-secondary px-1 rounded">action: "reset_session"</code>) e reenvia automaticamente a última mensagem do usuário com histórico reduzido às últimas 6 mensagens. Uma flag
              <code className="text-xs bg-secondary px-1 rounded">contextResetInFlight</code> por <code className="text-xs bg-secondary px-1 rounded">agentId</code> evita loops (1 tentativa por overflow).
            </P>
            <P>
              <strong>Fallback:</strong> se o gateway não expuser <code className="text-xs bg-secondary px-1 rounded">/v1/sessions/reset</code> (404/501), a edge function retorna soft-ack e o reenvio prossegue — a nova requisição inicia naturalmente uma sessão fresca.
            </P>

            <SubHeading>AAC — Agent Activity Card</SubHeading>
            <P>
              O <strong>AAC (Agent Activity Card)</strong> é o cartão de atividade em tempo real que aparece
              logo abaixo da mensagem do usuário quando o agente inicia o processamento. Ele consolida os eventos
              internos do agente (raciocínio, buscas na web, chamadas a ferramentas, geração de artefatos, uso de skills)
              em uma linha do tempo compacta, dando transparência ao que está acontecendo enquanto a resposta é gerada.
            </P>
            <P>
              <strong>Escopo por turno:</strong> cada nova mensagem enviada zera o AAC — ele exibe apenas as atividades
              da interação atual. Não há acúmulo de atividades de turnos anteriores. Um <code className="text-xs bg-secondary px-1 rounded">turnStartByAgentRef</code> registra
              o timestamp de início do turno por agente e o feed é filtrado por <code className="text-xs bg-secondary px-1 rounded">created_at &gt;= currentTurnStartTs</code>.
            </P>
            <P>
              <strong>Estado padrão:</strong> o card inicia <em>colapsado</em>. O processamento acontece internamente
              e o usuário vê apenas um badge compacto (<code className="text-xs bg-secondary px-1 rounded">ActivityStatusBadge</code>) com
              a contagem de eventos e um chevron para expandir. Ao clicar no header, o AAC abre e revela a linha do tempo
              detalhada. Substitui indicadores redundantes como "pensando…" ou "buscando web…" enquanto ativo.
            </P>
            <P>
              <strong>Tipos de evento capturados:</strong> reasoning/thinking, web_search, web_fetch, tool_call,
              artifact_generation, skill_invocation, media (imagem/áudio), file_read. Cada evento tem status
              (running/done/error), timestamp e payload resumido.
            </P>
            <P>
              <strong>UI limpa:</strong> o header do AAC não repete foto nem nome do agente — essa informação já aparece
              na mensagem do agente abaixo do card. Mostra apenas badge de status, contagem de atividades, timestamp e chevron.
            </P>
            <P>
              <strong>Persistência:</strong> as atividades são gravadas na tabela <code className="text-xs bg-secondary px-1 rounded">agent_activities</code> com
              <code className="text-xs bg-secondary px-1 rounded">session_id</code>, <code className="text-xs bg-secondary px-1 rounded">agent_id</code> e <code className="text-xs bg-secondary px-1 rounded">created_at</code>,
              permitindo revisão histórica e telemetria via <code className="text-xs bg-secondary px-1 rounded">/monitoring</code>.
            </P>



            {/* 5. ARTEFATOS */}
            <SectionHeading id="artefatos" title="5. Artefatos" />
            <P>
              Artefatos são conteúdos visuais ricos (dashboards, relatórios, landing pages, gráficos) gerados pelos agentes
              diretamente nas conversas. São uma das funcionalidades mais poderosas do HS.OS, permitindo que agentes
              entreguem resultados concretos e visuais sob demanda.
            </P>
            <SubHeading>Geração de Artefatos</SubHeading>
            <P>
              Quando um agente recebe um pedido que requer entrega visual, ele gera código HTML completo e funcional
              dentro de blocos <code className="text-xs bg-secondary px-1 rounded">```html</code> na resposta. O sistema detecta automaticamente
              esses blocos via o extrator (<code className="text-xs bg-secondary px-1 rounded">artifact-extractor</code>) e renderiza o conteúdo
              em um painel de preview dedicado (<code className="text-xs bg-secondary px-1 rounded">ArtifactPanel</code>).
            </P>
            <P>
              • As cores institucionais utilizadas são <code className="text-xs bg-secondary px-1 rounded">#3D61FF</code> (azul primário) e <code className="text-xs bg-secondary px-1 rounded">#E41A11</code> (vermelho) sobre fundo dark <code className="text-xs bg-secondary px-1 rounded">#0a0a0a</code>.
            </P>
            <P>
              • URLs ou nomes de arquivo nunca substituem o código inline — o extrator detecta menções a arquivos .html órfãos
              e exibe um fallback orientando o usuário a solicitar o código completo.
            </P>
            <SubHeading>Galeria de Artefatos</SubHeading>
            <P>
              Cada conversa possui uma galeria lateral (<code className="text-xs bg-secondary px-1 rounded">ArtifactsList</code>) que lista todos os artefatos
              gerados, escaneando até 200 mensagens do histórico. A galeria permite navegar entre artefatos,
              excluir itens individuais (removendo a mensagem correspondente) e visualizar em tela cheia.
            </P>
            <SubHeading>Exportação</SubHeading>
            <P>
              Artefatos podem ser exportados via menu dropdown "Baixar" no painel de preview:
            </P>
            <P>
              • <strong>PDF</strong> — Exportação via html2pdf.js com estilos otimizados para impressão (fundo claro forçado).
            </P>
            <P>
              • <strong>DOCX</strong> — Conversão estruturada de tags HTML para parágrafos do Word via docx.js.
            </P>
            <P>
              O sistema fornece feedback visual (toasts) durante o processamento de cada formato.
            </P>
            <SubHeading>Publicação Pública</SubHeading>
            <P>
              Artefatos podem ser publicados com URLs únicas e acessíveis sem autenticação, através da rota
              <code className="text-xs bg-secondary px-1 rounded">/artifact/:id</code>. O diálogo de publicação permite configurar:
            </P>
            <P>
              • <strong>Título</strong> — Nome personalizado para o artefato publicado.
            </P>
            <P>
              • <strong>Expiração</strong> — Data limite de disponibilidade do link (opcional).
            </P>
            <P>
              • <strong>URL pública</strong> — Gerada automaticamente e copiável com um clique.
            </P>
            <P>
              O sistema detecta automaticamente se o conteúdo já foi publicado pelo usuário para exibir o link existente
              e evitar duplicidade. Links publicados são armazenados na tabela <code className="text-xs bg-secondary px-1 rounded">artifacts_published</code> com
              contagem de visualizações, e podem ser gerenciados centralmente na aba de configurações.
            </P>

            <SubHeading>Artefatos Vivos (Live Artifacts)</SubHeading>
            <P>
              Diferente dos artefatos estáticos gerados em blocos <code className="text-xs bg-secondary px-1 rounded">```html</code>, os
              <strong> artefatos vivos</strong> são HTML/JS que se atualizam sozinhos consumindo dados reais — do banco interno via RLS ou de
              APIs externas (Meta Ads, Google Analytics, etc.) por meio das integrações configuradas na empresa. Ficam disponíveis em
              <code className="text-xs bg-secondary px-1 rounded">/artefatos</code> e, quando publicados, em
              <code className="text-xs bg-secondary px-1 rounded">/p/:slug</code>.
            </P>
            <P>
              <strong>Tag emitida pelo agente:</strong> qualquer agente pode criar/atualizar um artefato vivo escrevendo
              <code className="text-xs bg-secondary px-1 rounded">&lt;live_artifact title="..." refresh="60"&gt;HTML+JS&lt;/live_artifact&gt;</code> na
              resposta. O parser em <code className="text-xs bg-secondary px-1 rounded">useLiveArtifactParser.ts</code> extrai o bloco, persiste
              na tabela <code className="text-xs bg-secondary px-1 rounded">live_artifacts</code> (INSERT, ou UPDATE se o atributo
              <code className="text-xs bg-secondary px-1 rounded">id</code> for informado) e renderiza um <code className="text-xs bg-secondary px-1 rounded">LiveArtifactCard</code> inline no chat.
            </P>
            <P>
              <strong>Sandbox e bridge <code className="text-xs bg-secondary px-1 rounded">window.dnos</code>:</strong> o HTML roda em um iframe
              isolado (srcDoc). Uma bridge injetada por <code className="text-xs bg-secondary px-1 rounded">LiveArtifactViewer</code> expõe três
              métodos: <code className="text-xs bg-secondary px-1 rounded">query(tabela, opts)</code> — consulta tabelas internas do usuário
              (RLS aplicada) via Edge Function <code className="text-xs bg-secondary px-1 rounded">artifact-query</code>;
              <code className="text-xs bg-secondary px-1 rounded">invoke(integracao, opts)</code> — chama APIs externas via
              <code className="text-xs bg-secondary px-1 rounded">invoke-integration</code>, que descriptografa credenciais no servidor e nunca as
              expõe ao artefato; e <code className="text-xs bg-secondary px-1 rounded">onRefresh(cb)</code> — registra callback disparado pelo
              timer de auto-refresh conforme o atributo <code className="text-xs bg-secondary px-1 rounded">refresh</code> (segundos).
            </P>
            <P>
              <strong>Publicação:</strong> a rota pública <code className="text-xs bg-secondary px-1 rounded">/p/:slug</code> desabilita
              <code className="text-xs bg-secondary px-1 rounded">invoke()</code> (sem integrações externas para visitantes) e restringe
              <code className="text-xs bg-secondary px-1 rounded">query()</code> a dados cobertos pela policy
              <code className="text-xs bg-secondary px-1 rounded">public_read</code>. Credenciais nunca chegam ao browser.
            </P>
            <P>
              <strong>Contexto injetado no agente:</strong> em cada turno, o system prompt recebe (a) a especificação técnica da tag e da bridge,
              (b) a lista dos últimos artefatos vivos do usuário (para atualização por id), (c) as integrações disponíveis com seus
              <code className="text-xs bg-secondary px-1 rounded">data_endpoints</code> definidos no playbook e (d) o protocolo de geração de
              documentos PDF/DOCX — ver <code className="text-xs bg-secondary px-1 rounded">live-artifacts-context.ts</code>.
            </P>
            <SubHeading>Geração de Documentos (PDF/DOCX) — tag &lt;generate_document&gt;</SubHeading>
            <P>
              Padrão oficial para entregar arquivos PDF ou Word ao usuário. O agente emite a tag
              <code className="text-xs bg-secondary px-1 rounded"> &lt;generate_document type="pdf|docx" title="…"&gt;JSON&lt;/generate_document&gt; </code>
              com uma definição pdfmake (PDF) ou <code className="text-xs bg-secondary px-1 rounded">{`{ title, sections: [...] }`}</code> (DOCX).
              O HS.OS extrai a tag, chama a edge function <code className="text-xs bg-secondary px-1 rounded">generate-document</code> (gera com
              <code className="text-xs bg-secondary px-1 rounded"> pdfmake</code>/<code className="text-xs bg-secondary px-1 rounded">docx.js</code> no backend), sobe o arquivo em bucket privado
              <code className="text-xs bg-secondary px-1 rounded"> generated-documents</code> e mostra um card com botão <strong>Baixar</strong> no chat.
              Cada clique gera uma <em>signed URL</em> fresh (1h) via <code className="text-xs bg-secondary px-1 rounded">sign-generated-document</code> — link nunca é persistido.
            </P>
            <P>
              Regras injetadas no prompt de todos os agentes: <strong>proibido</strong> responder "PDF gerado com sucesso" sem emitir a tag;
              <strong>proibido</strong> colar o conteúdo como texto no lugar do arquivo; <strong>proibido</strong> usar <code className="text-xs bg-secondary px-1 rounded">&lt;live_artifact&gt;</code> para
              entregar documentos (essa tag fica reservada para painéis interativos). Persistência em <code className="text-xs bg-secondary px-1 rounded">public.generated_documents</code>
              com RLS por dono — o card sobrevive a reload do chat.
            </P>
            <P>
              <span className="text-xs text-muted-foreground">Nota: o comportamento também depende do SOUL.md de cada agente (mantido pelo time HS.OS no VPS/OpenClaw). O bloco imperativo
              injetado por <code className="text-xs bg-secondary px-1 rounded">live-artifacts-context.ts</code> força a nova tag em toda chamada, mas SOULs desatualizados podem gerar variação —
              a recomendação é atualizar os SOULs para referenciar <code className="text-xs bg-secondary px-1 rounded">&lt;generate_document&gt;</code>.</span>
            </P>

            <SubHeading>Filtro de Contexto (Anti-Overflow de Artefatos)</SubHeading>
            <P>
              Para evitar que HTML de artefatos (≥15KB) inflasse a janela de contexto do modelo em turnos seguintes, o
              <code className="text-xs bg-secondary px-1 rounded">toChatMessages</code> em <code className="text-xs bg-secondary px-1 rounded">chat-sender.ts</code>
              aplica três filtros antes de enviar o payload ao gateway OpenClaw: (a) limita o histórico às <strong>3 mensagens mais recentes</strong>,
              (b) faz <strong>strip</strong> das tags <code className="text-xs bg-secondary px-1 rounded">&lt;live_artifact&gt;</code> e
              <code className="text-xs bg-secondary px-1 rounded">&lt;artifact&gt;</code> substituindo o HTML por
              <code className="text-xs bg-secondary px-1 rounded">[Artifact: título]</code>, e (c) <strong>cap de 2KB</strong> por mensagem de histórico.
              A UI e o <code className="text-xs bg-secondary px-1 rounded">LiveArtifactCard</code> não são afetados — o filtro atua apenas no payload enviado ao modelo.
            </P>


            {/* 5. SISTEMA DE CANAIS */}
            <SectionHeading id="canais" title="6. Sistema de Canais" />
            <SubHeading>Tipos de Canal</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Tipo</Th><Th>Descrição</Th><Th>Visibilidade</Th></tr>
              </thead>
              <tbody>
                <tr><Td>public</Td><Td>Canais abertos para todos os membros</Td><Td>Todos autenticados</Td></tr>
                <tr><Td>private</Td><Td>Canais restritos a membros convidados</Td><Td>Apenas membros</Td></tr>
                <tr><Td>dm</Td><Td>Mensagens diretas (1:1 ou com agente)</Td><Td>Participantes</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Membros e Participação de Super agentes</SubHeading>
            <P>
              A tabela <code className="text-xs bg-secondary px-1 rounded">channel_members</code> controla a associação de usuários e agentes a canais.
              O campo <code className="text-xs bg-secondary px-1 rounded">member_type</code> distingue entre "human" e "agent".
              Super agentes podem ser adicionados a qualquer canal e respondem a menções ou automaticamente em DMs.
            </P>
            <SubHeading>Realtime</SubHeading>
            <P>
              Novas mensagens são sincronizadas em tempo real via Supabase Realtime (WebSocket).
              As tabelas <code className="text-xs bg-secondary px-1 rounded">channel_messages</code> e <code className="text-xs bg-secondary px-1 rounded">notifications</code> possuem
              publicação realtime ativa, garantindo que mensagens apareçam instantaneamente para todos os participantes.
            </P>

            {/* 7. ARENAS */}
            <SectionHeading id="arenas" title="7. Arenas" />
            <P>
              Arenas são ambientes de simulação multi-agente onde até 7 agentes debatem, colaboram ou analisam
              um tema específico em conjunto. Cada arena possui configuração própria de agentes, papéis e comportamento.
            </P>
            <SubHeading>Fluxo de Criação</SubHeading>
            <P>
              O processo de criação utiliza uma chamada síncrona ao endpoint que retorna metadados estruturados da persona.
              O usuário pode selecionar agentes do catálogo, atribuir papéis personalizados, definir prompts base
              e escolher entre templates pré-configurados por categoria (Vendas, Conteúdo, Estratégia, etc.).
            </P>
            <SubHeading>Estrutura de Dados</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Tabela</Th><Th>Função</Th></tr>
              </thead>
              <tbody>
                <tr><Td>arenas</Td><Td>Definição da arena (nome, prompt, agentes, configuração de persona/voz)</Td></tr>
                <tr><Td>arena_agents</Td><Td>Relacionamento arena ↔ agente com papéis (role_name, role_description, is_primary)</Td></tr>
                <tr><Td>arena_sessions</Td><Td>Sessões de conversa com suporte a sub-sessões (parent_session_id) que herdam contexto</Td></tr>
                <tr><Td>arena_messages</Td><Td>Mensagens da sessão com agent_id, agent_role e suporte a artifact_html</Td></tr>
                <tr><Td>arena_templates</Td><Td>Templates pré-configurados com prompts base, agentes sugeridos e sessões sugeridas</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Modo Debate</SubHeading>
            <P>
              O Modo Debate executa um fluxo sequencial onde cada agente contribui com sua perspectiva especializada,
              citando colegas nominalmente para criar um diálogo coerente. Ao final da rodada, o sistema gera
              automaticamente uma <strong>síntese executiva</strong> consolidando os pontos principais de todos os participantes.
            </P>
            <SubHeading>Sessões com Herança de Contexto</SubHeading>
            <P>
              Sessões dentro de uma arena podem ter sub-sessões que herdam o contexto da sessão pai via
              <code className="text-xs bg-secondary px-1 rounded">parent_session_id</code> e <code className="text-xs bg-secondary px-1 rounded">context_summary</code>.
              Isso permite ramificações de conversa sem perder o contexto acumulado.
            </P>
            <SubHeading>Sandbox React e Artefatos</SubHeading>
            <P>
              Arenas podem gerar artefatos visuais em HTML/React renderizados em sandbox isolado.
              O campo <code className="text-xs bg-secondary px-1 rounded">react_code</code> permite interfaces customizadas por arena,
              e o <code className="text-xs bg-secondary px-1 rounded">artifact_html</code> nas mensagens permite visualização inline de resultados.
              Artefatos de arena também podem ser exportados em PDF/DOCX e publicados com links públicos.
            </P>
            <SubHeading>Integração de Voz</SubHeading>
            <P>
              Arenas suportam conversa por voz via ElevenLabs (ConvAI), ativada exclusivamente via toggle.
              Se desativado, a arena opera em modo de texto puro. Campos <code className="text-xs bg-secondary px-1 rounded">voice_id</code> e
              <code className="text-xs bg-secondary px-1 rounded">convai_agent_id</code> configuram a voz por arena.
            </P>

            {/* 7. GATEWAY E PROXY */}
            <SectionHeading id="gateway" title="8. Gateway e Proxy" />
            <SubHeading>OpenClaw Gateway</SubHeading>
            <P>
              O OpenClaw Gateway é o servidor central que hospeda todos os modelos de agentes.
              A URL é configurada por install em Settings → Gateway (tabela <code className="text-xs bg-secondary px-1 rounded">public.vps_config</code>).
              O HS.OS se comunica com ele via API REST compatível com OpenAI.
            </P>
            <SubHeading>Endpoint Principal</SubHeading>
            <Code>{`POST <gateway-url>/v1/chat/completions

Headers:
  Authorization: Bearer <token>
  Content-Type: application/json

Body:
{
  "model": "openclaw:<agentId>",
  "messages": [...],
  "stream": true | false,
  "userId": "<optional>"
}`}</Code>
            <SubHeading>Proxy via Edge Function</SubHeading>
            <P>
              A edge function <code className="text-xs bg-secondary px-1 rounded">gateway-chat</code> atua como proxy CORS entre o frontend e o gateway.
              Ela carrega a configuração do gateway da tabela <code className="text-xs bg-secondary px-1 rounded">app_settings</code> (chave "gateway_config"),
              suporta requisições síncronas e streaming SSE, e possui timeout de 180 segundos.
              Erros do gateway são traduzidos em mensagens amigáveis para o usuário.
            </P>
            <SubHeading>Health Check</SubHeading>
            <P>
              O status do gateway é verificado via <code className="text-xs bg-secondary px-1 rounded">GET /api/health</code> e exibido na sidebar como
              indicador "Gateway Online/Offline". A tabela <code className="text-xs bg-secondary px-1 rounded">gateway_health</code> armazena métricas de latência e uptime.
            </P>
            <SubHeading>Control Plane Administrativo (admin-http-rpc)</SubHeading>
            <P>
              Plugin bundled do OpenClaw (desligado por padrão — o instalador do remix ativa na instalação) que expõe{" "}
              <code className="text-xs bg-secondary px-1 rounded">POST /api/v1/admin/rpc</code> para gerenciar o Gateway via HTTP: config de
              agentes, crons, status de sessões e credenciais de provedores de LLM. Métodos confirmados:{" "}
              <code className="text-xs bg-secondary px-1 rounded">config.get</code> (lê a config completa),{" "}
              <code className="text-xs bg-secondary px-1 rounded">config.patch</code> (params: <code className="text-xs bg-secondary px-1 rounded">{"{ raw: <objeto> }"}</code>,
              sem hash, merge aditivo — não aceita array de operações RFC 6902) e{" "}
              <code className="text-xs bg-secondary px-1 rounded">gateway.restart.request</code>. Rate limit: 3 requisições por 60s no{" "}
              <code className="text-xs bg-secondary px-1 rounded">config.patch</code>.
            </P>

            {/* 8. EDGE FUNCTIONS */}
            <SectionHeading id="edge-functions" title="9. Edge Functions" />
            <P>
              O HS.OS utiliza Supabase Edge Functions (runtime Deno) como camada serverless para lógica de negócio.
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Função</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>gateway-chat</Td><Td>Proxy CORS para o OpenClaw Gateway. Suporta streaming SSE e requisições síncronas. Timeout: 180s.</Td></tr>
                <tr><Td>channel-agent-reply</Td><Td>Gera resposta de agente em canal. Carrega histórico, envia ao gateway, insere a mensagem e notifica membros. Se o gateway falhar, insere uma mensagem de erro visível no canal (não fica em silêncio).</Td></tr>
                <tr><Td>channel-broadcast</Td><Td>API externa para envio de mensagens a canais/DMs. Suporta POST (mensagem/resultado), GET (histórico/usuários), DELETE. Auth via x-api-key.</Td></tr>
                <tr><Td>dm-agent-reply</Td><Td>Resposta de agente em DMs diretas (tabela conversations). Fire-and-forget com head-start de 15s ao streaming; antes de agir, consulta o status real da sessão no gateway para evitar execução duplicada em turnos longos.</Td></tr>
                <tr><Td>transcribe-audio</Td><Td>Transcrição de áudio usando serviço externo. Recebe arquivo de áudio e retorna texto transcrito.</Td></tr>
                <tr><Td>chat-image-vision</Td><Td>Processamento de imagens enviadas no chat usando modelos de visão.</Td></tr>
                <tr><Td>collect-agent-stats</Td><Td>Coleta periódica de métricas dos agentes (mensagens, tokens, custos, erros).</Td></tr>
                <tr><Td>cleanup-expired-files</Td><Td>Limpeza automática de arquivos expirados no storage.</Td></tr>
                <tr><Td>invite-user</Td><Td>Convite de novos usuários ao sistema com geração de link de acesso.</Td></tr>
                <tr><Td>monitoring-proxy</Td><Td>Proxy para coleta de dados de monitoramento do gateway.</Td></tr>
                <tr><Td>auth-email-hook</Td><Td>Hook de e-mail customizado para templates de autenticação (signup, recovery, magic-link, etc).</Td></tr>
                <tr><Td>process-email-queue</Td><Td>Processamento de fila de e-mails transacionais com retry e DLQ.</Td></tr>
                <tr><Td>artifact-query</Td><Td>Backend da bridge <code className="text-xs bg-secondary px-1 rounded">window.dnos.query()</code> dos artefatos vivos. Consulta tabelas internas usando o JWT do usuário (RLS aplicada) com suporte a select, filters, order e limit.</Td></tr>
                <tr><Td>invoke-integration</Td><Td>Backend da bridge <code className="text-xs bg-secondary px-1 rounded">window.dnos.invoke()</code>. Autentica o usuário, lê a credencial da integração no servidor (texto puro, nunca criptografada — nunca chega ao browser), resolve o endpoint pelo <code className="text-xs bg-secondary px-1 rounded">data_endpoints</code> do playbook e chama a API externa.</Td></tr>
                <tr><Td>agent-task</Td><Td>CRUD do Loop Architecture. Ações: create, checkpoint, resume, complete, fail, pause, delete, list, get. Super agentes (secret compartilhado) têm autonomia total entre si; humanos abaixo do papel "member" não conseguem mexer em tarefa alheia.</Td></tr>
                <tr><Td>configure-llm-provider</Td><Td>Escreve a api_key de um conector LLM no cofre do Gateway do cliente (config.patch via admin-http-rpc) e confirma a gravação. Fecha a ponte entre a área de Conectores e o Gateway num remix novo. Só super_admin.</Td></tr>
              </tbody>
            </TableWrapper>

            {/* 9. BANCO DE DADOS */}
            <SectionHeading id="banco-de-dados" title="10. Banco de Dados" />
            <SubHeading>Tabelas Principais</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Tabela</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>profiles</Td><Td>Perfis de usuários (nome, email, avatar, status)</Td></tr>
                <tr><Td>user_roles</Td><Td>Papéis dos usuários (super_admin, member, user)</Td></tr>
                <tr><Td>channels</Td><Td>Canais de comunicação (public, private, dm)</Td></tr>
                <tr><Td>channel_messages</Td><Td>Mensagens em canais com suporte a threads e anexos</Td></tr>
                <tr><Td>channel_members</Td><Td>Associação de usuários/agentes a canais</Td></tr>
                <tr><Td>conversations</Td><Td>DMs diretas entre usuário e agente (dual-storage)</Td></tr>
                <tr><Td>notifications</Td><Td>Notificações de novas mensagens para usuários</Td></tr>
                <tr><Td>message_reactions</Td><Td>Reações (emojis) em mensagens de canal</Td></tr>
                <tr><Td>arenas / arena_sessions / arena_messages</Td><Td>Sistema completo de arenas multi-agente</Td></tr>
                <tr><Td>arena_agents / arena_templates</Td><Td>Configuração de agentes e templates de arena</Td></tr>
                <tr><Td>agent_stats</Td><Td>Métricas coletadas dos agentes (mensagens, tokens, custo, erros)</Td></tr>
                <tr><Td>agent_avatars</Td><Td>Avatares customizados dos agentes</Td></tr>
                <tr><Td>agent_results</Td><Td>Resultados/entregas registradas pelos agentes</Td></tr>
                <tr><Td>agent_crons</Td><Td>Tarefas agendadas dos agentes</Td></tr>
                <tr><Td>teams / team_agents</Td><Td>Times e associação de agentes a times</Td></tr>
                <tr><Td>app_settings</Td><Td>Configurações da aplicação (gateway, branding, etc.)</Td></tr>
                <tr><Td>branding</Td><Td>Identidade visual (logo, cor primária, nome da empresa)</Td></tr>
                <tr><Td>gateway_health</Td><Td>Saúde do gateway (latência, uptime, versão)</Td></tr>
                <tr><Td>usage_daily</Td><Td>Métricas de uso diário agregadas</Td></tr>
                <tr><Td>cron_jobs</Td><Td>Jobs agendados do sistema</Td></tr>
                <tr><Td>access_logs</Td><Td>Logs de acesso e ações dos usuários</Td></tr>
                <tr><Td>drafts</Td><Td>Rascunhos de mensagens persistidos por usuário</Td></tr>
                <tr><Td>artifacts_published</Td><Td>Artefatos HTML publicados com link público</Td></tr>
                <tr><Td>live_artifacts</Td><Td>Artefatos vivos (HTML/JS auto-refresh) com bridge <code className="text-xs bg-secondary px-1 rounded">window.dnos</code> e publicação por slug em <code className="text-xs bg-secondary px-1 rounded">/p/:slug</code></Td></tr>
                <tr><Td>integrations / integration_templates</Td><Td>Credenciais criptografadas de APIs externas e playbooks (com <code className="text-xs bg-secondary px-1 rounded">data_endpoints</code>) consumidos por <code className="text-xs bg-secondary px-1 rounded">invoke-integration</code></Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Row Level Security (RLS)</SubHeading>
            <P>
              Todas as tabelas possuem RLS ativado. As políticas utilizam funções SECURITY DEFINER como
              <code className="text-xs bg-secondary px-1 rounded">has_role()</code>, <code className="text-xs bg-secondary px-1 rounded">is_channel_member()</code> e
              <code className="text-xs bg-secondary px-1 rounded">is_public_channel()</code> para verificar permissões sem recursão.
              Edge Functions utilizam <code className="text-xs bg-secondary px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> para bypass de RLS quando necessário.
            </P>
            <SubHeading>Enums</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Enum</Th><Th>Valores</Th></tr>
              </thead>
              <tbody>
                <tr><Td>app_role</Td><Td>super_admin, member, user</Td></tr>
                <tr><Td>author_type</Td><Td>human, agent</Td></tr>
                <tr><Td>channel_type</Td><Td>public, private, dm</Td></tr>
              </tbody>
            </TableWrapper>

            {/* 10. AUTENTICAÇÃO */}
            <SectionHeading id="autenticacao" title="11. Autenticação e Permissões" />
            <SubHeading>Sistema de Roles</SubHeading>
            <P>
              O controle de acesso é baseado em RBAC (Role-Based Access Control) com três perfis:
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Role</Th><Th>Acesso</Th></tr>
              </thead>
              <tbody>
                <tr><Td>super_admin</Td><Td>Acesso total: todos os módulos, monitoramento, gestão de usuários, settings</Td></tr>
                <tr><Td>member</Td><Td>Acesso operacional: agentes, chat, arenas, files, sessions, skills, teams</Td></tr>
                <tr><Td>user</Td><Td>Acesso básico: chat, perfil, resultados</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Rotas Protegidas</SubHeading>
            <P>
              O componente <code className="text-xs bg-secondary px-1 rounded">ProtectedRoute</code> verifica autenticação e roles antes de renderizar cada página.
              Rotas como <code className="text-xs bg-secondary px-1 rounded">/monitoring</code> e <code className="text-xs bg-secondary px-1 rounded">/users</code> são restritas a super_admin.
              A sidebar filtra dinamicamente os itens de navegação com base no role do usuário.
            </P>
            <SubHeading>Segurança</SubHeading>
            <P>
              • Roles armazenados em tabela separada (<code className="text-xs bg-secondary px-1 rounded">user_roles</code>), nunca no perfil.
            </P>
            <P>
              • Função <code className="text-xs bg-secondary px-1 rounded">has_role()</code> com SECURITY DEFINER para evitar recursão RLS.
            </P>
            <P>
              • Sessões sem logout automático por inatividade; encerramento apenas via comando manual.
            </P>
            <P>
              • Logs de acesso registrados na tabela <code className="text-xs bg-secondary px-1 rounded">access_logs</code>.
            </P>

            {/* 11. SKILLS E BROADCAST API */}
            <SectionHeading id="skills-broadcast" title="12. Skills e Broadcast API" />
            <SubHeading>Skills — Habilidades dos Super agentes</SubHeading>
            <P>
              <strong>Skills</strong> são capacidades modulares que estendem o comportamento dos agentes — cada skill
              descreve um conjunto de instruções, ferramentas ou padrões de resposta que o agente passa a incorporar.
              A página <code className="text-xs bg-secondary px-1 rounded">/skills</code> oferece um catálogo com busca,
              filtros e gestão completa (criar, editar, ativar/desativar, excluir).
            </P>
            <SubHeading>Ativação por Agente</SubHeading>
            <P>
              Skills são <strong>globais no catálogo</strong> mas <strong>ativadas por agente</strong>. Cada agente possui
              seu próprio conjunto de skills ativas, injetadas no prompt de sistema (SOUL.md / AGENTS.md) no momento
              da requisição ao gateway. Se um agente não tiver skills configuradas, um catálogo fallback é aplicado
              conforme o perfil oficial do agente.
            </P>
            <SubHeading>Estrutura de uma Skill</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Campo</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>name</Td><Td>Identificador legível da skill (ex.: "web_research", "financial_analysis")</Td></tr>
                <tr><Td>description</Td><Td>Resumo do que a skill faz e quando o agente deve acioná-la</Td></tr>
                <tr><Td>instructions</Td><Td>Bloco de instruções injetado no prompt de sistema do agente</Td></tr>
                <tr><Td>category</Td><Td>Categoria (research, analytics, communication, productivity, custom…)</Td></tr>
                <tr><Td>enabled</Td><Td>Flag global (skill disponível no catálogo)</Td></tr>
                <tr><Td>agent_mappings</Td><Td>Relação N:N entre skills e agentes — define quais agentes usam a skill</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Gerenciamento (UI)</SubHeading>
            <P>
              O diálogo <code className="text-xs bg-secondary px-1 rounded">ManageSkillDialog</code> permite editar
              nome, descrição, instruções e mapear a skill a agentes. A ação de <strong>exclusão</strong> fica isolada
              em uma "Zona de perigo" ao final do diálogo, com <code className="text-xs bg-secondary px-1 rounded">AlertDialog</code> de
              confirmação secundária — nunca próxima ao botão de fechar (X) — para evitar remoção acidental.
              A exclusão remove também todos os mapeamentos agente↔skill associados.
            </P>
            <SubHeading>Fluxo em Runtime</SubHeading>
            <P>
              Ao enviar uma mensagem para um agente, o gateway carrega o catálogo de skills ativas daquele agente e
              anexa as instruções ao prompt de sistema. O AAC (Agent Activity Card) sinaliza a invocação de skills
              como eventos <code className="text-xs bg-secondary px-1 rounded">skill_invocation</code>, permitindo
              observabilidade em tempo real. Estatísticas de uso ficam disponíveis em <code className="text-xs bg-secondary px-1 rounded">/monitoring</code> → aba Skills.
            </P>
            <SubHeading>Broadcast API</SubHeading>

            <P>
              A edge function <code className="text-xs bg-secondary px-1 rounded">channel-broadcast</code> expõe uma API REST externa autenticada via <code className="text-xs bg-secondary px-1 rounded">x-api-key</code>,
              permitindo que sistemas externos interajam com o HS.OS.
            </P>
            <SubHeading>Endpoints da Broadcast API</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Método</Th><Th>Ação</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>POST</Td><Td>Enviar mensagem</Td><Td>Envia mensagem a um canal ou DM. Suporta tipo "result" para registrar entregas de agentes.</Td></tr>
                <tr><Td>POST (dm)</Td><Td>DM externa</Td><Td>Envia DM a usuário (por email/UUID) ou DM agente-agente (A2A). Triggers de resposta automática.</Td></tr>
                <tr><Td>GET</Td><Td>Listar</Td><Td>Retorna mensagens de um canal (?channel=nome&limit=50) ou lista de usuários ativos (sem parâmetro).</Td></tr>
                <tr><Td>DELETE</Td><Td>Excluir mensagem</Td><Td>Remove uma mensagem por ID com verificação prévia e limpeza de notificações associadas.</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Exemplo de Uso</SubHeading>
            <Code>{`# Enviar mensagem a um canal
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
  }'`}</Code>

            {/* 12. MONITORAMENTO */}
            <SectionHeading id="monitoramento" title="13. Monitoramento" />
            <SubHeading>Painéis Disponíveis</SubHeading>
            <P>
              O módulo de monitoramento (<code className="text-xs bg-secondary px-1 rounded">/monitoring</code>, restrito a super_admin) oferece visão completa
              do estado operacional da plataforma através de abas especializadas:
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Aba</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>Super agentes</Td><Td>Status em tempo real de cada agente (online/idle/offline/error), última atividade, modelo em uso</Td></tr>
                <tr><Td>Gateway</Td><Td>Saúde do OpenClaw Gateway: latência, uptime, versão, status de conexão</Td></tr>
                <tr><Td>Uso</Td><Td>Métricas diárias: total de mensagens, tokens consumidos, custo, taxa de erro, cache hit rate</Td></tr>
                <tr><Td>Cron</Td><Td>Jobs agendados: expressão cron, última/próxima execução, status (ativo/inativo)</Td></tr>
                <tr><Td>Skills</Td><Td>Inventário de skills disponíveis e ativas por agente</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Coleta de Dados</SubHeading>
            <P>
              A edge function <code className="text-xs bg-secondary px-1 rounded">collect-agent-stats</code> é responsável pela coleta periódica de métricas.
              Os dados são armazenados nas tabelas <code className="text-xs bg-secondary px-1 rounded">agent_stats</code>, <code className="text-xs bg-secondary px-1 rounded">gateway_health</code> e
              <code className="text-xs bg-secondary px-1 rounded">usage_daily</code>, permitindo análise histórica e detecção de anomalias.
            </P>
            <SubHeading>Resiliência Automática</SubHeading>
            <P>
              O HS.OS tem mecanismos automáticos de recuperação, sem exigir intervenção manual do usuário:
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Mecanismo</Th><Th>Descrição</Th></tr>
              </thead>
              <tbody>
                <tr><Td>Fim da execução duplicada</Td><Td>Antes de reenviar uma mensagem que demora, o sistema pergunta ao Gateway se o agente ainda está processando; só reenvia se tiver certeza de que não está.</Td></tr>
                <tr><Td>Vigia de tarefas travadas</Td><Td>A cada 5 minutos, um processo automático varre tarefas, automações e agentes presos em "rodando" por tempo suficiente pra saber que morreram, e marca como falha sozinho.</Td></tr>
                <tr><Td>Erro real em vez de "processando" falso</Td><Td>Quando o Gateway falha de verdade, o usuário vê o motivo na hora, em vez de aguardar minutos por um agente que já parou.</Td></tr>
                <tr><Td>Aviso de falha visível</Td><Td>Tanto em DMs quanto em canais, se a resposta não chegar, aparece uma mensagem de erro visível — nunca silêncio total.</Td></tr>
              </tbody>
            </TableWrapper>
            <P>
              <strong>Limite conhecido:</strong> se um agente concluir uma tarefa longa mas a conexão cair exatamente
              na entrega, hoje não existe forma de recuperar o texto da resposta sem o agente reexecutar — a correção
              definitiva depende do Gateway (fora do HS.OS) empurrar o resultado ativamente ao concluir um turno.
            </P>

            {/* 14. ARQUIVOS E STORAGE */}
            <SectionHeading id="arquivos" title="14. Arquivos e Storage" />
            <SubHeading>Upload e Anexos no Chat</SubHeading>
            <P>
              O sistema utiliza o Supabase Storage (bucket <code className="text-xs bg-secondary px-1 rounded">agent-files</code>) para gerenciar anexos de chat.
              Ao enviar um arquivo, o HS.OS gera uma signed URL com validade de 6 horas e encaminha ao agente
              apenas a referência: <em>"O usuário enviou o arquivo {'<nome>'}. Acesse em: {'<signed_url>'}. Use web_fetch para ler quando necessário."</em>
            </P>
            <SubHeading>Tipos Suportados</SubHeading>
            <P>
              O chat suporta upload de diversos tipos de arquivo incluindo imagens (com preview inline e lightbox),
              PDFs (com preview integrado via pdfjs-dist), documentos Word (extração via mammoth.js) e arquivos genéricos.
              Imagens enviadas também podem ser processadas por modelos de visão via a edge function <code className="text-xs bg-secondary px-1 rounded">chat-image-vision</code>.
            </P>
            <SubHeading>Ciclo de Vida dos Arquivos</SubHeading>
            <P>
              Um cron job automático (<code className="text-xs bg-secondary px-1 rounded">cleanup-expired-files</code>) limpa arquivos com mais de 6 horas
              para manter conformidade com o tempo de expiração dos links e economizar espaço no bucket.
              A página <code className="text-xs bg-secondary px-1 rounded">/files</code> oferece uma interface centralizada para visualizar
              e gerenciar todos os arquivos do sistema.
            </P>
            <SubHeading>Rascunhos Persistentes</SubHeading>
            <P>
              Mensagens em composição são salvas automaticamente como rascunhos na tabela <code className="text-xs bg-secondary px-1 rounded">drafts</code>,
              associadas ao usuário e ao canal/conversa. Ao retornar a uma conversa, o rascunho é restaurado automaticamente.
            </P>
            <SubHeading>Acesso à Pasta Local</SubHeading>
            <P>
              Recurso que permite ao agente ler, criar, editar e listar arquivos diretamente em uma pasta do computador do usuário,
              via File System Access API do navegador. Não há upload — os arquivos nunca saem da máquina do usuário.
            </P>
            <P>
              <strong>Como funciona:</strong> o usuário clica no botão de pasta no composer e escolhe um diretório. O handle é
              persistido em IndexedDB (<code className="text-xs bg-secondary px-1 rounded">db: dnos-fs</code>, <code className="text-xs bg-secondary px-1 rounded">store: folder-handles</code>)
              e restaurado automaticamente nas próximas sessões enquanto a permissão estiver ativa.
            </P>
            <P>
              <strong>Operações:</strong> o agente emite tags <code className="text-xs bg-secondary px-1 rounded">&lt;file_op&gt;{'{"action":"...","path":"...","content":"..."}'}&lt;/file_op&gt;</code> em suas respostas.
              Ações suportadas: <code className="text-xs bg-secondary px-1 rounded">read</code>, <code className="text-xs bg-secondary px-1 rounded">write</code>, <code className="text-xs bg-secondary px-1 rounded">create</code>, <code className="text-xs bg-secondary px-1 rounded">list</code>.
              O navegador executa localmente e devolve o resultado na próxima mensagem, com prefixo
              <code className="text-xs bg-secondary px-1 rounded">[Resultado de file_op ...]</code> ou <code className="text-xs bg-secondary px-1 rounded">[Erro em file_op ...]</code>.
            </P>
            <P>
              <strong>Desconexão:</strong> o usuário pode revogar o acesso pelo botão <code className="text-xs bg-secondary px-1 rounded">×</code> no badge da pasta ou pelo botão
              "Desconectar pasta" no drawer. Ao desconectar, o sistema bloqueia novas operações e notifica o agente para que ele pare de tentar acessar arquivos.
            </P>
            <P>
              <strong>Compatibilidade:</strong> desktop Chrome, Edge, Brave e Opera. Safari e Firefox não suportam a API, então o botão é ocultado automaticamente.
            </P>
            <P>
              <strong>Limitações:</strong> apenas conteúdo texto puro (md, txt, html, csv, json); sem geração de .docx/.pdf binário; e conteúdo grande passa pelo contexto do agente (limite de tokens aplica).
            </P>
            <P>
              <strong>Componentes:</strong> <code className="text-xs bg-secondary px-1 rounded">useFileSystem.ts</code> (hook), <code className="text-xs bg-secondary px-1 rounded">FileSystemContext.tsx</code> (contexto),
              <code className="text-xs bg-secondary px-1 rounded">FolderButton.tsx</code> (botão no composer), <code className="text-xs bg-secondary px-1 rounded">FolderBadge.tsx</code> (badge no header),
              <code className="text-xs bg-secondary px-1 rounded">FilePanelDrawer.tsx</code> (explorador), <code className="text-xs bg-secondary px-1 rounded">FileOpCard.tsx</code> (card inline),
              <code className="text-xs bg-secondary px-1 rounded">useFileOpParser.ts</code> (parse) e <code className="text-xs bg-secondary px-1 rounded">ArtifactMessage.tsx</code> (executor).
            </P>



            {/* 15. BASE DE CONHECIMENTO (WIKI) */}
            <SectionHeading id="wiki" title="15. Base de Conhecimento (Wiki)" />
            <P>
              Módulo de documentos colaborativos no estilo Notion/Confluence disponível em
              <code className="text-xs bg-secondary px-1 rounded">/base-de-conhecimento</code>. Organiza conteúdo em <strong>Espaços</strong> com
              documentos editáveis via <strong>TipTap</strong>, suportando rich text, imagens redimensionáveis,
              vídeos, anexos (PDF, DOCX, HTML) e preview.
            </P>
            <SubHeading>Componentes</SubHeading>
            <P>
              • <code className="text-xs bg-secondary px-1 rounded">DocumentEditor</code> (TipTap) — guarda contra editor destruído em onUpdate/setContent.<br />
              • <code className="text-xs bg-secondary px-1 rounded">SpacesSidebar</code> — navegação de spaces e documentos.<br />
              • <code className="text-xs bg-secondary px-1 rounded">WikiHome</code> — landing com documentos recentes.<br />
              • <code className="text-xs bg-secondary px-1 rounded">PreviewModal</code> e rota <code className="text-xs bg-secondary px-1 rounded">/wiki-html-preview</code> para abrir HTML em nova aba.
            </P>
            <SubHeading>Tabelas</SubHeading>
            <TableWrapper>
              <thead><tr><Th>Tabela</Th><Th>Campos principais</Th></tr></thead>
              <tbody>
                <tr><Td>wiki_spaces</Td><Td>id, name, icon, description, created_by</Td></tr>
                <tr><Td>wiki_documents</Td><Td>id, space_id, title, content (JSON TipTap), html, attachments, created_by, updated_at</Td></tr>
              </tbody>
            </TableWrapper>
            <P>
              Anexos HTML abrem em nova aba renderizando via iframe <code className="text-xs bg-secondary px-1 rounded">srcDoc</code> com sandbox
              (allow-scripts, allow-forms, allow-popups, allow-modals, allow-downloads). Seleção de space/documento é persistida
              em <code className="text-xs bg-secondary px-1 rounded">sessionStorage</code> (chave <code className="text-xs bg-secondary px-1 rounded">wiki:selection</code>) e refletida na URL via query params.
            </P>

            {/* 16. BRANDING / WHITE-LABEL */}
            <SectionHeading id="branding" title="16. Branding / White-Label" />
            <P>
              Identidade visual configurável dinamicamente: <strong>nome da empresa, logo e cor primária</strong>.
              Aplicado em sidebar, header, e-mails transacionais e telas públicas.
            </P>
            <TableWrapper>
              <thead><tr><Th>Recurso</Th><Th>Detalhes</Th></tr></thead>
              <tbody>
                <tr><Td>Tabela</Td><Td><code className="text-xs bg-secondary px-1 rounded">branding</code> — company_name, logo_url, primary_color</Td></tr>
                <tr><Td>Hook</Td><Td><code className="text-xs bg-secondary px-1 rounded">useBranding()</code></Td></tr>
                <tr><Td>Configuração</Td><Td>Aba "Identidade" em <code className="text-xs bg-secondary px-1 rounded">/settings</code> (restrita a super_admin)</Td></tr>
              </tbody>
            </TableWrapper>

            {/* 17. TTS ELEVENLABS (GLOBAL) */}
            <SectionHeading id="tts" title="17. TTS ElevenLabs (Global)" />
            <P>
              Síntese de voz global para respostas de agentes via <strong>ElevenLabs</strong>. Cada agente possui um
              <code className="text-xs bg-secondary px-1 rounded">voice_id</code> padrão configurável. Toggle por usuário; sem auto-play obrigatório.
              Escopo: chat DM, canais e arenas. Configuração armazenada em <code className="text-xs bg-secondary px-1 rounded">app_settings</code> (chave
              <code className="text-xs bg-secondary px-1 rounded">elevenlabs_config</code>) e voice_id por agente.
            </P>

            {/* 18. NOTIFICAÇÕES E PUSH */}
            <SectionHeading id="notificacoes" title="18. Notificações e Push" />
            <SubHeading>Notificações In-App</SubHeading>
            <P>
              Toda mensagem nova em canal ou DM gera registro na tabela <code className="text-xs bg-secondary px-1 rounded">notifications</code>
              (<code className="text-xs bg-secondary px-1 rounded">author_name</code>, <code className="text-xs bg-secondary px-1 rounded">content_preview</code>, <code className="text-xs bg-secondary px-1 rounded">read_at</code>).
              O <code className="text-xs bg-secondary px-1 rounded">NotificationsProvider</code> escuta via Supabase Realtime e exibe toasts com supressão/deduplicação para evitar spam.
              A contagem unificada aparece como badge na sidebar e na bottom nav (suporta "99+").
            </P>
            <SubHeading>Notificações do Navegador</SubHeading>
            <P>
              Quando a aba está em segundo plano, o HS.OS dispara <code className="text-xs bg-secondary px-1 rounded">Notification</code> nativa via
              <code className="text-xs bg-secondary px-1 rounded">browser-notifications.ts</code>. Permissão é solicitada por banner discreto na primeira interação.
            </P>
            <SubHeading>Web Push (Fora da Aba)</SubHeading>
            <P>
              • <strong>Service Worker</strong> (<code className="text-xs bg-secondary px-1 rounded">src/sw.ts</code>) registra <em>push subscription</em> com chaves VAPID.<br />
              • <strong>Tabela</strong> <code className="text-xs bg-secondary px-1 rounded">push_subscriptions</code> armazena endpoint, p256dh, auth e <code className="text-xs bg-secondary px-1 rounded">user_id</code>.<br />
              • <strong>Envio</strong> via edge function <code className="text-xs bg-secondary px-1 rounded">send-push</code> com payload web-push autenticado por VAPID.
            </P>
            <P>
              No Windows, o usuário precisa habilitar a entrada do HS.OS / HS.OS em
              <em> Configurações → Sistema → Notificações</em> para recebê-las fora do navegador.
            </P>

            {/* 19. INTEGRAÇÕES EXTERNAS (CONECTORES) */}
            <SectionHeading id="integracoes" title="19. Integrações Externas (Conectores)" />
            <P>
              A aba <strong>Integrações</strong> em <code className="text-xs bg-secondary px-1 rounded">/settings</code> (restrita a super_admin) permite
              cadastrar credenciais de serviços externos consumidos pelos agentes via gateway e edge functions.
              As chaves são armazenadas de forma segura na tabela <code className="text-xs bg-secondary px-1 rounded">integrations</code> e nunca expostas no frontend.
            </P>
            <SubHeading>Tipos de Integração</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Tipo</Th><Th>Descrição</Th><Th>Exemplos</Th></tr>
              </thead>
              <tbody>
                <tr><Td>api_key</Td><Td>Credencial única (uma chave por serviço)</Td><Td>OpenAI, Anthropic, DeepSeek, Groq, ElevenLabs</Td></tr>
                <tr><Td>multi_key</Td><Td>Múltiplos campos obrigatórios/opcionais (templates pré-definidos + Personalizada)</Td><Td>AWS (Access Key + Secret), Twilio, SendGrid</Td></tr>
                <tr><Td>mcp</Td><Td>Servidores MCP (Model Context Protocol) — URL + token de autenticação</Td><Td>MCPs personalizados, conectores próprios</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Fluxo de Cadastro</SubHeading>
            <P>
              Modal de criação em 3 passos: <strong>categoria</strong> (LLM, Comunicação, Pagamento, MCP, etc.) →
              <strong> integração</strong> (template conhecido ou Personalizada) → <strong>formulário</strong> com campos derivados do template.
              Para categoria MCP, o tipo é fixo (não há escolha de api_key/multi_key).
              Cards listam cada integração com badge de tipo (ícones Lucide, sem emojis).
            </P>

            {/* 20. INTEGRAÇÕES DE AGENTES */}
            <SectionHeading id="integracoes-agentes" title="20. Integrações de Super agentes (Telegram, Slack, WhatsApp)" />
            <P>
              Cada agente pode estar conectado a canais externos — <strong>Telegram, Slack, WhatsApp</strong>. Essa
              informação <strong>não</strong> é armazenada no Supabase: vive no OpenClaw Gateway e é consultada em tempo
              real via endpoints <code className="text-xs bg-secondary px-1 rounded">/api/agents/:id/integrations</code> e
              <code className="text-xs bg-secondary px-1 rounded">/api/agents/integrations</code>.
            </P>
            <P>
              Hooks: <code className="text-xs bg-secondary px-1 rounded">useAgentIntegrations</code> e <code className="text-xs bg-secondary px-1 rounded">useAllIntegrations</code>
              (em <code className="text-xs bg-secondary px-1 rounded">use-integrations.ts</code>). UI: badges de conexão exibidos no detalhe do agente e na lista da frota.
            </P>

            {/* 21. SETTINGS */}
            <SectionHeading id="settings" title="21. Configurações (Settings)" />
            <P>
              Página única <code className="text-xs bg-secondary px-1 rounded">/settings</code> com abas controladas via query param <code className="text-xs bg-secondary px-1 rounded">?tab=</code>.
              Rotas antigas (<code className="text-xs bg-secondary px-1 rounded">/profile</code>, <code className="text-xs bg-secondary px-1 rounded">/users</code>, <code className="text-xs bg-secondary px-1 rounded">/documentation</code>,
              <code className="text-xs bg-secondary px-1 rounded">/mission-control</code>, <code className="text-xs bg-secondary px-1 rounded">/dnos</code>) são redirecionadas para a aba correspondente.
            </P>
            <TableWrapper>
              <thead>
                <tr><Th>Aba</Th><Th>Descrição</Th><Th>Acesso</Th></tr>
              </thead>
              <tbody>
                <tr><Td>profile</Td><Td>Dados pessoais, avatar, e-mail, senha</Td><Td>Todos</Td></tr>
                <tr><Td>identity</Td><Td>Identidade visual (branding white-label: logo, cor, nome)</Td><Td>super_admin</Td></tr>
                <tr><Td>gateway</Td><Td>URL e token do OpenClaw Gateway, health check</Td><Td>super_admin</Td></tr>
                <tr><Td>artifacts</Td><Td>Artefatos criados (preview iframe srcDoc) e publicados</Td><Td>member, admin</Td></tr>
                <tr><Td>dnos</Td><Td>Mission Control / configurações da operação</Td><Td>member, admin</Td></tr>
                <tr><Td>users</Td><Td>Gestão de usuários, convites, atribuição de roles</Td><Td>super_admin</Td></tr>
                <tr><Td>documentation</Td><Td>Esta documentação (HTML navegável + export PDF/YAML)</Td><Td>member, admin</Td></tr>
                <tr><Td>integrations</Td><Td>Conectores externos (api_key, multi_key, MCP)</Td><Td>super_admin</Td></tr>
                <tr><Td>tts</Td><Td>ElevenLabs e vozes por agente</Td><Td>super_admin</Td></tr>
                <tr><Td>empresa</Td><Td>Perfil da empresa (nome, segmento, fundador, descrição, público, oferta, tom, faturamento, equipe) + upload de docs (PDF/DOCX/TXT/MD) e gravação de voz para preenchimento por IA</Td><Td>super_admin</Td></tr>
              </tbody>
            </TableWrapper>

            {/* 22. UI GLOBAL */}
            <SectionHeading id="ui-global" title="22. UI Global" />
            <SubHeading>Tema</SubHeading>
            <P>
              Dark por padrão (Glass Aurora) com toggle dark/light no header (<code className="text-xs bg-secondary px-1 rounded">ThemeToggle</code>).
              Cor primária <code className="text-xs bg-secondary px-1 rounded">#3D61FF</code>, background <code className="text-xs bg-secondary px-1 rounded">#0A0A0A</code>.
            </P>
            <SubHeading>Busca Global</SubHeading>
            <P>
              Componente <code className="text-xs bg-secondary px-1 rounded">GlobalSearch</code> fica no header, ao lado do toggle de tema.
              Mapeia IDs (agentes, canais, usuários) para nomes amigáveis, evitando exibir UUIDs.
            </P>
            <SubHeading>Navegação Mobile</SubHeading>
            <P>
              <code className="text-xs bg-secondary px-1 rounded">BottomNav</code> com as rotas principais e header simplificado com safe-area iOS para notch.
            </P>
            <SubHeading>Notificações In-App</SubHeading>
            <P>
              <code className="text-xs bg-secondary px-1 rounded">NotificationsProvider</code> com badge unificado (suporta "99+") aparecendo na sidebar e na bottom nav.
            </P>

            {/* 23. PWA E MOBILE */}
            <SectionHeading id="pwa-mobile" title="23. PWA e Mobile" />
            <P>
              O HS.OS é distribuído como <strong>Progressive Web App (PWA)</strong> instalável em desktop e mobile.
              Não há build nativo (Capacitor/iOS/Android) no momento — a experiência mobile usa a própria PWA.
            </P>
            <SubHeading>Manifest e Ícones</SubHeading>
            <TableWrapper>
              <thead>
                <tr><Th>Campo</Th><Th>Valor</Th></tr>
              </thead>
              <tbody>
                <tr><Td>name / short_name</Td><Td>HS.OS HS.OS / HS.OS</Td></tr>
                <tr><Td>display</Td><Td>standalone (abre como app, sem barra do navegador)</Td></tr>
                <tr><Td>background_color</Td><Td>#0A0A0A</Td></tr>
                <tr><Td>theme_color</Td><Td>#3D61FF</Td></tr>
                <tr><Td>orientation</Td><Td>portrait-primary</Td></tr>
                <tr><Td>icons</Td><Td>/icons/icon-192.png e /icons/icon-512.png (any maskable)</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Instalação</SubHeading>
            <P>
              • <strong>Desktop (Chrome/Edge)</strong> — ícone "Instalar" na barra de endereços ou menu do navegador.<br />
              • <strong>Android</strong> — banner automático "Adicionar à tela inicial" ou via menu do Chrome.<br />
              • <strong>iOS (Safari)</strong> — botão Compartilhar → "Adicionar à Tela de Início". iOS limita push em PWAs instaladas ao iOS 16.4+.
            </P>
            <SubHeading>Service Worker e Offline</SubHeading>
            <P>
              O service worker (<code className="text-xs bg-secondary px-1 rounded">src/sw.ts</code>, gerado por <code className="text-xs bg-secondary px-1 rounded">vite-plugin-pwa</code>) é registrado apenas em produção,
              fora de previews/iframes da Lovable. Estratégia <strong>NetworkFirst</strong> para HTML (sem cache agressivo),
              <strong> CacheFirst</strong> para assets hashed. Auto-update on focus garante que novas versões substituam a anterior sem ação manual.
              O suporte offline cobre o shell da aplicação; mensagens e dados em tempo real exigem conexão.
            </P>
            <SubHeading>UI Mobile</SubHeading>
            <P>
              Layout responsivo com <code className="text-xs bg-secondary px-1 rounded">BottomNav</code> nas rotas principais, header simplificado com safe-area para iOS
              (notch), e drawer de canais/DMs. O Glass Aurora é mantido com glassmorphism e blur otimizados para GPU.
            </P>

            {/* 24. API PÚBLICA */}
            <SectionHeading id="api-publica" title="24. API Pública" />
            <P>
              O HS.OS <strong>não expõe</strong> uma API REST/GraphQL pública genérica para que outras plataformas consumam recursos
              (agentes, canais, mensagens, artefatos) por endpoint próprio.
            </P>
            <P>
              A única superfície pública é a <strong>Broadcast API</strong> (ver seção 12), autenticada via cabeçalho
              <code className="text-xs bg-secondary px-1 rounded">x-api-key</code>, voltada para envio de mensagens a canais/DMs e registro de resultados de agentes.
            </P>
            <P>
              • <strong>Sistemas externos → HS.OS</strong> — usar a Broadcast API (<code className="text-xs bg-secondary px-1 rounded">channel-broadcast</code>) para postar conteúdo.<br />
              • <strong>HS.OS → sistemas externos</strong> — cadastrar credenciais na aba Integrações (seção 19) e consumir via gateway/edge functions.
            </P>
            <P>
              Caso uma API pública seja necessária (exposição de agentes, conversas e artefatos por endpoint REST com OAuth/API key),
              ela precisa ser projetada e implementada como nova camada — não existe hoje no projeto.
            </P>

            {/* 25. ONBOARDING DA EMPRESA */}
            <SectionHeading id="onboarding-empresa" title="25. Onboarding da Empresa" />
            <P>
              Fluxo de cadastro do contexto do negócio para que todos os agentes conheçam a empresa.
              Singleton armazenado em <code className="text-xs bg-secondary px-1 rounded">public.company_profile</code> (RLS restrita a <code className="text-xs bg-secondary px-1 rounded">super_admin</code>),
              com bucket privado <code className="text-xs bg-secondary px-1 rounded">company-docs</code> para anexos.
            </P>
            <SubHeading>Interface (Settings → Empresa)</SubHeading>
            <P>
              Três formas de preencher: (a) edição manual dos campos, (b) descrição livre em texto ou voz (Web Speech API),
              (c) upload de documento (PDF, DOCX, TXT, MD — drag & drop). Nas opções (b) e (c) o conteúdo é normalizado
              por IA e os campos são pré-preenchidos para revisão antes de salvar. O nome do arquivo é sanitizado (NFD,
              remoção de acentos e caracteres não alfanuméricos) antes do upload ao Storage.
            </P>
            <SubHeading>Edge Functions</SubHeading>
            <TableWrapper>
              <thead><tr><Th>Função</Th><Th>Responsabilidade</Th></tr></thead>
              <tbody>
                <tr><Td>parse-company-context</Td><Td>Transforma texto livre em JSON estruturado via Lovable AI Gateway (google/gemini-3-flash-preview)</Td></tr>
                <tr><Td>extract-file-text</Td><Td>Baixa o arquivo do bucket <code className="text-xs bg-secondary px-1 rounded">company-docs</code>, extrai texto (pdf-parse, mammoth — opção <code className="text-xs bg-secondary px-1 rounded">buffer</code> com Uint8Array, leitura direta para TXT/MD) e encaminha ao parse</Td></tr>
                <tr><Td>notify-orchestrator-onboarding</Td><Td>Localiza o agente líder (<code className="text-xs bg-secondary px-1 rounded">agent_profiles.is_leader = true</code>), gera <code className="text-xs bg-secondary px-1 rounded">COMPANY.md</code> e dispara <code className="text-xs bg-secondary px-1 rounded">cron.add</code> (kind <code className="text-xs bg-secondary px-1 rounded">agentTurn</code>) no gateway para propagar o contexto à frota</Td></tr>
              </tbody>
            </TableWrapper>
            <SubHeading>Banner de Onboarding</SubHeading>
            <P>
              <code className="text-xs bg-secondary px-1 rounded">CompanyOnboardingBanner</code> aparece no <code className="text-xs bg-secondary px-1 rounded">AppLayout</code> quando o perfil não está preenchido.
              Link "Configurar" navega para <code className="text-xs bg-secondary px-1 rounded">/settings?tab=empresa</code> (a aba é sincronizada via <code className="text-xs bg-secondary px-1 rounded">useEffect</code> sobre <code className="text-xs bg-secondary px-1 rounded">searchParams</code>).
              É dismissível e o estado fica em <code className="text-xs bg-secondary px-1 rounded">localStorage</code> (<code className="text-xs bg-secondary px-1 rounded">dnos:company-onboarding-banner-dismissed</code>).
            </P>
            <SubHeading>Regras permanentes</SubHeading>
            <P>
              • Soft trigger — agentes nunca bloqueados esperando onboarding.<br />
              • Orquestrador sempre via <code className="text-xs bg-secondary px-1 rounded">is_leader = true</code> em <code className="text-xs bg-secondary px-1 rounded">agent_profiles</code> — nunca string literal.<br />
              • Apenas <code className="text-xs bg-secondary px-1 rounded">super_admin</code> cria/edita perfil e anexos da empresa.<br />
              • Sem emojis — sempre ícones Lucide.
            </P>

            {/* 26. GOAL VS LOOP */}
            <SectionHeading id="goal-vs-loop" title="26. Goal vs Loop — Modos de Autonomia" />
            <P>
              Os agentes HS.OS têm dois mecanismos para executar tarefas de forma autônoma:
            </P>

            <SubHeading>🎯 Goal (OpenClaw Nativo)</SubHeading>
            <P>
              <strong>O que é:</strong> Feature built-in do runtime OpenClaw. O agente define um objetivo e executa todas as etapas automaticamente dentro da mesma sessão, sem intervenção humana.
            </P>
            <P>
              <strong>Quem gerencia:</strong> 100% OpenClaw. Sem dependência externa (sem tabelas, sem EFs, sem frontend).
            </P>
            <P>
              <strong>Quando usar:</strong> Tarefas médias (~5–15 tool calls) que cabem em uma única sessão.
            </P>
            <P>
              <strong>Frontend:</strong> NÃO precisa de UI. Goal é invisível pro Lovable — roda dentro do runtime e morre com a sessão.
            </P>
            <P>
              <strong>Exemplo:</strong> "Faz um relatório de status de todos os agentes" — ~10 ferramentas, termina na mesma conversa.
            </P>

            <SubHeading>🔄 Loop Architecture (HS.OS)</SubHeading>
            <P>
              <strong>O que é:</strong> Infraestrutura customizada construída pela HS.OS sobre Supabase. Tarefas grandes são divididas em chunks, com checkpoints salvos no banco. Se a sessão cair ou o agente parar, a tarefa é retomada automaticamente de onde parou.
            </P>
            <P>
              <strong>Quem gerencia:</strong> Supabase (<code className="text-xs bg-secondary px-1 rounded">agent_tasks</code>) + Edge Function (<code className="text-xs bg-secondary px-1 rounded">agent-task</code>) + cron de retomada + UI do Lovable.
            </P>
            <P>
              <strong>Quando usar:</strong> Tarefas grandes (15+ tool calls) ou quando um Goal falha por timeout / queda de sessão.
            </P>
            <P>
              <strong>Frontend:</strong> ESSA é a parte que o Lovable precisa enxergar. O frontend já mostra cards de tarefas em andamento e injeta a system message <code className="text-xs bg-secondary px-1 rounded">[HS.OS] Task pendente encontrada</code> no início da sessão para o agente retomar automaticamente.
            </P>
            <P>
              <strong>Exemplo:</strong> "Audita os workspaces de todos os 8 agentes" — 3 dias, ~60 ferramentas, múltiplas sessões.
            </P>

            <SubHeading>📊 Comparativo</SubHeading>
            <TableWrapper>
              <thead><tr><Th>Aspecto</Th><Th>Goal</Th><Th>Loop</Th></tr></thead>
              <tbody>
                <tr><Td>Runtime</Td><Td>OpenClaw nativo</Td><Td>Infra HS.OS (Supabase + EF)</Td></tr>
                <tr><Td>Persistência</Td><Td>❌ Morre com a sessão</Td><Td>✅ Checkpoints no banco</Td></tr>
                <tr><Td>Frontend</Td><Td>❌ Não precisa de UI</Td><Td>✅ Já implementado no Lovable</Td></tr>
                <tr><Td>Gatilho</Td><Td>/goal ou agente decide</Td><Td>agent-task create</Td></tr>
                <tr><Td>Retomada</Td><Td>Manual (refaz)</Td><Td>Automática (cron + system message)</Td></tr>
                <tr><Td>Uso típico</Td><Td>5–15 tool calls, mesma sessão</Td><Td>15+ tool calls, multi-sessão</Td></tr>
              </tbody>
            </TableWrapper>

            <SubHeading>🔀 Árvore de Decisão</SubHeading>
            <Code>{`Tarefa chegou ->
  ├─ Simples (1-5 tool calls) -> Executa direto
  ├─ Média (5-15 tool calls) -> 🎯 Goal (mesma sessão)
  ├─ Grande (15+ tool calls) -> 🔄 Loop (checkpoint + retomada)
  └─ Goal travou -> 🔄 Loop (fallback automático)`}</Code>

            <SubHeading>✅ O que o Lovable JÁ implementa do Loop</SubHeading>
            <P>
              • Cards de task em andamento na UI.<br />
              • System message <code className="text-xs bg-secondary px-1 rounded">[HS.OS] Task pendente encontrada: "&lt;título&gt;" (ID: &lt;uuid&gt;)</code> injetada no início da sessão.<br />
              • Status visual: <code className="text-xs bg-secondary px-1 rounded">running</code> / <code className="text-xs bg-secondary px-1 rounded">checkpoint</code> / <code className="text-xs bg-secondary px-1 rounded">completed</code> / <code className="text-xs bg-secondary px-1 rounded">failed</code>.
            </P>

            <SubHeading>❌ O que NÃO precisa implementar</SubHeading>
            <P>
              • Qualquer UI para Goal — é 100% runtime, invisível pro frontend.
            </P>
            {/* 27. EXPORT / IMPORT */}
            <SectionHeading id="export-import" title="27. Exportação e Importação de Super Agentes (.dnos)" />
            <P>
              Super agentes podem ser exportados e reimportados entre instâncias HS.OS através do formato proprietário <code className="text-xs bg-secondary px-1 rounded">.dnos</code> (JSON estruturado). O pipeline sanitiza dados sensíveis da empresa e UUIDs de plataforma automaticamente, tornando o arquivo seguro para compartilhar.
            </P>

            <SubHeading>Formato .dnos</SubHeading>
            <P>
              Estrutura versionada (atual: <code className="text-xs bg-secondary px-1 rounded">1.0</code>) contendo:
              <br />• <strong>agent</strong>: metadados (agent_id, name, role, department, description, color, emoji).
              <br />• <strong>required_connectors</strong>: conectores detectados automaticamente (Meta Ads, Slack, Telegram, ElevenLabs, etc.).
              <br />• <strong>capabilities</strong>: capacidades extraídas do SOUL.md.
              <br />• <strong>files</strong>: <code className="text-xs bg-secondary px-1 rounded">SOUL.md</code>, <code className="text-xs bg-secondary px-1 rounded">IDENTITY.md</code>, <code className="text-xs bg-secondary px-1 rounded">TOOLS.md</code> e <code className="text-xs bg-secondary px-1 rounded">AGENTS.md</code>.
            </P>

            <SubHeading>Exportação</SubHeading>
            <P>
              Disparada pelo componente <code className="text-xs bg-secondary px-1 rounded">ExportAgentButton</code> (cards de agente e tela de detalhes), que invoca a edge function <code className="text-xs bg-secondary px-1 rounded">export-agent</code>. Pipeline em 3 camadas:
            </P>
            <Code>{`1. Live workspace (gateway) -> SOUL/IDENTITY/TOOLS/AGENTS.md atuais
2. Fallback público -> /templates/<agent>/*.md + /templates/AGENTS.md
3. Fallback gateway -> .templates/ snapshot do onboarding`}</Code>
            <P>
              Após a leitura, dois níveis de sanitização são aplicados:
            </P>
            <P>
              <strong>Sanitização de empresa</strong> — substitui dados do <code className="text-xs bg-secondary px-1 rounded">company_profile</code> por placeholders: <code className="text-xs bg-secondary px-1 rounded">{'{{COMPANY_NAME}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{FOUNDER_NAME}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{COMPANY_SEGMENT}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{COMPANY_DESCRIPTION}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{TARGET_AUDIENCE}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{COMPANY_PRODUCT}}'}</code>, <code className="text-xs bg-secondary px-1 rounded">{'{{BRAND_VOICE}}'}</code>.
            </P>
            <P>
              <strong>Sanitização de UUIDs</strong> — todo UUID de instância (boards, listas, membros, crons) vira placeholder contextual baseado nas ~60 chars anteriores:
            </P>
            <TableWrapper>
              <thead><tr><Th>Contexto detectado</Th><Th>Placeholder</Th></tr></thead>
              <tbody>
                <tr><Td>board</Td><Td>{'{{DN_TASK_BOARD_ID}}'}</Td></tr>
                <tr><Td>list / lista</Td><Td>{'{{DN_TASK_LIST_ID}}'}</Td></tr>
                <tr><Td>member / membro / user</Td><Td>{'{{DN_TASK_MEMBER_ID}}'}</Td></tr>
                <tr><Td>card</Td><Td>{'{{DN_TASK_CARD_ID}}'}</Td></tr>
                <tr><Td>cron</Td><Td>{'{{CRON_ID}}'}</Td></tr>
                <tr><Td>agent / agente</Td><Td>{'{{AGENT_UUID}}'}</Td></tr>
                <tr><Td>outros</Td><Td>{'{{PLATFORM_UUID}}'}</Td></tr>
              </tbody>
            </TableWrapper>

            <SubHeading>Importação</SubHeading>
            <P>
              Feita via <code className="text-xs bg-secondary px-1 rounded">ImportAgentDialog</code> na tela de Super agentes. O fluxo:
            </P>
            <P>
              1. Usuário faz upload do arquivo <code className="text-xs bg-secondary px-1 rounded">.dnos</code>.<br />
              2. Sistema valida versão, <code className="text-xs bg-secondary px-1 rounded">agent_id</code> ({'[a-z0-9-]{2,32}'}), presença de <code className="text-xs bg-secondary px-1 rounded">SOUL.md</code>.<br />
              3. UI exibe conectores requeridos e capacidades detectadas.<br />
              4. Cria <code className="text-xs bg-secondary px-1 rounded">agent_profiles</code> + workspace no gateway com todos os arquivos.<br />
              5. Placeholders <code className="text-xs bg-secondary px-1 rounded">{'{{COMPANY_*}}'}</code> são substituídos pelos dados locais da empresa.<br />
              6. Usuário conecta conectores requeridos que ainda não existem.
            </P>

            <SubHeading>Garantias de Segurança</SubHeading>
            <P>
              • Nenhum dado sensível de empresa vaza — tudo é convertido em placeholder.<br />
              • Nenhum UUID de instância vaza — sanitização aplicada em SOUL, IDENTITY, TOOLS e AGENTS.<br />
              • Nenhuma chave de API é exportada — apenas os <em>nomes</em> dos conectores requeridos.
            </P>

            <SubHeading>Casos de Uso</SubHeading>
            <P>
              • Compartilhar agentes entre empresas e instâncias HS.OS.<br />
              • Backup completo antes de mudanças estruturais no SOUL/IDENTITY.<br />
              • Distribuir super agentes especializados como templates públicos.<br />
              • Migrar agentes entre ambientes (dev → prod).
            </P>

            {/* Footer */}
            <div className="mt-12 pt-6 border-t border-border text-center">
              <p className="text-xs text-muted-foreground">
                HS.OS • Documentação gerada automaticamente • {new Date().toLocaleDateString("pt-BR")}
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
