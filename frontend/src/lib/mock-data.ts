// Mock data for development before gateway connection

export interface Agent {
  id: string;
  name: string;
  status: "online" | "offline" | "processing";
  model: string;
  channels: string[];
  systemPrompt: string;
  tokensUsed: number;
  sessions: number;
  lastActive: string;
}

export interface MediaAttachment {
  type: "image" | "audio" | "file";
  mimeType: string;
  base64: string; // data URI or public URL for files
  name?: string;
  size?: number; // bytes
  url?: string; // public URL from storage
  extractedText?: string; // extracted text content for documents
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  channel: string;
  media?: MediaAttachment[];
  isError?: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  assignedAgents: string[];
}

export interface AgentFile {
  id: string;
  agentId: string;
  name: string;
  size: number;
  uploadedAt: string;
}

export const mockAgents: Agent[] = [
  {
    id: "1",
    name: "Atendimento HS.OS",
    status: "online",
    model: "gpt-4o",
    channels: ["telegram", "whatsapp"],
    systemPrompt: "Você é o assistente de atendimento da HS.OS...",
    tokensUsed: 142850,
    sessions: 38,
    lastActive: "2026-03-14T10:30:00Z",
  },
  {
    id: "2",
    name: "Vendas Prospecção",
    status: "online",
    model: "gpt-4o-mini",
    channels: ["whatsapp"],
    systemPrompt: "Você é um agente de prospecção de vendas...",
    tokensUsed: 89430,
    sessions: 22,
    lastActive: "2026-03-14T09:45:00Z",
  },
  {
    id: "3",
    name: "Suporte Técnico",
    status: "offline",
    model: "gpt-4o",
    channels: ["telegram"],
    systemPrompt: "Agente de suporte técnico para clientes...",
    tokensUsed: 54210,
    sessions: 15,
    lastActive: "2026-03-13T18:00:00Z",
  },
  {
    id: "4",
    name: "Qualificação Leads",
    status: "processing",
    model: "claude-3.5-sonnet",
    channels: ["whatsapp", "telegram"],
    systemPrompt: "Qualifique leads com perguntas BANT...",
    tokensUsed: 203100,
    sessions: 67,
    lastActive: "2026-03-14T11:02:00Z",
  },
];

export const mockMessages: ChatMessage[] = [
  { id: "m1", agentId: "1", role: "user", content: "Olá, gostaria de saber sobre os serviços da HS.OS", timestamp: "2026-03-14T10:25:00Z", channel: "telegram" },
  { id: "m2", agentId: "1", role: "agent", content: "Olá! Bem-vindo à HS.OS! Somos especializados em automação com IA para negócios. Posso te ajudar com informações sobre nossos serviços de agentes inteligentes, automação de atendimento e prospecção. O que te interessa mais?", timestamp: "2026-03-14T10:25:05Z", channel: "telegram" },
  { id: "m3", agentId: "1", role: "user", content: "Quero saber sobre automação de WhatsApp", timestamp: "2026-03-14T10:26:00Z", channel: "telegram" },
  { id: "m4", agentId: "1", role: "agent", content: "Ótimo! Nossa solução de automação para WhatsApp inclui:\n\n• Atendimento 24/7 com IA\n• Qualificação automática de leads\n• Integração com CRM\n• Respostas personalizadas\n\nQuer agendar uma demonstração?", timestamp: "2026-03-14T10:26:08Z", channel: "telegram" },
];

export const mockTeamMembers: TeamMember[] = [
  { id: "t1", name: "Admin", email: "admin@dnia.ai", role: "admin", assignedAgents: ["1", "2", "3", "4"] },
  { id: "t2", name: "João Silva", email: "joao@dnia.ai", role: "operator", assignedAgents: ["1", "2"] },
  { id: "t3", name: "Maria Santos", email: "maria@dnia.ai", role: "operator", assignedAgents: ["3"] },
];

export const mockFiles: AgentFile[] = [
  { id: "f1", agentId: "1", name: "catalogo-servicos.pdf", size: 2400000, uploadedAt: "2026-03-10T14:00:00Z" },
  { id: "f2", agentId: "1", name: "faq-atendimento.txt", size: 45000, uploadedAt: "2026-03-12T09:00:00Z" },
  { id: "f3", agentId: "2", name: "script-vendas.md", size: 12000, uploadedAt: "2026-03-11T16:00:00Z" },
];
