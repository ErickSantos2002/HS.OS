import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAudioLevel } from "@/hooks/use-audio-level";
import { useChatMedia } from "@/hooks/use-chat-media";

import { saveArena, deleteArena, type Arena } from "@/lib/arena-store";
import { useArenaAgents } from "@/hooks/use-arena-agents";
import { AiLoader } from "@/components/ui/ai-loader";
import VoicePicker from "@/components/VoicePicker";
import AgentRoleSelector, { type SelectedAgentRole } from "@/components/arena/AgentRoleSelector";
import TemplateSelector from "@/components/arena/TemplateSelector";
import type { ArenaTemplate } from "@/hooks/use-arena-templates";
import {
  Swords, Bot, CheckCircle2, RefreshCw,
  Sparkles, Search, Cpu, ArrowLeft,
  Mic, X, PhoneCall, AlertTriangle, Star,
} from "lucide-react";

/* ── Types ── */

interface StepLog {
  icon: React.ReactNode;
  text: string;
  done: boolean;
}

interface ArenaResponse {
  name: string;
  emoji?: string;
  description?: string;
  voiceId?: string;
  openingMessage?: string;
  agents?: string[];
}

/* ── Sub-components ── */

function StepsPanel({ steps }: { steps: StepLog[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="glass-card rounded-xl p-4 space-y-3 mt-6">
      {steps.map((step, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 text-sm transition-opacity duration-500 ${step.done ? "opacity-100" : "opacity-70"}`}
        >
          <div className="shrink-0">{step.icon}</div>
          <span className="text-foreground">{step.text}</span>
          {step.done ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success ml-auto shrink-0" />
          ) : (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-primary/40 border-t-primary animate-spin ml-auto shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main page ── */

export default function ArenaCreatePage() {
  const navigate = useNavigate();
  const audioLevel = useAudioLevel();
  const media = useChatMedia();

  const [prompt, setPrompt] = useState("");
  const [hasVoice, setHasVoice] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgentRole[]>([]);
  const [phase, setPhase] = useState<"template" | "input" | "generating" | "proposal">("template");
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [arenaResult, setArenaResult] = useState<ArenaResponse | null>(null);
  const [error, setError] = useState("");
  const [adjustInput, setAdjustInput] = useState("");
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const progressRef = useRef<number>(0);
  const generatingRef = useRef(false);
  const { saveAgents } = useArenaAgents(undefined);

  const addStep = (icon: React.ReactNode, text: string) => {
    setSteps((prev) => [...prev, { icon, text, done: false }]);
    setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => (i === prev.length - 1 ? { ...s, done: true } : s)));
    }, 1200);
  };

  /**
   * Chama a edge function arena-generate (que fala com o gateway em nome do cliente).
   * Elimina o "Failed to fetch" causado pela rota inexistente /api/arena/generate.
   */
  const callArenaGenerate = async (
    description: string,
    controller: AbortController,
  ): Promise<ArenaResponse> => {
    console.log(`[Arena] invoke arena-generate`);

    const { data, error } = await supabase.functions.invoke("arena-generate", {
      body: { description, voiceId: selectedVoiceId || undefined, agentCount: hasVoice ? 1 : 3 },
    });

    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

    if (error) {
      console.error(`[Arena] invoke error:`, error);
      throw new Error(error.message || "Erro ao chamar arena-generate.");
    }

    if (!data?.ok || !data.arena) {
      throw new Error(data?.error || "Resposta inválida do servidor.");
    }

    return data.arena as ArenaResponse;
  };

  const generate = async (userPrompt: string) => {
    if (generatingRef.current) return;
    generatingRef.current = true;

    abortRef.current?.abort();

    setPhase("generating");
    setSteps([]);
    setArenaResult(null);
    setError("");
    setProgress(0);
    progressRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    const progressInterval = setInterval(() => {
      progressRef.current += progressRef.current < 40 ? 2 : progressRef.current < 70 ? 1 : 0.3;
      if (progressRef.current > 95) progressRef.current = 95;
      setProgress(Math.floor(progressRef.current));
    }, 500);

    addStep(<Sparkles className="h-4 w-4 text-primary" />, "Analisando sua solicitação...");
    await delay(600);
    addStep(<Search className="h-4 w-4 text-warning" />, "Gerando Arena via IA...");

    try {
      const arena = await callArenaGenerate(userPrompt, controller);

      addStep(<Cpu className="h-4 w-4 text-accent" />, "Arena recebida!");
      setProgress(100);
      setArenaResult(arena);
      setPhase("proposal");
      addStep(<CheckCircle2 className="h-4 w-4 text-success" />, "Pronta para uso!");
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Requisição cancelada.");
        return;
      }
      setError(err.message);
      addStep(<CheckCircle2 className="h-4 w-4 text-destructive" />, `Erro: ${err.message}`);
    } finally {
      clearInterval(progressInterval);
      generatingRef.current = false;
    }
  };

  const handleCreate = () => {
    if (!prompt.trim()) return;
    if (media.recording) {
      audioLevel.stop();
      media.stopRecording();
    }
    generate(prompt);
  };

  const handleApprove = async () => {
    if (!arenaResult) return;

    // Base list of agents (from user selection or AI suggestion)
    let effectiveSelected = selectedAgents;
    let effectiveAgentList: { id: string; name: string }[] = selectedAgents.length > 0
      ? selectedAgents.map((a) => ({ id: a.agentId, name: a.agentName }))
      : (arenaResult.agents || []).map((a) => ({ id: a, name: a }));

    // Voice arenas are 1-to-1 (one ElevenLabs voice = one active agent).
    // Force to a single agent: keep the primary if the user marked one, else the first.
    if (hasVoice && effectiveAgentList.length > 1) {
      if (effectiveSelected.length > 0) {
        const primary = effectiveSelected.find((a) => a.isPrimary) ?? effectiveSelected[0];
        effectiveSelected = [{ ...primary, isPrimary: true }];
        effectiveAgentList = [{ id: primary.agentId, name: primary.agentName }];
      } else {
        const first = effectiveAgentList[0];
        effectiveAgentList = [first];
      }
    }

    // Only create ConvAI agent if voice is enabled (via edge function proxy)
    let convaiAgentId: string | undefined;
    let convaiFailed = false;
    if (hasVoice) {
      try {
        // Load primary agent profile so the voice agent IS that agent (Lia, Milo, etc.)
        // — not a generic "Rodrigo" persona invented by the LLM.
        const primarySelected =
          effectiveSelected.find((a) => a.isPrimary) ?? effectiveSelected[0] ?? null;
        const primaryAgentId = primarySelected?.agentId ?? effectiveAgentList[0]?.id ?? null;

        let agentProfile: {
          name: string | null;
          role: string | null;
          persona_description: string | null;
          behavior: string | null;
          tts_voice_id: string | null;
        } | null = null;

        if (primaryAgentId) {
          const { data: profile } = await supabase
            .from("agent_profiles")
            .select("name, role, persona_description, behavior, tts_voice_id")
            .eq("agent_id", primaryAgentId)
            .maybeSingle();
          agentProfile = profile ?? null;
        }

        const agentDisplayName =
          agentProfile?.name || primarySelected?.agentName || primaryAgentId || "Assistente";
        const roleLine = primarySelected?.roleName
          ? `\n\nNesta simulação você atuará como: ${primarySelected.roleName}.${
              primarySelected.roleDescription ? ` ${primarySelected.roleDescription}` : ""
            }`
          : "";
        const scenarioLine = (prompt || arenaResult.description || "").trim();

        const systemPrompt = [
          `Você é ${agentDisplayName}${agentProfile?.role ? ` (${agentProfile.role})` : ""}.`,
          agentProfile?.persona_description || "",
          agentProfile?.behavior || "",
          roleLine,
          scenarioLine ? `\nContexto do roleplay: ${scenarioLine}` : "",
          `\nMantenha sempre a identidade de ${agentDisplayName}. Fale em português brasileiro.`,
        ].filter(Boolean).join("\n").trim();

        const voiceId =
          selectedVoiceId ||
          agentProfile?.tts_voice_id ||
          arenaResult.voiceId ||
          "";

        const { data, error } = await supabase.functions.invoke("arena-convai-create", {
          body: {
            name: `${agentDisplayName} — ${arenaResult.name}`,
            systemPrompt,
            openingMessage: arenaResult.openingMessage || "",
            voiceId,
          },
        });
        if (error) throw error;
        if (data?.ok && data.agentId) {
          convaiAgentId = data.agentId;
          console.log("[Arena] ConvAI agent created:", convaiAgentId);
        } else {
          console.error("[Arena] ConvAI create failed:", data);
          convaiFailed = true;
        }
      } catch (err) {
        console.error("[Arena] ConvAI create error:", err);
        convaiFailed = true;
      }
      if (convaiFailed) {
        toast.warning(
          "Não foi possível ativar a voz para esta arena — ela será criada em modo texto. Você pode reativar depois.",
        );
      }
    }


    const agentsList = effectiveAgentList;

    const arenaId = crypto.randomUUID();
    const arena: Arena = {
      id: arenaId,
      name: arenaResult.name,
      description: arenaResult.description || "",
      emoji: arenaResult.emoji,
      agents: agentsList,
      reactCode: "",
      createdAt: new Date().toISOString(),
      prompt,
      voiceId: selectedVoiceId || arenaResult.voiceId,
      openingMessage: arenaResult.openingMessage,
      convaiAgentId,
    };

    // 1) salva arena — se falhar, aborta
    const { error: arenaError } = await saveArena(arena);
    if (arenaError) {
      toast.error(`Erro ao salvar arena: ${arenaError.message}`);
      return;
    }

    // 2) salva agentes — se falhar, rollback (deleta arena órfã)
    if (effectiveSelected.length > 0) {
      const { error: agentsError } = await saveAgents(arenaId, effectiveSelected.map((a) => ({
        arena_id: arenaId,
        agent_id: a.agentId,
        role_name: a.roleName,
        role_description: a.roleDescription,
        is_primary: a.isPrimary,
      })));
      if (agentsError) {
        await deleteArena(arenaId); // rollback
        toast.error("Erro ao salvar agentes. Arena não criada.");
        return;
      }
    }

    toast.success("Arena criada!");
    navigate(`/arenas/${arena.id}`);
  };

  const handleAdjust = () => {
    if (!adjustInput.trim()) return;
    generate(`${prompt}\n\nAjustes solicitados: ${adjustInput}`);
    setAdjustInput("");
  };

  const handleTemplateSelect = async (template: ArenaTemplate) => {
    // Pre-fill agents from template
    const prefilledAgents: SelectedAgentRole[] = template.agents.map((a, i) => ({
      agentId: a.id,
      agentName: a.name,
      roleName: a.role,
      roleDescription: "",
      isPrimary: i === 0,
    }));
    setSelectedAgents(prefilledAgents);
    setPrompt(template.base_prompt || template.description || "");
    setPhase("input");
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /* ── TEMPLATE PHASE ── */
  if (phase === "template") {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] p-6">
        <TemplateSelector
          onSelect={handleTemplateSelect}
          onSkip={() => setPhase("input")}
        />
      </div>
    );
  }

  /* ── INPUT PHASE ── */
  if (phase === "input") {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] p-6">
        <div className="w-full max-w-xl space-y-6">
          <button
            onClick={() => setPhase("template")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para templates
          </button>
          <div className="text-center space-y-3">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto">
              <Swords className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Criar Nova Arena</h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Descreva o ambiente que você precisa. A IA vai gerar automaticamente a interface, selecionar agentes e criar a Arena.
            </p>
          </div>

          <div className="glass-card rounded-xl p-1">
            <div className="px-4 py-2">
              {media.recording ? (
                <div className="flex flex-col items-center justify-center py-4" style={{ minHeight: "120px" }}>
                  <AiLoader size={100} text="Ouvindo..." />
                </div>
              ) : (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Descreva a Arena que você quer criar..."
                  rows={6}
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none p-3"
                />
              )}
            </div>

            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1">
                {media.recording ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { audioLevel.stop(); media.stopRecording(); }}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                      title="Cancelar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      onClick={async () => {
                        audioLevel.stop();
                        const text = await media.stopRecording();
                        if (text) setPrompt((prev) => (prev ? prev + " " + text : text));
                      }}
                      className="p-2 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
                      title="Parar e transcrever"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5L5.5 11L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { media.startRecording(); audioLevel.start(); }}
                    className="p-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                    title="Falar para transcrever"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Voice toggle */}
          <button
            type="button"
            onClick={() => setHasVoice((v) => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
              hasVoice
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <PhoneCall className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Esta arena terá conversa por voz?</span>
            <div className={`ml-auto h-5 w-9 rounded-full transition-colors relative ${hasVoice ? "bg-primary" : "bg-muted"}`}>
              <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${hasVoice ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
          </button>

          {/* Voice picker — only when voice enabled */}
          {hasVoice && (
            <div className="glass-card rounded-xl p-4">
              <VoicePicker value={selectedVoiceId} onChange={setSelectedVoiceId} />
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!prompt.trim()}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Swords className="h-4 w-4" />
            Criar Arena
          </button>
        </div>
      </div>
    );
  }

  /* ── GENERATING PHASE ── */
  if (phase === "generating" && !arenaResult) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] p-6">
        <div className="w-full max-w-lg space-y-2">
          <AiLoader text="Criando Arena" />

          <div className="w-full max-w-xs mx-auto space-y-2 mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span>Progresso</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <StepsPanel steps={steps} />

          {error && (
            <div className="glass-card rounded-xl p-4 space-y-3 mt-4">
              <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</p>
              <button
                onClick={() => generate(prompt)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </button>
            </div>
          )}

          <button
            onClick={() => { abortRef.current?.abort(); setPhase("input"); generatingRef.current = false; }}
            className="w-full py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex items-center justify-center gap-2 mt-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        </div>
      </div>
    );
  }

  /* ── PROPOSAL PHASE ── */
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => setPhase("input")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </button>

      {arenaResult && (
        <>
          {/* Arena info */}
          <div className="glass-card rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <Swords className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-foreground">{arenaResult.name}</h2>
                <p className="text-sm text-muted-foreground">{arenaResult.description}</p>
              </div>
            </div>

            {/* Agent Role Selector */}
            <AgentRoleSelector value={selectedAgents} onChange={setSelectedAgents} />

            {/* AI-suggested agents (if no manual selection) */}
            {selectedAgents.length === 0 && arenaResult.agents && arenaResult.agents.length > 0 && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">
                  Super agentes sugeridos pela IA
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {arenaResult.agents.map((a) => (
                    <div key={a} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/60">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm text-foreground">{a}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">Selecione agentes acima para personalizar os papéis</p>
              </div>
            )}


            {/* Opening message */}
            {arenaResult.openingMessage && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">
                  Mensagem de abertura
                </label>
                <p className="mt-2 text-sm text-foreground bg-secondary/30 rounded-lg p-3 border border-border/40">
                  {arenaResult.openingMessage}
                </p>
              </div>
            )}

            {/* Voice picker in proposal — only when voice enabled */}
            {hasVoice && (
              <div className="pt-2">
                <VoicePicker value={selectedVoiceId} onChange={setSelectedVoiceId} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleApprove}
              className="flex-1 py-3 rounded-xl bg-success text-success-foreground font-semibold text-sm hover:bg-success/90 transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Aprovar e usar
            </button>
            <div className="flex-1 flex gap-2">
              <input
                value={adjustInput}
                onChange={(e) => setAdjustInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdjust()}
                placeholder="Descreva o ajuste..."
                className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleAdjust}
                disabled={!adjustInput.trim()}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Ajustar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
