import { useState } from "react";
import { getGatewayConfig } from "@/lib/gateway";
import { type GatewayAgent } from "@/hooks/use-agents";
import { X, Send, Bot, User, Loader2 } from "lucide-react";

interface OrchestratorChatProps {
  agents: GatewayAgent[];
  onClose: () => void;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const ORCHESTRATOR_SYSTEM = `Você é o Orquestrador do OpenClaw dn.os. Você ajuda o admin a criar e configurar novos agentes.

Quando o usuário descrever um agente que quer criar, você deve:
1. Perguntar detalhes se necessário (nome, modelo preferido, canais, personalidade)
2. Sugerir conteúdo para os arquivos padrão: SOUL.md, IDENTITY.md, USER.md, MEMORY.md, AGENTS.md, HEARTBEAT.md, TOOLS.md
3. Criar os arquivos via API quando o usuário aprovar
4. O usuário pode enviar arquivos de conhecimento que você deve salvar no workspace

Você tem acesso a:
- POST /api/files/:agentId com {filename, content} para criar/editar arquivos
- Instruir o admin sobre configuração manual se necessário

Seja direto e eficiente. Responda em português.`;

export function OrchestratorChat({ agents, onClose }: OrchestratorChatProps) {
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || "");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Olá! Sou o Orquestrador. Me diga que tipo de agente você quer criar e eu ajudo com a configuração completa — nome, personalidade, arquivos do workspace e mais." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || !selectedAgent || sending) return;
    const userMsg: Msg = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setSending(true);

    try {
      const config = getGatewayConfig();
      const res = await fetch(`${config.url}/v1/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedAgent,
          input: `${ORCHESTRATOR_SYSTEM}\n\n${newMessages.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
        }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      const reply = data.output?.[0]?.content?.[0]?.text ?? "Sem resposta.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Erro: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md z-50 flex flex-col bg-card border-l border-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent/80 to-primary/40 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold text-foreground">Criar via Orquestrador</h3>
            <p className="text-[10px] text-muted-foreground">Descreva o agente que deseja criar</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Agent selector */}
      <div className="px-4 py-2 border-b border-border">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Orquestrador</label>
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.model})</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3 w-3 text-foreground" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "user" ? "bg-primary text-primary-foreground" : "glass-card text-foreground"
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "user" && (
              <div className="h-6 w-6 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Descreva o agente..."
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSend}
            disabled={!selectedAgent || sending}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors duration-150 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
