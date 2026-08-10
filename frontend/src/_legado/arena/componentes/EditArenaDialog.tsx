import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import VoicePicker from "@/components/VoicePicker";
import type { Arena } from "@/lib/arena-store";
import { saveArena } from "@/lib/arena-store";
import type { ArenaAgentRole } from "@/hooks/use-arena-agents";

interface Props {
  arena: Arena;
  agents: ArenaAgentRole[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

/**
 * Edit dialog for arena configuration: objetivo (prompt), nome, descrição,
 * emoji, mensagem de abertura, voz (se áudio) e papel/descrição de cada
 * agente. Para arenas de voz, sincroniza o agente ConvAI na ElevenLabs
 * via edge function `arena-convai-update`.
 */
export default function EditArenaDialog({ arena, agents, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState(arena.name);
  const [emoji, setEmoji] = useState(arena.emoji ?? "");
  const [description, setDescription] = useState(arena.description ?? "");
  const [prompt, setPrompt] = useState(arena.prompt ?? "");
  const [openingMessage, setOpeningMessage] = useState(arena.openingMessage ?? "");
  const [voiceId, setVoiceId] = useState<string | null>(arena.voiceId ?? null);
  const [agentRoles, setAgentRoles] = useState<ArenaAgentRole[]>(agents);
  const [saving, setSaving] = useState(false);

  const isVoiceArena = !!arena.convaiAgentId;

  // Reset local state whenever the dialog opens with fresh data
  useEffect(() => {
    if (!open) return;
    setName(arena.name);
    setEmoji(arena.emoji ?? "");
    setDescription(arena.description ?? "");
    setPrompt(arena.prompt ?? "");
    setOpeningMessage(arena.openingMessage ?? "");
    setVoiceId(arena.voiceId ?? null);
    setAgentRoles(agents);
  }, [open, arena, agents]);

  const updateRole = (agentId: string, patch: Partial<ArenaAgentRole>) => {
    setAgentRoles((prev) => prev.map((a) => (a.agent_id === agentId ? { ...a, ...patch } : a)));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório.");
      return;
    }
    setSaving(true);
    try {
      // 1) Save arena core
      const { error: arenaErr } = await saveArena({
        ...arena,
        name: name.trim(),
        emoji: emoji.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        openingMessage: openingMessage.trim() || undefined,
        voiceId: voiceId ?? undefined,
      });
      if (arenaErr) {
        toast.error(`Erro ao salvar arena: ${arenaErr.message}`);
        setSaving(false);
        return;
      }

      // 2) Update per-agent roles
      for (const role of agentRoles) {
        const error = await api(`/arenas/${arena.id}/agentes/${role.id}`, {
          method: "PATCH",
          body: {
            agent_id: role.agent_id,
            role_name: role.role_name,
            role_description: role.role_description,
          },
        }).then(() => null, (e: Error) => e);
        if (error) {
          console.error("[EditArenaDialog] update role:", error.message);
          toast.error(`Erro ao salvar papel do agente ${role.agent_id}.`);
        }
      }

      // 3) If voice arena, sync ElevenLabs ConvAI agent
      if (isVoiceArena && arena.convaiAgentId) {
        const primary = agentRoles.find((a) => a.is_primary) ?? agentRoles[0] ?? null;
        let profile: {
          name: string | null;
          role: string | null;
          persona_description: string | null;
          behavior: string | null;
          tts_voice_id: string | null;
        } | null = null;

        if (primary) {
          const data = await api<any>(
            `/agents/${encodeURIComponent(primary.agent_id)}`,
          ).catch(() => null);
          profile = data ?? null;
        }

        const agentDisplayName = profile?.name || primary?.agent_id || "Assistente";
        const roleLine = primary?.role_name
          ? `\n\nNesta simulação você atuará como: ${primary.role_name}.${
              primary.role_description ? ` ${primary.role_description}` : ""
            }`
          : "";
        const scenarioLine = (prompt || description).trim();

        const systemPrompt = [
          `Você é ${agentDisplayName}${profile?.role ? ` (${profile.role})` : ""}.`,
          profile?.persona_description || "",
          profile?.behavior || "",
          roleLine,
          scenarioLine ? `\nContexto do roleplay: ${scenarioLine}` : "",
          `\nMantenha sempre a identidade de ${agentDisplayName}. Fale em português brasileiro.`,
        ].filter(Boolean).join("\n").trim();

        const finalVoiceId = voiceId || profile?.tts_voice_id || "";

        const { data, error } = await supabase.functions.invoke("arena-convai-update", {
          body: {
            agentId: arena.convaiAgentId,
            name: `${agentDisplayName} — ${name.trim()}`,
            systemPrompt,
            openingMessage: openingMessage.trim() || undefined,
            voiceId: finalVoiceId,
          },
        });
        if (error || !data?.ok) {
          console.error("[EditArenaDialog] convai-update failed:", error, data);
          toast.warning("Arena salva, mas não foi possível atualizar o agente de voz.");
        }
      }

      toast.success("Arena atualizada.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[EditArenaDialog] save error:", err);
      toast.error("Erro ao salvar arena.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Arena</DialogTitle>
          <DialogDescription>
            Refine o objetivo, mensagens e papéis dos agentes desta arena.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>


          <div>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Resumo curto exibido no cabeçalho"
            />
          </div>

          <div>
            <Label htmlFor="prompt">Objetivo / Instruções do Roleplay</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Ex: Simule um cliente difícil em uma negociação B2B. O usuário está treinando técnicas de fechamento…"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Este texto é injetado como contexto do agente durante a simulação.
            </p>
          </div>

          <div>
            <Label htmlFor="opening">Mensagem de abertura</Label>
            <Textarea
              id="opening"
              value={openingMessage}
              onChange={(e) => setOpeningMessage(e.target.value)}
              rows={2}
              placeholder="Primeira fala do agente ao iniciar a conversa"
            />
          </div>

          {isVoiceArena && (
            <div>
              <Label>Voz do agente</Label>
              <div className="mt-1">
                <VoicePicker value={voiceId} onChange={setVoiceId} />
              </div>
            </div>
          )}

          {agentRoles.length > 0 && (
            <div className="space-y-3">
              <Label>Papéis dos agentes</Label>
              {agentRoles.map((ag) => (
                <div key={ag.id} className="border border-border/40 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{ag.agent_id}</span>
                    {ag.is_primary && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase">
                        Primário
                      </span>
                    )}
                  </div>
                  <Input
                    value={ag.role_name ?? ""}
                    onChange={(e) => updateRole(ag.agent_id, { role_name: e.target.value })}
                    placeholder="Papel (ex: Cliente cético, Entrevistador)"
                  />
                  <Textarea
                    value={ag.role_description ?? ""}
                    onChange={(e) => updateRole(ag.agent_id, { role_description: e.target.value })}
                    placeholder="Descrição do papel — comportamento, objeções, contexto"
                    rows={2}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando…</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Salvar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
