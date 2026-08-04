import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useAgents } from "@/hooks/use-agents";
import { useIsMobile } from "@/hooks/use-mobile";
import { useChannels, useChannelMessages, useChannelMembers, Channel } from "@/hooks/use-channels";
import { useAuthContext } from "@/contexts/auth-context";
import { startChannelAgentReplies, getAgentDisplayName } from "@/lib/channel-agents";
import { getPendingAgentsForChannel, subscribeToChannelAgentPending } from "@/lib/channel-agent-pending";
import { supabase } from "@/integrations/supabase/client";
import { getAudioFileExtension, useAudioRecorder } from "@/hooks/use-audio-recorder";
import { Button } from "@/components/ui/button";
import AudioMessagePlayer from "@/components/chat/AudioMessagePlayer";
import CollapsibleTranscription from "@/components/chat/CollapsibleTranscription";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Hash, Lock, MessageCircle, MessageSquare, Plus, Send, Users, Bot, Mic, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import ThreadPanel from "@/components/chat/ThreadPanel";
import { useMessageReactions } from "@/hooks/use-message-reactions";
import { useThreadCounts } from "@/hooks/use-channel-threads";
import { resetComposerTextarea, resizeComposerTextarea } from "@/lib/chat-composer";
import { hasEveryoneMention, notifyChannelRecipients } from "@/lib/channel-notifications";

function ChannelIcon({ type }: { type: Channel["type"] }) {
  if (type === "private") return <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />;
  if (type === "dm") return <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  return <Bot className={className ?? "h-4 w-4"} />;
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Main Page ──────────────────────────────────────────────
export default function ChannelsPage() {
  const { user, profile } = useAuthContext();
  const { agents } = useAgents();
  const isMobile = useIsMobile();
  const { channels, loading: channelsLoading, createChannel, joinChannel } = useChannels();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const { messages, loading: msgsLoading, sendMessage } = useChannelMessages(selectedChannel?.id ?? null);
  const threadCounts = useThreadCounts(selectedChannel?.id ?? null);
  const members = useChannelMembers(selectedChannel?.id ?? null);
  const { reactions: channelReactions, toggleReaction: toggleChannelReaction } = useMessageReactions(selectedChannel?.id ?? null);
  const [input, setInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<"public" | "private" | "dm">("public");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>(() => getPendingAgentsForChannel(selectedChannel?.id));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorder = useAudioRecorder();
  const [activeThreadMessage, setActiveThreadMessage] = useState<import("@/hooks/use-channels").ChannelMessage | null>(null);

  const agentMembers = useMemo(
    () => members.filter((m) => (m as any).member_type === "agent").map((m) => m.user_id),
    [members]
  );

  useEffect(() => {
    if (!selectedChannel && channels.length > 0) setSelectedChannel(channels[0]);
  }, [channels, selectedChannel]);

  useEffect(() => {
    setActiveThreadMessage(null);
    resetComposerTextarea(inputRef.current);
  }, [selectedChannel?.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pendingAgentIds]);

  useEffect(() => {
    if (selectedChannel && user) joinChannel(selectedChannel.id);
  }, [selectedChannel?.id]);

  useEffect(() => subscribeToChannelAgentPending(selectedChannel?.id, setPendingAgentIds), [selectedChannel?.id]);

  const triggerAgents = useCallback((text: string) => {
    if (!selectedChannel) return;
    startChannelAgentReplies({
      channelId: selectedChannel.id,
      channelType: selectedChannel.type,
      agentMembers,
      messageText: text,
    });
  }, [agentMembers, selectedChannel]);

  const handleSend = async () => {
    if (!input.trim() || !selectedChannel || !user) return;
    const msg = input.trim();
    setInput("");
    resetComposerTextarea(inputRef.current);
    const authorName = profile?.full_name || user.email || "Usuário";
    await sendMessage(selectedChannel.id, user.id, authorName, msg, "human");
    await notifyChannelRecipients({
      channelId: selectedChannel.id,
      senderUserId: user.id,
      authorName,
      contentPreview: msg.slice(0, 100),
      contentText: msg,
      forceNotifyAll: selectedChannel.type === "dm",
    });
    triggerAgents(msg);
  };

  const handleSendThreadReply = useCallback(async (content: string, rootMessageId: string, attachments?: import("@/hooks/use-channels").ChannelAttachment[] | null) => {
    if (!selectedChannel || !user) return;
    const authorName = profile?.full_name || user.email || "Usuário";
    await sendMessage(
      selectedChannel.id,
      user.id,
      authorName,
      content,
      "human",
      null,
      null,
      attachments ?? null,
      rootMessageId,
    );
    await notifyChannelRecipients({
      channelId: selectedChannel.id,
      senderUserId: user.id,
      authorName,
      contentPreview: content.slice(0, 100),
      contentText: content,
      forceNotifyAll: selectedChannel.type === "dm",
    });
  }, [profile?.full_name, selectedChannel, sendMessage, user]);

  const handleAudioStop = async () => {
    if (!selectedChannel || !user) return;
    recorder.setIsProcessing(true);

    try {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio. Tente novamente.");
        recorder.setIsProcessing(false);
        return;
      }

      // 1. Upload to storage
      const ext = getAudioFileExtension(blob.type);
      const fileName = `${selectedChannel.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("audio-messages")
        .upload(fileName, blob, { contentType: blob.type });

      if (uploadErr) {
        console.error("Upload error:", uploadErr);
        toast.error("Falha ao enviar o áudio.");
        recorder.setIsProcessing(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("audio-messages").getPublicUrl(fileName);
      const audioUrl = urlData.publicUrl;

      // 2. Transcribe via edge function
      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      const { data: transcribeData, error: transcribeErr } = await supabase.functions.invoke(
        "transcribe-audio",
        { body: formData }
      );

      const transcription = transcribeErr ? "⚠️ Transcrição indisponível" : (transcribeData?.text || "🎤 Mensagem de áudio");

      // 3. Send message with audio_url
      await sendMessage(
        selectedChannel.id,
        user.id,
        profile?.full_name || user.email || "Usuário",
        transcription,
        "human",
        null,
        audioUrl
      );

      await notifyChannelRecipients({
        channelId: selectedChannel.id,
        senderUserId: user.id,
        authorName: profile?.full_name || user.email || "Usuário",
        contentPreview: `🎤 ${transcription.slice(0, 100)}`,
        contentText: transcription,
        forceNotifyAll: selectedChannel.type === "dm",
      });

      // 4. Trigger agents
      triggerAgents(transcription);
    } catch (err) {
      console.error("Audio send error:", err);
      toast.error("Falha ao processar o áudio.");
    } finally {
      recorder.setIsProcessing(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const ch = await createChannel(newName.trim(), newDesc.trim(), newType, undefined, selectedAgents.length > 0 ? selectedAgents : undefined);
      if (ch) {
        setSelectedChannel(ch);
        setCreateOpen(false);
        setNewName("");
        setNewDesc("");
        setNewType("public");
        setSelectedAgents([]);
        toast.success(`Canal #${ch.name} criado!`);
      } else {
        toast.error("Erro ao criar canal. Verifique o console para detalhes.");
      }
    } catch (err) {
      console.error("Create channel error:", err);
      toast.error("Erro ao criar canal.");
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]);
  };

  const publicChannels = channels.filter((c) => c.type === "public");
  const privateChannels = channels.filter((c) => c.type === "private");
  const dmChannels = channels.filter((c) => c.type === "dm");
  const isBusy = recorder.isProcessing;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 border-r border-border flex flex-col bg-card/50 shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold font-display text-foreground">Canais</h2>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><Plus className="h-4 w-4" /></Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Criar Canal</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div><Label>Nome</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex: marketing" /></div>
                <div><Label>Descrição (opcional)</Label><Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Sobre o que é este canal?" rows={2} /></div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={newType} onValueChange={(v) => setNewType(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Público</SelectItem>
                      <SelectItem value="private">Privado</SelectItem>
                      <SelectItem value="dm">Mensagem Direta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Super agentes no canal</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border hover:bg-secondary cursor-pointer text-sm">
                        <Checkbox checked={selectedAgents.includes(agent.id)} onCheckedChange={() => toggleAgent(agent.id)} />
                        <AgentIcon agentId={agent.id} className="h-4 w-4 text-muted-foreground" />
                        <span>{agent.name || getAgentDisplayName(agent.id)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={!newName.trim()}>Criar Canal</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {publicChannels.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-display px-2 mb-1">Canais Públicos</p>
                {publicChannels.map((ch) => (<ChannelItem key={ch.id} channel={ch} active={selectedChannel?.id === ch.id} onClick={() => setSelectedChannel(ch)} />))}
              </div>
            )}
            {privateChannels.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-display px-2 mb-1">Canais Privados</p>
                {privateChannels.map((ch) => (<ChannelItem key={ch.id} channel={ch} active={selectedChannel?.id === ch.id} onClick={() => setSelectedChannel(ch)} />))}
              </div>
            )}
            {dmChannels.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-display px-2 mb-1">Mensagens Diretas</p>
                {dmChannels.map((ch) => (<ChannelItem key={ch.id} channel={ch} active={selectedChannel?.id === ch.id} onClick={() => setSelectedChannel(ch)} />))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedChannel ? (
          <>
            {/* Header */}
            <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ChannelIcon type={selectedChannel.type} />
                <h3 className="font-semibold text-foreground truncate">{selectedChannel.name}</h3>
                {selectedChannel.description && (
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">— {selectedChannel.description}</span>
                )}
                {pendingAgentIds.length > 0 && (
                  <span className="text-xs text-primary animate-pulse ml-2">
                    {pendingAgentIds.map((a) => getAgentDisplayName(a)).join(", ")} digitando...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {agentMembers.length > 0 && (<div className="flex items-center gap-1"><Bot className="h-3.5 w-3.5" /><span className="text-[10px]">{agentMembers.length}</span></div>)}
                <div className="flex items-center gap-1"><Users className="h-4 w-4" /><span className="text-xs">{members.length}</span></div>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando mensagens...</div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nenhuma mensagem ainda. Comece a conversa! 🚀</div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    threadCount={threadCounts[msg.id]?.count ?? 0}
                    onReply={() => setActiveThreadMessage(msg)}
                  />
                ))
              )}

              {pendingAgentIds.length > 0 && (
                <div className="flex gap-3">
                  <div className="h-9 w-9 rounded-full shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/50">
                    <div className="h-9 w-9 flex items-center justify-center bg-accent/20">
                      <Bot className="h-4 w-4 text-accent-foreground" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{pendingAgentIds.map((a) => getAgentDisplayName(a)).join(", ")}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Agente</Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="animate-bounce text-muted-foreground" style={{ animationDelay: "0ms" }}>●</span>
                      <span className="animate-bounce text-muted-foreground" style={{ animationDelay: "150ms" }}>●</span>
                      <span className="animate-bounce text-muted-foreground" style={{ animationDelay: "300ms" }}>●</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className={`p-3 shrink-0 ${isMobile ? "pb-1" : ""}`}>
              {agentMembers.length > 0 && !recorder.isRecording && !recorder.isProcessing && (
                <p className="text-[10px] text-muted-foreground mb-1.5 px-1">
                  {selectedChannel.type === "dm"
                    ? "💡 Mensagens diretas com agente respondem automaticamente."
                    : `💡 Use @${getAgentDisplayName(agentMembers[0]).toLowerCase()} para mencionar um agente — ele só responde quando for mencionado.`}
                </p>
              )}

              {recorder.isRecording ? (
                <div className="glass-input flex items-center gap-2 px-3 py-2">
                  <button onClick={recorder.cancel} className="p-1.5 text-destructive hover:text-destructive/80 transition-colors rounded-full hover:bg-destructive/10">
                    <X className="h-4 w-4" />
                  </button>
                  <div className="flex-1 flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
                    <span className="text-sm font-mono text-destructive">{formatDuration(recorder.duration)}</span>
                    <span className="text-xs text-muted-foreground">Gravando...</span>
                  </div>
                  <button onClick={handleAudioStop} className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              ) : recorder.isProcessing ? (
                <div className="glass-input flex items-center gap-3 px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Transcrevendo áudio...</span>
                </div>
              ) : (
                <div className="glass-input flex items-end gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <Textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        resizeComposerTextarea(e.currentTarget);
                      }}
                      onInput={(e) => resizeComposerTextarea(e.currentTarget)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                      placeholder={`Mensagem em #${selectedChannel.name}...`}
                      rows={1}
                      disabled={isBusy}
                      className="min-h-[40px] max-h-[88px] w-full resize-none border-0 bg-transparent px-0 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground/40 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [overflow-wrap:anywhere]"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pb-0.5">
                    <button
                      onClick={recorder.start}
                      disabled={isBusy}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-secondary/30 disabled:opacity-50"
                      title="Gravar áudio"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || isBusy}
                      className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {channelsLoading ? "Carregando canais..." : "Selecione um canal para começar"}
          </div>
        )}

        {selectedChannel && (
          <ThreadPanel
            channelId={selectedChannel.id}
            channelName={selectedChannel.name}
            open={!!activeThreadMessage}
            onOpenChange={(open) => !open && setActiveThreadMessage(null)}
            rootMessage={activeThreadMessage}
            onSendReply={handleSendThreadReply}
            currentUserId={user?.id ?? ""}
            reactions={channelReactions}
            onToggleReaction={(messageId, emoji) => user && toggleChannelReaction(messageId, emoji, user.id)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Message Bubble ─────────────────────────────────────────
function MessageBubble({
  msg,
  onReply,
  threadCount,
}: {
  msg: import("@/hooks/use-channels").ChannelMessage;
  onReply: () => void;
  threadCount: number;
}) {
  const isAgent = msg.author_type === "agent";
  const hasAudio = !!msg.audio_url;
  const mentionsEveryone = hasEveryoneMention(msg.content);

  return (
    <div className={`flex gap-3 group ${isAgent ? "pl-2" : ""}`}>
      <div className="h-9 w-9 rounded-full shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/50">
        {msg.author_avatar ? (
          <img src={msg.author_avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : isAgent ? (
          <div className="h-9 w-9 flex items-center justify-center bg-accent/20">
            <AgentIcon agentId={msg.author_id} className="h-4 w-4 text-accent-foreground" />
          </div>
        ) : (
          <div className="h-9 w-9 flex items-center justify-center bg-primary/20">
            <span className="text-sm font-bold text-primary">{msg.author_name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className={`min-w-0 flex-1 ${isAgent ? "bg-accent/5 rounded-lg px-3 py-2 -ml-1" : ""}`}>
        <div className="flex items-center gap-2">
          <span className={`font-semibold text-sm ${isAgent ? "text-accent-foreground" : "text-foreground"}`}>{msg.author_name}</span>
          {isAgent && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Agente</Badge>}
          {hasAudio && <span className="text-[10px]">🎙️</span>}
          <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "HH:mm")}</span>
        </div>

        {/* Audio player */}
        {hasAudio && (
          <div className="mt-1.5 mb-1">
            <AudioMessagePlayer src={msg.audio_url!} />
          </div>
        )}

        {/* Text content / transcription */}
        {hasAudio ? (
          <CollapsibleTranscription text={msg.content} />
        ) : isAgent ? (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground/90 mt-0.5 prose-p:my-0 prose-p:whitespace-pre-wrap prose-pre:whitespace-pre-wrap">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-2">
            {mentionsEveryone && (
              <div className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                <Users className="h-3 w-3" />
                <span>Aviso para todos</span>
              </div>
            )}
            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onReply}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{threadCount > 0 ? `${threadCount} ${threadCount === 1 ? "resposta" : "respostas"}` : "Responder na conversa"}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Channel Item ───────────────────────────────────────────
function ChannelItem({ channel, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-2.5 rounded-xl transition-colors touch-target ${
        active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-secondary/50 active:bg-secondary/70"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`relative h-11 w-11 shrink-0 rounded-full flex items-center justify-center ring-1 ring-border/50 ${
          active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
        }`}>
          <ChannelIcon type={channel.type} />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[15px] truncate ${active ? "font-bold text-primary" : "font-semibold text-foreground"}`}>{channel.name}</span>
          </div>
          {channel.description && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{channel.description}</p>
          )}
        </div>
      </div>
    </button>
  );
}

