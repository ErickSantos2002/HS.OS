import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getArena, deleteArena, type Arena } from "@/lib/arena-store";
import { supabase } from "@/integrations/supabase/client";
import { useArenaSessions } from "@/hooks/use-arena-sessions";
import { getAgentAvatar } from "@/hooks/use-agent-avatar";
import { useArenaAgents } from "@/hooks/use-arena-agents";
import { extractArtifact } from "@/lib/artifact-extractor";
import SessionsSidebar from "@/components/arena/SessionsSidebar";
import DebateCards, { type DebateResponse, getAgentColor } from "@/components/arena/DebateCards";
import ArenaArtifactPanel from "@/components/arena/ArenaArtifactPanel";
import { Conversation } from "@elevenlabs/client";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft, Trash2, Swords, AlertTriangle,
  Phone, PhoneOff, Volume2, Send, Bot, Star,
  PanelLeftClose, PanelLeftOpen, Users, MessageSquare,
  FileCode2, Settings,
} from "lucide-react";
import EditArenaDialog from "@/components/arena/EditArenaDialog";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

type CallStatus = "idle" | "connecting" | "active" | "ended";

async function fetchPersonaResponse(userText: string, systemPrompt: string, agentModel: string): Promise<string> {
  // Route via gateway-chat edge function — browser never holds the admin token,
  // and openclaw models expect /v1/chat/completions on the gateway.
  const { data, error } = await supabase.functions.invoke("gateway-chat", {
    body: {
      model: agentModel,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    },
  });
  if (error) throw new Error(error.message || "gateway-chat failed");
  if (data?.error) throw new Error(data.detail || data.error);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Resposta vazia do gateway");
  return text;
}

export default function ArenaViewPage() {
  const { arenaId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [arena, setArena] = useState<Arena | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  // Debate mode
  const [debateMode, setDebateMode] = useState(false);
  const [debateRounds, setDebateRounds] = useState<{ question: string; responses: DebateResponse[]; isComplete: boolean }[]>([]);
  const [debateRunning, setDebateRunning] = useState(false);

  // Artifact panel
  const [activeArtifact, setActiveArtifact] = useState<{ type: "html"; code: string; title: string } | null>(null);

  // Voice state
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const conversationRef = useRef<any>(null);

  // Sessions
  const {
    sessions, activeSessionId, setActiveSessionId,
    messages, createSession, updateSessionTitle, deleteSession, addMessage,
    loading: sessionsLoading,
  } = useArenaSessions(arenaId);

  // Arena agents with roles
  const { agents: arenaAgents, refresh: refreshAgents } = useArenaAgents(arenaId);
  const [editOpen, setEditOpen] = useState(false);


  // Text chat state
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Default selection = primary agent (or first) when arenaAgents load/change
  useEffect(() => {
    if (arenaAgents.length === 0) { setSelectedAgentIds([]); return; }
    setSelectedAgentIds((prev) => {
      const valid = prev.filter((id) => arenaAgents.some((a) => a.agent_id === id));
      if (valid.length > 0) return valid;
      const primary = arenaAgents.find((a) => a.is_primary) || arenaAgents[0];
      return [primary.agent_id];
    });
  }, [arenaAgents]);

  const toggleAgentSelection = useCallback((agentId: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(agentId)) {
        const next = prev.filter((id) => id !== agentId);
        return next.length === 0 ? prev : next; // keep at least one
      }
      return [...prev, agentId];
    });
  }, []);

  useEffect(() => {
    if (!arenaId) return;
    setLoading(true);
    getArena(arenaId).then((a) => {
      setArena(a ?? null);
      setLoading(false);
    });
  }, [arenaId]);

  // Auto-create first session if none exists (guarded against StrictMode + async races)
  const autoCreatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      arena && !loading && !sessionsLoading &&
      sessions.length === 0 && arenaId &&
      autoCreatedRef.current !== arenaId
    ) {
      autoCreatedRef.current = arenaId;
      createSession("Sessão 1");
    }
  }, [arena, loading, sessionsLoading, sessions.length, arenaId, createSession]);

  // Check messages for artifacts
  const checkForArtifact = useCallback((content: string | null) => {
    if (!content) return;
    const artifact = extractArtifact(content);
    if (artifact && artifact.type === "html") {
      setActiveArtifact({ type: "html", code: artifact.code, title: "Artefato da Arena" });
    }
  }, []);

  const startConversation = useCallback(async () => {
    if (!arena?.convaiAgentId || callStatus === "connecting") return;
    setCallStatus("connecting");
    setSubtitle("");
    try {
      // Request mic FIRST inside user gesture — Safari/iOS require it,
      // and this also fails fast with a clearer error than the fetch does.
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("arena-convai-signed-url", {
        body: { agentId: arena.convaiAgentId },
      });
      if (error) throw new Error(error.message || "Falha ao obter signed URL");
      const signedUrl = data?.signedUrl || data?.signed_url;
      if (!signedUrl) throw new Error(data?.error || "No signed URL received");

      const conversation = await Conversation.startSession({
        signedUrl,
        onConnect: () => { setCallStatus("active"); },
        onDisconnect: () => { setCallStatus("ended"); setIsSpeaking(false); setTimeout(() => setCallStatus("idle"), 2000); },
        onMessage: (message: any) => { if (message.source === "ai") setSubtitle(message.message); },
        onModeChange: (mode: any) => { setIsSpeaking(mode.mode === "speaking"); },
        onError: (error: any) => { console.error("[ConvAI] error:", error); },
      });
      conversationRef.current = conversation;
    } catch (err) {
      console.error("[ConvAI] start error:", err);
      setCallStatus("idle");
    }
  }, [arena, callStatus]);

  const endConversation = useCallback(async () => {
    try { await conversationRef.current?.endSession(); } catch {}
    conversationRef.current = null;
    setCallStatus("idle");
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => { conversationRef.current?.endSession().catch(() => {}); };
  }, []);

  // Debate mode: sequential calls with context accumulation
  const handleDebateSend = useCallback(async (text: string) => {
    if (!arena || !activeSessionId || arenaAgents.length === 0 || debateRunning) return;
    setDebateRunning(true);

    // Save user message
    await addMessage({
      session_id: activeSessionId, role: "user", agent_id: null,
      agent_role: null, content: text, artifact_html: null,
    });

    const allAgentIds = arenaAgents.map((a) => a.agent_id);
    const primaryAgent = arenaAgents.find((a) => a.is_primary) || arenaAgents[0];

    // Create round with loading placeholders
    const roundIdx = debateRounds.length;
    const initialResponses: DebateResponse[] = arenaAgents.map((ag) => ({
      agentId: ag.agent_id, agentName: ag.agent_id,
      roleName: ag.role_name, content: "", loading: true,
    }));
    // Add synthesis placeholder
    initialResponses.push({
      agentId: primaryAgent.agent_id, agentName: primaryAgent.agent_id,
      roleName: primaryAgent.role_name, content: "", loading: true, isSynthesis: true,
    });

    setDebateRounds((prev) => [...prev, { question: text, responses: initialResponses, isComplete: false }]);

    const completedTexts: { agentId: string; roleName: string | null; content: string }[] = [];

    // Sequential calls — each agent sees previous responses
    for (let i = 0; i < arenaAgents.length; i++) {
      const ag = arenaAgents[i];
      const previousContext = completedTexts.map(
        (ct) => `[${ct.agentId} (${ct.roleName || "Assistente"})]: ${ct.content}`
      ).join("\n\n---\n\n");

      const debateInstruction = i === 0
        ? `Você é ${ag.agent_id} atuando como ${ag.role_name || "Assistente"}. ${ag.role_description || ""}\nResponda à pergunta do usuário com sua perspectiva única.`
        : `Você é ${ag.agent_id} atuando como ${ag.role_name || "Assistente"}. ${ag.role_description || ""}\n\nRespostas anteriores dos outros agentes:\n${previousContext}\n\nLeia o que os outros agentes disseram e responda concordando, discordando ou complementando. Cite o agente pelo nome quando referenciar a opinião dele.`;

      const systemPrompt = `${debateInstruction}\n\n${arena.description || ""}`;
      const agentModel = `openclaw:${ag.agent_id}`;

      try {
        const response = await fetchPersonaResponse(text, systemPrompt, agentModel);
        completedTexts.push({ agentId: ag.agent_id, roleName: ag.role_name, content: response });

        await addMessage({
          session_id: activeSessionId, role: "assistant", agent_id: ag.agent_id,
          agent_role: ag.role_name, content: response, artifact_html: null,
        });
        checkForArtifact(response);

        // Update this agent's response in the round
        setDebateRounds((prev) => {
          const updated = [...prev];
          const round = { ...updated[roundIdx] };
          round.responses = round.responses.map((r, ri) =>
            ri === i ? { ...r, content: response, loading: false } : r
          );
          updated[roundIdx] = round;
          return updated;
        });
      } catch {
        completedTexts.push({ agentId: ag.agent_id, roleName: ag.role_name, content: "Erro ao gerar resposta." });
        setDebateRounds((prev) => {
          const updated = [...prev];
          const round = { ...updated[roundIdx] };
          round.responses = round.responses.map((r, ri) =>
            ri === i ? { ...r, content: "Erro ao gerar resposta.", loading: false } : r
          );
          updated[roundIdx] = round;
          return updated;
        });
      }
    }

    // Synthesis by primary agent
    const allContext = completedTexts.map(
      (ct) => `[${ct.agentId} (${ct.roleName || "Assistente"})]: ${ct.content}`
    ).join("\n\n---\n\n");

    const synthPrompt = `Você é ${primaryAgent.agent_id} atuando como ${primaryAgent.role_name || "Orquestrador"}.\n\nPergunta do usuário: "${text}"\n\nRespostas de todos os agentes:\n${allContext}\n\nFaça uma síntese executiva das perspectivas apresentadas, destacando pontos de convergência, divergência e uma recomendação final.`;

    try {
      const synthResponse = await fetchPersonaResponse(text, synthPrompt, `openclaw:${primaryAgent.agent_id}`);
      await addMessage({
        session_id: activeSessionId, role: "assistant", agent_id: primaryAgent.agent_id,
        agent_role: `${primaryAgent.role_name || "Síntese"}`, content: synthResponse, artifact_html: null,
      });
      checkForArtifact(synthResponse);

      setDebateRounds((prev) => {
        const updated = [...prev];
        const round = { ...updated[roundIdx] };
        round.responses = round.responses.map((r) =>
          r.isSynthesis ? { ...r, content: synthResponse, loading: false } : r
        );
        round.isComplete = true;
        updated[roundIdx] = round;
        return updated;
      });
    } catch {
      setDebateRounds((prev) => {
        const updated = [...prev];
        const round = { ...updated[roundIdx] };
        round.responses = round.responses.map((r) =>
          r.isSynthesis ? { ...r, content: "Erro ao gerar síntese.", loading: false } : r
        );
        round.isComplete = true;
        updated[roundIdx] = round;
        return updated;
      });
    }

    setDebateRunning(false);
  }, [arena, activeSessionId, arenaAgents, addMessage, debateRounds.length, checkForArtifact, debateRunning]);

  // Normal text chat send
  const handleChatSend = useCallback(async () => {
    if (!arena || !chatInput.trim() || chatLoading || !activeSessionId) return;
    const text = chatInput.trim();
    setChatInput("");

    if (debateMode && arenaAgents.length > 1) {
      await handleDebateSend(text);
      return;
    }

    setChatLoading(true);

    await addMessage({
      session_id: activeSessionId,
      role: "user",
      agent_id: null,
      agent_role: null,
      content: text,
      artifact_html: null,
    });

    // Determine which agents to invoke
    const primaryAgent = arenaAgents.find((a) => a.is_primary) || arenaAgents[0];
    let targetAgents = arenaAgents.filter((a) => selectedAgentIds.includes(a.agent_id));
    if (targetAgents.length === 0 && primaryAgent) targetAgents = [primaryAgent];

    if (targetAgents.length === 0) {
      await addMessage({
        session_id: activeSessionId, role: "assistant", agent_id: null,
        agent_role: null, content: "Nenhum agente configurado para esta arena.", artifact_html: null,
      });
      setChatLoading(false);
      return;
    }

    const systemPromptBase = `Você é um assistente especializado. ${arena.description ?? ""}`;

    // Invoke each selected agent in parallel
    await Promise.all(targetAgents.map(async (ag) => {
      try {
        const roleContext = ag.role_name
          ? `Você é ${ag.agent_id} atuando como ${ag.role_name}. ${ag.role_description || ""}\n\n`
          : "";
        const systemPrompt = `${roleContext}${systemPromptBase}`;
        const response = await fetchPersonaResponse(text, systemPrompt, `openclaw:${ag.agent_id}`);
        await addMessage({
          session_id: activeSessionId,
          role: "assistant",
          agent_id: ag.agent_id,
          agent_role: ag.role_name || null,
          content: response,
          artifact_html: null,
        });
        checkForArtifact(response);
      } catch (err) {
        console.error("[Arena] chat error:", err);
        await addMessage({
          session_id: activeSessionId,
          role: "assistant",
          agent_id: ag.agent_id,
          agent_role: ag.role_name || null,
          content: "Erro ao gerar resposta.",
          artifact_html: null,
        });
      }
    }));

    setChatLoading(false);
  }, [arena, chatInput, chatLoading, activeSessionId, addMessage, arenaAgents, selectedAgentIds, debateMode, handleDebateSend, checkForArtifact]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, debateRounds]);

  const handleDelete = async () => {
    if (!arena) return;
    await endConversation();
    await deleteArena(arena.id);
    navigate("/arenas");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3rem)]">
        <div className="h-6 w-6 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
      </div>
    );
  }

  if (!arena) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3rem)]">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-warning mx-auto" />
          <p className="text-sm text-muted-foreground">Arena não encontrada</p>
          <button onClick={() => navigate("/arenas")} className="text-sm text-primary hover:underline">Voltar para Arenas</button>
        </div>
      </div>
    );
  }

  const isVoiceArena = !!arena.convaiAgentId;
  const personaLabel = arena.name;
  const isActive = callStatus === "active";
  const isConnecting = callStatus === "connecting";

  /* ── HEADER with agent avatars ── */
  const header = (
    <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-border/40">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate("/arenas")} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground font-mono tracking-wide uppercase">{arena.name}</span>
        {/* Agent avatars with role tooltips and colors */}
        <div className="flex items-center -space-x-1.5 ml-2">
          {arenaAgents.map((ag, i) => {
            const color = getAgentColor(i);
            const avatarUrl = getAgentAvatar(ag.agent_id);
            const displayName = ag.agent_id;
            const subLabel = ag.role_name;
            return (
              <Tooltip key={ag.agent_id}>
                <TooltipTrigger asChild>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-background relative overflow-hidden ${
                    ag.is_primary ? `${color.bg} ${color.text} ring-1 ring-primary/40` : `${color.bg} ${color.text}`
                  }`}>
                    {ag.is_primary && <Star className="h-2.5 w-2.5 text-warning fill-warning absolute -top-0.5 -right-0.5 z-10" />}
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                    ) : (
                      displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium">{displayName}</p>
                  {subLabel && <p className="text-xs text-muted-foreground">{subLabel}</p>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {activeArtifact && (
          <button
            onClick={() => setActiveArtifact(null)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="Fechar artefato"
          >
            <FileCode2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => setEditOpen(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Editar configurações"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button onClick={handleDelete} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Excluir Arena">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const editDialog = arena && (
    <EditArenaDialog
      arena={arena}
      agents={arenaAgents}
      open={editOpen}
      onOpenChange={setEditOpen}
      onSaved={async () => {
        if (arenaId) {
          const updated = await getArena(arenaId);
          if (updated) setArena(updated);
        }
        await refreshAgents();
      }}
    />
  );


  /* ── VOICE ARENA ── */
  if (isVoiceArena) {
    return (
      <div className="flex flex-col h-[calc(100vh-3rem)] bg-background">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className="relative">
            <div className={`h-28 w-28 rounded-full flex items-center justify-center text-4xl transition-all duration-500 ${
              isSpeaking ? "bg-primary/20 ring-4 ring-primary/40 ring-offset-2 ring-offset-background scale-105"
                : isActive ? "bg-secondary/40 ring-4 ring-accent/30 ring-offset-2 ring-offset-background" : "bg-secondary/60"
            }`}>
              <Swords className="h-10 w-10 text-primary" />
            </div>
            {isSpeaking && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
                <div className="absolute -inset-3 rounded-full border border-primary/10 animate-pulse" />
              </>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-display font-bold text-foreground">
              {arenaAgents[0]?.agent_id || personaLabel}
            </h2>
            {arenaAgents[0]?.role_name && (
              <p className="text-xs text-primary mt-0.5">atuando como {arenaAgents[0].role_name}</p>
            )}
            {arena.description && <p className="text-xs text-muted-foreground mt-0.5">{arena.description}</p>}
          </div>

          <div className="h-6 flex items-center gap-2">
            {isConnecting && <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="h-2 w-2 rounded-full bg-primary animate-pulse" /><span>Conectando...</span></div>}
            {isActive && isSpeaking && <div className="flex items-center gap-2 text-xs text-primary"><Volume2 className="h-3.5 w-3.5 animate-pulse" /><span>Falando...</span></div>}
            {isActive && !isSpeaking && <div className="flex items-center gap-2 text-xs text-accent"><div className="h-2 w-2 rounded-full bg-accent animate-pulse" /><span>Ouvindo você...</span></div>}
            {callStatus === "idle" && <span className="text-[11px] text-muted-foreground">Toque para iniciar a conversa</span>}
            {callStatus === "ended" && <span className="text-[11px] text-muted-foreground">Conversa encerrada</span>}
          </div>
          {subtitle && isActive && (
            <div className="max-w-md text-center">
              <p className="text-sm text-muted-foreground leading-relaxed italic">"{subtitle}"</p>
            </div>
          )}
        </div>
        <div className="shrink-0 px-4 pb-6 pt-2">
          <div className="flex items-center justify-center">
            {!isActive && !isConnecting ? (
              <button onClick={startConversation} className="h-16 w-16 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30 transition-all duration-300">
                <Phone className="h-6 w-6" />
              </button>
            ) : (
              <button onClick={endConversation} disabled={isConnecting} className="h-16 w-16 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30 transition-all duration-300 disabled:opacity-40">
                <PhoneOff className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
        {editDialog}
      </div>
    );
  }


  /* ── TEXT CHAT ARENA WITH SESSIONS SIDEBAR + ARTIFACT PANEL ── */
  return (
    <div className="flex h-[calc(100vh-3rem)] bg-background">
      {/* Sessions sidebar */}
      {sidebarOpen && (
        <div className={`${isMobile ? "absolute inset-y-0 left-0 z-30" : "relative"} w-60 shrink-0`}>
          <div className="h-full flex flex-col">
            <div className="shrink-0 flex items-center justify-end px-2 pt-2">
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <SessionsSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={(id) => { setActiveSessionId(id); setDebateRounds([]); if (isMobile) setSidebarOpen(false); }}
              onNewSession={(title, inherit) => { createSession(title, inherit); setDebateRounds([]); }}
              onRenameSession={updateSessionTitle}
              onDeleteSession={(id) => { deleteSession(id); setDebateRounds([]); }}
            />
          </div>
        </div>
      )}

      {/* Mobile overlay */}
      {sidebarOpen && isMobile && (
        <div className="fixed inset-0 bg-black/40 z-20" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {header}

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {arena.description && messages.length === 0 && (() => {
            const primary = arenaAgents.find((a: any) => a.is_primary) || arenaAgents[0];
            const primaryAvatar = primary ? getAgentAvatar(primary.agent_id) : null;
            return (
              <div className="text-center py-8">
                <div className="h-16 w-16 rounded-full bg-secondary/60 flex items-center justify-center mx-auto mb-4 overflow-hidden">
                  {primaryAvatar ? (
                    <img src={primaryAvatar} alt={personaLabel} className="h-full w-full object-cover" />
                  ) : (
                    <Swords className="h-8 w-8 text-primary" />
                  )}
                </div>
                <h2 className="text-lg font-display font-bold text-foreground">{personaLabel}</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{arena.description}</p>
              {/* Inherited context badge */}
              {sessions.find((s) => s.id === activeSessionId)?.parent_session_id && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
                  <MessageSquare className="h-3 w-3" />
                  Contexto herdado da sessão anterior
                </div>
              )}
            </div>
            );
          })()}

          {/* Render messages - group debate responses */}
          {messages.map((msg, idx) => {
            // Find agent index for coloring
            const agentIdx = arenaAgents.findIndex((a) => a.agent_id === msg.agent_id);
            const color = agentIdx >= 0 ? getAgentColor(agentIdx) : null;

            return (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role !== "user" && msg.agent_id && (
                  <div className="flex flex-col items-center mr-2 mt-1">
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center ${color ? color.bg : "bg-primary/15"}`}>
                      <Bot className={`h-3.5 w-3.5 ${color ? color.text : "text-primary"}`} />
                    </div>
                    {msg.agent_role && (
                      <span className="text-[9px] text-muted-foreground mt-0.5 max-w-[60px] text-center truncate">{msg.agent_role}</span>
                    )}
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : `bg-secondary/60 text-foreground rounded-bl-md ${color ? `border ${color.border}` : ""}`
                }`}>
                  {msg.role !== "user" ? (
                    <div className="prose prose-sm prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                      <ReactMarkdown>{msg.content || ""}</ReactMarkdown>
                      {/* Artifact button if content has code block */}
                      {msg.content && extractArtifact(msg.content) && (
                        <button
                          onClick={() => {
                            const art = extractArtifact(msg.content || "");
                            if (art) setActiveArtifact({ type: "html", code: art.code, title: `Artefato · ${msg.agent_id || "Arena"}` });
                          }}
                          className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors"
                        >
                          <FileCode2 className="h-3 w-3" />
                          Ver artefato
                        </button>
                      )}
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })}

          {/* Debate rounds rendered inline */}
          {debateRounds.map((round, gi) => (
            <DebateCards
              key={gi}
              question={round.question}
              responses={round.responses}
              roundNumber={gi + 1}
              isComplete={round.isComplete}
              allAgentIds={arenaAgents.map((a) => a.agent_id)}
              onNewRound={() => {
                // Focus input for next round
                setChatInput("");
              }}
            />
          ))}

          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-secondary/60 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:0.2s]" />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          {/* Debate toggle */}
          {arenaAgents.length > 1 && (
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setDebateMode(!debateMode)}
                disabled={debateRunning}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  debateMode
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-secondary/40 text-muted-foreground hover:text-foreground border border-border/40"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                🎭 Modo Debate
              </button>
              {debateMode && (
                <span className="text-[10px] text-muted-foreground">
                  {debateRunning ? "Debate em andamento..." : `${arenaAgents.length} agentes responderão sequencialmente`}
                </span>
              )}
            </div>
          )}

          {/* Agent selector — active only when NOT in debate mode and has 2+ agents */}
          {arenaAgents.length > 1 && !debateMode && (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1">Acionar:</span>
              {arenaAgents.map((ag, i) => {
                const color = getAgentColor(i);
                const selected = selectedAgentIds.includes(ag.agent_id);
                const avatarUrl = getAgentAvatar(ag.agent_id);
                return (
                  <button
                    key={ag.agent_id}
                    onClick={() => toggleAgentSelection(ag.agent_id)}
                    className={`flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                      selected
                        ? `${color.bg} ${color.text} border-transparent`
                        : "bg-secondary/30 text-muted-foreground border-border/40 hover:text-foreground opacity-60"
                    }`}
                    title={ag.role_name || ag.agent_id}
                  >
                    <div className="h-4 w-4 rounded-full overflow-hidden bg-background/40 flex items-center justify-center text-[9px] font-bold shrink-0">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        ag.agent_id.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span className="truncate max-w-[100px]">{ag.agent_id}</span>
                  </button>
                );
              })}
              {selectedAgentIds.length > 1 && (
                <span className="text-[10px] text-accent ml-1">{selectedAgentIds.length} agentes responderão em paralelo</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChatSend()}
              placeholder={debateMode ? "Faça uma pergunta para todos os agentes..." : "Digite sua mensagem..."}
              className="flex-1 bg-secondary/40 border border-border/60 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleChatSend}
              disabled={!chatInput.trim() || chatLoading || debateRunning}
              className="h-11 w-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Artifact panel */}
      {activeArtifact && !isMobile && (
        <div className="w-[400px] shrink-0">
          <ArenaArtifactPanel
            type={activeArtifact.type}
            code={activeArtifact.code}
            title={activeArtifact.title}
            onClose={() => setActiveArtifact(null)}
          />
        </div>
      )}

      {/* Mobile artifact modal */}
      {activeArtifact && isMobile && (
        <div className="fixed inset-0 z-50 bg-background">
          <ArenaArtifactPanel
            type={activeArtifact.type}
            code={activeArtifact.code}
            title={activeArtifact.title}
            onClose={() => setActiveArtifact(null)}
          />
        </div>
      )}
      {editDialog}
    </div>
  );

}
