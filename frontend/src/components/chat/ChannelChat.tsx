import { api } from "@/lib/api";
import { Fragment, memo, useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from "react";
import { enviarArquivo, urlPublica } from "@/lib/storage";
import { useIsMobile } from "@/hooks/use-mobile";
import { useChannelMessages, useChannelMembers, Channel, ChannelMessage, ChannelAttachment } from "@/hooks/use-channels";
import { usePeople } from "@/hooks/use-people";
import { useMessageReactions } from "@/hooks/use-message-reactions";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { useAuthContext } from "@/contexts/auth-context";
import { startChannelAgentReplies, getAgentDisplayName } from "@/lib/channel-agents";
import { getPendingAgentsForChannel, subscribeToChannelAgentPending } from "@/lib/channel-agent-pending";
import { useAgentAvatar } from "@/hooks/use-agent-avatar";
import { normalizeAgentId } from "@/lib/active-agents";
import { useChatMedia } from "@/hooks/use-chat-media";
import { getAudioFileExtension, useAudioRecorder } from "@/hooks/use-audio-recorder";
import { uploadFileToStorage, formatFileSize, isImageFile } from "@/lib/file-upload";
import FileAttachmentCard from "./FileAttachmentCard";
import AudioMessagePlayer from "./AudioMessagePlayer";
import CollapsibleTranscription from "./CollapsibleTranscription";
import CopyMessageButton from "./CopyMessageButton";
import MarkUnreadButton from "./MarkUnreadButton";
import { useTypingIndicator, formatTypingLabel } from "@/hooks/use-typing-indicator";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Hash, Lock, MessageCircle, MessageSquare, Send, Users, Bot, Mic, X, Loader2, Pencil, MoreHorizontal, Smile, Trash2, Check, Paperclip, FileText, ChevronDown, ChevronUp, Bold, Italic, Strikethrough, Link as LinkIcon, List, ListOrdered, Code, AtSign, BellDot, Plus, Type } from "lucide-react";
import { format } from "date-fns";
import ChannelMembersPanel from "./ChannelMembersPanel";
import ChannelFilesPanel from "./ChannelFilesPanel";
import { useLocation } from "react-router-dom";
import EditChannelDialog from "./EditChannelDialog";
import MentionPopup, { MentionOption } from "./MentionPopup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover";
import EmojiPickerReact, { Theme as EmojiTheme } from "emoji-picker-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import ThreadPanel from "./ThreadPanel";
import { useThreadCounts, getThreadLastViewed, markThreadViewed, type ThreadMeta } from "@/hooks/use-channel-threads";
import { useDmReads } from "@/hooks/use-dm-reads";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import RichComposer, { type RichComposerHandle, type RichFormat } from "./RichComposer";

import ImageLightbox from "./ImageLightbox";
import GifPicker, { type GifResult } from "./GifPicker";
import FileAttachmentPreviewDialog from "./FileAttachmentPreviewDialog";
import { hasEveryoneMention, notifyChannelRecipients } from "@/lib/channel-notifications";
import { MarkdownMessageContent, PlainMessageContent } from "./MessageContent";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { UserStatusPicker } from "@/components/UserStatusPicker";
import { UserStatusBadge } from "@/components/UserStatusBadge";
import { formatStatusAge } from "@/lib/user-status";

import DateDivider from "@/components/chat/DateDivider";
import { useChannelAgentActivity } from "@/hooks/use-channel-agent-activity";
import StreamingActivityIndicator from "@/components/chat/StreamingActivityIndicator";

function ChannelStreamingActivity({ agentIds }: { agentIds: string[] }) {
  const firstAgent = agentIds[0] ?? "";
  return <StreamingActivityIndicator agentId={firstAgent} isWorking={agentIds.length > 0} hasStreamingText={false} />;
}
import { shouldShowDateDivider } from "@/lib/chat-date-groups";

function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-1 ${className}`} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-primary/70"
          style={{ animation: "typing-dot 1.15s ease-in-out infinite", animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

function HumanTypingIndicator({ label }: { label: string }) {
  return (
    <div className="-mt-1 flex items-center gap-2 pl-12 text-xs italic text-muted-foreground">
      <TypingDots />
      <span className="truncate">{label}</span>
    </div>
  );
}

function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  return <Bot className={className ?? "h-4 w-4"} />;
}

export function ChannelIcon({ type }: { type: Channel["type"] }) {
  if (type === "private") return <Lock className="h-4 w-4 shrink-0" />;
  if (type === "dm") return <MessageCircle className="h-4 w-4 shrink-0" />;
  return <Hash className="h-4 w-4 shrink-0" />;
}


function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Emoji Picker ───────────────────────────────────────────
function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { resolvedTheme } = useTheme();

  return (
    <div
      className="w-[320px] rounded-xl border border-border bg-popover shadow-xl"
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <EmojiPickerReact
        onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
        width={320}
        height={380}
        searchDisabled={false}
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        theme={resolvedTheme === "light" ? EmojiTheme.LIGHT : EmojiTheme.DARK}
      />
    </div>
  );
}

// ─── Reactions display ──────────────────────────────────────
function ReactionsBar({
  reactions,
  currentUserId,
  onToggle,
  userNameById,
}: {
  reactions: { emoji: string; user_ids: string[]; count: number }[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
  userNameById?: Map<string, string>;
}) {
  if (!reactions || reactions.length === 0) return null;
  const resolveName = (uid: string) => {
    if (uid === currentUserId) return "Você";
    return userNameById?.get(uid) || "Alguém";
  };
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap gap-1 mt-1">
        {reactions.map((r) => {
          const isOwn = r.user_ids.includes(currentUserId);
          const names = r.user_ids.map(resolveName);
          const tooltipText = `${names.join(", ")} reagiu com ${r.emoji}`;
          return (
            <Tooltip key={r.emoji}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onToggle(r.emoji)}
                  className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border transition-all duration-200 hover:scale-105 ${
                    isOwn
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-secondary/50 border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="font-medium">{r.count}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                {tooltipText}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

// ─── Message Bubble ─────────────────────────────────────────
const MessageBubble = memo(function MessageBubble({
  msg,
  currentUserId,
  msgReactions,
  onToggleReaction,
  onEdit,
  onDelete,
  onReply,
  onMarkUnread,
  onMarkRead,
  onImageClick,
  onAttachmentPreview,
  threadMeta,
  threadHasUnread,
  isMarkedUnread,
  userNameById,
  authorStatus,
}: {
  msg: ChannelMessage;
  currentUserId: string;
  msgReactions: { emoji: string; user_ids: string[]; count: number }[];
  onToggleReaction: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onMarkUnread: () => Promise<boolean> | boolean;
  onMarkRead?: () => void;
  onImageClick: (src: string, alt: string) => void;
  onAttachmentPreview: (attachment: { name: string; url: string; size?: number; mimeType?: string }) => void;
  threadMeta: ThreadMeta | null;
  threadHasUnread: boolean;
  isMarkedUnread?: boolean;
  userNameById?: Map<string, string>;
  authorStatus?: { emoji: string; label: string; setAt?: string | null } | null;
}) {
  const isAgent = msg.author_type === "agent";
  const agentIdForAvatar = isAgent ? normalizeAgentId(msg.author_id || "") : "";
  const { avatar: agentAvatar } = useAgentAvatar(agentIdForAvatar);
  const hasAudio = !!msg.audio_url;
  const hasMention = msg.content.includes("@");
  const mentionsEveryone = hasEveryoneMention(msg.content);
  const isOwn = msg.author_id === currentUserId;
  const isDeleted = !!msg.deleted_at;
  const isEdited = !!msg.edited_at;
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const closeEmojiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback(() => {
    const timer = setTimeout(() => setShowMobileMenu(true), 500);
    setLongPressTimer(timer);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) clearTimeout(longPressTimer);
    setLongPressTimer(null);
  }, [longPressTimer]);

  const clearCloseEmojiTimer = useCallback(() => {
    if (closeEmojiTimerRef.current) {
      clearTimeout(closeEmojiTimerRef.current);
      closeEmojiTimerRef.current = null;
    }
  }, []);

  const scheduleCloseEmoji = useCallback(() => {
    clearCloseEmojiTimer();
    closeEmojiTimerRef.current = setTimeout(() => setEmojiOpen(false), 120);
  }, [clearCloseEmojiTimer]);

  useEffect(() => () => clearCloseEmojiTimer(), [clearCloseEmojiTimer]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [actionBarPlacement, setActionBarPlacement] = useState<"side" | "meta">("side");

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const bubble = bubbleRef.current;
    if (!wrapper || !bubble) return;

    let frame = 0;
    const estimatedActionWidth = isOwn ? 204 : 148;
    const updatePlacement = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const wrapperRect = wrapper.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const sideSpace = isOwn ? bubbleRect.left - wrapperRect.left : wrapperRect.right - bubbleRect.right;
        const nextPlacement = bubbleRect.width > 360 || sideSpace < estimatedActionWidth + 12 ? "meta" : "side";
        setActionBarPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      });
    };

    updatePlacement();
    const resizeObserver = new ResizeObserver(updatePlacement);
    resizeObserver.observe(wrapper);
    resizeObserver.observe(bubble);
    window.addEventListener("resize", updatePlacement);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, [isOwn, msg.content, msg.attachments?.length, hasAudio]);

  // Auto-clear "marked as unread" highlight once the message is actually seen
  useEffect(() => {
    if (!isMarkedUnread || !onMarkRead) return;
    const el = wrapperRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!timer) {
              timer = setTimeout(() => {
                onMarkRead();
              }, 1500);
            }
          } else if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [isMarkedUnread, onMarkRead]);

  const bubbleClass = isAgent
    ? "rounded-2xl border border-[hsl(var(--agent-accent)/0.55)] bg-[hsl(var(--agent-accent)/0.06)] px-3.5 py-2 text-foreground/90 backdrop-blur-sm shadow-[0_0_28px_-12px_hsl(var(--agent-accent)/0.55),inset_0_0_0_1px_hsl(var(--agent-accent)/0.12)]"
    : isOwn
      ? "rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2 text-foreground backdrop-blur-sm shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
      : "rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2 text-foreground backdrop-blur-sm";

  const renderActionBar = (placement: "side" | "meta") => {
    if (msg.id.startsWith("optimistic-")) return null;
    const displayClass = showMobileMenu || emojiOpen
      ? placement === "meta" ? "inline-flex" : "flex"
      : placement === "meta" ? "hidden group-hover:inline-flex" : "hidden group-hover:flex";
    const placementClass = placement === "side"
      ? `absolute top-1/2 -translate-y-1/2 ${isOwn ? "right-full mr-1" : "left-full ml-1"}`
      : "relative align-middle";

    return (
      <div className={`${placementClass} ${displayClass} shrink-0 items-center gap-0.5 bg-popover border border-border rounded-md shadow-md p-0.5 z-30 whitespace-nowrap`}>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title="Reagir"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEmojiOpen((prev) => !prev);
              }}
            >
              <Smile className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto border-0 bg-transparent p-0 shadow-none z-50"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            avoidCollisions
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <EmojiPicker
              onSelect={(emoji) => {
                onToggleReaction(emoji);
                setEmojiOpen(false);
                setShowMobileMenu(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <button onClick={() => { onReply(); setShowMobileMenu(false); }} className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Responder na conversa">
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
        {!isDeleted && msg.content && (
          <CopyMessageButton text={msg.content} />
        )}
        <MarkUnreadButton onMark={onMarkUnread} />
        {isOwn && (
          <>
            <button onClick={() => { onEdit(); setShowMobileMenu(false); }} className="p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { onDelete(); setShowMobileMenu(false); }} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Apagar">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={wrapperRef}
      className={`flex gap-3 group relative px-3 py-1.5 -mx-3 transition-colors ${isOwn ? "flex-row-reverse" : ""} ${threadHasUnread ? "bg-primary/[0.06] border-l-4 border-primary rounded-r-md" : isMarkedUnread ? "bg-primary/[0.04] border-l-2 border-primary/50" : ""}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className={`h-9 w-9 shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/30 ${isAgent ? "rounded-md" : "rounded-full"}`}>
        {isAgent ? (
          agentAvatar ? (
            <img src={agentAvatar} alt="" className="h-9 w-9 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center bg-card">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
          )
        ) : msg.author_avatar ? (
          <img src={msg.author_avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="h-9 w-9 flex items-center justify-center bg-primary/15">
            <span className="text-sm font-bold text-primary">{msg.author_name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className={`min-w-0 flex-1 flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <>
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${isAgent ? "text-foreground" : "text-foreground"}`}>{msg.author_name}</span>
              {!isAgent && authorStatus && (
                <span title={authorStatus.label} className="text-xs leading-none" aria-label={`Status: ${authorStatus.label}`}>
                  {authorStatus.emoji}
                </span>
              )}
              {isAgent && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Agente</Badge>}
              {hasAudio && <Mic className="h-3 w-3 text-muted-foreground" />}
              <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "HH:mm")}</span>
              {actionBarPlacement === "meta" && renderActionBar("meta")}
              {isMarkedUnread && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                  <BellDot className="h-3 w-3" />
                  Não lida
                </span>
              )}
              {threadHasUnread && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-pulse" />
                  Nova resposta
                </span>
              )}
              {isEdited && !isDeleted && <span className="text-[10px] text-muted-foreground italic">(editado)</span>}
            </div>
            {!isAgent && authorStatus && (
              <span className="text-[10px] text-muted-foreground italic -mt-0.5">
                {authorStatus.label} · pode demorar a responder
              </span>
            )}
          </>
        )}

        {isDeleted ? (
          <p className="text-sm text-muted-foreground italic mt-1">Mensagem apagada</p>
        ) : (
          <div className={`relative max-w-full flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
            {mentionsEveryone && (
              <div className="mt-1.5 mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                <Users className="h-3 w-3" />
                <span>Aviso para todos</span>
              </div>
            )}

            {hasAudio && (
              <div className="mt-1.5 mb-1">
                <AudioMessagePlayer src={msg.audio_url!} />
              </div>
            )}
            <div ref={bubbleRef} className={`relative mt-1 inline-block w-fit max-w-full text-left ${bubbleClass}`}>
              {(() => {
                // Strip @todos prefix from rendered text when the "Aviso para todos" badge is already shown
                const displayContent = mentionsEveryone
                  ? msg.content.replace(/(^|\s)@todos\b[ \t]*/iu, "$1").replace(/^\s+/, "")
                  : msg.content;
                if (hasAudio) return <CollapsibleTranscription text={displayContent} />;
                if (isAgent) return <MarkdownMessageContent text={displayContent} className="" />;
                return <MarkdownMessageContent text={displayContent} highlightMentions={hasMention} className="text-sm text-foreground/90" />;
              })()}

              {actionBarPlacement === "side" && renderActionBar("side")}
            </div>

            {isOwn && (
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                <span>{format(new Date(msg.created_at), "HH:mm")}</span>
                {actionBarPlacement === "meta" && renderActionBar("meta")}
                {isEdited && !isDeleted && <span className="italic">(editado)</span>}
                {isMarkedUnread && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                    <BellDot className="h-3 w-3" />
                    Não lida
                  </span>
                )}
              </div>
            )}
            {/* Render file attachments */}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {msg.attachments.map((att, i) => {
                  if (att.mimeType?.startsWith("image/")) {
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onImageClick(att.url, att.name)}
                        className="mt-1 overflow-hidden rounded-md"
                      >
                        <img src={att.url} alt={att.name} className="max-h-48 max-w-[240px] rounded-md object-cover transition-transform hover:scale-[1.01]" />
                      </button>
                    );
                  }
                  return (
                    <FileAttachmentCard
                      key={i}
                      name={att.name}
                      url={att.url}
                      size={att.size}
                      mimeType={att.mimeType}
                      onPreview={onAttachmentPreview}
                    />
                  );
                })}
              </div>
            )}

            <ReactionsBar reactions={msgReactions} currentUserId={currentUserId} onToggle={onToggleReaction} userNameById={userNameById} />

            {threadMeta && threadMeta.count > 0 && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={onReply}
                  className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors ${
                    threadHasUnread
                      ? "border-primary bg-primary/15 text-primary hover:bg-primary/20 ring-2 ring-primary/30"
                      : "border-border/50 bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  }`}
                >
                  {threadMeta.lastAuthorAvatar ? (
                    <img src={threadMeta.lastAuthorAvatar} alt="" className="h-4 w-4 rounded-full object-cover" />
                  ) : (
                    <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold text-primary">
                      {(threadMeta.lastAuthorName || "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className={`font-semibold ${threadHasUnread ? "text-primary" : "text-foreground"}`}>
                    {threadMeta.count} {threadMeta.count === 1 ? "resposta" : "respostas"}
                  </span>
                  {threadHasUnread && (
                    <>
                      <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" aria-label="Não lidas" />
                      <span className="font-semibold">Nova</span>
                    </>
                  )}
                  <span className="text-[10px] opacity-80">
                    Última às {format(new Date(threadMeta.lastReplyAt), "HH:mm")}
                  </span>
                </button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
});

// ─── Inline Edit Bubble ─────────────────────────────────────
function EditingBubble({
  msg,
  onSave,
  onCancel,
}: {
  msg: ChannelMessage;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}) {
  const composerRef = useRef<RichComposerHandle | null>(null);
  const [value, setValue] = useState(msg.content);

  useEffect(() => {
    // Focus shortly after mount so the contentEditable is ready.
    const t = setTimeout(() => composerRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="flex gap-3">
      <div className="h-9 w-9 rounded-full shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/50">
        {msg.author_avatar ? (
          <img src={msg.author_avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="h-9 w-9 flex items-center justify-center bg-primary/20">
            <span className="text-sm font-bold text-primary">{msg.author_name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-foreground">{msg.author_name}</span>
          <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "HH:mm")}</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="glass-input flex gap-2 px-3 py-2 items-center">
            <RichComposer
              ref={composerRef}
              initialMarkdown={msg.content}
              onChange={(md) => setValue(md)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if (composerRef.current?.isInsideList()) return;
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              placeholder="Editar mensagem..."
              className="flex-1 text-sm py-1"
            />
            <Button size="sm" variant="ghost" onClick={onCancel} className="h-8 px-2 shrink-0">
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={submit} className="h-8 px-2 shrink-0" disabled={!value.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-0.5 px-2">
            {([
              { icon: Bold, format: "bold" as RichFormat, title: "Negrito (Ctrl+B)" },
              { icon: Italic, format: "italic" as RichFormat, title: "Itálico (Ctrl+I)" },
              { icon: Strikethrough, format: "strikethrough" as RichFormat, title: "Riscado" },
              { icon: List, format: "ul" as RichFormat, title: "Lista" },
              { icon: ListOrdered, format: "ol" as RichFormat, title: "Lista numerada" },
              { icon: Code, format: "code" as RichFormat, title: "Código" },
            ]).map(({ icon: Icon, format: f, title }) => (
              <button
                key={f}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  composerRef.current?.applyFormat(f);
                }}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                title={title}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                  title="Inserir emoji"
                >
                  <Smile className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 border-0 bg-transparent shadow-none w-auto" align="start" side="top">
                <EmojiPicker onSelect={(emoji) => composerRef.current?.insertText(emoji)} />
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-[10px] text-muted-foreground px-2">Escape para cancelar • Enter para salvar</p>
        </div>
      </div>
    </div>
  );
}


// ─── Main Channel Chat ──────────────────────────────────────
export default function ChannelChat({
  channel,
  onChannelUpdated,
  onChannelDeleted,
  onBack,
  dmPeerName,
}: {
  channel: Channel;
  onChannelUpdated?: () => void;
  onChannelDeleted?: () => void;
  onBack?: () => void;
  dmPeerName?: string;
}) {
  const { user, profile, role } = useAuthContext();
  const { markMessageAsUnread } = useNotificationsContext();
  const currentUserName = (profile?.full_name && profile.full_name.trim()) || user?.email?.split("@")[0] || "Alguém";
  const isMobile = useIsMobile();
  const { bottomOffset, isKeyboardOpen } = useMobileChatViewport();
  const { messages, loading: msgsLoading, sendMessage, ensureMessageLoaded } = useChannelMessages(channel.id);
  const threadCounts = useThreadCounts(channel.id);
  const [membersVersion, setMembersVersion] = useState(0);
  const members = useChannelMembers(channel.id, membersVersion);
  const { people } = usePeople();
  const peopleById = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string | null }>();
    for (const p of people) map.set(p.id, { name: p.full_name || p.email || "?", avatar: p.avatar_url });
    return map;
  }, [people]);
  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, p] of peopleById) map.set(id, p.name);
    return map;
  }, [peopleById]);
  const statusByUserId = useMemo(() => {
    const map = new Map<string, { emoji: string; label: string; setAt: string | null } | null>();
    for (const p of people) {
      if (p.custom_status && p.custom_status_emoji) {
        map.set(p.id, { emoji: p.custom_status_emoji, label: p.custom_status, setAt: p.custom_status_set_at });
      }
    }
    return map;
  }, [people]);
  const { reactions, toggleReaction } = useMessageReactions(channel.id);
  const channelDraftKey = `channel:${channel.id}`;
  const { value: draftValue, setValue: setDraftValue, clear: clearInputDraft } = usePersistentDraft(channelDraftKey);
  const inputLocalRef = useRef("");
  const [pendingLocal, setPendingLocal] = useState<string[]>(() => getPendingAgentsForChannel(channel.id));
  // Do servidor: vale para todos os membros e sobrevive a reload.
  const trabalhandoServidor = useChannelAgentActivity(channel.id);
  // Os dois juntos: o local responde no instante do envio, o do servidor é a
  // verdade e chega logo depois. Sozinho, cada um erra de um jeito — o local
  // só aparece para quem mencionou, o do servidor demora um piscar.
  const pendingAgentIds = useMemo(
    () => [...new Set([...pendingLocal, ...Object.keys(trabalhandoServidor)])],
    [pendingLocal, trabalhandoServidor],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<RichComposerHandle | null>(null);
  // Plain-text caret offset, kept fresh by RichComposer.onChange — used by @mention popup.
  const caretOffsetRef = useRef(0);
  const plainTextRef = useRef("");
  const shouldAutoScrollRef = useRef(true);
  // Grace period after opening a channel: ignore "user scrolled up" signals
  // caused by images/audio loading, composer padding animating, or visualViewport
  // resizing on mobile. Stores the timestamp until which the grace is active.
  const initialPinUntilRef = useRef(0);
  // True when the initial layout positioned the view at an unread-message anchor
  // ABOVE the bottom. While true, we must NOT force-pin to bottom — this preserves
  // the unread-message UX.
  const unreadAnchorActiveRef = useRef(false);
  const recorder = useAudioRecorder();
  const channelMedia = useChatMedia();
  const [uploadingFiles, setUploadingFiles] = useState(false);
  // Re-entrancy lock: prevents duplicate inserts when the user hits Enter / Send
  // twice while the previous insert is still in flight (the source of duplicate
  // messages seen in DMs).
  const sendingRef = useRef(false);
  const [hasComposerText, setHasComposerText] = useState(false);
  const [activeThreadMessage, setActiveThreadMessage] = useState<ChannelMessage | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; url: string; size?: number; mimeType?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadBelowCount, setUnreadBelowCount] = useState(0);
  const [markedUnreadIds, setMarkedUnreadIds] = useState<Set<string>>(new Set());

  // Load marked-unread message IDs from localStorage when channel changes
  useEffect(() => {
    if (!channel.id) {
      setMarkedUnreadIds(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(`marked-unread:${channel.id}`);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        setMarkedUnreadIds(new Set(ids));
      } else {
        setMarkedUnreadIds(new Set());
      }
    } catch {
      setMarkedUnreadIds(new Set());
    }
  }, [channel.id]);

  const clearMarkedUnread = useCallback((messageId: string) => {
    setMarkedUnreadIds(prev => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      try {
        if (next.size === 0) {
          localStorage.removeItem(`marked-unread:${channel.id}`);
        } else {
          localStorage.setItem(`marked-unread:${channel.id}`, JSON.stringify([...next]));
        }
      } catch {}
      return next;
    });
  }, [channel.id]);

  const markMessageAsUnreadLocally = useCallback((messageId: string) => {
    setMarkedUnreadIds(prev => {
      if (prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.add(messageId);
      try {
        localStorage.setItem(`marked-unread:${channel.id}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, [channel.id]);

  const handleMarkUnread = useCallback(async (messageId: string, authorName: string, contentPreview: string) => {
    const ok = await markMessageAsUnread({
      messageId,
      channelId: channel.id,
      authorName,
      contentPreview,
    });
    if (ok) {
      markMessageAsUnreadLocally(messageId);
    }
    return ok;
  }, [channel.id, markMessageAsUnread, markMessageAsUnreadLocally]);
  const lastSeenMessageCountRef = useRef(0);
  const [threadViewedVersion, setThreadViewedVersion] = useState(0);

  // Listen for thread-viewed events to refresh unread state
  useEffect(() => {
    const handler = () => setThreadViewedVersion((v) => v + 1);
    window.addEventListener("thread-viewed", handler);
    return () => window.removeEventListener("thread-viewed", handler);
  }, []);

  // Compute IDs of messages whose threads have unread replies, in chronological order
  const unreadThreadRootIds = useMemo(() => {
    void threadViewedVersion;
    const ownName = profile?.full_name ?? "";
    return messages
      .filter((m) => {
        const tc = threadCounts[m.id];
        if (!tc) return false;
        if (tc.lastAuthorName === ownName) return false;
        return new Date(tc.lastReplyAt).getTime() > getThreadLastViewed(m.id);
      })
      .map((m) => m.id);
  }, [messages, threadCounts, threadViewedVersion, profile?.full_name]);

  const [unreadThreadCycleIdx, setUnreadThreadCycleIdx] = useState(0);
  const jumpToUnreadThread = useCallback(() => {
    if (unreadThreadRootIds.length === 0) return;
    const idx = unreadThreadCycleIdx % unreadThreadRootIds.length;
    const targetId = unreadThreadRootIds[idx];
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${targetId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1800);
    }
    setUnreadThreadCycleIdx((v) => v + 1);
  }, [unreadThreadRootIds, unreadThreadCycleIdx]);

  const markAllThreadsRead = useCallback(() => {
    unreadThreadRootIds.forEach((id) => {
      const lastReplyAt = threadCounts[id]?.lastReplyAt;
      markThreadViewed(id, lastReplyAt);
    });
    setUnreadThreadCycleIdx(0);
  }, [unreadThreadRootIds, threadCounts]);


  // Mark thread as viewed when opened and keep re-marking as new replies arrive
  // (depende do lastReplyAt para que replies que chegam com o painel aberto
  // não voltem a aparecer como "não lidos").
  useEffect(() => {
    if (!activeThreadMessage) return;
    const lastReplyAt = threadCounts[activeThreadMessage.id]?.lastReplyAt;
    markThreadViewed(activeThreadMessage.id, lastReplyAt);
  }, [activeThreadMessage, threadCounts]);

  // Auto-focus input when channel changes
  useEffect(() => {
    if (isMobile) return;
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }, [channel.id, isMobile]);

  // Hydrate local draft mirror when the channel changes. The RichComposer itself
  // is remounted (via key) per-channel and picks up `draftValue` as initialMarkdown.
  useLayoutEffect(() => {
    inputLocalRef.current = draftValue;
  }, [draftValue]);

  const syncToDraft = useCallback((val: string) => {
    inputLocalRef.current = val;
    setDraftValue(val);
  }, [setDraftValue]);


  useEffect(() => {
    setActiveThreadMessage(null);
  }, [channel.id]);

  // Auto-open thread panel when notification points to a specific message
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { channelId?: string; threadRootId?: string | null } | undefined;
      if (!detail?.threadRootId) return;
      if (detail.channelId !== channel.id) return;
      const rootMsg = messages.find((m) => m.id === detail.threadRootId);
      if (rootMsg) setActiveThreadMessage(rootMsg);
    };
    window.addEventListener("navigate-to-channel", handler);
    return () => window.removeEventListener("navigate-to-channel", handler);
  }, [channel.id, messages]);

  const isNearBottom = useCallback((element: HTMLDivElement | null) => {
    if (!element) return true;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom < 96;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    // During the initial open grace period, ignore scroll noise from images
    // loading / composer animations / visualViewport resizing — unless the
    // initial layout intentionally anchored above bottom (unread anchor).
    if (Date.now() < initialPinUntilRef.current && !unreadAnchorActiveRef.current) {
      return;
    }
    const near = isNearBottom(scrollRef.current);
    shouldAutoScrollRef.current = near;
    setShowScrollDown(!near);
    if (near) {
      lastSeenMessageCountRef.current = messages.length;
      setUnreadBelowCount(0);
      if (messages.length > 0) {
        const lastId = messages[messages.length - 1].id;
        if (!lastId.startsWith("optimistic-")) {
          try { localStorage.setItem(`channel-last-seen-id:${channel.id}`, lastId); } catch {}
        }
      }
    }
  }, [isNearBottom, messages, channel.id]);

  // Scroll to + highlight a specific message when ?message=<id> is present in the URL.
  // If the target is older than the currently loaded window, fetch it (and the range
  // up to now) on demand so deep-links from search always land on the right bubble.
  const highlightedMessageRef = useRef<string | null>(null);
  // Set synchronously while a deep-link scroll is pending so the various
  // "auto-pin to bottom" effects (channel open, ResizeObserver, layout pin)
  // don't override our scrollIntoView.
  const deepLinkTargetRef = useRef<string | null>(null);
  const location = useLocation();

  // Pick up `?message=` synchronously so subsequent layout effects can opt out
  // of the default "pin to bottom on open" behaviour.
  const pendingDeepLinkTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("message");
  }, [location.search]);
  if (pendingDeepLinkTarget && deepLinkTargetRef.current !== pendingDeepLinkTarget && highlightedMessageRef.current !== pendingDeepLinkTarget) {
    deepLinkTargetRef.current = pendingDeepLinkTarget;
  }

  useEffect(() => {
    const targetId = pendingDeepLinkTarget;
    if (!targetId || highlightedMessageRef.current === targetId) return;

    const focus = () => {
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${targetId}"]`);
        if (!el) {
          // Element not in DOM yet — retry briefly while messages render.
          return;
        }
        // Lock auto-scroll so the layout/ResizeObserver effects don't yank us
        // back to the bottom right after scrollIntoView.
        shouldAutoScrollRef.current = false;
        initialPinUntilRef.current = 0;
        unreadAnchorActiveRef.current = true;
        el.querySelectorAll<HTMLButtonElement>('[data-collapsible-toggle="expand"]').forEach((btn) => btn.click());
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("msg-highlight");
        // Re-assert after late image/composer reflows.
        const reassert = window.setTimeout(() => {
          el.scrollIntoView({ behavior: "auto", block: "center" });
        }, 350);
        window.setTimeout(() => {
          el.classList.remove("msg-highlight");
          window.clearTimeout(reassert);
          deepLinkTargetRef.current = null;
        }, 2600);
      });
    };

    const focusWithRetries = (tries = 12) => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${targetId}"]`);
      if (el) {
        focus();
        return;
      }
      if (tries <= 0) return;
      window.setTimeout(() => focusWithRetries(tries - 1), 120);
    };

    if (messages.some((m) => m.id === targetId)) {
      highlightedMessageRef.current = targetId;
      focusWithRetries();
      return;
    }

    // Not loaded yet — fetch on demand. Mark BEFORE awaiting so we don't refire.
    highlightedMessageRef.current = targetId;
    (async () => {
      const ok = await ensureMessageLoaded(targetId);
      if (ok) {
        focusWithRetries();
      } else {
        // Allow retry if user navigates back
        highlightedMessageRef.current = null;
        deepLinkTargetRef.current = null;
      }
    })();
  }, [messages, channel.id, ensureMessageLoaded, pendingDeepLinkTarget]);

  // Edit / delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Panel / dialog state
  const [membersOpen, setMembersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Mention state
  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const [mentionOptionsLoaded, setMentionOptionsLoaded] = useState(false);
  useEffect(() => {
    setMentionOptionsLoaded(false);
    setMentionOptions([]);
  }, [channel.id, members]);

  useEffect(() => {
    if (!mentionVisible || mentionOptionsLoaded) return;
    let cancelled = false;

    (async () => {
      const opts: MentionOption[] = [];
      const humanIds: string[] = [];
      if (channel.type !== "dm") {
        opts.push({ id: "__all__", name: "todos", type: "all" });
      }

      for (const member of members) {
        if (member.member_type === "agent") {
          opts.push({ id: member.user_id, name: getAgentDisplayName(member.user_id), type: "agent" });
          continue;
        }

        humanIds.push(member.user_id);
      }

      if (humanIds.length > 0) {
        const { data: profiles } = await api<any[]>("/profiles").then((d) => ({ data: d })).catch(() => ({ data: [] as any[] }));

        if (profiles) {
          for (const profile of profiles) {
            opts.push({ id: profile.id, name: profile.full_name || profile.email || profile.id, type: "human" });
          }
        }
      }

      if (cancelled) return;
      setMentionOptions(opts);
      setMentionOptionsLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [channel.type, members, mentionVisible, mentionOptionsLoaded]);

  const filteredMentions = useMemo(
    () => mentionOptions
      .filter((o) => o.name.toLowerCase().includes(mentionQuery.toLowerCase()))
      .filter((o) => !(o.type === "agent" && pendingAgentIds.includes(o.id))),
    [mentionOptions, mentionQuery, pendingAgentIds]
  );

  useEffect(() => { setMentionIndex(0); }, [mentionQuery]);
  const isDm = channel.type === "dm";
  const canEdit = !isDm && (role === "administrador" || user?.id === channel.created_by);
  const displayName = isDm && dmPeerName ? dmPeerName : channel.name;

  const agentMembers = useMemo(
    () => members.filter((m) => (m as any).member_type === "agent").map((m) => m.user_id),
    [members]
  );

  // Human-to-human DM peer (for read receipts)
  const humanPeerId = useMemo(() => {
    if (!isDm || !user) return null;
    const peer = members.find(
      (m) => (m as any).member_type === "human" && m.user_id !== user.id,
    );
    return peer?.user_id ?? null;
  }, [isDm, members, user]);

  const { peerLastReadAt, markRead } = useDmReads(
    isDm && humanPeerId ? channel.id : null,
    humanPeerId,
    user?.id ?? null,
  );
  const { typingUsers, notifyTyping } = useTypingIndicator(channel.id, user?.id ?? null, currentUserName);
  const typingLabel = formatTypingLabel(typingUsers);

  // Mark current user's last_read_at whenever the channel is open and messages change
  useEffect(() => {
    if (!isDm || !humanPeerId) return;
    if (document.visibilityState !== "visible") return;
    markRead();
  }, [isDm, humanPeerId, messages.length, markRead]);

  useEffect(() => {
    if (!isDm || !humanPeerId) return;
    const onVis = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [isDm, humanPeerId, markRead]);

  // Index of the last own message that the peer has already read
  const lastSeenOwnIndex = useMemo(() => {
    if (!isDm || !humanPeerId || !peerLastReadAt || !user) return -1;
    const peerReadMs = new Date(peerLastReadAt).getTime();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.author_id === user.id && new Date(m.created_at).getTime() <= peerReadMs) {
        return i;
      }
    }
    return -1;
  }, [isDm, humanPeerId, peerLastReadAt, messages, user]);

  useEffect(() => subscribeToChannelAgentPending(channel.id, setPendingLocal), [channel.id]);

  // Persist the ID of the last message the user has seen. Using an ID (not a
  // timestamp) avoids jumping to weeks-old anchors when there are no real new
  // messages. If the saved ID is still the latest, we scroll to the bottom.
  const lastSeenIdKey = (id: string) => `channel-last-seen-id:${id}`;
  const persistLastSeenId = useCallback((chId: string, msgs: ChannelMessage[]) => {
    if (!msgs.length) return;
    const lastId = msgs[msgs.length - 1].id;
    if (lastId.startsWith("optimistic-")) return;
    try { localStorage.setItem(lastSeenIdKey(chId), lastId); } catch {}
  }, []);

  const prevChannelIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChannelMessage[]>(messages);
  messagesRef.current = messages;
  useEffect(() => {
    if (prevChannelIdRef.current && prevChannelIdRef.current !== channel.id) {
      persistLastSeenId(prevChannelIdRef.current, messagesRef.current);
    }
    prevChannelIdRef.current = channel.id;
    const persist = () => {
      if (prevChannelIdRef.current) persistLastSeenId(prevChannelIdRef.current, messagesRef.current);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      persist();
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [channel.id, persistLastSeenId]);

  const channelInitialLoadRef = useRef<Record<string, boolean>>({});
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    // A deep-link to a specific message is in progress — never pin to bottom.
    if (deepLinkTargetRef.current) return;
    const isFirstOpen = !channelInitialLoadRef.current[channel.id];
    if (isFirstOpen && messages.length > 0) {
      // Always open at the bottom (latest message). Unread tracking lives in
      // the notifications system; anchoring to a stale "last seen" id on open
      // was causing the chat to land mid-history with no scroll-down button
      // visible on mobile.
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      // Re-pin after a frame in case mobile composer/keyboard reflow grows
      // scrollHeight after the first paint.
      requestAnimationFrame(() => {
        if (scrollRef.current && !deepLinkTargetRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
      persistLastSeenId(channel.id, messages);
      channelInitialLoadRef.current[channel.id] = true;
      return;
    }
    if (!shouldAutoScrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages, pendingAgentIds.length, channel.id, persistLastSeenId]);

  // Keep view pinned to bottom as content/container size changes (images load,
  // streaming bubbles grow, composer/keyboard resizes). Only when near bottom.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const pin = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (deepLinkTargetRef.current) return;
        // During the grace period, force-pin to bottom unless the initial layout
        // chose an unread anchor — this absorbs late image/audio/composer reflows
        // on mobile that would otherwise leave the view above the last message.
        const inGrace = Date.now() < initialPinUntilRef.current && !unreadAnchorActiveRef.current;
        if (!shouldAutoScrollRef.current && !inGrace) return;
        container.scrollTop = container.scrollHeight;
      });
    };
    const ro = new ResizeObserver(pin);
    ro.observe(container);
    Array.from(container.children).forEach((child) => ro.observe(child as Element));
    return () => { if (frame) cancelAnimationFrame(frame); ro.disconnect(); };
  }, [channel.id, messages.length]);

  // Re-pin when mobile keyboard opens/closes or composer height changes
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [bottomOffset, isKeyboardOpen]);

  useEffect(() => {
    // If we're handling a deep-link, don't reset to "auto-pin-to-bottom" mode.
    if (deepLinkTargetRef.current) {
      shouldAutoScrollRef.current = false;
      unreadAnchorActiveRef.current = true;
      initialPinUntilRef.current = 0;
      setShowScrollDown(false);
      setUnreadBelowCount(0);
      lastSeenMessageCountRef.current = 0;
      return;
    }
    shouldAutoScrollRef.current = true;
    unreadAnchorActiveRef.current = false;
    initialPinUntilRef.current = Date.now() + 800;
    setShowScrollDown(false);
    setUnreadBelowCount(0);
    lastSeenMessageCountRef.current = 0;
    // Final safety pin after the grace period, covering slow-loading images.
    const t = window.setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      if (deepLinkTargetRef.current) return;
      if (unreadAnchorActiveRef.current) return;
      if (shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    }, 820);
    return () => window.clearTimeout(t);
  }, [channel.id]);

  // Track unread messages arriving while scrolled up
  useEffect(() => {
    if (shouldAutoScrollRef.current || messages.length === 0) {
      lastSeenMessageCountRef.current = messages.length;
      return;
    }
    if (lastSeenMessageCountRef.current === 0) {
      lastSeenMessageCountRef.current = messages.length;
      return;
    }
    const newCount = messages.length - lastSeenMessageCountRef.current;
    if (newCount > 0) setUnreadBelowCount(newCount);
  }, [messages.length]);

  const triggerAgents = useCallback((text: string) => {
    startChannelAgentReplies({
      channelId: channel.id,
      channelType: channel.type,
      agentMembers,
      messageText: text,
    });
  }, [agentMembers, channel.id, channel.type]);

  const handleSend = async () => {
    const currentInput = inputLocalRef.current;
    if ((!currentInput.trim() && channelMedia.staged.length === 0) || !user || uploadingFiles) return;
    // Hard re-entrancy guard against double-Enter / double-click duplicate sends.
    if (sendingRef.current) return;
    sendingRef.current = true;
    shouldAutoScrollRef.current = true;
    const msg = currentInput.trim();

    // Snapshot composer state so we can restore it if the send fails.
    const snapshotMarkdown = currentInput;

    // Clear composer IMMEDIATELY (synchronously) — before any await — so a
    // second Enter cannot resubmit the same text while the first insert is
    // still in flight.
    clearInputDraft();
    inputLocalRef.current = "";
    setHasComposerText(false);
    plainTextRef.current = "";
    caretOffsetRef.current = 0;
    setMentionVisible(false);
    inputRef.current?.setMarkdown("");

    try {
      // Upload staged files
      let attachments: ChannelAttachment[] | null = null;
      if (channelMedia.staged.length > 0) {
        setUploadingFiles(true);
        try {
          const finalized = await channelMedia.finalizeStaged(`channel-${channel.id}`);
          attachments = finalized.map((f) => ({
            name: f.name ?? "arquivo",
            url: f.url || f.base64,
            size: f.size ?? 0,
            mimeType: f.mimeType,
          }));
          channelMedia.clearStaged();
        } catch (err) {
          console.error("File upload error:", err);
          setUploadingFiles(false);
          // Restore composer so user can retry
          inputLocalRef.current = snapshotMarkdown;
          inputRef.current?.setMarkdown(snapshotMarkdown);
          setHasComposerText(snapshotMarkdown.trim().length > 0);
          return;
        }
        setUploadingFiles(false);
      }

      const nonImageAttachments = attachments ? attachments.filter(a => !a.mimeType?.startsWith("image/")) : [];
      const displayContent = msg || (nonImageAttachments.length > 0 ? `📎 ${nonImageAttachments.map(a => a.name).join(", ")}` : "");
      const displayName = (profile?.full_name && profile.full_name.trim()) || user.email?.split("@")[0] || "Usuário";
      const avatarUrl = profile?.avatar_url || null;
      await sendMessage(channel.id, user.id, displayName, displayContent, "human", avatarUrl, null, attachments);

      await notifyChannelRecipients({
        channelId: channel.id,
        senderUserId: user.id,
        authorName: displayName,
        contentPreview: displayContent.slice(0, 100),
        contentText: displayContent,
        forceNotifyAll: channel.type === "dm",
      });

      triggerAgents(displayContent);
    } finally {
      sendingRef.current = false;
    }
  };

  // Notification action hooks: ?focus=composer, ?prefill=<text>, ?autosend=1
  // Triggered when the user clicks "Responder" on a desktop push notification
  // (focus only) or when Android sends inline text via SW openWindow fallback.
  const handledNotifActionRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wantsFocus = params.get("focus") === "composer";
    const prefill = params.get("prefill");
    const autosend = params.get("autosend") === "1";
    if (!wantsFocus && !prefill) return;

    const signature = `${channel.id}|${prefill ?? ""}|${autosend ? "1" : "0"}|${wantsFocus ? "1" : "0"}`;
    if (handledNotifActionRef.current === signature) return;
    handledNotifActionRef.current = signature;

    const cleanUrl = () => {
      const p = new URLSearchParams(location.search);
      p.delete("focus");
      p.delete("prefill");
      p.delete("autosend");
      const s = p.toString();
      const newUrl = `${location.pathname}${s ? `?${s}` : ""}${location.hash}`;
      window.history.replaceState({}, "", newUrl);
    };

    const run = async () => {
      // Wait a tick for composer mount
      await new Promise((r) => setTimeout(r, 80));
      if (prefill) {
        inputLocalRef.current = prefill;
        setDraftValue(prefill);
        inputRef.current?.setMarkdown(prefill);
        setHasComposerText(true);
      }
      inputRef.current?.focus();
      cleanUrl();
      if (autosend && prefill && prefill.trim()) {
        // Allow the composer state to settle, then send.
        setTimeout(() => { void handleSend(); }, 120);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, location.search]);


  const handleSendGif = useCallback(async (gif: GifResult) => {
    if (!user) return;
    shouldAutoScrollRef.current = true;
    const displayName = (profile?.full_name && profile.full_name.trim()) || user.email?.split("@")[0] || "Usuário";
    const avatarUrl = profile?.avatar_url || null;
    const attachments: ChannelAttachment[] = [{
      name: `${gif.title || "gif"}.gif`,
      url: gif.url,
      size: 0,
      mimeType: "image/gif",
    }];
    await sendMessage(channel.id, user.id, displayName, "", "human", avatarUrl, null, attachments);
    await notifyChannelRecipients({
      channelId: channel.id,
      senderUserId: user.id,
      authorName: displayName,
      contentPreview: "🎬 GIF",
      contentText: "🎬 GIF",
      forceNotifyAll: channel.type === "dm",
    });
  }, [channel.id, channel.type, profile?.avatar_url, profile?.full_name, sendMessage, user]);

  // Called by RichComposer on every input. Receives markdown + plain text + caret offset.
  const handleComposerChange = useCallback(
    (markdown: string, plain: string, caret: number) => {
      inputLocalRef.current = markdown;
      const trimmed = plain.trim().length > 0;
      setHasComposerText(trimmed);
      if (trimmed) notifyTyping();
      plainTextRef.current = plain;
      caretOffsetRef.current = caret;
      syncToDraft(markdown);
      const textBeforeCursor = plain.slice(0, caret);
      const atMatch = textBeforeCursor.match(/@(\w*)$/);
      if (atMatch) {
        setMentionVisible(true);
        setMentionQuery(atMatch[1]);
      } else {
        setMentionVisible(false);
      }
    },
    [notifyTyping, syncToDraft],
  );


  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      void channelMedia.handlePasteOrDrop(e.dataTransfer);
    },
    [channelMedia],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length > 0) {
        e.preventDefault();
        channelMedia.handlePasteOrDrop(e.clipboardData);
        return;
      }
      // Promote large pasted text to a .txt attachment (Claude-style).
      const text = e.clipboardData.getData("text/plain");
      if (text && channelMedia.stagePastedText(text)) {
        e.preventDefault();
      }
    },
    [channelMedia],
  );

  const handleMentionSelect = (opt: MentionOption) => {
    inputRef.current?.replaceMentionTrigger(opt.name);
    setMentionVisible(false);
  };


  const handleEditSave = async (msgId: string, newContent: string) => {
    setEditingId(null);
    // O `edited_at` é do servidor, e a rota confere que a mensagem é de quem
    // está editando — antes bastava saber o id.
    await api(`/channels/${channel.id}/messages/${msgId}`, {
      method: "PATCH",
      body: { content: newContent },
    }).catch(() => { /* a tela já saiu do modo de edição */ });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    await api(`/channels/${channel.id}/messages/${deleteConfirmId}`, {
      method: "DELETE",
    }).catch(() => { /* idem */ });
    setDeleteConfirmId(null);
  };

  const handleSendThreadReply = useCallback(async (content: string, rootMessageId: string, attachments?: ChannelAttachment[] | null) => {
    if (!user) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      const replyDisplayName = (profile?.full_name && profile.full_name.trim()) || user.email?.split("@")[0] || "Usuário";
      const replyAvatarUrl = profile?.avatar_url || null;
      await sendMessage(channel.id, user.id, replyDisplayName, content, "human", replyAvatarUrl, null, attachments ?? null, rootMessageId);
      await notifyChannelRecipients({
        channelId: channel.id,
        senderUserId: user.id,
        authorName: `${replyDisplayName} (em conversa)`,
        contentPreview: `💬 ${content.slice(0, 100)}`,
        contentText: content,
        forceNotifyAll: true,
        threadRootId: rootMessageId,
      });
    } finally {
      sendingRef.current = false;
    }
  }, [channel.id, profile?.avatar_url, profile?.full_name, sendMessage, user]);

  const handleSendThreadAudio = useCallback(async (audioUrl: string, transcription: string, rootMessageId: string) => {
    if (!user) return;
    const displayName = (profile?.full_name && profile.full_name.trim()) || user.email?.split("@")[0] || "Usuário";
    const avatarUrl = profile?.avatar_url || null;
    await sendMessage(channel.id, user.id, displayName, transcription, "human", avatarUrl, audioUrl, null, rootMessageId);
    await notifyChannelRecipients({
      channelId: channel.id,
      senderUserId: user.id,
      authorName: `${displayName} (em conversa)`,
      contentPreview: `🎤 ${transcription.slice(0, 100)}`,
      contentText: transcription,
      forceNotifyAll: true,
      threadRootId: rootMessageId,
    });
  }, [channel.id, profile?.avatar_url, profile?.full_name, sendMessage, user]);

  const handleAudioStop = async () => {
    if (!user) return;
    recorder.setIsProcessing(true);
    try {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio. Tente novamente.");
        recorder.setIsProcessing(false);
        return;
      }

      const ext = getAudioFileExtension(blob.type);
      const fileName = `${channel.id}/${Date.now()}.${ext}`;
      try {
        await enviarArquivo("audio-messages", fileName, blob, `audio.${ext}`);
      } catch (uploadErr) {
        console.error("Upload error:", uploadErr);
        toast.error("Falha ao enviar o áudio.");
        recorder.setIsProcessing(false);
        return;
      }

      const audioUrl = urlPublica("audio-messages", fileName);
      const formData = new FormData();
      // ⚠️ O campo chama `arquivo` (a rota é nossa agora, não a edge).
      formData.append("arquivo", blob, `audio.${ext}`);
      const { data: transcribeData, error: transcribeErr } = await api<{ text: string }>(
        "/ia/transcrever", { method: "POST", body: formData },
      ).then((d) => ({ data: d, error: null as Error | null }),
             (e: Error) => ({ data: null, error: e }));
      const transcription = transcribeErr ? "Transcrição indisponível" : (transcribeData?.text || "Mensagem de áudio");
      const audioDisplayName = (profile?.full_name && profile.full_name.trim()) || user.email?.split("@")[0] || "Usuário";
      const audioAvatarUrl = profile?.avatar_url || null;
      await sendMessage(channel.id, user.id, audioDisplayName, transcription, "human", audioAvatarUrl, audioUrl);

      await notifyChannelRecipients({
        channelId: channel.id,
        senderUserId: user.id,
        authorName: audioDisplayName,
        contentPreview: `🎤 ${transcription.slice(0, 100)}`,
        contentText: transcription,
        forceNotifyAll: channel.type === "dm",
      });

      triggerAgents(transcription);
    } catch (err) {
      console.error("Audio send error:", err);
      toast.error("Falha ao processar o áudio.");
    } finally {
      recorder.setIsProcessing(false);
    }
  };

  const isBusy = recorder.isProcessing || uploadingFiles;

  return (
    <div
      className={`relative flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden ${dragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      style={isMobile && isKeyboardOpen ? { paddingBottom: `${bottomOffset}px` } : undefined}

      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-20 bg-primary/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
          <div className="glass-card px-6 py-4 flex items-center gap-3 shadow-lg">
            <Paperclip className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium text-foreground">Solte arquivos ou imagens para anexar</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="aurora-glow border-b border-border/40 flex items-center justify-between gap-2 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button onClick={onBack} className="p-1 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors touch-target">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <div className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
            <ChannelIcon type={channel.type} />
          </div>
          <div className="min-w-0 flex flex-col leading-tight">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-semibold text-foreground truncate">{displayName}</h3>
              {isDm && humanPeerId && (() => {
                const peerStatus = statusByUserId.get(humanPeerId);
                if (!peerStatus) return null;
                return (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0"
                    title={`${peerStatus.emoji} ${peerStatus.label}${peerStatus.setAt ? " · " + formatStatusAge(peerStatus.setAt) : ""}`}
                  >
                    <span aria-hidden>{peerStatus.emoji}</span>
                    <span className="truncate max-w-[120px]">{peerStatus.label}</span>
                  </span>
                );
              })()}
              {canEdit && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              {pendingAgentIds.length > 0 && (
                <span className="text-xs text-primary animate-pulse ml-1 truncate">
                  {pendingAgentIds.map((a) => getAgentDisplayName(a)).join(", ")} digitando...
                </span>
              )}
            </div>
            {!isDm && channel.description && (
              <span className="text-xs text-muted-foreground truncate">{channel.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
          {agentMembers.length > 0 && (
            <div className="flex items-center gap-1"><Bot className="h-3.5 w-3.5" /><span className="text-[10px]">{agentMembers.length}</span></div>
          )}
          <UserStatusPicker variant="header-chip" align="end" compact={isMobile} />
          <button
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm px-2 py-1 hover:border-primary/40 hover:text-foreground transition-colors text-xs font-medium"
            onClick={() => setFilesOpen(true)}
            title="Arquivos compartilhados"
            aria-label="Arquivos compartilhados"
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Arquivos</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm pl-1 pr-2.5 py-1 hover:border-primary/40 hover:text-foreground transition-colors"
            onClick={() => setMembersOpen(true)}
            title="Ver participantes"
          >
            <div className="flex -space-x-2">
              {members.slice(0, 4).map((m, i) => {
                const p = peopleById.get(m.user_id);
                const name = p?.name || m.user_id;
                const initial = (name?.[0] || "?").toUpperCase();
                const hue = (m.user_id.charCodeAt(0) * 47 + i * 37) % 360;
                const memberStatus = statusByUserId.get(m.user_id) ?? null;
                return (
                  <span key={m.user_id} className="relative">
                    <span
                      title={memberStatus ? `${name} · ${memberStatus.emoji} ${memberStatus.label}` : name}
                      className="h-6 w-6 rounded-full border-2 border-card overflow-hidden flex items-center justify-center text-[10px] font-semibold text-white bg-cover bg-center"
                      style={p?.avatar ? { backgroundImage: `url(${p.avatar})` } : { background: `hsl(${hue} 60% 45%)` }}
                    >
                      {!p?.avatar && initial}
                    </span>
                    <UserStatusBadge emoji={memberStatus?.emoji ?? null} label={memberStatus?.label} className="h-3 w-3 text-[8px]" />
                  </span>
                );
              })}
              {members.length > 4 && (
                <span className="h-6 w-6 rounded-full border-2 border-card bg-secondary text-foreground/80 flex items-center justify-center text-[9px] font-semibold">
                  +{members.length - 4}
                </span>
              )}
            </div>
            <span className="text-xs font-medium">{members.length}</span>
          </button>
        </div>
      </div>

      {/* DM peer status banner */}
      {isDm && humanPeerId && (() => {
        const peerStatus = statusByUserId.get(humanPeerId);
        const peerName = peopleById.get(humanPeerId)?.name ?? dmPeerName ?? "";
        if (!peerStatus) return null;
        return (
          <div className="border-b border-border/40 bg-secondary/30 px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2 shrink-0">
            <span aria-hidden>{peerStatus.emoji}</span>
            <span className="truncate">
              <span className="font-medium text-foreground">{peerName}</span> está em{" "}
              <span className="font-medium text-foreground">{peerStatus.label}</span>
              {peerStatus.setAt ? ` ${formatStatusAge(peerStatus.setAt)}` : ""} — pode demorar a responder
            </span>
          </div>
        );
      })()}

      {/* Threads with new replies bar */}
      {unreadThreadRootIds.length > 0 && (
        <div className="shrink-0 flex justify-center px-3 pt-2 pb-1">
          <div className="flex items-center gap-1 rounded-full border border-primary/60 bg-primary text-primary-foreground shadow-md max-w-full">
            <button
              type="button"
              onClick={jumpToUnreadThread}
              className="flex items-center gap-1.5 rounded-l-full pl-2.5 pr-2 py-1 text-xs font-semibold transition-all hover:bg-primary/85"
              title="Ir para próxima thread com nova resposta"
            >
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {unreadThreadRootIds.length} {unreadThreadRootIds.length === 1 ? "thread nova" : "threads novas"}
              </span>
            </button>
            <button
              type="button"
              onClick={markAllThreadsRead}
              className="flex items-center gap-1 rounded-r-full border-l border-primary-foreground/25 pl-2 pr-2.5 py-1 text-[11px] font-medium transition-all hover:bg-primary/85"
              title="Marcar todas as threads como lidas"
            >
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span>Marcar lidas</span>
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleMessagesScroll} className="mobile-scroll-region flex-1 overflow-y-auto p-4 space-y-4">

        {msgsLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando mensagens...</div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nenhuma mensagem ainda. Comece a conversa!</div>
        ) : (
          messages.map((msg, index) => {
            const previousMessage = messages[index - 1];
            const showDateDivider = shouldShowDateDivider(msg.created_at, previousMessage?.created_at);

            return (
              <Fragment key={msg.id}>
                {showDateDivider && <DateDivider date={msg.created_at} />}
                <div data-message-index={index} data-message-id={msg.id}>
                  {editingId === msg.id ? (
                    <EditingBubble
                      msg={msg}
                      onSave={(content) => handleEditSave(msg.id, content)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <MessageBubble
                      msg={msg}
                      currentUserId={user?.id ?? ""}
                      msgReactions={reactions[msg.id] ?? []}
                      onToggleReaction={(emoji) => user && toggleReaction(msg.id, emoji, user.id)}
                      onEdit={() => setEditingId(msg.id)}
                      onDelete={() => setDeleteConfirmId(msg.id)}
                      onReply={() => setActiveThreadMessage(msg)}
                      onMarkUnread={() =>
                        handleMarkUnread(msg.id, msg.author_name, msg.content || "")
                      }
                      isMarkedUnread={markedUnreadIds.has(msg.id)}
                      onMarkRead={() => clearMarkedUnread(msg.id)}
                      onImageClick={(src, alt) => setLightboxImage({ src, alt })}
                      onAttachmentPreview={setPreviewAttachment}
                      threadMeta={threadCounts[msg.id] ?? null}
                      threadHasUnread={
                        !!threadCounts[msg.id] &&
                        threadViewedVersion >= 0 &&
                        new Date(threadCounts[msg.id].lastReplyAt).getTime() > getThreadLastViewed(msg.id) &&
                        threadCounts[msg.id].lastAuthorName !== (profile?.full_name ?? "")
                      }
                      userNameById={userNameById}
                      authorStatus={statusByUserId.get(msg.author_id) ?? null}
                    />
                  )}
                </div>
                {index === lastSeenOwnIndex && peerLastReadAt && Number.isFinite(new Date(peerLastReadAt).getTime()) && new Date(peerLastReadAt).getTime() > 0 && (
                  <div className="-mt-2 flex justify-end pr-1">
                    <span className="text-[10px] text-muted-foreground italic">
                      Visto às {format(new Date(peerLastReadAt), "HH:mm")}
                    </span>
                  </div>
                )}
              </Fragment>

            );
          })
        )}
        {pendingAgentIds.length > 0 && (
          <div className="flex flex-col gap-0">
            <div className="flex gap-3">
              <div className="h-9 w-9 rounded-md shrink-0 mt-0.5 overflow-hidden ring-2 ring-border/30 bg-card flex items-center justify-center">
                <Bot className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{pendingAgentIds.map((a) => getAgentDisplayName(a)).join(", ")}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Agente</Badge>
                </div>
                <div className="typing-pill mt-1.5 agent-working-pulse text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs">Trabalhando...</span>
                </div>
              </div>
            </div>
            <ChannelStreamingActivity agentIds={pendingAgentIds} />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}

      {showScrollDown && (
        <button
          type="button"
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
              shouldAutoScrollRef.current = true;
              setShowScrollDown(false);
              setUnreadBelowCount(0);
              lastSeenMessageCountRef.current = messages.length;
            }
          }}
          className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-3 py-2 text-muted-foreground shadow-lg backdrop-blur-sm transition-all hover:bg-secondary hover:text-foreground hover:shadow-xl ${isMobile ? "bottom-44" : "bottom-28"}`}
          title="Ir para mensagens recentes"
        >
          {unreadBelowCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
              {unreadBelowCount > 99 ? "99+" : unreadBelowCount}
            </span>
          )}
          <ChevronDown className="h-4 w-4" />
        </button>
      )}


      <div
        className={`mobile-chat-composer relative shrink-0 border-t border-border/40 p-3 ${isMobile ? "pb-2 bg-background" : "bg-background/95 backdrop-blur-sm"}`}
        style={isMobile ? {
          paddingBottom: isKeyboardOpen
            ? `calc(max(env(safe-area-inset-bottom, 0px), 12px) + 8px)`
            : `calc(3.5rem + max(env(safe-area-inset-bottom, 0px), 16px) + 12px)`,
          transform: "translateZ(0)",
          willChange: "padding-bottom",
        } : undefined}
      >
        {typingLabel && pendingAgentIds.length === 0 && (
          <div className="pointer-events-none absolute -top-7 left-4 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs italic text-muted-foreground shadow-sm backdrop-blur-sm border border-border/40">
            <span className="truncate">{typingLabel.replace(/[…]+\s*$/, '').replace(/\.{3,}\s*$/, '')}</span>
            <TypingDots />
          </div>
        )}
        {/* Hint moved below the composer for a less cluttered top */}



        <MentionPopup
          options={filteredMentions}
          selected={mentionIndex}
          visible={mentionVisible}
          onSelect={handleMentionSelect}
          onHover={setMentionIndex}
        />

        {/* Staged file previews */}
        {channelMedia.staged.length > 0 && (
          <div className="flex gap-2 px-1 py-2 overflow-x-auto mb-1">
            {channelMedia.staged.map((att, i) => (
              <div key={i} className="relative group shrink-0">
                {att.type === "image" ? (
                  <img src={att.base64} alt={att.name} className="h-14 w-14 rounded-md object-cover border border-border" />
                ) : (
                  <div className="h-14 min-w-[110px] max-w-[160px] rounded-md border border-border bg-secondary/50 flex items-center gap-2 px-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-foreground truncate font-medium">{att.name ?? "file"}</p>
                      {att.size && <p className="text-[9px] text-muted-foreground">{formatFileSize(att.size)}</p>}
                    </div>
                  </div>
                )}
                <button onClick={() => channelMedia.removeStaged(i)} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {recorder.isRecording ? (
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={recorder.cancel} className="shrink-0 text-destructive hover:text-destructive rounded-full">
              <X className="h-4 w-4" />
            </Button>
            <div className="flex-1 flex items-center gap-3 px-3 py-2 rounded-full bg-destructive/10 border border-destructive/20">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-mono text-destructive">{formatDuration(recorder.duration)}</span>
              <span className="text-xs text-muted-foreground">Gravando...</span>
            </div>
            <button onClick={handleAudioStop} className="btn-send-gradient"><Send className="h-4 w-4" /></button>
          </div>
        ) : recorder.isProcessing || uploadingFiles ? (
          <div className="glass-input flex items-center gap-3 px-4 py-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">{uploadingFiles ? "Enviando arquivos..." : "Transcrevendo áudio..."}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Compact input row: field grows as the user types. */}
            <div className={`glass-input flex gap-1.5 px-2 ${isMobile ? "py-1.5" : "py-2"} items-center`}>
              {/* Mobile: single "+" popover holds attach, emoji and formatting */}
              {isMobile ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
                      title="Mais opções"
                      aria-label="Mais opções"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-2 w-[280px]" align="start" side="top">
                    <div className="space-y-2">
                      {/* Primary actions */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <PopoverClose asChild>
                          <button
                            type="button"
                            onClick={channelMedia.pickFile}
                            className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-xs text-foreground hover:bg-secondary/60 active:bg-secondary/80 transition-colors"
                          >
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                            <span>Anexar</span>
                          </button>
                        </PopoverClose>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-xs text-foreground hover:bg-secondary/60 active:bg-secondary/80 transition-colors"
                            >
                              <Smile className="h-4 w-4 text-muted-foreground" />
                              <span>Emoji</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 border-0 bg-transparent shadow-none w-auto" align="start" side="top">
                            <EmojiPicker onSelect={(emoji) => inputRef.current?.insertText(emoji)} />
                          </PopoverContent>
                        </Popover>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-xs text-foreground hover:bg-secondary/60 active:bg-secondary/80 transition-colors"
                            >
                              <span className="text-[10px] font-bold tracking-wider text-muted-foreground border border-current rounded px-1 py-0.5 leading-none">GIF</span>
                              <span>GIF</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 overflow-hidden w-auto" align="start" side="top">
                            <GifPicker onSelect={(gif) => { void handleSendGif(gif); }} />
                          </PopoverContent>
                        </Popover>
                      </div>
                      {/* Formatting */}
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground px-2 pb-1">Formatação</p>
                        <div className="grid grid-cols-6 gap-0.5">
                          {([
                            { icon: Bold, format: "bold" as RichFormat, title: "Negrito" },
                            { icon: Italic, format: "italic" as RichFormat, title: "Itálico" },
                            { icon: Strikethrough, format: "strikethrough" as RichFormat, title: "Riscado" },
                            { icon: List, format: "ul" as RichFormat, title: "Lista" },
                            { icon: ListOrdered, format: "ol" as RichFormat, title: "Lista numerada" },
                            { icon: Code, format: "code" as RichFormat, title: "Código" },
                          ]).map(({ icon: Icon, format, title }) => (
                            <button
                              key={format}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                inputRef.current?.applyFormat(format);
                              }}
                              className="h-10 w-full flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary/80 transition-colors"
                              title={title}
                              aria-label={title}
                            >
                              <Icon className="h-[18px] w-[18px]" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="shrink-0 p-1.5 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                      title="Inserir emoji"
                      aria-label="Inserir emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 border-0 bg-transparent shadow-none w-auto" align="start" side="top">
                    <EmojiPicker onSelect={(emoji) => inputRef.current?.insertText(emoji)} />
                  </PopoverContent>
                </Popover>
              )}
              <RichComposer
                key={channel.id}
                ref={inputRef}
                initialMarkdown={draftValue}
                onChange={handleComposerChange}
                onPaste={(e) => handlePaste(e)}
                onFocus={() => {
                  shouldAutoScrollRef.current = true;
                  if (isKeyboardOpen) {
                    requestAnimationFrame(() => {
                      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (mentionVisible && filteredMentions.length > 0) {
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleMentionSelect(filteredMentions[mentionIndex]);
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((i) => (i + 1) % filteredMentions.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionVisible(false);
                      return;
                    }
                  }

                  // Enter sends on desktop; on mobile behaves like WhatsApp (newline only).
                  // Shift+Enter inserts a newline on desktop. Inside <li>, let the
                  // browser handle natural list continuation.
                  if (e.key === "Enter" && !e.shiftKey) {
                    if (isMobile) {
                      // On mobile, Enter inserts a newline instead of sending
                      e.preventDefault();
                      inputRef.current?.insertText("\n");
                      return;
                    }
                    if (inputRef.current?.isInsideList()) return;
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Mensagem em #${channel.name}...`}
                disabled={isBusy}
                className="flex-1 text-sm py-1"
              />
              {/* Right action: send when there's text or staged files; mic otherwise (mobile only) */}
              {isMobile && !hasComposerText && channelMedia.staged.length === 0 ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await recorder.start();
                    } catch (e) {
                      console.error("Audio start failed:", e);
                    }
                  }}
                  disabled={isBusy}
                  className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/35 transition-colors disabled:opacity-40"
                  title="Gravar áudio"
                  aria-label="Gravar áudio"
                >
                  <Mic className="h-5 w-5" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={(!inputLocalRef.current.trim() && channelMedia.staged.length === 0) || isBusy}
                  className="btn-send-gradient shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Desktop-only toolbar: attach + formatting + record */}
            {!isMobile && (
              <div className="flex items-center gap-0.5 px-2">
                <button
                  onClick={channelMedia.pickFile}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                  title="Anexar arquivo"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                      title="Enviar GIF"
                    >
                      <span className="text-[10px] font-bold tracking-wider border border-current rounded px-1 py-px leading-none">GIF</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 overflow-hidden w-auto" align="start" side="top">
                    <GifPicker onSelect={(gif) => { void handleSendGif(gif); }} />
                  </PopoverContent>
                </Popover>
                <span className="mx-1 h-4 w-px bg-border/60" />
                {([
                  { icon: Bold, format: "bold" as RichFormat, title: "Negrito (Ctrl+B)" },
                  { icon: Italic, format: "italic" as RichFormat, title: "Itálico (Ctrl+I)" },
                  { icon: Strikethrough, format: "strikethrough" as RichFormat, title: "Riscado" },
                  { icon: List, format: "ul" as RichFormat, title: "Lista" },
                  { icon: ListOrdered, format: "ol" as RichFormat, title: "Lista numerada" },
                  { icon: Code, format: "code" as RichFormat, title: "Código" },
                ]).map(({ icon: Icon, format, title }) => (
                  <button
                    key={format}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      inputRef.current?.applyFormat(format);
                    }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                    title={title}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-border/60" />
                <button
                  onClick={async () => {
                    try {
                      await recorder.start();
                    } catch (e) {
                      console.error("Audio start failed:", e);
                    }
                  }}
                  disabled={isBusy}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                  title="Gravar áudio"
                >
                  <Mic className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* @mention hint below everything */}
            {agentMembers.length > 0 && (
              <p className="text-[10px] text-muted-foreground px-2 pt-0.5">
                {channel.type === "dm"
                  ? "Mensagens diretas com agente respondem automaticamente."
                  : `Use @${getAgentDisplayName(agentMembers[0]).toLowerCase()} para mencionar um agente — ele só responde quando for mencionado.`}
              </p>
            )}
          </div>
        )}
      </div>



      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja apagar esta mensagem? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Members Panel */}
      <ChannelMembersPanel
        channelId={channel.id}
        channelCreatedBy={channel.created_by}
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        onMembersChanged={() => setMembersVersion((v) => v + 1)}
      />

      {/* Files Panel */}
      <ChannelFilesPanel
        channelId={channel.id}
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
      />

      {/* Edit Dialog */}
      <EditChannelDialog
        channel={channel}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdated={() => onChannelUpdated?.()}
        onDeleted={() => onChannelDeleted?.()}
      />

      <ThreadPanel
        channelId={channel.id}
        channelName={displayName}
        open={!!activeThreadMessage}
        onOpenChange={(open) => !open && setActiveThreadMessage(null)}
        rootMessage={activeThreadMessage}
        onSendReply={handleSendThreadReply}
        onSendAudioReply={handleSendThreadAudio}
        currentUserId={user?.id ?? ""}
        reactions={reactions}
        onToggleReaction={(messageId, emoji) => user && toggleReaction(messageId, emoji, user.id)}
      />

      <ImageLightbox
        open={!!lightboxImage}
        src={lightboxImage?.src ?? null}
        alt={lightboxImage?.alt}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setLightboxImage(null);
        }}
      />

      <FileAttachmentPreviewDialog
        open={!!previewAttachment}
        attachment={previewAttachment}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPreviewAttachment(null);
        }}
      />
    </div>
  );
}
