import { useState, useEffect, useCallback } from "react";
import { getGatewayConfig } from "@/lib/gateway";

export interface Skill {
  name: string;
  description: string;
  type: "built-in" | "custom";
  installable: boolean;
  platform: "linux" | "mac" | "any";
  requiresCredentials?: string;
  category?: string;
}

export interface AgentSkill {
  name: string;
  source: "SOUL.md" | "AGENTS.md";
}

/* ---------- Fallback: 54 known OpenClaw skills ---------- */
const FALLBACK_SKILLS: Skill[] = [
  // Web & Search
  { name: "web-search", description: "Busca na web via Google/Bing", type: "built-in", installable: true, platform: "any", category: "Web & Search" },
  { name: "web-scrape", description: "Extração de conteúdo de páginas web", type: "built-in", installable: true, platform: "any", category: "Web & Search" },
  { name: "web-browse", description: "Navegação interativa em sites", type: "built-in", installable: true, platform: "any", category: "Web & Search" },
  { name: "url-fetch", description: "Download de URLs e APIs", type: "built-in", installable: true, platform: "any", category: "Web & Search" },
  { name: "rss-reader", description: "Leitura de feeds RSS/Atom", type: "built-in", installable: true, platform: "any", category: "Web & Search" },
  // Files & Documents
  { name: "file-read", description: "Leitura de arquivos locais", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "file-write", description: "Escrita de arquivos locais", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "file-edit", description: "Edição parcial de arquivos", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "pdf-read", description: "Leitura e extração de PDFs", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "csv-parse", description: "Parsing e análise de CSVs", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "json-parse", description: "Parsing e manipulação de JSON", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "markdown-render", description: "Renderização de Markdown", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "docx-read", description: "Leitura de documentos Word", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  { name: "xlsx-read", description: "Leitura de planilhas Excel", type: "built-in", installable: true, platform: "any", category: "Files & Documents" },
  // Code & Dev
  { name: "code-execute", description: "Execução de código Python/JS/Shell", type: "built-in", installable: true, platform: "any", category: "Code & Dev" },
  { name: "code-review", description: "Revisão e análise de código", type: "built-in", installable: true, platform: "any", category: "Code & Dev" },
  { name: "git-ops", description: "Operações Git (clone, pull, push)", type: "built-in", installable: true, platform: "any", category: "Code & Dev", requiresCredentials: "Git Token" },
  { name: "npm-run", description: "Execução de scripts npm", type: "built-in", installable: true, platform: "any", category: "Code & Dev" },
  { name: "docker-run", description: "Execução de containers Docker", type: "built-in", installable: true, platform: "linux", category: "Code & Dev" },
  { name: "shell-exec", description: "Execução de comandos shell", type: "built-in", installable: true, platform: "any", category: "Code & Dev" },
  // Communication
  { name: "email-send", description: "Envio de emails via SMTP/API", type: "built-in", installable: true, platform: "any", category: "Communication", requiresCredentials: "SMTP/API Key" },
  
  { name: "slack-send", description: "Envio de mensagens no Slack", type: "built-in", installable: true, platform: "any", category: "Communication", requiresCredentials: "Slack Token" },
  { name: "whatsapp-send", description: "Envio de mensagens no WhatsApp", type: "built-in", installable: true, platform: "any", category: "Communication", requiresCredentials: "WhatsApp API Key" },
  { name: "discord-send", description: "Envio de mensagens no Discord", type: "built-in", installable: true, platform: "any", category: "Communication", requiresCredentials: "Discord Token" },
  { name: "webhook-call", description: "Chamadas a webhooks HTTP", type: "built-in", installable: true, platform: "any", category: "Communication" },
  // Data & Analysis
  { name: "data-analysis", description: "Análise estatística de dados", type: "built-in", installable: true, platform: "any", category: "Data & Analysis" },
  { name: "chart-generate", description: "Geração de gráficos e charts", type: "built-in", installable: true, platform: "any", category: "Data & Analysis" },
  { name: "sql-query", description: "Execução de queries SQL", type: "built-in", installable: true, platform: "any", category: "Data & Analysis", requiresCredentials: "DB Connection" },
  { name: "vector-search", description: "Busca por similaridade vetorial", type: "built-in", installable: true, platform: "any", category: "Data & Analysis" },
  { name: "embeddings", description: "Geração de embeddings de texto", type: "built-in", installable: true, platform: "any", category: "Data & Analysis" },
  // Media
  { name: "image-generate", description: "Geração de imagens via AI", type: "built-in", installable: true, platform: "any", category: "Media" },
  { name: "image-analyze", description: "Análise e descrição de imagens", type: "built-in", installable: true, platform: "any", category: "Media" },
  { name: "image-edit", description: "Edição e manipulação de imagens", type: "built-in", installable: true, platform: "any", category: "Media" },
  { name: "audio-transcribe", description: "Transcrição de áudio para texto", type: "built-in", installable: true, platform: "any", category: "Media" },
  { name: "tts-generate", description: "Text-to-speech com ElevenLabs", type: "built-in", installable: true, platform: "any", category: "Media", requiresCredentials: "ElevenLabs API Key" },
  { name: "video-analyze", description: "Análise de conteúdo de vídeo", type: "built-in", installable: true, platform: "any", category: "Media" },
  { name: "screenshot", description: "Captura de screenshots de URLs", type: "built-in", installable: true, platform: "any", category: "Media" },
  // APIs & Integrations
  { name: "api-call", description: "Chamadas a APIs REST genéricas", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations" },
  { name: "graphql-query", description: "Queries GraphQL", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations" },
  { name: "github-api", description: "Integração com GitHub API", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations", requiresCredentials: "GitHub Token" },
  { name: "notion-api", description: "Integração com Notion API", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations", requiresCredentials: "Notion Token" },
  { name: "google-sheets", description: "Leitura/escrita em Google Sheets", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations", requiresCredentials: "Google Service Account" },
  { name: "google-calendar", description: "Gerenciamento de Google Calendar", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations", requiresCredentials: "Google Service Account" },
  { name: "google-drive", description: "Upload/download Google Drive", type: "built-in", installable: true, platform: "any", category: "APIs & Integrations", requiresCredentials: "Google Service Account" },
  // Memory & Context
  { name: "memory-store", description: "Armazenamento de memória persistente", type: "built-in", installable: true, platform: "any", category: "Memory & Context" },
  { name: "memory-recall", description: "Recuperação de memórias salvas", type: "built-in", installable: true, platform: "any", category: "Memory & Context" },
  { name: "context-inject", description: "Injeção de contexto na conversa", type: "built-in", installable: true, platform: "any", category: "Memory & Context" },
  { name: "rag-query", description: "Busca RAG em documentos indexados", type: "built-in", installable: true, platform: "any", category: "Memory & Context" },
  // Scheduling & Automation
  { name: "cron-schedule", description: "Agendamento de tarefas periódicas", type: "built-in", installable: true, platform: "any", category: "Scheduling" },
  { name: "task-queue", description: "Fila de tarefas assíncronas", type: "built-in", installable: true, platform: "any", category: "Scheduling" },
  { name: "agent-delegate", description: "Delegação de tarefas entre agentes", type: "built-in", installable: true, platform: "any", category: "Scheduling" },
  // Custom HS.OS
  { name: "ai-video-gen", description: "Geração de vídeos com IA (custom HS.OS)", type: "custom", installable: true, platform: "any", category: "Custom HS.OS", requiresCredentials: "Video API Key" },
  { name: "canva-connect", description: "Integração com Canva para design (custom HS.OS)", type: "custom", installable: true, platform: "any", category: "Custom HS.OS", requiresCredentials: "Canva API Key" },
];

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    const config = getGatewayConfig();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.url}/api/skills`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.skills ?? []);
      if (list.length === 0) throw new Error("empty");
      setSkills(
        list
          .map((s: any) => ({
            name: s.name ?? s.id ?? "",
            description: s.description ?? "",
            type: s.type === "custom" ? "custom" : "built-in",
            installable: s.installable ?? true,
            platform: (["linux", "mac", "any"].includes(s.platform) ? s.platform : "any") as Skill["platform"],
            requiresCredentials: s.requiresCredentials ?? s.requires_credentials ?? undefined,
            category: s.category ?? undefined,
          }))
          .filter((s: Skill) => !s.name.toLowerCase().includes("telegram") && !s.description.toLowerCase().includes("telegram"))
      );
    } catch {
      // Fallback to known skills catalog
      console.warn("Skills API unavailable, using fallback catalog");
      setSkills(FALLBACK_SKILLS);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return { skills, loading, error, refetch: fetchSkills };
}

export function useAgentSkills(agentId: string | null) {
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgentSkills = useCallback(async () => {
    if (!agentId) return;
    const config = getGatewayConfig();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.url}/api/skills/${agentId}`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.skills ?? []);
      setAgentSkills(
        list.map((s: any) => ({
          name: s.name ?? s.id ?? s,
          source: s.source ?? "SOUL.md",
        }))
      );
    } catch (err: any) {
      setError(err.message);
      setAgentSkills([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgentSkills();
  }, [fetchAgentSkills]);

  return { agentSkills, loading, error, refetch: fetchAgentSkills };
}
