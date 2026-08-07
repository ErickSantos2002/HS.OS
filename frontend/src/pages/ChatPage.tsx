import { assinar } from "@/lib/realtime";
import React, { Fragment, useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { enviarArquivo, urlPublica } from "@/lib/storage";
import { api } from "@/lib/api";

import { useAllAvatars, useResolvedAgentAvatar } from "@/hooks/use-agent-avatar";
import { useAgents } from "@/hooks/use-agents";
import { useChatMedia } from "@/hooks/use-chat-media";
import { useAudioRecorder, getAudioFileExtension } from "@/hooks/use-audio-recorder";
import { useAudioLevel } from "@/hooks/use-audio-level";
import { useChannels, type Channel } from "@/hooks/use-channels";
import { usePeople, findOrCreateDm, type Person } from "@/hooks/use-people";
import { useDmPeers } from "@/hooks/use-dm-members";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { useTypingActivity } from "@/hooks/use-typing-indicator";
import { useAuthContext } from "@/contexts/auth-context";
import { useFS } from "@/contexts/FileSystemContext";
import { getGatewayConfig } from "@/lib/gateway";
import { type ChatMessage, type MediaAttachment } from "@/lib/mock-data";
import { formatFileSize } from "@/lib/file-upload";
import { Bot, FileText, File as FileIcon, Copy, Check, BellDot } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  loadPersistedHistory,
  loadOlderMessages,
  appendToConversations,
  clearConversationHistory,
  loadLastMessagesPerAgent,
  getCachedHistory,
  prefetchAgentHistory,
  appendMessageToHistoryCache,
  conversationRowToMessage,
  removeMessageFromHistoryCache,
  replaceMessageInHistoryCache,
  loadConversationArtifacts,
  loadArtifactTitles,
  saveArtifactTitle,
} from "@/lib/chat-persistence";
import {
  sendMessageInBackground,
  isAgentPending,
  getPendingAgentIds,
  setActiveAgentId,
  stopAgentResponse,
  wasAgentResponseStopped,
  hasUnreadAgentMessage,
  getUnreadAgentIds,
  clearUnreadAgent,
  markAgentUnread,
  pruneUnreadAgents,
  resumePendingBackgroundTasks,
  CHAT_UPDATE_EVENT,
  CHAT_PENDING_EVENT,
  CHAT_STREAM_EVENT,
  AGENT_UNREAD_EVENT,
  type ChatUpdateDetail,
  type ChatStreamDetail,
} from "@/lib/chat-sender";
import {
  Send, User, Loader2, WifiOff,
  Mic, Paperclip, Image as ImageIcon,
  X, ZoomIn, Trash2, Info, Volume2, Square,
  RefreshCw, Hash, Lock, MessageCircle, Plus, Star, Bell, RotateCcw,
} from "lucide-react";
import { usePendingAgentTask } from "@/hooks/use-pending-agent-task";
import { speakText, stopTTS, getVoiceForAgent } from "@/lib/elevenlabs";
import { playNotificationSound } from "@/lib/notification-sound";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import ChannelChat, { ChannelIcon } from "@/components/chat/ChannelChat";
import CreateChannelDialog from "@/components/chat/CreateChannelDialog";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { MarkdownMessageContent, PlainMessageContent, StreamingMarkdownContent } from "@/components/chat/MessageContent";
import CollapsiblePlainText from "@/components/chat/CollapsiblePlainText";
import ArtifactMessage from "@/components/chat/ArtifactMessage";
import { FolderButton } from "@/components/chat/FolderButton";
import { FolderBadge } from "@/components/chat/FolderBadge";
import ArtifactPanel from "@/components/chat/ArtifactPanel";
import LiveArtifactViewer from "@/components/LiveArtifactViewer";
import ArtifactsList from "@/components/chat/ArtifactsList";
import { ContextWindowIndicator } from "@/components/chat/ContextWindowIndicator";
import { ModelSelector } from "@/components/chat/ModelSelector";
import CopyMessageButton from "@/components/chat/CopyMessageButton";
import AudioRecordingOverlay from "@/components/chat/AudioRecordingOverlay";
import { type ArtifactType, extractAllArtifacts, type ConversationArtifact } from "@/lib/artifact-extractor";

import StreamingActivityIndicator, { CHAT_ACTIVITY_EVENT } from "@/components/chat/StreamingActivityIndicator";


import AgentActivityCard, { AgentActivityBucketCard } from "@/components/chat/AgentActivityCard";
import { useAgentActivitiesFeed, type AgentActivity } from "@/hooks/use-agent-activities";
import { useAgentActivityVisible, setAgentActivityVisible } from "@/lib/agent-activity-visibility";
import HeartbeatPanel from "@/components/chat/HeartbeatPanel";
import DateDivider from "@/components/chat/DateDivider";
import { shouldShowDateDivider } from "@/lib/chat-date-groups";
import { resetComposerTextarea, resizeComposerTextarea } from "@/lib/chat-composer";
import { copyToClipboard, hasActiveTextSelection } from "@/lib/clipboard";
import { getAgentIdAliases, toCanonicalAgentId } from "@/lib/agent-id";

/** Strip markdown formatting for sidebar preview */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`{1,3}(.*?)`{1,3}/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
}

/** Relative time for sidebar timestamps */
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Today — show HH:mm
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function sameAgentId(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  const leftAliases = getAgentIdAliases(left);
  return getAgentIdAliases(right).some((alias) => leftAliases.includes(alias));
}

/* ── Helpers ──────────────────────────────────────────── */

const EMPTY_MESSAGES: ChatMessage[] = [];

function AgentChatAvatar({
  sizeClass,
  ringClass = "ring-2 ring-border/50",
  agentId,
}: {
  sizeClass: string;
  ringClass?: string;
  agentId?: string;
}) {
  const { avatar: custom, handleBrokenAvatar } = useResolvedAgentAvatar(agentId);
  return (
    <div className={`${sizeClass} rounded-full overflow-hidden bg-card ${ringClass}`}>
      {custom ? (
        <img src={custom} alt="Agente" className="h-full w-full object-cover" onError={handleBrokenAvatar} />
      ) : (
        <Bot className="h-full w-full p-1 text-muted-foreground" />
      )}
    </div>
  );
}

function AgentListAvatar({
  sizeClass,
  className = "",
  agentId,
}: {
  sizeClass: string;
  className?: string;
  agentId?: string;
}) {
  const { avatar: custom, handleBrokenAvatar } = useResolvedAgentAvatar(agentId);
  return (
    <div className={`agent-list-avatar ${sizeClass} ${className}`.trim()}>
      {custom ? (
        <img
          src={custom}
          alt="Agente"
          className="h-full w-full rounded-[inherit] object-cover"
          onError={handleBrokenAvatar}
        />
      ) : (
        <Bot className="h-full w-full p-1 text-muted-foreground" />
      )}
    </div>
  );
}

function AgentListIndicator({
  working = false,
  className = "",
}: {
  working?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "agent-list-indicator inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md px-1",
        working ? "agent-list-indicator-working" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      <Bot className="h-2.5 w-2.5" />
    </span>
  );
}

function SidebarTypingDots() {
  return (
    <span className="inline-flex h-4 items-center gap-0.5 px-1" aria-label="digitando">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1 w-1 rounded-full bg-primary"
          style={{ animation: "typing-dot 1.15s ease-in-out infinite", animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

// Gateway session fallback removed — too slow and causes latency on agent history load.
// Agent history is now loaded exclusively from local DB via loadPersistedHistory.

/* ── Media Bubble ─────────────────────────────────────── */

function MediaBubble({ attachment, onImageClick }: { attachment: MediaAttachment; onImageClick: (src: string) => void }) {
  // Auto-detect type from mimeType when type is missing or generic
  const effectiveType: MediaAttachment["type"] =
    attachment.type ??
    (attachment.mimeType?.startsWith("image/") ? "image" :
     attachment.mimeType?.startsWith("audio/") ? "audio" : "file");

  const handleDownload = async (src: string, name: string) => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(src, "_blank");
    }
  };

  if (effectiveType === "image") {
    const rawSrc = attachment.url || attachment.base64 || "";
    // Handle bare base64 strings (no data: prefix)
    const src = rawSrc && !rawSrc.startsWith("data:") && !rawSrc.startsWith("http") && !rawSrc.startsWith("/")
      ? `data:${attachment.mimeType || "image/png"};base64,${rawSrc.replace(/\s/g, "")}`
      : rawSrc;
    
    return (
      <div className="relative group rounded-md overflow-hidden max-w-[240px] mt-1">
        <img src={src} alt={attachment.name ?? "image"} className="rounded-md max-h-48 object-cover cursor-pointer" onClick={() => onImageClick(src)} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 pointer-events-none">
          <button onClick={() => onImageClick(src)} className="pointer-events-auto h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(src, attachment.name || "image.png"); }}
            className="pointer-events-auto h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            title="Download"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          </button>
        </div>
      </div>
    );
  }
  if (attachment.type === "file") {
    const isPdf = attachment.mimeType === "application/pdf";
    const Icon = isPdf ? FileText : FileIcon;
    return (
      <a href={attachment.url || attachment.base64} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 mt-1 px-3 py-2 rounded-md bg-secondary/60 hover:bg-secondary/80 transition-colors max-w-[280px]">
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">{attachment.name ?? "arquivo"}</p>
          {attachment.size && <p className="text-[10px] text-muted-foreground">{formatFileSize(attachment.size)}</p>}
        </div>
      </a>
    );
  }
  return null;
}

/* ── Staged Media Preview ─────────────────────────────── */

function StagedPreview({ items, onRemove }: { items: MediaAttachment[]; onRemove: (i: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2 px-3 py-2 overflow-x-auto">
      {items.map((att, i) => (
        <div key={i} className="relative group shrink-0">
          {att.type === "image" ? (
            <img src={att.base64} alt={att.name} className="h-16 w-16 rounded-md object-cover border border-border" />
          ) : att.type === "file" ? (
            <div className="h-16 min-w-[120px] max-w-[180px] rounded-md border border-border bg-secondary/50 flex items-center gap-2 px-2">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-foreground truncate font-medium">{att.name ?? "file"}</p>
                {att.size && <p className="text-[9px] text-muted-foreground">{formatFileSize(att.size)}</p>}
              </div>
            </div>
          ) : (
            <div className="h-16 w-16 rounded-md border border-border bg-secondary flex flex-col items-center justify-center gap-1">
              <Paperclip className="h-4 w-4 text-primary" />
              <span className="text-[8px] text-muted-foreground truncate max-w-[56px]">{att.name ?? "file"}</span>
            </div>
          )}
          <button onClick={() => onRemove(i)} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Copy single message button ──────────────────────── */

const agentMessageActionClassName = "inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-secondary/20 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground";

/* CopyMessageButton is now imported from @/components/chat/CopyMessageButton */

/* ── Streaming indicator (isolated to avoid re-rendering entire page) ── */

const StreamingIndicator = React.memo(function StreamingIndicator({
  streamingText,
  isAgentWorking,
  isMobile,
  agentId,
}: {
  streamingText: string;
  isAgentWorking: boolean;
  isMobile: boolean;
  agentId: string;
}) {
  const activityCardVisible = useAgentActivityVisible(agentId);
  if (!isAgentWorking) return null;
  // Keep the streaming bubble/pill visible alongside the AAC, but hide the
  // chip row (Pensando/Buscando na web/…) when the AAC is up to avoid dup.

  const hasText = !!streamingText && streamingText !== "[working]" && streamingText !== "[retrying]";
  const isLongTask = hasText && /Tarefa longa em andamento|ainda estou trabalhando/i.test(streamingText);

  return (
    <div className="flex flex-col gap-0">
      <div className="flex min-w-0 gap-2 md:gap-3">
        <AgentChatAvatar sizeClass="h-8 w-8 shrink-0" ringClass="ring-2 ring-border/30 agent-working-pulse" agentId={agentId} />
        {streamingText === "[working]" ? (
          <div className="typing-pill agent-working-pulse text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-xs">Trabalhando...</span></div>
        ) : streamingText === "[retrying]" ? (
          <div className="typing-pill text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" /><span className="text-xs">Tentando novamente...</span></div>
        ) : streamingText ? (
          <div className={`min-w-0 ${isMobile ? "max-w-[85%]" : "max-w-[70%]"} bg-card/60 backdrop-blur-md border border-border/20 rounded-2xl px-3.5 py-2.5 text-sm text-foreground shadow-sm`}>
            <div className="min-w-0 text-inherit">
              <StreamingMarkdownContent text={streamingText} className="text-inherit" />
              <span className="inline-block w-[2px] h-[1em] bg-foreground ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        ) : (
          <div className="typing-pill agent-working-pulse text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-xs">Iniciando...</span></div>
        )}
      </div>
      <HeartbeatPanel agentId={agentId} active={isLongTask} />
      {!activityCardVisible && <StreamingActivityIndicator agentId={agentId} isWorking={isAgentWorking} hasStreamingText={hasText} />}


    </div>
  );
});


interface AgentMessageListProps {
  messages: ChatMessage[];
  isMobile: boolean;
  isAgentWorking: boolean;
  ttsPlaying: string | null;
  effectiveAgentId: string;
  agentName: string;
  userAvatarUrl?: string | null;
  userName?: string | null;
  onSetLightboxSrc: (src: string) => void;
  onSetActiveArtifact: (a: { type: ArtifactType; code: string; title?: string } | null) => void;
  onOpenLiveArtifact: (id: string) => void;
  onRetry: (msgId: string) => void;
  onTtsToggle: (msgId: string, content: string) => void;
  /** Activities grouped by the agent message they belong to. */
  activitiesByMessageId?: Record<string, AgentActivity[]>;
  /** Trailing activities not yet tied to any agent reply (live turn). */
  trailingActivities?: AgentActivity[];
}

const AgentMessageList = React.memo(function AgentMessageList({
  messages,
  isMobile,
  isAgentWorking,
  ttsPlaying,
  effectiveAgentId,
  agentName,
  userAvatarUrl,
  userName,
  onSetLightboxSrc,
  onSetActiveArtifact,
  onOpenLiveArtifact,
  onRetry,
  onTtsToggle,
  activitiesByMessageId,
  trailingActivities,
}: AgentMessageListProps) {
  const lastAgentIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "agent") return i;
    }
    return -1;
  })();
  return (
    <>
      {messages.map((msg, index) => {
        const previousMessage = messages[index - 1];
        const showDateDivider = shouldShowDateDivider(msg.timestamp, previousMessage?.timestamp);
        const isOwn = msg.role === "user";
        const isAgent = msg.role === "agent";
        const isErrorContent = !!msg.content && msg.content.startsWith("[error]");
        const time = new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const bubbleClass = msg.isError
          ? "rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-foreground backdrop-blur-md"
          : isOwn
          ? "rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2 text-foreground backdrop-blur-sm shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
          : "rounded-2xl border border-primary/30 bg-card/60 px-3.5 py-2 text-foreground/90 backdrop-blur-sm shadow-[0_0_24px_-12px_hsl(var(--primary)/0.45),inset_0_0_0_1px_hsl(var(--primary)/0.08)]";

        return (
          <Fragment key={msg.id}>
            {showDateDivider && <DateDivider date={msg.timestamp} />}
            <div
              data-message-id={msg.id}
              className={`flex gap-3 group relative px-3 py-1.5 -mx-3 ${isOwn ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar */}
              <div className={`h-9 w-9 shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/30 ${isAgent ? "rounded-md" : "rounded-full"}`}>
                {isAgent ? (
                  <AgentChatAvatar sizeClass="h-9 w-9" ringClass="" agentId={effectiveAgentId} />
                ) : userAvatarUrl ? (
                  <img src={userAvatarUrl} alt={userName || "Você"} className="h-9 w-9 object-cover" />
                ) : (
                  <div className="h-9 w-9 flex items-center justify-center bg-primary/15">
                    {userName ? (
                      <span className="text-sm font-bold text-foreground">{userName.charAt(0).toUpperCase()}</span>
                    ) : (
                      <User className="h-4 w-4 text-primary" />
                    )}
                  </div>
                )}
              </div>

              <div className={`min-w-0 flex-1 flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                {/* Author + time row (agent only) */}
                {!isOwn && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{agentName || "Agente"}</span>
                    <span className="text-[10px] text-muted-foreground">{time}</span>
                  </div>
                )}

                {/* Activity history sits between the agent header and the response bubble */}
                {msg.role === "agent" && activitiesByMessageId?.[msg.id]?.length ? (
                  <AgentActivityBucketCard
                    activities={activitiesByMessageId[msg.id]}
                    agentId={effectiveAgentId}
                    agentName={agentName}
                    forceIdle
                    initialCollapsed
                    className="pl-0 md:pl-0 mt-1 mb-1 w-full"
                  />
                ) : null}

                <div className={`relative w-full flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                  <div
                    className={`relative mt-1 text-left ${isOwn ? "inline-block w-max max-w-[85%]" : "block w-full"} ${bubbleClass}`}
                  >
                    <div className="chat-message-content-selectable break-words" data-message-select-scope={msg.id}>
                      {msg.content && (
                        isErrorContent ? (
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm">
                            <span className="inline-flex items-start gap-1.5">
                              <WifiOff className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                              <span>{msg.content.replace("[error] ", "").replace("[error]", "")}</span>
                            </span>
                          </p>
                        ) : isAgent ? (
                          <ArtifactMessage content={msg.content} className="text-inherit text-sm" agentId={msg.agentId} onArtifactClick={onSetActiveArtifact} onLiveArtifactClick={onOpenLiveArtifact} />
                        ) : (
                          <CollapsiblePlainText text={msg.content} className="text-sm text-foreground/90" />
                        )
                      )}
                      {Array.isArray(msg.media) && msg.media.map((att, i) => <MediaBubble key={i} attachment={att} onImageClick={onSetLightboxSrc} />)}
                    </div>

                    {/* Hover action bar — anchored to bubble edge */}
                    {!msg.id.startsWith("optimistic-") && !msg.isError && (
                      <div
                        className={`absolute top-1 ${isOwn ? "-left-1 -translate-x-full" : "-right-1 translate-x-full"} hidden group-hover:flex items-center gap-0.5 bg-popover border border-border rounded-md shadow-md p-0.5 z-10`}
                      >
                        {isAgent && msg.content && (
                          <button
                            type="button"
                            onClick={() => onTtsToggle(msg.id, msg.content)}
                            className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                            title={ttsPlaying === msg.id ? "Parar" : "Ouvir"}
                            aria-label={ttsPlaying === msg.id ? "Parar áudio" : "Ouvir resposta"}
                          >
                            {ttsPlaying === msg.id ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <CopyMessageButton text={msg.content || ""} />
                        {isAgent && effectiveAgentId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAgentUnread(effectiveAgentId);
                              toast.success("Marcada como não lida");
                            }}
                            className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                            title="Marcar como não lida"
                            aria-label="Marcar como não lida"
                          >
                            <BellDot className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bottom action bar for agent responses — avoids scrolling up to copy */}
                  {isAgent && !msg.id.startsWith("optimistic-") && !msg.isError && msg.content && (
                    <div className="mt-1 flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity">
                      {effectiveAgentId && (
                        <button
                          type="button"
                          onClick={() => onTtsToggle(msg.id, msg.content)}
                          className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                          title={ttsPlaying === msg.id ? "Parar" : "Ouvir"}
                          aria-label={ttsPlaying === msg.id ? "Parar áudio" : "Ouvir resposta"}
                        >
                          {ttsPlaying === msg.id ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <CopyMessageButton text={msg.content} />
                    </div>
                  )}


                  {/* Own timestamp below bubble */}
                  {isOwn && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>{time}</span>
                    </div>
                  )}

                  {/* Retry inline for errors */}
                  {msg.isError && (
                    <button
                      onClick={() => onRetry(msg.id)}
                      disabled={isAgentWorking}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className="h-3 w-3" /> Tentar novamente
                    </button>
                  )}



                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
});


/* ── Selection type ───────────────────────────────────── */

type Selection =
  | { type: "agent"; id: string }
  | { type: "channel"; channel: Channel };

/* ── Mobile Agent Chips ──────────────────────────────── */

function MobileAgentChips({
  agents,
  selectedId,
  onSelect,
}: {
  agents: { id: string; name: string; status: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scrollRef} className="chips-scroll py-2">
      {agents.map((agent) => {
        const active = agent.id === selectedId;
        const hasUnread = hasUnreadAgentMessage(agent.id);
        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-full shrink-0 transition-all touch-target ${
              active
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                : "glass-card text-foreground"
            }`}
          >
              <div className="relative h-7 w-7 shrink-0">
                <AgentChatAvatar sizeClass="h-7 w-7" ringClass="ring-2 ring-border/40" agentId={agent.id} />
              <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 ${active ? "border-primary" : "border-card"} ${
                agent.status === "active" ? "bg-success" : agent.status === "recent" ? "bg-warning" : "bg-muted-foreground"
              }`} />
            </div>
            <span className={`text-sm whitespace-nowrap ${active ? "font-bold" : hasUnread ? "font-bold" : "font-medium"}`}>
              {agent.name}
            </span>
            {hasUnread && !active && (
              <span className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold shrink-0">1</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────── */

export default function ChatPage() {
  const { agents, loading, error } = useAgents();
  const { channels, loading: channelsLoading, createChannel, joinChannel, refetch: refetchChannels } = useChannels();
  const { people, loading: peopleLoading } = usePeople();
  const { user, profile } = useAuthContext();
  const { peers: dmPeers, peerIdToChannelId } = useDmPeers(channels, user?.id);
  const { notifications, unreadByChannel, unreadByAgentOnly, unreadCount, markAsRead, markAllAsReadForChannel, markAllAsReadForAgent, setActiveChannel, setActiveAgent } = useNotificationsContext();
  const isMobile = useIsMobile();
  const { bottomOffset, isKeyboardOpen } = useMobileChatViewport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [agentDmChannelMap, setAgentDmChannelMap] = useState<Record<string, string>>({});

  // Não lidas de um agente = as do canal de DM dele + as gravadas só com
  // agent_id (channel_id nulo, caso do dm-agent-reply quando o canal não
  // resolve). Antes só o primeiro mapa era lido e as órfãs nunca acendiam
  // badge — apareciam na aba "Não lidas" e sumiam da lista de DMs.
  const agentUnreadTotal = useCallback((agentId: string): number => {
    const aliases = getAgentIdAliases(agentId);
    const dmChId = aliases.map((alias) => agentDmChannelMap[alias]).find(Boolean);
    const fromChannel = dmChId ? (unreadByChannel[dmChId] || 0) : 0;
    const fromAgentOnly = aliases.reduce((acc, alias) => acc + (unreadByAgentOnly[alias] || 0), 0);
    return fromChannel + fromAgentOnly;
  }, [agentDmChannelMap, unreadByChannel, unreadByAgentOnly]);

  // Derive selection from URL search params
  const channelParam = searchParams.get("channel");
  const agentParam = searchParams.get("agent");
  const hasExplicitSelectionParam = !!channelParam || !!agentParam;

  // If channel param exists but not in channels list yet, trigger a refetch — once per channelId
  const refetchedForChannelRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!channelParam || channelsLoading) return;
    if (channels.find((c) => c.id === channelParam)) return;
    if (refetchedForChannelRef.current.has(channelParam)) return;
    refetchedForChannelRef.current.add(channelParam);
    refetchChannels();
  }, [channelParam, channels, channelsLoading, refetchChannels]);

  const agentIdFromChannelParam = useMemo(() => {
    if (!channelParam) return null;
    for (const agent of agents) {
      if (getAgentIdAliases(agent.id).some((alias) => agentDmChannelMap[alias] === channelParam)) {
        return agent.id;
      }
    }
    return null;
  }, [agentDmChannelMap, agents, channelParam]);

  const resolvedAgentParam = useMemo(() => {
    if (!agentParam) return null;
    const normalizedParam = agentParam.trim().toLowerCase();
    const match = agents.find((agent) =>
      getAgentIdAliases(agent.id).some((alias) => alias.toLowerCase() === normalizedParam)
    );
    return match?.id ?? agentParam;
  }, [agentParam, agents]);

  const getAgentIdForDmChannel = useCallback((channelId: string | null | undefined) => {
    if (!channelId) return null;
    for (const agent of agents) {
      if (getAgentIdAliases(agent.id).some((alias) => agentDmChannelMap[alias] === channelId)) {
        return agent.id;
      }
    }
    return null;
  }, [agentDmChannelMap, agents]);

  const selection: Selection | null = useMemo(() => {
    if (resolvedAgentParam) return { type: "agent", id: resolvedAgentParam };
    if (agentIdFromChannelParam) return { type: "agent", id: agentIdFromChannelParam };
    if (channelParam) {
      const ch = channels.find((c) => c.id === channelParam);
      if (ch) return { type: "channel", channel: ch };
    }
    return null;
  }, [agentIdFromChannelParam, channelParam, channels, resolvedAgentParam]);

  useEffect(() => {
    if (!channelParam || !agentIdFromChannelParam || agentParam) return;
    navigate(`/chat?agent=${encodeURIComponent(agentIdFromChannelParam)}`, { replace: true });
  }, [agentIdFromChannelParam, agentParam, channelParam, navigate]);

  useEffect(() => {
    if (!agentParam || !resolvedAgentParam || agentParam === resolvedAgentParam) return;
    navigate(`/chat?agent=${encodeURIComponent(resolvedAgentParam)}`, { replace: true });
  }, [agentParam, navigate, resolvedAgentParam]);

  // Navigate helpers — creates real history entries for swipe-back
  const setSelection = useCallback((next: Selection | null) => {
    if (!next) {
      if (location.pathname === "/chat" && !channelParam && !agentParam) return;
      navigate("/chat", { replace: false });
    } else if (next.type === "agent") {
      if (agentParam === next.id && !channelParam) return;
      navigate(`/chat?agent=${encodeURIComponent(next.id)}`, { replace: false });
      try { localStorage.setItem("mc_last_chat", JSON.stringify({ type: "agent", id: next.id })); } catch {}
    } else if (next.type === "channel") {
      if (channelParam === next.channel.id && !agentParam) return;
      navigate(`/chat?channel=${encodeURIComponent(next.channel.id)}`, { replace: false });
      try { localStorage.setItem("mc_last_chat", JSON.stringify({ type: "channel", channelId: next.channel.id })); } catch {}
    }
  }, [agentParam, channelParam, location.pathname, navigate]);

  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [hasMoreByAgent, setHasMoreByAgent] = useState<Record<string, boolean>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"channels" | "dms" | "unreads">("dms");

  // Persist sidebar tab selection and restore on mount
  useEffect(() => {
    try { localStorage.setItem("mc_last_chat_tab", sidebarTab); } catch {}
  }, [sidebarTab]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mc_last_chat_tab");
      if (saved === "channels" || saved === "dms" || saved === "unreads") setSidebarTab(saved);
    } catch {}

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current selection (from URL or click) so we can restore it later
  useEffect(() => {
    if (!selection) return;
    try {
      if (selection.type === "agent") {
        localStorage.setItem("mc_last_chat", JSON.stringify({ type: "agent", id: selection.id }));
      } else if (selection.type === "channel") {
        localStorage.setItem("mc_last_chat", JSON.stringify({ type: "channel", channelId: selection.channel.id }));
      }
    } catch {}
  }, [selection?.type === "channel" ? (selection as any).channel.id : null, selection?.type === "agent" ? (selection as any).id : null]);

  // When user lands on /chat without explicit params, restore last conversation.
  // On mobile, the main /chat screen always shows the list — the last chat is only
  // restored when the URL itself points to it (agent/channel param).
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (hasExplicitSelectionParam) { restoreAttemptedRef.current = true; return; }
    if (location.pathname !== "/chat") return;
    if (channelsLoading) return;
    if (isMobile) { restoreAttemptedRef.current = true; return; }
    try {
      const saved = localStorage.getItem("mc_last_chat");
      if (!saved) { restoreAttemptedRef.current = true; return; }
      const parsed = JSON.parse(saved);
      if (parsed?.type === "agent" && parsed.id) {
        restoreAttemptedRef.current = true;
        navigate(`/chat?agent=${encodeURIComponent(parsed.id)}`, { replace: true });
      } else if (parsed?.type === "channel" && parsed.channelId) {
        restoreAttemptedRef.current = true;
        navigate(`/chat?channel=${encodeURIComponent(parsed.channelId)}`, { replace: true });
      } else {
        restoreAttemptedRef.current = true;
      }
    } catch {
      restoreAttemptedRef.current = true;
    }
  }, [hasExplicitSelectionParam, location.pathname, channelsLoading, navigate, isMobile]);
  const [activeArtifact, setActiveArtifact] = useState<{ type: ArtifactType; code: string } | null>(null);
  const [activeLiveArtifactId, setActiveLiveArtifactId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agentShouldAutoScrollRef = useRef(true);

  const media = useChatMedia();
  const audioLevel = useAudioLevel();
  const audioRecorder = useAudioRecorder();
  useAllAvatars();

  // Listen for toast click → navigate to channel
  useEffect(() => {
    const handler = (e: Event) => {
      const { channelId } = (e as CustomEvent).detail;
      const agentId = getAgentIdForDmChannel(channelId);
      if (agentId) {
        setSelection({ type: "agent", id: agentId });
        return;
      }
      const ch = channels.find((c) => c.id === channelId);
      if (ch) setSelection({ type: "channel", channel: ch });
    };
    window.addEventListener("navigate-to-channel", handler);
    return () => window.removeEventListener("navigate-to-channel", handler);
  }, [channels, getAgentIdForDmChannel, setSelection]);

  // Listen for toast click → navigate to agent DM
  useEffect(() => {
    const handler = (e: Event) => {
      const { agentId } = (e as CustomEvent).detail;
      if (agentId) setSelection({ type: "agent", id: agentId });
    };
    window.addEventListener("navigate-to-agent", handler);
    return () => window.removeEventListener("navigate-to-agent", handler);
  }, []);

  // Track active agent for notification suppression
  const prevAgentRef = useRef<string | null>(null);
  // BUG 3 fix: keep agentDmChannelMap in a ref so this effect doesn't re-run
  // (and clean up via setActiveAgentId(null)) every time the map updates.
  const agentDmChannelMapRef = useRef(agentDmChannelMap);
  agentDmChannelMapRef.current = agentDmChannelMap;

  useEffect(() => {
    const currentAgentId = selection?.type === "agent" ? selection.id : null;

    // Always update prevAgentRef first to prevent artifact panel from closing on re-render
    const agentActuallyChanged = prevAgentRef.current !== currentAgentId;
    prevAgentRef.current = currentAgentId;

    if (currentAgentId) {
      setActiveAgentId(currentAgentId);
      clearUnreadAgent(currentAgentId);
      if (agentActuallyChanged) {
        setActiveArtifact(null);
      }
      // Defensive sweep: clears ghost notifications from channel-broadcast
      // even when agentDmChannelMap doesn't yet know the channel UUID.
      void markAllAsReadForAgent(currentAgentId);
      const dmChId = getAgentIdAliases(currentAgentId)
        .map((alias) => agentDmChannelMapRef.current[alias])
        .find(Boolean);
      if (dmChId) {
        markAllAsReadForChannel(dmChId);
        // NOTE: setActiveChannel is handled by the unified effect below
        // Re-sweep after 2s to catch late-arriving DB notifications (race condition)
        const sweepTimer = setTimeout(() => {
          markAllAsReadForChannel(dmChId);
          void markAllAsReadForAgent(currentAgentId);
        }, 2000);
        return () => clearTimeout(sweepTimer);
      }
    } else {
      if (agentActuallyChanged) {
        setActiveArtifact(null);
      }
      setActiveAgentId(null);
    }
    return () => {
      setActiveAgentId(null);
    };
  }, [selection?.type === "agent" ? (selection as any).id : null]);

  // Unified active channel tracking for notifications — prevents race conditions
  // between the agent effect and the channel effect
  const activeNotificationChannelId = useMemo(() => {
    if (selection?.type === "channel") return selection.channel.id;
    if (selection?.type === "agent") {
      return getAgentIdAliases(selection.id)
        .map((alias) => agentDmChannelMap[alias])
        .find(Boolean) ?? null;
    }
    return null;
  }, [selection?.type === "channel" ? (selection as any).channel.id : null, selection?.type === "agent" ? (selection as any).id : null, agentDmChannelMap]);

  useEffect(() => {
    if (activeNotificationChannelId) {
      setActiveChannel(activeNotificationChannelId);
      markAllAsReadForChannel(activeNotificationChannelId);
    } else {
      setActiveChannel(null);
    }
    // O agente ativo vai junto: notificação órfã (sem canal) que chegar
    // enquanto o chat desse agente está aberto é lida na hora, não vira badge.
    setActiveAgent(selection?.type === "agent" ? selection.id : null);
    return () => { setActiveChannel(null); setActiveAgent(null); };
  }, [activeNotificationChannelId, selection?.type === "agent" ? (selection as any).id : null]);

  // When the tab/window becomes visible or focused again, re-sweep the active
  // channel so notifications that arrived while the app was in background
  // (but with this chat already open) are cleared without needing to switch chats.
  useEffect(() => {
    if (!activeNotificationChannelId) return;
    const sweep = () => {
      if (document.visibilityState === "visible") {
        markAllAsReadForChannel(activeNotificationChannelId);
      }
    };
    document.addEventListener("visibilitychange", sweep);
    window.addEventListener("focus", sweep);
    return () => {
      document.removeEventListener("visibilitychange", sweep);
      window.removeEventListener("focus", sweep);
    };
  }, [activeNotificationChannelId, markAllAsReadForChannel]);

  // Re-render sidebar when unread state changes
  const [, forceUnread] = useState(0);
  useEffect(() => {
    const handler = () => forceUnread((c) => c + 1);
    window.addEventListener(AGENT_UNREAD_EVENT, handler);
    return () => window.removeEventListener(AGENT_UNREAD_EVENT, handler);
  }, []);

  // Last messages per agent for sorting — stabilize dependency to avoid duplicate fetches
  const [lastMessages, setLastMessages] = useState<Record<string, { content: string; created_at: string }>>({});
  const agentIdsKey = useMemo(() => agents.map((a) => a.id).sort().join(","), [agents]);

  // Evict any in-memory ghost unread entries that don't match a real agent.
  useEffect(() => {
    if (!agentIdsKey) return;
    pruneUnreadAgents(agentIdsKey.split(","));
  }, [agentIdsKey]);

  useEffect(() => {
    if (!agentIdsKey || !user?.id) return;
    let cancelled = false;
    const agentIds = agentIdsKey.split(",");
    void (async () => {
      const map = await loadLastMessagesPerAgent(user.id, agentIds);
      if (!cancelled) setLastMessages(map);
    })();
    return () => { cancelled = true; };
  }, [agentIdsKey, user?.id]);

  // Resume long-task placeholders that were active before a page refresh
  useEffect(() => {
    if (!user?.id) return;
    resumePendingBackgroundTasks(user.id);
  }, [user?.id]);

  const sortedAgents = useMemo(() => {
    const withConvo: typeof agents = [];
    const withoutConvo: typeof agents = [];
    for (const agent of agents) {
      if (lastMessages[agent.id]) withConvo.push(agent);
      else withoutConvo.push(agent);
    }
    withConvo.sort((a, b) => {
      const ta = new Date(lastMessages[a.id]?.created_at ?? 0).getTime();
      const tb = new Date(lastMessages[b.id]?.created_at ?? 0).getTime();
      return tb - ta;
    });
    return [...withConvo, ...withoutConvo];
  }, [agents, lastMessages]);

  const effectiveAgentId = selection?.type === "agent" ? selection.id : "";
  const effectiveAgentIdRef = useRef(effectiveAgentId);
  effectiveAgentIdRef.current = effectiveAgentId;
  const agentDraftKey = effectiveAgentId ? `agent:${effectiveAgentId}` : null;
  const { value: draftValue, setValue: setDraftValue, clear: clearInputDraft } = usePersistentDraft(agentDraftKey);
  const inputLocalRef = useRef("");
  const userTypingRef = useRef(false);
  const userTypingTimerRef = useRef<number | null>(null);

  const markUserTyping = useCallback(() => {
    userTypingRef.current = true;
    if (userTypingTimerRef.current) window.clearTimeout(userTypingTimerRef.current);
    userTypingTimerRef.current = window.setTimeout(() => {
      userTypingRef.current = false;
    }, 1500);
  }, []);

  // Keep the local ref/height in sync with the controlled draft value without
  // imperatively writing textarea.value, which can reset the caret on mobile.
  useLayoutEffect(() => {
    inputLocalRef.current = draftValue;
    const ta = inputRef.current;
    if (!ta) return;
    const frame = window.requestAnimationFrame(() => {
      if (draftValue) resizeComposerTextarea(ta);
      else resetComposerTextarea(ta);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftValue]);

  const syncToDraft = useCallback((val: string) => {
    inputLocalRef.current = val;
    setDraftValue(val);
  }, [setDraftValue]);

  // Convenience getter for reading current input value
  const getInputValue = useCallback(() => inputLocalRef.current, []);
  const selectedAgent = agents.find((a) => a.id === effectiveAgentId);
  const agentMessages = messagesByAgent[effectiveAgentId] ?? EMPTY_MESSAGES;
  const { task: pendingAgentTask, dismiss: dismissPendingTask } = usePendingAgentTask(effectiveAgentId);

  // Realtime feed of tool-call activities for this agent, split into buckets
  // that match each agent reply so the AAC history sits right below the
  // response it belongs to.
  const activitiesFeed = useAgentActivitiesFeed(effectiveAgentId, user?.id ?? null, 60);

  // Per-agent "turn start" timestamp. Bumped whenever the user sends a new
  // message so the live AAC opens zeroed for that turn and does not accumulate
  // activities from previous interactions.
  const turnStartByAgentRef = useRef<Record<string, number>>({});
  const [turnStartTick, setTurnStartTick] = useState(0);
  const currentTurnStartTs = turnStartByAgentRef.current[effectiveAgentId] ?? 0;

  // Only activities from the current turn onwards are considered "live"
  // (used for the trailing AAC card that renders while the agent is replying).
  // Historical buckets keep the full feed so past AAC cards remain visible.
  //
  // A fronteira do turno compara RELÓGIO DO BANCO com relógio do banco: o
  // created_at da última mensagem SUA persistida. A marca anterior era
  // Date.now() do navegador contra created_at do Postgres — segundos de skew
  // bastavam para toda atividade do turno parecer "de antes do turno", e a
  // caixa ao vivo ficava vazia até a resposta chegar (aí o agrupamento
  // histórico, que não usa a marca, encaixava tudo de uma vez).
  const scopedActivitiesFeed = useMemo(() => {
    let fronteira = 0;
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const m = agentMessages[i];
      if (m.role === "user" && !m.id.startsWith("optimistic-")) {
        // 2s de folga para inserções fora de ordem no mesmo instante.
        fronteira = new Date(m.timestamp).getTime() - 2000;
        break;
      }
    }
    // Sem mensagem persistida ainda (só a otimista): relógio local com folga
    // generosa — errar para "mostrar cedo demais" é melhor que caixa vazia.
    if (!fronteira) fronteira = currentTurnStartTs - 60_000;
    return activitiesFeed.filter(
      (a) => new Date(a.created_at).getTime() >= fronteira
    );
  }, [activitiesFeed, agentMessages, currentTurnStartTs, turnStartTick]);

  useEffect(() => {
    setAgentActivityVisible(effectiveAgentId, scopedActivitiesFeed.length > 0);
    return () => setAgentActivityVisible(effectiveAgentId, false);
  }, [effectiveAgentId, scopedActivitiesFeed.length]);

  const { activitiesByMessageId, trailingActivities, lastAgentMessageId } = useMemo(() => {
    const byId: Record<string, AgentActivity[]> = {};
    // Historical bucketing uses the FULL feed so previous turns' AAC cards
    // stay attached to their agent reply and don't vanish after a new turn.
    const remaining = [...activitiesFeed];
    // Bucket rule: an activity belongs to the agent reply whose timestamp is
    // the first agent message with timestamp >= activity.created_at - 2s.
    const agentMsgs = agentMessages
      .map((m, i) => ({ m, i }))
      .filter((x) => x.m.role === "agent");
    for (const act of remaining) {
      const actTs = new Date(act.created_at).getTime();
      const match = agentMsgs.find(
        ({ m }) => new Date(m.timestamp).getTime() + 2000 >= actTs
      );
      if (match) {
        (byId[match.m.id] ||= []).push(act);
      }
    }
    const lastAgentMsg = agentMsgs.length ? agentMsgs[agentMsgs.length - 1].m : null;
    const lastAgentTs = lastAgentMsg
      ? new Date(lastAgentMsg.timestamp).getTime()
      : 0;
    // Trailing (live) AAC uses the turn-scoped feed so it starts empty on
    // each new user message.
    const trailing = scopedActivitiesFeed.filter(
      (a) => new Date(a.created_at).getTime() > lastAgentTs + 2000
    );
    return {
      activitiesByMessageId: byId,
      trailingActivities: trailing,
      lastAgentMessageId: lastAgentMsg?.id ?? null,
    };
  }, [activitiesFeed, scopedActivitiesFeed, agentMessages]);


  // Dedicated artifact messages state — loaded independently from DB
  const [artifactMessages, setArtifactMessages] = useState<ChatMessage[]>([]);
  const [artifactTitles, setArtifactTitles] = useState<Record<string, string>>({});

  // Signal used to trigger a reload of persisted artifacts whenever a new
  // agent message containing an artifact fence arrives in the live stream.
  const lastAgentArtifactSig = useMemo(() => {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const m = agentMessages[i];
      if (m.role !== "agent") continue;
      if (/```(html|svg|jsx|tsx|react)\s*\n/i.test(m.content)) {
        return `${m.id ?? i}:${m.content.length}`;
      }
      break; // only inspect the most recent agent message
    }
    return "";
  }, [agentMessages]);

  const [liveArtifactRows, setLiveArtifactRows] = useState<Array<{ id: string; title: string; html_content: string; refresh_interval: number; updated_at: string }>>([]);

  useEffect(() => {
    if (!effectiveAgentId || !user?.id) {
      setArtifactMessages([]);
      setArtifactTitles({});
      setLiveArtifactRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const msgs = await loadConversationArtifacts(user.id, effectiveAgentId);
      if (!cancelled) setArtifactMessages(msgs);
      if (cancelled) return;
      const messageIds = msgs.map((m) => m.id).filter(Boolean) as string[];
      const titles = await loadArtifactTitles(messageIds);
      if (!cancelled) setArtifactTitles(titles);

      // `com_html` porque a aba renderiza o painel ali mesmo. São poucos e
      // filtrados por agente — a lista geral continua sem o HTML.
      const liveRows = await api<any[]>(
        `/artefatos/vivos?agent_id=${encodeURIComponent(effectiveAgentId)}&meus=true&com_html=true`,
      ).catch(() => []);
      if (!cancelled) setLiveArtifactRows(liveRows ?? []);
    })();
    return () => { cancelled = true; };
  }, [effectiveAgentId, user?.id, lastAgentArtifactSig]);

  const conversationArtifacts = useMemo(() => {
    const base = extractAllArtifacts(artifactMessages, artifactTitles);
    const live: ConversationArtifact[] = liveArtifactRows.map((r, idx) => ({
      type: "html" as ArtifactType,
      code: r.html_content,
      title: r.title,
      messageIndex: -1 - idx,
      messageId: `live:${r.id}`,
      createdAt: r.updated_at,
      live: true,
      liveId: r.id,
      liveInterval: r.refresh_interval,
    }));
    return [...live, ...base].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [artifactMessages, artifactTitles, liveArtifactRows]);
  const handleRenameArtifact = useCallback(async (messageId: string, newTitle: string) => {
    if (!messageId || !newTitle.trim()) return;
    const trimmed = newTitle.trim();
    if (messageId.startsWith("live:")) {
      const liveId = messageId.slice(5);
      const error = await api(`/artefatos/vivos/${liveId}`, {
        method: "PATCH",
        body: { title: trimmed },
      }).then(() => null, (e: Error) => e);
      if (error) return;
      setLiveArtifactRows((prev) => prev.map((r) => (r.id === liveId ? { ...r, title: trimmed } : r)));
      return;
    }
    await saveArtifactTitle(messageId, trimmed);
    setArtifactTitles((prev) => ({ ...prev, [messageId]: trimmed }));
  }, []);
  const handleTtsToggle = useCallback(async (msgId: string, content: string) => {
    if (ttsPlaying === msgId) { stopTTS(); setTtsPlaying(null); } else {
      try {
        setTtsPlaying(msgId);
        const voice = await getVoiceForAgent(effectiveAgentId);
        const audio = await speakText(content, voice.voiceId);
        audio.onended = () => setTtsPlaying(null);
      } catch { setTtsPlaying(null); }
    }
  }, [ttsPlaying, effectiveAgentId]);
  const handleDeleteArtifact = useCallback(async (messageId: string) => {
    if (!messageId || !user?.id) return;
    if (messageId.startsWith("live:")) {
      const liveId = messageId.slice(5);
      setLiveArtifactRows((prev) => prev.filter((r) => r.id !== liveId));
      setActiveLiveArtifactId((cur) => (cur === liveId ? null : cur));
      await api(`/artefatos/vivos/${liveId}`, { method: "DELETE" }).catch(() => {
        /* a linha já saiu da tela; falhar aqui não deve reverter o que a pessoa viu */
      });
      return;
    }
    // Remove from local state immediately
    setMessagesByAgent(prev => ({
      ...prev,
      [effectiveAgentId]: (prev[effectiveAgentId] ?? []).filter(m => m.id !== messageId),
    }));
    setArtifactMessages(prev => prev.filter(m => m.id !== messageId));
    removeMessageFromHistoryCache(user.id, effectiveAgentId, messageId);
    // Delete from database
    await supabase.from("conversations").delete().eq("id", messageId);
  }, [effectiveAgentId, user?.id]);
  const [realtimePendingByAgent, setRealtimePendingByAgent] = useState<Record<string, boolean>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "reconnecting">("connected");
  // Debounced flag: only true after the socket stays down for >5s, so brief
  // SUBSCRIBED/CLOSED blips don't make the badge flash every second.
  const [showReconnecting, setShowReconnecting] = useState(false);
  useEffect(() => {
    if (realtimeStatus === "connected") {
      setShowReconnecting(false);
      return;
    }
    const t = window.setTimeout(() => setShowReconnecting(true), 5000);
    return () => window.clearTimeout(t);
  }, [realtimeStatus]);
  const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set(getPendingAgentIds()));
  useEffect(() => {
    const handler = () => setPendingAgentIds(new Set(getPendingAgentIds()));
    window.addEventListener(CHAT_PENDING_EVENT, handler);
    return () => window.removeEventListener(CHAT_PENDING_EVENT, handler);
  }, []);

  const setRealtimePending = useCallback((agentId: string, pending: boolean) => {
    setRealtimePendingByAgent((prev) => {
      const current = Boolean(prev[agentId]);
      if (current === pending) return prev;

      if (pending) return { ...prev, [agentId]: true };

      if (!(agentId in prev)) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  const syncRealtimePendingFromMessages = useCallback((agentId: string, messages: ChatMessage[]) => {
    // Only clear "pending" if the most recent message is an agent reply (i.e. the
    // user's last turn has been answered). Otherwise we may be in a long-running
    // task whose response has not yet been persisted — keep the indicator on.
    let lastUserIdx = -1;
    let lastAgentIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = messages[i]?.role;
      if (lastAgentIdx === -1 && role === "agent") lastAgentIdx = i;
      if (lastUserIdx === -1 && role === "user") lastUserIdx = i;
      if (lastUserIdx !== -1 && lastAgentIdx !== -1) break;
    }
    const answered = lastAgentIdx > lastUserIdx;
    const stillPendingLocal = isAgentPending(agentId);
    if (answered && !stillPendingLocal) {
      setRealtimePending(agentId, false);
    }
  }, [setRealtimePending]);

  // Listen for nav-reset to go back to list view (mobile) — no longer needed with URL nav
  // BottomNav now navigates to /chat directly

  // Auto-select: restore last session or fallback to first channel/agent (desktop only)
  useEffect(() => {
    if (selection) return;
    if (isMobile) return; // Mobile starts on list view
    if (hasExplicitSelectionParam) return; // Wait for URL-driven channel/agent resolution

    // Try restoring last session from localStorage
    try {
      const saved = localStorage.getItem("mc_last_chat");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.type === "agent" && parsed.id) {
          setSelection({ type: "agent", id: parsed.id });
          return;
        }
        if (parsed.type === "channel" && parsed.channelId) {
          const ch = channels.find((c) => c.id === parsed.channelId);
          if (ch) { setSelection({ type: "channel", channel: ch }); return; }
        }
      }
    } catch {}

    // Fallback
    if (channels.length > 0) {
      setSelection({ type: "channel", channel: channels[0] });
    } else if (sortedAgents.length > 0) {
      setSelection({ type: "agent", id: sortedAgents[0].id });
    }
  }, [channels, sortedAgents, selection, isMobile, hasExplicitSelectionParam, setSelection]);

  // Join channel on select (notification tracking is handled by the unified effect above)
  useEffect(() => {
    if (selection?.type === "channel") {
      joinChannel(selection.channel.id);
    }
  }, [selection?.type === "channel" ? (selection as any).channel.id : null]);

  // Auto-focus input when switching conversations
  useEffect(() => {
    if (isMobile || !selection) return;
    if (!document.hasFocus()) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement?.tagName !== "TEXTAREA") {
        inputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selection?.type === "agent" ? (selection as any).id : selection?.type === "channel" ? (selection as any).channel?.id : null, isMobile]);

  const isNearBottom = useCallback((element: HTMLDivElement | null) => {
    if (!element) return true;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom < 96;
  }, []);

  const handleAgentMessagesScroll = useCallback(() => {
    agentShouldAutoScrollRef.current = isNearBottom(messagesContainerRef.current);
  }, [isNearBottom]);

  // Resize composer on conversation switch only
  useEffect(() => {
    if (selection?.type !== "agent") return;
    const frame = window.requestAnimationFrame(() => {
      if (!inputRef.current) return;
      if (inputLocalRef.current) resizeComposerTextarea(inputRef.current);
      else resetComposerTextarea(inputRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [effectiveAgentId, selection?.type]);

  // Auto-scroll
  const prevLenRef = useRef(0);
  const initialLoadDoneRef = useRef<Record<string, boolean>>({});
  useLayoutEffect(() => {
    if (selection?.type !== "agent") return;
    if (hasActiveTextSelection()) return; // Don't disrupt text selection
    const container = messagesContainerRef.current;
    if (!container) return;
    const isInitialLoad = prevLenRef.current === 0 && agentMessages.length > 0;
    const isFirstOpen = !initialLoadDoneRef.current[effectiveAgentId];
    if (isInitialLoad && isFirstOpen) {
      container.scrollTop = container.scrollHeight;
      // Re-pin after layout so late mobile composer/keyboard reflows don't
      // leave the view stranded above the latest message.
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight;
      });
      window.setTimeout(() => {
        if (container) container.scrollTop = container.scrollHeight;
      }, 250);
      initialLoadDoneRef.current[effectiveAgentId] = true;
      prevLenRef.current = agentMessages.length;
      return;
    }
    if (!agentShouldAutoScrollRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    prevLenRef.current = agentMessages.length;
  }, [agentMessages.length, selection?.type, effectiveAgentId]);

  // Keep view pinned to bottom as content/container size changes (images load,
  // streaming text grows, composer/keyboard resizes). Only when user is near bottom.
  useEffect(() => {
    if (selection?.type !== "agent") return;
    const container = messagesContainerRef.current;
    if (!container) return;
    let frame = 0;
    const pin = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!agentShouldAutoScrollRef.current) return;
        if (hasActiveTextSelection()) return;
        container.scrollTop = container.scrollHeight;
      });
    };
    const ro = new ResizeObserver(pin);
    ro.observe(container);
    // Observe direct children so growing message bubbles also trigger pin
    Array.from(container.children).forEach((child) => ro.observe(child as Element));
    return () => { if (frame) cancelAnimationFrame(frame); ro.disconnect(); };
  }, [selection?.type, effectiveAgentId, agentMessages.length]);

  // Re-pin when mobile keyboard opens/closes or composer height changes
  useEffect(() => {
    if (selection?.type !== "agent") return;
    if (!agentShouldAutoScrollRef.current) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [bottomOffset, isKeyboardOpen, selection?.type]);

  // Scroll-to + highlight a specific message when ?message=<id> is present in URL.
  const highlightedMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agentMessages.length) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("message");
    if (!targetId || highlightedMessageRef.current === targetId) return;
    if (!agentMessages.some((m) => m.id === targetId)) return;
    highlightedMessageRef.current = targetId;
    requestAnimationFrame(() => {
      const el = messagesContainerRef.current?.querySelector<HTMLElement>(`[data-message-id="${targetId}"]`);
      if (!el) return;
      el.querySelectorAll<HTMLButtonElement>('[data-collapsible-toggle="expand"]').forEach((btn) => btn.click());
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      el.classList.add("msg-highlight");
      window.setTimeout(() => el.classList.remove("msg-highlight"), 2400);
    });
  }, [agentMessages, effectiveAgentId]);

  useEffect(() => {
    prevLenRef.current = 0;
    agentShouldAutoScrollRef.current = true;
  }, [effectiveAgentId]);

  // Load persisted history — cache-first with background revalidation
  useEffect(() => {
    if (!effectiveAgentId || !user?.id) return;

    // Instant hydration from cache
    const cached = getCachedHistory(user.id, effectiveAgentId);
    if (cached) {
      setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: cached.messages }));
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: cached.hasMore }));
      syncRealtimePendingFromMessages(effectiveAgentId, cached.messages);
    }

    // Background revalidation
    let cancelled = false;
    void (async () => {
      const result = await loadPersistedHistory(user.id, effectiveAgentId);
      if (cancelled) return;
      setMessagesByAgent((prev) => {
        const existing = prev[effectiveAgentId] ?? [];
        const byId = new Map(existing.map(m => [m.id, m]));
        for (const m of result.messages) byId.set(m.id, m);
        const merged = [...byId.values()].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        return { ...prev, [effectiveAgentId]: merged };
      });
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
      syncRealtimePendingFromMessages(effectiveAgentId, result.messages);
    })();
    return () => { cancelled = true; };
  }, [effectiveAgentId, syncRealtimePendingFromMessages, user?.id]);

  // Prefetch histories for sidebar items on mount
  useEffect(() => {
    if (!agentIdsKey || !user?.id) return;
    const agentIds = agentIdsKey.split(",");
    for (const id of agentIds) {
      prefetchAgentHistory(user.id, id);
    }
  }, [agentIdsKey, user?.id]);

  // Load older messages
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const clearMessageSelectionLock = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.removeAttribute("data-selection-lock");
    container
      .querySelectorAll<HTMLElement>(".chat-message-content-selectable[data-selection-active='true']")
      .forEach((element) => element.removeAttribute("data-selection-active"));
  }, []);

  const handleMessageSelectionPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = messagesContainerRef.current;
    const target = event.target;

    if (!container || !(target instanceof Element)) return;

    const selectionScope = target.closest<HTMLElement>(".chat-message-content-selectable");

    clearMessageSelectionLock();

    if (!selectionScope) return;

    selectionScope.setAttribute("data-selection-active", "true");
    container.setAttribute("data-selection-lock", "true");
  }, [clearMessageSelectionLock]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const container = messagesContainerRef.current;
      if (!container) return;

      const activeScope = container.querySelector<HTMLElement>(".chat-message-content-selectable[data-selection-active='true']");
      if (!activeScope) return;

      if (document.activeElement === inputRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
        clearMessageSelectionLock();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [clearMessageSelectionLock, inputRef]);

  const handleLoadMore = useCallback(async () => {
    if (!effectiveAgentId || loadingMore || !user?.id) return;
    const currentMsgs = messagesByAgent[effectiveAgentId] ?? [];
    if (currentMsgs.length === 0) return;
    const oldestTimestamp = currentMsgs[0].timestamp;
    setLoadingMore(true);
    try {
      const container = messagesContainerRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const result = await loadOlderMessages(user.id, effectiveAgentId, oldestTimestamp);
      setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: [...result.messages, ...(prev[effectiveAgentId] ?? [])] }));
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
      requestAnimationFrame(() => { if (container) container.scrollTop = container.scrollHeight - prevScrollHeight; });
    } finally { setLoadingMore(false); }
  }, [effectiveAgentId, loadingMore, messagesByAgent, user?.id]);

  const updateAgentHistory = useCallback(
    (agentId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByAgent((prev) => ({ ...prev, [agentId]: updater(prev[agentId] ?? []) }));
    }, []
  );

  const upsertAgentMessage = useCallback(
    (agentId: string, message: ChatMessage, replaceMessageId?: string) => {
      updateAgentHistory(agentId, (current) => {
        const nextBase = replaceMessageId
          ? current.filter((item) => item.id !== replaceMessageId && item.id !== message.id)
          : current.filter((item) => item.id !== message.id);

        return [...nextBase, message].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });
    },
    [updateAgentHistory]
  );

  const appendAgentMessage = useCallback(
    (agentId: string, message: ChatMessage) => upsertAgentMessage(agentId, message),
    [upsertAgentMessage]
  );

  const handleConfirmClearConversation = useCallback(() => {
    if (!effectiveAgentId || !user?.id) return;
    setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: [] }));
    setArtifactMessages([]);
    clearConversationHistory(user.id, effectiveAgentId);
    setClearConfirmOpen(false);
    toast.success("Conversa limpa com sucesso!");
  }, [effectiveAgentId, user?.id]);

  /* ── Copy entire conversation ── */
  const [conversationCopied, setConversationCopied] = useState(false);
  const handleCopyConversation = useCallback(async () => {
    if (agentMessages.length === 0) return;
    const agentName = selectedAgent?.name ?? "Agente";
    const transcript = agentMessages
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const sender = msg.role === "user" ? "Você" : agentName;
        let line = `[${time}] ${sender}: ${msg.content || ""}`;
        if (msg.media?.length) {
          line += ` [${msg.media.map((m) => m.name || m.type).join(", ")}]`;
        }
        return line;
      })
      .join("\n");
    const ok = await copyToClipboard(transcript);
    if (ok) {
      setConversationCopied(true);
      toast.success("Conversa copiada!");
      setTimeout(() => setConversationCopied(false), 2000);
    } else {
      toast.error("Falha ao copiar.");
    }
  }, [agentMessages, selectedAgent?.name]);

  /* ── Background sender ── */
  const [bgPending, setBgPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const isAgentWorking = effectiveAgentId ? bgPending || Boolean(realtimePendingByAgent[effectiveAgentId]) : false;

  // When the task ends, fold trailing activities into the last agent message
  // so a single AAC renders for the turn (no duplicate above + below).
  const { finalActivitiesByMessageId, finalTrailingActivities } = useMemo(() => {
    if (!isAgentWorking && lastAgentMessageId && trailingActivities.length > 0) {
      const merged = { ...activitiesByMessageId };
      merged[lastAgentMessageId] = [
        ...(merged[lastAgentMessageId] || []),
        ...trailingActivities,
      ];
      return { finalActivitiesByMessageId: merged, finalTrailingActivities: [] as typeof trailingActivities };
    }
    return { finalActivitiesByMessageId: activitiesByMessageId, finalTrailingActivities: trailingActivities };
  }, [isAgentWorking, activitiesByMessageId, trailingActivities, lastAgentMessageId]);

  const handleStopAgentResponse = useCallback(() => {
    if (!effectiveAgentId) return;
    setRealtimePending(effectiveAgentId, false);
    setStreamingText("");
    stopAgentResponse(effectiveAgentId);
  }, [effectiveAgentId, setRealtimePending]);

  // Use ref to read messagesByAgent inside handleRetry without recreating the callback
  const messagesByAgentRef = useRef(messagesByAgent);
  messagesByAgentRef.current = messagesByAgent;

  const handleRetry = useCallback((errorMsgId: string) => {
    if (!effectiveAgentId || isAgentWorking) return;
    const currentMsgs = messagesByAgentRef.current[effectiveAgentId] ?? [];
    const withoutError = currentMsgs.filter((m) => m.id !== errorMsgId);
    setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: withoutError }));
    sendMessageInBackground(effectiveAgentId, withoutError);
  }, [effectiveAgentId, isAgentWorking]);

  /* ── Auto-feed file_op results back to the agent ── */
  useEffect(() => {
    if (!effectiveAgentId || !user?.id) return;
    const agentId = effectiveAgentId;
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { action: string; path: string; newPath?: string; ok: boolean; result: string }
        | undefined;
      if (!detail) return;
      const pathLabel = detail.newPath ? `"${detail.path}" → "${detail.newPath}"` : `"${detail.path}"`;
      const header = detail.ok
        ? `[Resultado de file_op ${detail.action} ${pathLabel}]`
        : `[Erro em file_op ${detail.action} ${pathLabel}]`;
      // Limite alto para permitir leitura de arquivos grandes inteiros.
      // O modelo ainda respeita sua própria janela de contexto.
      const FILE_OP_MAX_CHARS = 200000;
      const body = detail.result.length > FILE_OP_MAX_CHARS
        ? detail.result.slice(0, FILE_OP_MAX_CHARS) + "\n...[truncado]"
        : detail.result;
      const userMsg: ChatMessage = {
        id: `m${Date.now()}-fileop`,
        agentId,
        role: "user",
        content: `${header}\n\n${body}`,
        timestamp: new Date().toISOString(),
        channel: "web",
      };
      appendAgentMessage(agentId, userMsg);
      try {
        const persisted = await appendToConversations(user.id, agentId, userMsg);
        upsertAgentMessage(agentId, persisted, userMsg.id);
      } catch { /* ignore persistence error */ }
      sendMessageInBackground(agentId, [...(messagesByAgentRef.current[agentId] ?? []), userMsg]);
    };
    window.addEventListener("dnos:file-op-result", handler);
    return () => window.removeEventListener("dnos:file-op-result", handler);
  }, [effectiveAgentId, user?.id, appendAgentMessage, upsertAgentMessage]);

  /* ── Notify agent when user revokes local folder ── */
  const fsConnected = useFS().isConnected;
  const prevFsConnectedRef = useRef(fsConnected);
  useEffect(() => {
    const wasConnected = prevFsConnectedRef.current;
    prevFsConnectedRef.current = fsConnected;
    if (!wasConnected || fsConnected) return; // only on true → false
    if (!effectiveAgentId || !user?.id) return;
    const agentId = effectiveAgentId;
    const notice: ChatMessage = {
      id: `m${Date.now()}-fs-revoke`,
      agentId,
      role: "user",
      content: "[Sistema] O usuário desconectou a pasta local. Você perdeu acesso aos arquivos. Não tente mais operações <file_op> até que ele autorize novamente.",
      timestamp: new Date().toISOString(),
      channel: "web",
    };
    appendAgentMessage(agentId, notice);
    void (async () => {
      try {
        const persisted = await appendToConversations(user.id, agentId, notice);
        upsertAgentMessage(agentId, persisted, notice.id);
      } catch { /* ignore */ }
      sendMessageInBackground(agentId, [...(messagesByAgentRef.current[agentId] ?? []), notice]);
    })();
  }, [fsConnected, effectiveAgentId, user?.id, appendAgentMessage, upsertAgentMessage]);


  useEffect(() => {
    const findStreamPlaceholderId = (agentId: string, message: ChatMessage): string | undefined => {
      if (message.role !== "agent") return undefined;
      if (message.id.startsWith("stream-")) return undefined;
      const existing = messagesByAgentRef.current[agentId] ?? [];
      const incomingTs = new Date(message.timestamp).getTime();
      // Widened to 16 minutes to cover extended-poll background replies
      const placeholder = existing.find(
        (m) =>
          m.role === "agent" &&
          typeof m.id === "string" &&
          m.id.startsWith("stream-") &&
          Math.abs(new Date(m.timestamp).getTime() - incomingTs) < 16 * 60_000
      );
      return placeholder?.id;
    };


    const onUpdate = (e: Event) => {
      const { agentId, message } = (e as CustomEvent<ChatUpdateDetail>).detail;
      if (user?.id) appendMessageToHistoryCache(user.id, agentId, message);
      setRealtimePending(agentId, message.role === "user");
      const replaceId = findStreamPlaceholderId(agentId, message);
      upsertAgentMessage(agentId, message, replaceId);
      if (agentId === effectiveAgentId) setStreamingText("");
    };
    const onPending = () => {
      const pending = effectiveAgentId ? isAgentPending(effectiveAgentId) : false;
      setBgPending(pending);
      if (!effectiveAgentId || !pending) {
        setStreamingText("");
      }
      if (effectiveAgentId && !isAgentPending(effectiveAgentId)) {
        setRealtimePending(effectiveAgentId, false);
      }
      if (effectiveAgentId && wasAgentResponseStopped(effectiveAgentId) && !isAgentPending(effectiveAgentId)) {
        setRealtimePending(effectiveAgentId, false);
      }
    };
    let streamRafId: number | null = null;
    let latestPartial = "";
    const onStream = (e: Event) => {
      const { agentId, partialText } = (e as CustomEvent<ChatStreamDetail>).detail;
      if (agentId !== effectiveAgentId || hasActiveTextSelection()) return;
      latestPartial = partialText;
      if (streamRafId === null) {
        streamRafId = requestAnimationFrame(() => {
          streamRafId = null;
          setStreamingText(latestPartial);
        });
      }
    };
    window.addEventListener(CHAT_UPDATE_EVENT, onUpdate);
    window.addEventListener(CHAT_PENDING_EVENT, onPending);
    window.addEventListener(CHAT_STREAM_EVENT, onStream);
    onPending();
    return () => {
      window.removeEventListener(CHAT_UPDATE_EVENT, onUpdate);
      window.removeEventListener(CHAT_PENDING_EVENT, onPending);
      window.removeEventListener(CHAT_STREAM_EVENT, onStream);
      if (streamRafId !== null) cancelAnimationFrame(streamRafId);
    };
  }, [effectiveAgentId, setRealtimePending, upsertAgentMessage, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const syncConversationRequest = () => {
      if (document.visibilityState !== "visible") return;

      if (effectiveAgentId) {
        void (async () => {
          const result = await loadPersistedHistory(user.id, effectiveAgentId);
          // Protect: don't replace existing history with empty revalidation
          if (result.messages.length === 0) {
            setMessagesByAgent((prev) => {
              const existing = prev[effectiveAgentId];
              if (existing?.length) return prev; // keep existing
              return { ...prev, [effectiveAgentId]: [] };
            });
            return;
          }
          setMessagesByAgent((prev) => {
            const existing = prev[effectiveAgentId] ?? [];
            const byId = new Map(existing.map(m => [m.id, m]));
            for (const m of result.messages) byId.set(m.id, m);
            const merged = [...byId.values()].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            return { ...prev, [effectiveAgentId]: merged };
          });
          setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
          syncRealtimePendingFromMessages(effectiveAgentId, result.messages);
        })();
      }

      const agentIds = agentIdsKey ? agentIdsKey.split(",") : [];
      if (agentIds.length > 0) {
        void loadLastMessagesPerAgent(user.id, agentIds).then((map) => setLastMessages(map));
      }
    };

    // Tópico da pessoa: o backend roteia `conversations` por `user_id`, então
    // chega só o que é dela — era o que o `filter: user_id=eq.…` fazia.
    //
    // ⚠️ **O evento dispara a reconciliação, não substitui a mensagem.** Ele não
    // carrega a linha (ver `docs/PLANO-REALTIME.md`), e o `syncConversationRequest`
    // já existia como rede de segurança para o bug "gravado no banco e nunca
    // renderizado". Ele passa a ser o caminho principal, o que é uma
    // simplificação real: antes havia dois caminhos para a mesma mensagem
    // aparecer — o payload do realtime e a reconciliação — e eles podiam
    // divergir. Agora há um.
    //
    // A reconexão e a espera crescente saíram daqui: vivem no `lib/realtime.ts`,
    // que mantém **uma** conexão para a aba inteira. O controle por hook
    // duplicava isso e era a origem do laço CLOSED → retry.
    const cancelarRealtime = assinar(`usuario:${user.id}`, (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela !== "conversations") return;
      syncConversationRequest();
    });
    setRealtimeStatus("connected");

    window.addEventListener("visibilitychange", syncConversationRequest);
    window.addEventListener("focus", syncConversationRequest);

    return () => {
      window.removeEventListener("visibilitychange", syncConversationRequest);
      window.removeEventListener("focus", syncConversationRequest);
      cancelarRealtime();
    };
  }, [agentIdsKey, effectiveAgentId, setRealtimePending, syncRealtimePendingFromMessages, upsertAgentMessage, user?.id]);

  // Active reconciliation: while an agent reply is expected (pending) or the chat
  // is open, poll persisted history and merge any new agent messages that the
  // realtime subscription may have missed. Safety net against the "saved in DB
  // but never rendered" bug.
  useEffect(() => {
    if (!effectiveAgentId || !user?.id) return;
    const agentId = effectiveAgentId;
    const userId = user.id;
    let cancelled = false;

    const reconcile = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      try {
        const result = await loadPersistedHistory(userId, agentId);
        if (cancelled) return;
        let appliedAny = false;
        setMessagesByAgent((prev) => {
          const existing = prev[agentId] ?? [];
          const byId = new Map(existing.map((m) => [m.id, m]));
          let changed = false;
          for (const m of result.messages) {
            if (!byId.has(m.id)) changed = true;
            byId.set(m.id, m);
          }
          if (!changed) return prev;
          appliedAny = true;
          const merged = [...byId.values()].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          return { ...prev, [agentId]: merged };
        });
        if (appliedAny) {
          setHasMoreByAgent((prev) => ({ ...prev, [agentId]: result.hasMore }));
        }
        syncRealtimePendingFromMessages(agentId, result.messages);
      } catch {
        // swallow — next tick will retry
      }
    };

    // Fast cadence while we are waiting for a reply; slower safety-net otherwise.
    const fastMs = 3500;
    const slowMs = 20000;
    const tick = () => {
      const pending =
        isAgentPending(agentId) ||
        Boolean(realtimePendingByAgent[agentId]) ||
        pendingAgentIds.has(agentId);
      void reconcile();
      return pending ? fastMs : slowMs;
    };

    let timer: number | null = null;
    const schedule = () => {
      const delay = tick();
      timer = window.setTimeout(schedule, delay);
    };
    timer = window.setTimeout(schedule, 1500);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    effectiveAgentId,
    user?.id,
    realtimePendingByAgent,
    pendingAgentIds,
    syncRealtimePendingFromMessages,
  ]);



  // Auto-scroll during agent work — also listen for activity updates
  const [activityTick, setActivityTick] = useState(0);
  useEffect(() => {
    if (!isAgentWorking) return;
    const handler = () => setActivityTick((t) => t + 1);
    window.addEventListener(CHAT_ACTIVITY_EVENT, handler);
    return () => window.removeEventListener(CHAT_ACTIVITY_EVENT, handler);
  }, [isAgentWorking]);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (hasActiveTextSelection()) return;
    if ((isAgentWorking || streamingText) && agentShouldAutoScrollRef.current) {
      const now = Date.now();
      if (now - lastScrollRef.current < 200) return;
      lastScrollRef.current = now;
      chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [isAgentWorking, streamingText, activityTick]);

  /* ── Send (agent DM) ── */
  const [uploading, setUploading] = useState(false);

  const handleSend = useCallback(async () => {
    let input = inputLocalRef.current;
    if ((!input.trim() && media.staged.length === 0) || !effectiveAgentId || uploading) return;
    // Long messages (> 10k chars) are automatically converted to a .txt attachment.
    if (input.trim().length > 10000) {
      const converted = media.stagePastedText(input);
      if (converted) {
        input = "";
        inputLocalRef.current = "";
        clearInputDraft();
        resetComposerTextarea(inputRef.current);
      }
    }
    const sendingAgentId = effectiveAgentId;
    if (isAgentWorking) {
      setRealtimePending(sendingAgentId, false);
      setStreamingText("");
      stopAgentResponse(sendingAgentId);
    }
    agentShouldAutoScrollRef.current = true;
    // New turn → reset scoped AAC so it opens zeroed for this interaction.
    turnStartByAgentRef.current[sendingAgentId] = Date.now();
    setTurnStartTick((t) => t + 1);
    setUploading(true);
    try {
      const outgoingMedia = await media.finalizeStaged(sendingAgentId);
      const hasImages = outgoingMedia.some((m) => m.type === "image");
      const hasDocs = outgoingMedia.some((m) => m.type === "file");
      let displayContent = input.trim();
      if (!displayContent && outgoingMedia.length > 0) {
        if (hasImages) displayContent = "[imagem anexada]";
        else if (hasDocs) displayContent = "[documento anexado]";
        else displayContent = "[mídia anexada]";
      }
      const userMsg: ChatMessage = {
        id: `m${Date.now()}`, agentId: sendingAgentId, role: "user",
        content: displayContent, timestamp: new Date().toISOString(), channel: "web",
        media: outgoingMedia.length > 0 ? outgoingMedia : undefined,
      };
      appendAgentMessage(sendingAgentId, userMsg);
      try {
        const persistedMessage = await appendToConversations(user!.id, sendingAgentId, userMsg);
        replaceMessageInHistoryCache(user!.id, sendingAgentId, userMsg.id, persistedMessage);
        upsertAgentMessage(sendingAgentId, persistedMessage, userMsg.id);
        setLastMessages((prev) => ({
          ...prev,
          [sendingAgentId]: {
            content: (persistedMessage.content ?? "").length > 120 ? `${persistedMessage.content.slice(0, 120)}…` : (persistedMessage.content ?? ""),
            created_at: persistedMessage.timestamp,
          },
        }));
      } catch {
        removeMessageFromHistoryCache(user!.id, sendingAgentId, userMsg.id);
        updateAgentHistory(sendingAgentId, (c) => c.filter((m) => m.id !== userMsg.id));
        toast.error("Não consegui salvar essa mensagem no histórico. Tente novamente.");
        return;
      }
      inputLocalRef.current = "";
      clearInputDraft();
      resetComposerTextarea(inputRef.current);
      media.clearStaged();
      sendMessageInBackground(sendingAgentId, [...(messagesByAgent[sendingAgentId] ?? []), userMsg]);
    } finally { setUploading(false); }
  }, [media, effectiveAgentId, isAgentWorking, uploading, messagesByAgent, appendAgentMessage, updateAgentHistory, clearInputDraft, upsertAgentMessage, user, setLastMessages, setRealtimePending]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      media.handlePasteOrDrop(e.clipboardData);
      return;
    }
    const text = e.clipboardData.getData("text");
    if (text && media.stagePastedText(text)) {
      e.preventDefault();
    }
  }, [media]);

  /* ── Composer textarea handlers (memoized to avoid re-creating on every render) ── */
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    markUserTyping();
    inputLocalRef.current = e.target.value;
    syncToDraft(e.target.value);
    resizeComposerTextarea(e.currentTarget);
  }, [markUserTyping, syncToDraft]);

  const handleTextareaFocus = useCallback(() => {
    markUserTyping();
    agentShouldAutoScrollRef.current = true;
    if (isKeyboardOpen) {
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      });
    }
  }, [markUserTyping, isKeyboardOpen]);

  const handleTextareaClick = useCallback(() => {
    markUserTyping();
  }, [markUserTyping]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    markUserTyping();
    const ta = e.currentTarget;
    const val = ta.value;
    const pos = ta.selectionStart ?? 0;

    // Find current line
    const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = val.indexOf("\n", pos);
    const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);
    const indentMatch = currentLine.match(/^(\s*)-\s/);

    if (e.key === "Tab" && indentMatch) {
      e.preventDefault();
      if (e.shiftKey) {
        const spacesToRemove = Math.min(2, indentMatch[1].length);
        if (spacesToRemove > 0) {
          const nextValue = val.slice(0, lineStart) + val.slice(lineStart + spacesToRemove);
          const nextPos = pos - spacesToRemove;
          inputLocalRef.current = nextValue;
          syncToDraft(nextValue);
          window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextPos, nextPos));
        }
      } else {
        const nextValue = val.slice(0, lineStart) + "  " + val.slice(lineStart);
        const nextPos = pos + 2;
        inputLocalRef.current = nextValue;
        syncToDraft(nextValue);
        window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextPos, nextPos));
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (isMobile) {
        // On mobile, Enter inserts a newline instead of sending (WhatsApp behavior)
        e.preventDefault();
        const nextValue = val.slice(0, pos) + "\n" + val.slice(pos);
        inputLocalRef.current = nextValue;
        syncToDraft(nextValue);
        resizeComposerTextarea(ta);
        window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos + 1, pos + 1));
        return;
      }
      if (indentMatch) {
        e.preventDefault();
        const indent = indentMatch[1];
        const contentAfterMarker = currentLine.slice(indent.length + 2);
        if (contentAfterMarker.trim() === "") {
          const nextValue = val.slice(0, lineStart) + val.slice(lineEnd === -1 ? val.length : lineEnd);
          inputLocalRef.current = nextValue;
          syncToDraft(nextValue);
          window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(lineStart, lineStart));
        } else {
          const insert = "\n" + indent + "- ";
          const nextValue = val.slice(0, pos) + insert + val.slice(pos);
          const nextPos = pos + insert.length;
          inputLocalRef.current = nextValue;
          syncToDraft(nextValue);
          resizeComposerTextarea(ta);
          window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextPos, nextPos));
        }
        return;
      }
      e.preventDefault();
      handleSend();
    }
  }, [markUserTyping, syncToDraft, handleSend, isMobile]);


  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false); media.handlePasteOrDrop(e.dataTransfer);
  }, [media]);

  /* ── Audio overlay callbacks ── */
  const handleAudioCancel = useCallback(() => {
    audioLevel.stop();
    audioRecorder.cancel();
  }, [audioLevel, audioRecorder]);

  const handleAudioTranscribe = useCallback(async () => {
    audioLevel.stop();
    audioRecorder.setIsProcessing(true);
    try {
      const blob = await audioRecorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio.");
        return;
      }
      const ext = getAudioFileExtension(blob.type);
      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      const { data, error } = await supabase.functions.invoke("transcribe-audio", { body: formData });
      if (error) {
        toast.error("Falha na transcrição do áudio.");
        return;
      }
      const text = data?.text?.trim();
      if (text) {
        const prev = inputLocalRef.current;
        const next = prev ? prev + " " + text : text;
        inputLocalRef.current = next;
        syncToDraft(next);
      } else {
        toast.info("Nenhum texto detectado no áudio.");
      }
    } catch (err) {
      console.error("Transcription error:", err);
      toast.error("Erro ao transcrever o áudio.");
    } finally {
      audioRecorder.setIsProcessing(false);
    }
  }, [audioLevel, audioRecorder, syncToDraft]);

  const handleAudioSendAsVoice = useCallback(async () => {
    if (!user || !effectiveAgentId) return;
    audioLevel.stop();
    audioRecorder.setIsProcessing(true);
    try {
      const blob = await audioRecorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio.");
        return;
      }
      const ext = getAudioFileExtension(blob.type);
      const fileName = `${Date.now()}.${ext}`;
      const filePath = `${user.id}/${effectiveAgentId}/${fileName}`;
      try {
        await enviarArquivo("audio-messages", filePath, blob, `audio.${ext}`);
      } catch {
        toast.error("Erro ao enviar áudio.");
        return;
      }
      const audioUrl = urlPublica("audio-messages", filePath);
      // O `user_id` sai do token no servidor.
      await api(`/conversations/${encodeURIComponent(effectiveAgentId)}`, {
        method: "POST",
        body: {
          role: "user",
          content: "🎤 Mensagem de voz",
          media: [{ type: "audio", url: audioUrl, name: fileName }],
        },
      });
    } catch (err) {
      console.error("Audio send error:", err);
      toast.error("Erro ao enviar áudio.");
    } finally {
      audioRecorder.setIsProcessing(false);
    }
  }, [audioLevel, audioRecorder, user, effectiveAgentId]);

  /* ── Channel create handler ── */
  const handleCreateChannel = async (name: string, desc: string, type: "public" | "private" | "dm", agentIds?: string[], memberIds?: string[]) => {
    const ch = await createChannel(name, desc, type, memberIds, agentIds);
    if (ch) {
      setSelection({ type: "channel", channel: ch });
      setCreateOpen(false);
      toast.success(`Canal #${ch.name} criado!`);
    } else {
      toast.error("Erro ao criar canal.");
    }
  };

  /* ── Open DM with a person ── */
  const [openingDm, setOpeningDm] = useState<string | null>(null);
  const handleOpenPersonDm = useCallback(async (person: Person) => {
    if (!user || openingDm) return;
    setOpeningDm(person.id);
    try {
      const channelId = await findOrCreateDm(user.id, person.id, person.full_name || person.email);
      if (channelId) {
        // Navigate directly — the channel will be fetched lazily if not in list yet
        navigate(`/chat?channel=${encodeURIComponent(channelId)}`, { replace: false });
      } else {
        toast.error("Erro ao abrir conversa.");
      }
    } finally {
      setOpeningDm(null);
    }
  }, [user, openingDm, navigate]);

  /* ── Sidebar data ── */
  const publicChannels = useMemo(() => channels.filter((c) => c.type === "public"), [channels]);
  const privateChannels = useMemo(() => channels.filter((c) => c.type === "private"), [channels]);
  const dmChannels = useMemo(() => channels.filter((c) => c.type === "dm"), [channels]);
  const dmChannelIdsKey = useMemo(() => dmChannels.map(c => c.id).sort().join(","), [dmChannels]);
  const typingByDmChannel = useTypingActivity(dmChannels.map((c) => c.id), user?.id ?? null);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);

  const [agentUnreadIdsForDm, setAgentUnreadIdsForDm] = useState<string[]>(() => getUnreadAgentIds());
  useEffect(() => {
    const handler = () => setAgentUnreadIdsForDm(getUnreadAgentIds());
    window.addEventListener(AGENT_UNREAD_EVENT, handler);
    return () => window.removeEventListener(AGENT_UNREAD_EVENT, handler);
  }, []);
  const dmUnreadCount = useMemo(
    () => {
      const visibleAgentDmChannelIds = agents.flatMap((agent) =>
        getAgentIdAliases(agent.id)
          .map((alias) => agentDmChannelMap[alias])
          .filter(Boolean)
      );
      const visibleDmChannelIds = new Set([
        ...visibleAgentDmChannelIds,
        ...Object.values(peerIdToChannelId),
      ]);
      const dbUnread = dmChannels.reduce(
        (acc, c) => acc + (visibleDmChannelIds.has(c.id) && c.id !== activeNotificationChannelId ? (unreadByChannel[c.id] || 0) : 0),
        0,
      );
      // Órfãs (agent_id sem canal) dos agentes visíveis, exceto o chat aberto.
      const orphanUnread = agents.reduce((acc, agent) => {
        const aliases = getAgentIdAliases(agent.id);
        if (selection?.type === "agent" && aliases.includes(selection.id)) return acc;
        return acc + aliases.reduce((sum, alias) => sum + (unreadByAgentOnly[alias] || 0), 0);
      }, 0);

      const localAgentUnread = agentUnreadIdsForDm.filter((agentId) => {
        const aliases = getAgentIdAliases(agentId);
        if (selection?.type === "agent" && aliases.includes(selection.id)) return false;
        // Já contado como órfã no banco — não recontar pelo rastreador local.
        if (aliases.some((alias) => (unreadByAgentOnly[alias] || 0) > 0)) return false;
        const dmChannelId = aliases
          .map((alias) => agentDmChannelMap[alias])
          .find(Boolean);
        if (dmChannelId && dmChannelId === activeNotificationChannelId) return false;
        if (dmChannelId) return false;
        return agents.some((agent) => aliases.includes(agent.id));
      }).length;

      return dbUnread + orphanUnread + localAgentUnread;
    },
    [activeNotificationChannelId, agentDmChannelMap, agentUnreadIdsForDm, agents, dmChannels, peerIdToChannelId, selection, unreadByChannel, unreadByAgentOnly]
  );
  const channelUnreadCount = useMemo(() => [...publicChannels, ...privateChannels].reduce((acc, c) => acc + (unreadByChannel[c.id] || 0), 0), [publicChannels, privateChannels, unreadByChannel]);

  // Populate agent_id → DM channel_id mapping for badge display
  useEffect(() => {
    if (!dmChannelIdsKey || !user?.id) return;
    let cancelled = false;
    const dmIds = dmChannelIdsKey.split(",");
    (async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("channel_id, user_id")
        .in("channel_id", dmIds)
        .eq("member_type", "agent");
      if (cancelled || !data) return;
      const { data: ownRows } = await supabase
        .from("channel_members")
        .select("channel_id")
        .in("channel_id", dmIds)
        .eq("user_id", user.id)
        .eq("member_type", "human");
      if (cancelled) return;
      const ownDmChannelIds = new Set((ownRows ?? []).map((row: any) => row.channel_id));
      const map: Record<string, string> = {};
      for (const row of data as any[]) {
        if (!ownDmChannelIds.has(row.channel_id)) continue;
        map[row.user_id] = row.channel_id;
        for (const alias of getAgentIdAliases(row.user_id)) {
          map[alias] = row.channel_id;
        }
      }
      // Also map official agent IDs to channels created with variant IDs
      // e.g. "rodrigoia" → channel maps to official "rodrigo"
      for (const agentId of agentIdsKey.split(",").filter(Boolean)) {
        if (!map[agentId]) {
          const match = (data as any[]).find(
            (row: any) => getAgentIdAliases(agentId).includes(row.user_id)
          );
          if (match) map[agentId] = match.channel_id;
        }
      }
      // Don't mass-clear unread — badge is cleared when user opens the chat (line 583)
      setAgentDmChannelMap((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(map);
        if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === map[key])) {
          return prev;
        }
        return map;
      });
    })();
    return () => { cancelled = true; };
  }, [agentIdsKey, dmChannelIdsKey, user?.id]);

  // Track last activity for DM channels (people)
  const [dmLastActivity, setDmLastActivity] = useState<Record<string, string>>({});

  // DM sidebar sub-filter: all | unread | favorites
  const [dmFilter, setDmFilter] = useState<"all" | "unread" | "favorites">("all");

  // Handler for the "Unreads" tab — open the right context (channel/DM/thread) and mark as read
  const openNotification = useCallback((notif: any) => {
    const channelId: string | null = notif.channel_id ?? null;
    const threadRootId: string | null = notif.message_id ?? null;
    const agentId: string | null = notif.agent_id ?? null;

    const channel = channelId ? channels.find((c) => c.id === channelId) : null;
    if (channel) {
      setSelection({ type: "channel", channel });
      if (threadRootId) {
        // wait until ChannelChat mounts/messages load, then dispatch
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("navigate-to-channel", { detail: { channelId, threadRootId } }));
        }, 250);
      }
    } else if (agentId) {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) setSelection({ type: "agent", id: agent.id });
    } else if (channelId) {
      // channel not yet in list — let global handler resolve once channels load
      window.dispatchEvent(new CustomEvent("navigate-to-channel", { detail: { channelId, threadRootId } }));
    }

    void markAsRead(notif.id);
  }, [channels, agents, markAsRead]);


  const [dmFavorites, setDmFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("dnos:dm:favorites");
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
  });
  const toggleDmFavorite = useCallback((id: string) => {
    setDmFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("dnos:dm:favorites", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!dmChannelIdsKey) return;
    let cancelled = false;
    const dmIds = dmChannelIdsKey.split(",");
    (async () => {
      const { data } = await supabase
        .from("channel_messages")
        .select("channel_id, created_at")
        .in("channel_id", dmIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled || !data) return;
      const map: Record<string, string> = {};
      for (const row of data as any[]) {
        if (!map[row.channel_id]) map[row.channel_id] = row.created_at;
      }
      setDmLastActivity(map);
    })();
    return () => { cancelled = true; };
  }, [dmChannelIdsKey]);

  // Update dmLastActivity on realtime DM channel messages
  useEffect(() => {
    if (!dmChannelIdsKey) return;
    const dmIds = dmChannelIdsKey.split(",");

    // Um tópico por DM, em vez de ouvir a tabela inteira: assim só chega o que
    // é destas conversas, e o direito de ouvir cada uma já foi conferido na
    // assinatura.
    //
    // ⚠️ O horário usado é o da CHEGADA do evento, não o `created_at` da linha
    // — o evento não a carrega. Para ordenar "conversas por atividade recente"
    // a diferença é de milissegundos e não muda a ordem; buscar a mensagem só
    // para carimbar a lista lateral não se pagaria.
    const cancelamentos = dmIds.map((id) =>
      assinar(`canal:${id}`, (_tipo, dados) => {
        if ((dados as { tabela?: string })?.tabela !== "channel_messages") return;
        setDmLastActivity((prev) => ({ ...prev, [id]: new Date().toISOString() }));
      }),
    );
    return () => { cancelamentos.forEach((c) => c()); };
  }, [dmChannelIdsKey]);

  // Unified DM list: agents + people sorted by last activity
  type DmItem =
    | { kind: "agent"; agent: typeof agents[0]; lastActivity: number }
    | { kind: "person"; person: Person; lastActivity: number };

  const unifiedDmList: DmItem[] = useMemo(() => {
    const items: DmItem[] = [];
    for (const agent of agents) {
      const lastMsg = lastMessages[agent.id];
      const ts = lastMsg ? new Date(lastMsg.created_at).getTime() : 0;
      items.push({ kind: "agent", agent, lastActivity: ts });
    }
    for (const person of people) {
      if (person.id === user?.id) continue; // hide the logged-in user from the DM list
      const chId = peerIdToChannelId[person.id];
      const ts = chId && dmLastActivity[chId] ? new Date(dmLastActivity[chId]).getTime() : 0;
      items.push({ kind: "person", person, lastActivity: ts });
    }
    items.sort((a, b) => {
      if (a.lastActivity && b.lastActivity) return b.lastActivity - a.lastActivity;
      if (a.lastActivity && !b.lastActivity) return -1;
      if (!a.lastActivity && b.lastActivity) return 1;
      const nameA = a.kind === "agent" ? a.agent.name : (a.person.full_name || a.person.email);
      const nameB = b.kind === "agent" ? b.agent.name : (b.person.full_name || b.person.email);
      return nameA.localeCompare(nameB);
    });
    return items;
  }, [agents, people, lastMessages, peerIdToChannelId, dmLastActivity, user?.id]);

  /* ── Agent DM Content (shared between mobile and desktop) ── */
  const renderAgentChat = () => (
    <div
      className={`flex-1 flex flex-col min-w-0 relative overflow-x-hidden ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-10 bg-primary/5 flex items-center justify-center pointer-events-none">
          <div className="glass-card px-6 py-4 flex items-center gap-3">
            <Paperclip className="h-6 w-6 text-primary" />
            <span className="text-sm text-foreground font-medium">Solte o arquivo aqui</span>
          </div>
        </div>
      )}

      <div className="overflow-hidden flex flex-col flex-1 min-h-0 min-w-0">
        {/* Header - compact on desktop */}
        {!isMobile && (
          <div className="aurora-glow border-b border-border/40 flex items-center justify-between gap-3 px-4 py-2.5 shrink-0">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <AgentChatAvatar sizeClass="h-8 w-8 shrink-0" ringClass={`ring-2 ring-border/50 ${isAgentWorking ? "agent-working-pulse" : ""}`.trim()} agentId={effectiveAgentId} />
              <div className="min-w-0">
                <span className="block truncate text-sm font-display font-bold text-foreground">{selectedAgent?.name ?? "Selecione um agente"}</span>
                {isAgentWorking && <p className="agent-working-fade truncate text-[11px] leading-tight text-primary">digitando...</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {showReconnecting && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500"
                  title="Reconectando ao servidor em tempo real"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  reconectando...
                </span>
              )}
              <FolderBadge />
              {conversationArtifacts.length > 0 && (
                <ArtifactsList artifacts={conversationArtifacts} onSelect={(a) => { setActiveArtifact(a); setActiveLiveArtifactId(null); }} onOpenLive={(id) => { setActiveLiveArtifactId(id); setActiveArtifact(null); }} onDelete={handleDeleteArtifact} onRename={handleRenameArtifact} />
              )}
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono text-muted-foreground border border-border/40 bg-secondary/30">{selectedAgent?.model ?? "—"}</span>
              <button onClick={handleCopyConversation} disabled={agentMessages.length === 0} className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40" title="Copiar conversa">
                {conversationCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
               <button onClick={() => setClearConfirmOpen(true)} disabled={!effectiveAgentId || isAgentWorking} className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40" title="Limpar conversa">
                <Trash2 className="h-3 w-3" />
                <span>Limpar</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile header - minimal */}
        {isMobile && (
          <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between gap-2 bg-gradient-to-r from-primary/8 via-card/80 to-accent/8 backdrop-blur-xl">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button onClick={() => navigate("/chat")} className="p-1 -ml-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors touch-target">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <AgentChatAvatar sizeClass="h-8 w-8 shrink-0" ringClass={`ring-2 ring-border/50 ${isAgentWorking ? "agent-working-pulse" : ""}`.trim()} agentId={effectiveAgentId} />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-display font-bold text-foreground">{selectedAgent?.name ?? "Agente"}</span>
                {isAgentWorking && <span className="agent-working-fade block truncate text-[11px] text-primary">digitando...</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pl-1">
              {showReconnecting && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500"
                  title="Reconectando"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                </span>
              )}
              {conversationArtifacts.length > 0 && (
                <ArtifactsList artifacts={conversationArtifacts} onSelect={(a) => { setActiveArtifact(a); setActiveLiveArtifactId(null); }} onOpenLive={(id) => { setActiveLiveArtifactId(id); setActiveArtifact(null); }} onDelete={handleDeleteArtifact} onRename={handleRenameArtifact} />
              )}
              
              <button onClick={handleCopyConversation} disabled={agentMessages.length === 0} className="p-2 rounded-full text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-40 touch-target" title="Copiar conversa">
                {conversationCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
               <button onClick={() => setClearConfirmOpen(true)} disabled={!effectiveAgentId || isAgentWorking} className="p-2 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40 touch-target">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {effectiveAgentId && (
          <ContextWindowIndicator
            agentId={effectiveAgentId}
            actions={<ModelSelector agentId={toCanonicalAgentId(effectiveAgentId)} />}
          />
        )}

        {pendingAgentTask && (
          <div className="mx-3 mt-2 md:mx-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground backdrop-blur-sm">
            <RotateCcw className="h-4 w-4 shrink-0 text-primary mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Task em andamento: <span className="text-foreground/90">"{pendingAgentTask.title}"</span>
              </div>
              <div className="text-muted-foreground">
                O agente vai retomar antes de responder.
              </div>
            </div>
            <button
              type="button"
              onClick={dismissPendingTask}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors"
            >
              Dispensar
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleAgentMessagesScroll}
          onPointerDownCapture={handleMessageSelectionPointerDown}
          className="mobile-scroll-region flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4 space-y-3"
        >
          {hasMoreByAgent[effectiveAgentId] && (
            <div className="flex justify-center pb-2">
              <button onClick={handleLoadMore} disabled={loadingMore} className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40 touch-target">
                {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {loadingMore ? "Carregando..." : "Carregar anteriores"}
              </button>
            </div>
          )}
          {agentMessages.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {agents.length > 0 ? "Envie uma mensagem para iniciar" : "Nenhum agente disponível"}
            </div>
          )}
          <AgentMessageList
            messages={agentMessages}
            isMobile={isMobile}
            isAgentWorking={isAgentWorking}
            ttsPlaying={ttsPlaying}
            effectiveAgentId={effectiveAgentId}
            agentName={selectedAgent?.name ?? "Agente"}
            userAvatarUrl={profile?.avatar_url ?? null}
            userName={profile?.full_name ?? null}
            onSetLightboxSrc={setLightboxSrc}
            onSetActiveArtifact={(a) => { setActiveArtifact(a); if (a) setActiveLiveArtifactId(null); }}
            onOpenLiveArtifact={(id) => { setActiveLiveArtifactId(id); setActiveArtifact(null); }}
            onRetry={handleRetry}
            onTtsToggle={handleTtsToggle}
            activitiesByMessageId={finalActivitiesByMessageId}
          />

          {isAgentWorking && finalTrailingActivities.length > 0 && (
            <AgentActivityBucketCard
              activities={finalTrailingActivities}
              agentId={effectiveAgentId}
              agentName={selectedAgent?.name}
              taskActive={isAgentWorking}
              initialCollapsed
            />
          )}
          <StreamingIndicator streamingText={streamingText} isAgentWorking={isAgentWorking} isMobile={isMobile} agentId={effectiveAgentId} />
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div
          className={`mobile-chat-composer border-t border-border/30 bg-card/70 p-3 backdrop-blur-xl md:p-4 ${isMobile ? "pb-2" : ""}`}
          style={isMobile ? {
            paddingBottom: isKeyboardOpen
              ? `calc(max(env(safe-area-inset-bottom, 0px), 12px) + 8px)`
              : `calc(3.5rem + max(env(safe-area-inset-bottom, 0px), 16px) + 12px)`,
          } : undefined}
        >
          <StagedPreview items={media.staged} onRemove={media.removeStaged} />
          <div className={`glass-input flex gap-2 px-3 py-1.5 ${isMobile ? "items-end" : "items-center"}`}>
            {/* Left tools */}
            <div className="flex h-8 items-center gap-0.5 shrink-0">
              <button onClick={media.pickFile} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors touch-target rounded-full hover:bg-secondary/30" title="Anexar arquivo">
                <Paperclip className="h-4 w-4" />
              </button>
              <FolderButton iconClassName="h-4 w-4" />
            </div>

            {/* Center: textarea */}
            <div className="flex flex-1 min-w-0 items-center">
                <textarea
                  ref={inputRef}
                  value={draftValue}
                  onChange={handleTextareaChange}
                  onFocus={handleTextareaFocus}
                  onClick={handleTextareaClick}
                  onKeyDown={handleTextareaKeyDown}
                  onPaste={handlePaste}
                  placeholder={isAgentWorking ? "Agente trabalhando..." : "Pergunte qualquer coisa..."}
                  rows={1}
                  className="w-full bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none resize-none overflow-y-auto overflow-x-hidden break-words [overflow-wrap:anywhere] py-1.5"
                  style={{ minHeight: "32px" }}
                  
                />
            </div>

            {/* Right: mic + send */}
            <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={async () => { try { const s = await audioRecorder.start(); if (s) audioLevel.start(s); } catch (e) { console.error("Audio start failed:", e); } }} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors" title="Falar para transcrever">
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    onClick={isAgentWorking && !inputLocalRef.current.trim() && media.staged.length === 0 ? handleStopAgentResponse : handleSend}
                    disabled={!effectiveAgentId || uploading || (!inputLocalRef.current.trim() && media.staged.length === 0 && !isAgentWorking)}
                    className="btn-send-gradient flex h-10 w-10 items-center justify-center"
                    title={isAgentWorking && !inputLocalRef.current.trim() && media.staged.length === 0 ? "Interromper resposta" : "Enviar mensagem"}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : isAgentWorking && !inputLocalRef.current.trim() && media.staged.length === 0 ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  </button>
            </div>
          </div>
        </div>
      </div>

      {/* Audio recording fullscreen overlay */}
      {(audioRecorder.isRecording || audioRecorder.isProcessing) && (
        <AudioRecordingOverlay
          bars={audioLevel.bars}
          duration={audioRecorder.duration}
          isProcessing={audioRecorder.isProcessing}
          onCancel={handleAudioCancel}
          onTranscribe={handleAudioTranscribe}
          
        />
      )}
    </div>
  );

  // Shared list for the "Não Lidas" tab (mobile + desktop)
  const renderUnreadsList = () => {
    const unread = [...notifications].filter((n) => !n.read);

    // Agent-only unreads (in-memory tracker) that don't already have a
    // matching DB notification — otherwise the global badge counts them
    // but they never appear in the list, leaving a "ghost" unread.
    const dbCoveredAgentIds = new Set<string>();
    for (const n of unread) {
      if (n.agent_id) dbCoveredAgentIds.add(n.agent_id);
      if (n.channel_id) {
        for (const agent of agents) {
          if (getAgentIdAliases(agent.id).some((a) => agentDmChannelMap[a] === n.channel_id)) {
            dbCoveredAgentIds.add(agent.id);
          }
        }
      }
    }
    const orphanAgentUnreads = agentUnreadIdsForDm.filter((id) => !dbCoveredAgentIds.has(id));

    if (unread.length === 0 && orphanAgentUnreads.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center px-4">
          <div className="h-10 w-10 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
            <Bell className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Tudo em dia!</p>
          <p className="text-xs text-muted-foreground mt-1">Você não tem mensagens não lidas.</p>
        </div>
      );
    }

    // Group by main-chat vs thread. Threads always show as their own row (one per thread root).
    // Multiple unread messages in the same main chat collapse to a single row with a counter.
    const groups = new Map<string, { items: any[]; isThread: boolean }>();
    for (const n of unread) {
      const scope = n.channel_id || n.agent_id || "unknown";
      const isThread = !!n.message_id;
      const key = isThread ? `thread:${scope}:${n.message_id}` : `main:${scope}`;
      const g = groups.get(key);
      if (g) g.items.push(n);
      else groups.set(key, { items: [n], isThread });
    }

    // Sort each group's items ascending (oldest first → click opens the first unread)
    // and the group list descending by most recent activity.
    const groupList = Array.from(groups.values()).map((g) => {
      const items = g.items.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return { ...g, items, latestAt: items[items.length - 1].created_at };
    });
    groupList.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));

    return (
      <div className="divide-y divide-border/40">
        {groupList.map((g) => {
          const first = g.items[0]; // oldest unread — opens first
          const latest = g.items[g.items.length - 1];
          const count = g.items.length;
          const ch = first.channel_id ? channels.find((c) => c.id === first.channel_id) : null;
          const agentId = first.agent_id || null;
          const agent = agentId ? agents.find((a) => a.id === agentId) : null;
          const isDm = !!agent || (ch && ch.type === "dm");
          const contextLabel = agent
            ? `DM • ${agent.name}`
            : ch
              ? (ch.type === "dm" ? `DM • ${dmPeers[ch.id]?.peerName || ch.name}` : `#${ch.name}`)
              : "Conversa";
          const title = count > 1 && !g.isThread
            ? (agent?.name || (ch?.type === "dm" ? (dmPeers[ch.id]?.peerName || ch.name) : ch?.name) || first.author_name)
            : first.author_name;
          return (
            <button
              key={(g.isThread ? "t:" : "m:") + (first.channel_id || first.agent_id) + ":" + (first.message_id || "")}
              onClick={() => openNotification(first)}
              className="w-full text-left px-3 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-full bg-secondary flex items-center justify-center">
                  {isDm ? <User className="h-4 w-4 text-muted-foreground" /> : <Hash className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate">{title}</span>
                      {count > 1 && (
                        <span className="shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 leading-none">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{getRelativeTime(latest.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {g.isThread && (
                      <span className="rounded-full bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5">Thread</span>
                    )}
                    <span className="text-[11px] text-muted-foreground truncate">{contextLabel}</span>
                  </div>
                  {latest.content_preview && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">
                      {count > 1 && !g.isThread ? `${latest.author_name}: ` : ""}{latest.content_preview}
                    </p>
                  )}
                </div>
                <span className="h-2 w-2 mt-2 rounded-full bg-primary shrink-0" />
              </div>
            </button>
          );
        })}
        {orphanAgentUnreads.map((agentId) => {
          const agent = agents.find((a) => a.id === agentId);
          const name = agent?.name || agentId;
          return (
            <button
              key={`orphan-agent:${agentId}`}
              onClick={() => {
                clearUnreadAgent(agentId);
                if (agent) setSelection({ type: "agent", id: agent.id });
              }}
              className="w-full text-left px-3 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-full bg-secondary flex items-center justify-center">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">{name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-muted-foreground truncate">DM • {name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">Nova resposta do agente</p>
                </div>
                <span className="h-2 w-2 mt-2 rounded-full bg-primary shrink-0" />
              </div>
            </button>
          );
        })}
      </div>
    );
  };



  /* ── MOBILE LAYOUT ── */
  if (isMobile) {
    const showList = !selection;

    return (
      <div
        className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
        style={isKeyboardOpen ? { paddingBottom: `${bottomOffset}px` } : undefined}
      >

        {showList ? (
          /* ── Mobile List View (Slack-like sidebar) ── */
          <div className="flex flex-col flex-1 min-h-0">
            <div className="border-b border-border/30 shrink-0 px-3 pt-3 pb-2 bg-gradient-to-b from-primary/5 to-transparent">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-display font-bold text-foreground">Chat</h2>
                {sidebarTab === "channels" && (
                  <button onClick={() => setCreateOpen(true)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors touch-target" title="Criar canal">
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </div>
              <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as "channels" | "dms" | "unreads")} className="w-full">
                <TabsList className="w-full bg-transparent border-b border-border/30 rounded-none p-0 h-auto justify-start gap-6">
                  <TabsTrigger value="dms" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                    DMs
                    {dmUnreadCount > 0 && (
                      <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                        {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="channels" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                    Canais
                    {channelUnreadCount > 0 && (
                      <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                        {channelUnreadCount > 99 ? "99+" : channelUnreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="unreads" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                    Não Lidas
                    {unreadCount > 0 && (
                      <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>


            <ScrollArea className="flex-1">
              <div className="px-3 py-2 pb-20">
                {sidebarTab === "unreads" ? (
                  renderUnreadsList()
                ) : sidebarTab === "channels" ? (
                  <>
                    {publicChannels.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-display px-2 mb-1">Públicos</p>
                        {publicChannels.map((ch) => (
                          <ChannelSidebarItem key={ch.id} channel={ch} active={false} onClick={() => setSelection({ type: "channel", channel: ch })} unreadCount={unreadByChannel[ch.id] || 0} />
                        ))}
                      </div>
                    )}
                    {privateChannels.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-display px-2 mb-1">Privados</p>
                        {privateChannels.map((ch) => (
                          <ChannelSidebarItem key={ch.id} channel={ch} active={false} onClick={() => setSelection({ type: "channel", channel: ch })} unreadCount={unreadByChannel[ch.id] || 0} />
                        ))}
                      </div>
                    )}
                    {channelsLoading && channels.length === 0 && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mb-2 divide-y divide-border/40">
                  {loading && agents.length === 0 && (
                    <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                  )}
                  {error && (
                    <div className="p-2 text-xs text-destructive flex items-center gap-1"><WifiOff className="h-3 w-3" /> {error}</div>
                  )}
                  {unifiedDmList.map((item) => {
                    if (item.kind === "agent") {
                      const agent = item.agent;
                      const unread = agentUnreadTotal(agent.id);
                      const hasUnread = unread > 0;
                      const lastMsg = lastMessages[agent.id];
                      return (
                        <button key={`agent-${agent.id}`} onClick={() => setSelection({ type: "agent", id: agent.id })}
                          className="w-full text-left px-2 py-3 transition-colors duration-150 hover:bg-secondary/40 active:bg-secondary/60 touch-target">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative h-12 w-12 shrink-0">
                              <AgentListAvatar sizeClass="h-12 w-12 rounded-full" agentId={agent.id} />
                              <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background">
                                <Bot className="h-3 w-3" />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[15px] truncate ${hasUnread ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>{agent.name}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {lastMsg && (
                                    <span className={`text-[11px] ${hasUnread ? "text-primary font-semibold" : "text-muted-foreground"}`}>{getRelativeTime(lastMsg.created_at)}</span>
                                  )}
                                  {hasUnread && (
                                    <span className="flex items-center justify-center h-[18px] min-w-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                                      {unread > 99 ? "99+" : unread}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    } else {
                      const person = item.person;
                      const existingChannelId = peerIdToChannelId[person.id];
                      const unread = existingChannelId ? (unreadByChannel[existingChannelId] || 0) : 0;
                      const existingChannel = existingChannelId ? channels.find((c) => c.id === existingChannelId) : null;
                      const hasUnread = unread > 0;
                      const lastAct = existingChannelId ? dmLastActivity[existingChannelId] : null;
                      const isHumanTyping = existingChannelId ? (typingByDmChannel[existingChannelId]?.length ?? 0) > 0 : false;
                      return (
                        <button key={`person-${person.id}`} onClick={() => { if (existingChannel) setSelection({ type: "channel", channel: existingChannel }); else handleOpenPersonDm(person); }}
                          disabled={openingDm === person.id}
                          className="w-full text-left px-2 py-3 transition-colors duration-150 hover:bg-secondary/40 active:bg-secondary/60 touch-target disabled:opacity-50">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative h-12 w-12 shrink-0">
                              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center overflow-hidden ring-1 ring-border/50">
                                {person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : <span className="text-sm font-bold text-foreground">{(person.full_name || person.email).charAt(0).toUpperCase()}</span>}
                              </div>
                              <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-secondary text-foreground flex items-center justify-center border-2 border-background">
                                <User className="h-3 w-3" />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[15px] truncate ${hasUnread ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>{person.full_name || person.email}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isHumanTyping ? (
                                    <SidebarTypingDots />
                                  ) : lastAct && (
                                    <span className={`text-[11px] ${hasUnread ? "text-primary font-semibold" : "text-muted-foreground"}`}>{getRelativeTime(lastAct)}</span>
                                  )}
                                  {openingDm === person.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                  {hasUnread && (
                                    <span className="flex items-center justify-center h-[18px] min-w-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                                      {unread > 99 ? "99+" : unread}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    }
                  })}
                </div>
                )}

              </div>
            </ScrollArea>
          </div>
        ) : (
          /* ── Mobile Chat View (fullscreen with back) ── */
          <>
            {selection?.type === "channel" ? (
              <ChannelChat channel={selection.channel} onChannelUpdated={refetchChannels} onChannelDeleted={() => { navigate("/chat"); refetchChannels(); }} onBack={() => navigate("/chat")} dmPeerName={selection.channel.type === "dm" ? dmPeers[selection.channel.id]?.peerName : undefined} />
            ) : selection?.type === "agent" ? (
              <>
                {renderAgentChat()}
                {activeArtifact && (
                  <div className="h-[50vh] border-t border-border">
                    <ArtifactPanel type={activeArtifact.type} code={activeArtifact.code} onClose={() => setActiveArtifact(null)} />
                  </div>
                )}
                {activeLiveArtifactId && (
                  <div className="h-[50vh] border-t border-border">
                    <LiveArtifactViewer artifactId={activeLiveArtifactId} onClose={() => setActiveLiveArtifactId(null)} />
                  </div>
                )}
              </>
            ) : null}
          </>
        )}

        <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreateChannel} />
        <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>⚠️ Atenção: ação irreversível</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block font-semibold text-destructive">Todo o histórico desta conversa será apagado permanentemente.</span>
                <span className="block">As mensagens não poderão ser recuperadas após a exclusão. O agente começará uma nova conversa do zero.</span>
                <span className="block">Tem certeza que deseja continuar?</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmClearConversation}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Sim, limpar conversa
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={!!lightboxSrc} onOpenChange={() => setLightboxSrc(null)}>
          <DialogContent className="max-w-3xl p-2 bg-transparent border-none shadow-none">
            {lightboxSrc && <img src={lightboxSrc} alt="Expanded" className="w-full h-auto rounded-lg max-h-[80vh] object-contain" />}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  /* ── DESKTOP LAYOUT ── */
  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden gap-3 p-3">
      {/* ═══ Unified Sidebar ═══ */}
      <div className="w-[260px] flex flex-col shrink-0 bg-card/60 backdrop-blur-xl overflow-hidden rounded-2xl border border-border/40 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]">
        <div className="p-3 border-b border-border/30 space-y-2 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-display font-semibold uppercase tracking-wider text-muted-foreground">Chat</h2>
            {sidebarTab === "channels" && (
              <button onClick={() => setCreateOpen(true)} className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Criar canal">
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as "channels" | "dms" | "unreads")} className="w-full">
            <TabsList className="w-full bg-transparent border-b border-border/30 rounded-none p-0 h-auto justify-start gap-6">
              <TabsTrigger value="dms" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                DMs
                {dmUnreadCount > 0 && (
                  <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                    {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="channels" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                Canais
                {channelUnreadCount > 0 && (
                  <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                    {channelUnreadCount > 99 ? "99+" : channelUnreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="unreads" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-xs font-medium text-muted-foreground pb-2 pt-1 px-1 gap-1.5">
                Não Lidas
                {unreadCount > 0 && (
                  <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none px-1">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!w-full">
          <div className="px-2 py-1.5 w-full min-w-0">
            {sidebarTab === "unreads" ? (
              renderUnreadsList()
            ) : sidebarTab === "channels" ? (

              <>
                {publicChannels.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-display px-2 mb-1">Públicos</p>
                    {publicChannels.map((ch) => (
                      <ChannelSidebarItem key={ch.id} channel={ch} active={selection?.type === "channel" && selection.channel.id === ch.id} onClick={() => setSelection({ type: "channel", channel: ch })} unreadCount={unreadByChannel[ch.id] || 0} />
                    ))}
                  </div>
                )}
                {privateChannels.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-display px-2 mb-1">Privados</p>
                    {privateChannels.map((ch) => (
                      <ChannelSidebarItem key={ch.id} channel={ch} active={selection?.type === "channel" && selection.channel.id === ch.id} onClick={() => setSelection({ type: "channel", channel: ch })} unreadCount={unreadByChannel[ch.id] || 0} />
                    ))}
                  </div>
                )}
                {channelsLoading && channels.length === 0 && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            ) : (
              <div className="mb-2">


                {loading && agents.length === 0 && (
                  <div className="flex items-center justify-center py-4"><Loader2 className="h-3 w-3 animate-spin text-primary" /></div>
                )}
                {error && (
                  <div className="p-2 text-xs text-destructive flex items-center gap-1"><WifiOff className="h-3 w-3" /> {error}</div>
                )}
                {unifiedDmList
                  .filter((item) => {
                    const id = item.kind === "agent" ? item.agent.id : item.person.id;
                    if (dmFilter === "favorites") return dmFavorites.has(id);
                    if (dmFilter === "unread") {
                      const chId = item.kind === "agent" ? agentDmChannelMap[id] : peerIdToChannelId[id];
                      return chId ? (unreadByChannel[chId] || 0) > 0 : false;
                    }
                    return true;
                  })
                  .map((item) => {
                  if (item.kind === "agent") {
                    const agent = item.agent;
                    const isActive = selection?.type === "agent" && selection.id === agent.id;
                    const agentDmChId = agentDmChannelMap[agent.id];
                    const hasUnread = !isActive && (agentDmChId ? ((unreadByChannel[agentDmChId] || 0) > 0) : false);
                    const agentIsWorking = Boolean(realtimePendingByAgent[agent.id]) || pendingAgentIds.has(agent.id) || (isActive && bgPending);
                    const lastMsg = lastMessages[agent.id];
                    const isFav = dmFavorites.has(agent.id);
                    return (
                      <div key={`agent-${agent.id}`} className="group relative">
                        <button onClick={() => setSelection({ type: "agent", id: agent.id })}
                          className={`w-full max-w-full text-left px-2 py-2 rounded-xl mb-0.5 transition-all duration-200 overflow-hidden box-border ${isActive ? "bg-primary/12 backdrop-blur-md shadow-[0_0_12px_-4px_hsl(var(--primary)/0.3)] ring-1 ring-primary/20" : "hover:bg-card/60 hover:backdrop-blur-md"}`}>
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="relative h-9 w-9 shrink-0 mt-0.5">
                              <AgentListAvatar sizeClass="h-9 w-9" agentId={agent.id} />
                              <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card shadow-sm ${agent.status === "active" ? "bg-success animate-pulse" : agent.status === "recent" ? "bg-warning" : "bg-muted-foreground"}`} />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center justify-between gap-1">
                                <span className={`text-sm truncate ${hasUnread ? "font-bold text-foreground" : "font-medium text-foreground"}`}>{agent.name}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {lastMsg && <span className="text-[10px] text-muted-foreground/60">{getRelativeTime(lastMsg.created_at)}</span>}
                                  <AgentListIndicator working={agentIsWorking} />
                                </div>
                              </div>
                              {hasUnread && (
                                <div className="flex justify-end mt-0.5">
                                  <span className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold shrink-0">1</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  } else {
                    const person = item.person;
                    const existingChannelId = peerIdToChannelId[person.id];
                    const unread = existingChannelId ? (unreadByChannel[existingChannelId] || 0) : 0;
                    const existingChannel = existingChannelId ? channels.find((c) => c.id === existingChannelId) : null;
                    const isActive = existingChannel && selection?.type === "channel" && selection.channel.id === existingChannel.id;
                    const lastAct = existingChannelId ? dmLastActivity[existingChannelId] : null;
                    const isHumanTyping = existingChannelId ? (typingByDmChannel[existingChannelId]?.length ?? 0) > 0 : false;
                    const isFav = dmFavorites.has(person.id);
                    return (
                      <div key={`person-${person.id}`} className="group relative">
                        <button onClick={() => { if (existingChannel) setSelection({ type: "channel", channel: existingChannel }); else handleOpenPersonDm(person); }}
                          disabled={openingDm === person.id}
                          className={`w-full max-w-full text-left px-2 py-2 rounded-xl mb-0.5 transition-all duration-200 overflow-hidden box-border disabled:opacity-50 ${isActive ? "bg-primary/12 backdrop-blur-md ring-1 ring-primary/20" : "hover:bg-card/60 hover:backdrop-blur-md"}`}>
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="relative h-9 w-9 shrink-0 mt-0.5">
                              <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center overflow-hidden">
                                {person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : <span className="text-[11px] font-bold text-foreground">{(person.full_name || person.email).charAt(0).toUpperCase()}</span>}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${person.presence === "online" ? "bg-success" : person.presence === "away" ? "bg-warning" : "bg-muted-foreground"}`} title={person.presence === "online" ? "Online" : person.presence === "away" ? "Ausente" : "Offline"} />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className={`text-sm truncate ${unread > 0 ? "font-bold text-foreground" : "font-medium text-foreground"}`}>{person.full_name || person.email}</span>
                                  {person.custom_status_emoji && (
                                    <span
                                      title={person.custom_status ? `${person.custom_status_emoji} ${person.custom_status}` : undefined}
                                      aria-label={person.custom_status ?? undefined}
                                      className="text-sm leading-none shrink-0"
                                    >
                                      {person.custom_status_emoji}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isHumanTyping ? <SidebarTypingDots /> : lastAct && <span className="text-[10px] text-muted-foreground/60">{getRelativeTime(lastAct)}</span>}
                                  {openingDm === person.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
                                </div>
                              </div>
                              {person.custom_status && (
                                <div className="text-[11px] text-foreground/75 truncate mt-0.5 font-medium">
                                  {person.custom_status}
                                </div>
                              )}
                              {unread > 0 && (
                                <div className="flex justify-end mt-0.5">
                                  <span className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold shrink-0">{unread}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  }
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ═══ Right pane ═══ */}
      {selection?.type === "channel" ? (
        <div className="flex flex-1 min-w-0 h-full overflow-hidden rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]">
          <ChannelChat channel={selection.channel} onChannelUpdated={refetchChannels} onChannelDeleted={() => { navigate("/chat"); refetchChannels(); }} dmPeerName={selection.channel.type === "dm" ? dmPeers[selection.channel.id]?.peerName : undefined} />
        </div>
      ) : selection?.type === "agent" ? (
        <div className="flex flex-1 min-w-0 h-full overflow-hidden gap-3">
          <div className={`flex flex-col min-w-0 h-full overflow-hidden rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] ${activeArtifact || activeLiveArtifactId ? "w-1/2" : "flex-1"}`}>
            {renderAgentChat()}
          </div>
          {activeArtifact && (
            <div className="w-1/2 min-w-0 h-full overflow-hidden rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]">
              <ArtifactPanel type={activeArtifact.type} code={activeArtifact.code} onClose={() => setActiveArtifact(null)} />
            </div>
          )}
          {activeLiveArtifactId && !activeArtifact && (
            <div className="w-1/2 min-w-0 h-full overflow-hidden rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]">
              <LiveArtifactViewer artifactId={activeLiveArtifactId} onClose={() => setActiveLiveArtifactId(null)} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl">
          Selecione um canal ou agente para começar
        </div>
      )}

      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreateChannel} />
      <Dialog open={!!lightboxSrc} onOpenChange={() => setLightboxSrc(null)}>
        <DialogContent className="max-w-3xl p-2 bg-transparent border-none shadow-none">
          {lightboxSrc && <img src={lightboxSrc} alt="Expanded" className="w-full h-auto rounded-lg max-h-[80vh] object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Sidebar Channel Item ─────────────────────────────── */

function ChannelSidebarItem({ channel, active, onClick, unreadCount = 0 }: { channel: Channel; active: boolean; onClick: () => void; unreadCount?: number }) {
  const hasUnread = unreadCount > 0 && !active;
  return (
    <button
      onClick={onClick}
      className={`relative w-full text-left pl-3 pr-3 py-2.5 transition-colors duration-150 touch-target ${
        active
          ? "bg-primary/10"
          : hasUnread
            ? "bg-primary/[0.06] hover:bg-primary/10"
            : "hover:bg-secondary/40 active:bg-secondary/60"
      }`}
    >
      {hasUnread && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-3/5 w-[3px] rounded-r-full bg-primary" />
      )}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`relative h-10 w-10 shrink-0 rounded-full flex items-center justify-center ring-1 ${
          active
            ? "bg-primary/15 text-primary ring-primary/30"
            : hasUnread
              ? "bg-primary/10 text-primary ring-primary/30"
              : "bg-secondary text-muted-foreground ring-border/50"
        }`}>
          <ChannelIcon type={channel.type} />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-[15px] truncate flex-1 min-w-0 ${
            active
              ? "font-bold text-primary"
              : hasUnread
                ? "font-bold text-foreground"
                : "font-medium text-muted-foreground"
          }`}>{channel.name}</span>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold shrink-0 shadow-sm">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

