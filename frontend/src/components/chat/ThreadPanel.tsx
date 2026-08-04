import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { FileText, Loader2, MessageSquare, Mic, Paperclip, Pencil, Send, Smile, Trash2, Users, X, Check, Bot } from "lucide-react";
import EmojiPickerReact, { Theme as EmojiTheme } from "emoji-picker-react";

import type { ChannelMessage, ChannelAttachment } from "@/hooks/use-channels";
import { useThreadMessages } from "@/hooks/use-channel-threads";
import { useChatMedia } from "@/hooks/use-chat-media";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { resetComposerTextarea, resizeComposerTextarea } from "@/lib/chat-composer";
import { formatFileSize } from "@/lib/file-upload";
import { hasEveryoneMention } from "@/lib/channel-notifications";
import { useTheme } from "next-themes";
import FileAttachmentCard from "@/components/chat/FileAttachmentCard";
import AudioMessagePlayer from "@/components/chat/AudioMessagePlayer";
import CollapsibleTranscription from "@/components/chat/CollapsibleTranscription";
import FileAttachmentPreviewDialog from "@/components/chat/FileAttachmentPreviewDialog";
import ImageLightbox from "@/components/chat/ImageLightbox";
import { MarkdownMessageContent, PlainMessageContent } from "@/components/chat/MessageContent";
import DateDivider from "@/components/chat/DateDivider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { supabase } from "@/integrations/supabase/client";
import { shouldShowDateDivider } from "@/lib/chat-date-groups";
import type { Reaction } from "@/hooks/use-message-reactions";
import { getAudioFileExtension, useAudioRecorder } from "@/hooks/use-audio-recorder";
import { toast } from "sonner";

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

function ReactionsBar({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: Reaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => {
        const isOwn = r.user_ids.includes(currentUserId);
        return (
          <button
            key={r.emoji}
            onClick={() => onToggle(r.emoji)}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-all duration-200 hover:scale-105 ${
              isOwn
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
            }`}
          >
            <span>{r.emoji}</span>
            <span className="font-medium">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThreadEditingCard({
  message,
  onSave,
  onCancel,
}: {
  message: ChannelMessage;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(message.content);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  return (
    <article className="rounded-2xl border border-primary/40 bg-card/70 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-border/30">
          {message.author_avatar ? (
            <img src={message.author_avatar} alt="" className="h-9 w-9 object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center bg-primary/20">
              <span className="text-sm font-bold text-primary">{message.author_name.charAt(0).toUpperCase()}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{message.author_name}</span>
            <span className="text-[10px] text-muted-foreground">{format(new Date(message.created_at), "HH:mm")}</span>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              ref={taRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && value.trim()) {
                  e.preventDefault();
                  onSave(value.trim());
                }
                if (e.key === "Escape") onCancel();
              }}
              className="min-h-[36px] max-h-[200px] flex-1 resize-none py-2 text-sm leading-relaxed"
              rows={1}
            />
            <Button size="sm" variant="ghost" onClick={onCancel} className="h-8 shrink-0 px-2">
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => value.trim() && onSave(value.trim())}
              className="h-8 shrink-0 px-2"
              disabled={!value.trim()}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Escape para cancelar • Enter para salvar</p>
        </div>
      </div>
    </article>
  );
}

function ThreadMessageCard({
  message,
  compact = false,
  currentUserId,
  reactions,
  onToggleReaction,
  onEdit,
  onDelete,
  onImageClick,
  onAttachmentPreview,
}: {
  message: ChannelMessage;
  compact?: boolean;
  currentUserId: string;
  reactions: Reaction[];
  onToggleReaction?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onImageClick: (src: string, alt: string) => void;
  onAttachmentPreview: (attachment: { name: string; url: string; size?: number; mimeType?: string }) => void;
}) {
  const isAgent = message.author_type === "agent";
  const hasAudio = !!message.audio_url;
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.edited_at;
  const isOwn = message.author_id === currentUserId;
  const mentionsEveryone = hasEveryoneMention(message.content);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showActions = !compact && !isDeleted && !!onToggleReaction && !message.id.startsWith("optimistic-");

  const handleTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => setShowMobileMenu(true), 500);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  return (
    <article
      className={`group relative rounded-2xl border p-3 ${compact ? "shadow-none" : "shadow-sm"} ${
        isOwn
          ? "border-primary/30 bg-primary text-primary-foreground shadow-[0_8px_32px_rgba(61,97,255,0.18)]"
          : isAgent
            ? "border-[hsl(var(--agent-accent)/0.55)] bg-[hsl(var(--agent-accent)/0.06)] shadow-[0_0_28px_-12px_hsl(var(--agent-accent)/0.55)]"
            : "border-border/60 bg-card/70"
      }`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 shrink-0 overflow-hidden ring-2 ${isOwn ? "ring-primary-foreground/20" : "ring-border/30"} ${isAgent ? "rounded-md" : "rounded-full"}`}>
          {isAgent ? (
            <div className="flex h-9 w-9 items-center justify-center bg-card">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : message.author_avatar ? (
            <img src={message.author_avatar} alt="" className="h-9 w-9 object-cover" />
          ) : (
            <div className={`flex h-9 w-9 items-center justify-center ${isOwn ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
              <span className="text-sm font-semibold">{message.author_name.charAt(0).toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-semibold ${isOwn ? "text-primary-foreground" : "text-foreground"}`}>{message.author_name}</span>
            {isAgent && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Agente</Badge>}
            {hasAudio && <Mic className={`h-3.5 w-3.5 ${isOwn ? "text-primary-foreground/80" : "text-muted-foreground"}`} />}
            <span className={`text-[10px] ${isOwn ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{format(new Date(message.created_at), "HH:mm")}</span>
            {isEdited && !isDeleted && <span className={`text-[10px] italic ${isOwn ? "text-primary-foreground/70" : "text-muted-foreground"}`}>(editado)</span>}
          </div>

          {isDeleted ? (
            <p className={`text-sm italic ${isOwn ? "text-primary-foreground/70" : "text-muted-foreground"}`}>Mensagem apagada</p>
          ) : (
            <>
              {mentionsEveryone && (
                <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${isOwn ? "bg-primary-foreground/15 text-primary-foreground ring-primary-foreground/30" : "bg-primary/10 text-primary ring-primary/20"}`}>
                  <Users className="h-3 w-3" />
                  <span>Aviso para todos</span>
                </div>
              )}

              {hasAudio && message.audio_url && <AudioMessagePlayer src={message.audio_url} />}

              {hasAudio ? (
                <CollapsibleTranscription text={message.content} />
              ) : isAgent ? (
                <MarkdownMessageContent text={message.content} />
              ) : (
                <PlainMessageContent text={message.content} className={`text-sm ${isOwn ? "text-primary-foreground" : "text-foreground/90"}`} />
              )}

              {message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-col gap-2">
                  {message.attachments.map((attachment, index) => {
                    if (attachment.mimeType?.startsWith("image/")) {
                      return (
                        <button
                          key={`${attachment.url}-${index}`}
                          type="button"
                          onClick={() => onImageClick(attachment.url, attachment.name)}
                          className="overflow-hidden rounded-xl"
                        >
                          <img
                            src={attachment.url}
                            alt={attachment.name}
                            className="max-h-48 max-w-full rounded-xl object-cover transition-transform hover:scale-[1.01]"
                          />
                        </button>
                      );
                    }
                    return (
                      <FileAttachmentCard
                        key={`${attachment.url}-${index}`}
                        name={attachment.name}
                        url={attachment.url}
                        size={attachment.size}
                        mimeType={attachment.mimeType}
                        onPreview={onAttachmentPreview}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {onToggleReaction && (
            <ReactionsBar reactions={reactions} currentUserId={currentUserId} onToggle={onToggleReaction} />
          )}
        </div>
      </div>

      {showActions && (
        <div
          className={`absolute -top-3 ${isOwn ? "left-2" : "right-2"} ${
            showMobileMenu || emojiOpen ? "flex" : "hidden group-hover:flex"
          } items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md z-10`}
        >
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Reagir"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiOpen((p) => !p);
                }}
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="z-50 w-auto border-0 bg-transparent p-0 shadow-none"
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
                  onToggleReaction?.(emoji);
                  setEmojiOpen(false);
                  setShowMobileMenu(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {isOwn && onEdit && (
            <button
              onClick={() => {
                onEdit();
                setShowMobileMenu(false);
              }}
              title="Editar"
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {isOwn && onDelete && (
            <button
              onClick={() => {
                onDelete();
                setShowMobileMenu(false);
              }}
              title="Apagar"
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

interface ThreadPanelProps {
  channelId: string;
  channelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootMessage: ChannelMessage | null;
  onSendReply: (content: string, rootMessageId: string, attachments?: ChannelAttachment[] | null) => Promise<void>;
  onSendAudioReply?: (audioUrl: string, transcription: string, rootMessageId: string) => Promise<void>;
  currentUserId: string;
  reactions: Record<string, Reaction[]>;
  onToggleReaction: (messageId: string, emoji: string) => void;
}

export default function ThreadPanel({
  channelId,
  channelName,
  open,
  onOpenChange,
  rootMessage,
  onSendReply,
  onSendAudioReply,
  currentUserId,
  reactions,
  onToggleReaction,
}: ThreadPanelProps) {
  const isMobile = useIsMobile();
  const { bottomOffset } = useMobileChatViewport();
  const threadDraftKey = open && rootMessage ? `thread:${channelId}:${rootMessage.id}` : null;
  const { value: input, setValue: setInput, clear: clearInputDraft } = usePersistentDraft(threadDraftKey);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; url: string; size?: number; mimeType?: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const threadMedia = useChatMedia();
  const recorder = useAudioRecorder();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const repliesRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const { messages, loading } = useThreadMessages(open ? channelId : null, open ? rootMessage?.id ?? null : null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (!inputRef.current) return;
      if (input) resizeComposerTextarea(inputRef.current);
      else resetComposerTextarea(inputRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [input, open, rootMessage?.id]);

  useEffect(() => {
    if (!open) return;
    if (!repliesRef.current || !shouldAutoScrollRef.current) return;
    repliesRef.current.scrollTo({ top: repliesRef.current.scrollHeight, behavior: "auto" });
  }, [messages.length, open]);

  const handleRepliesScroll = useCallback(() => {
    if (!repliesRef.current) return;
    const distanceFromBottom = repliesRef.current.scrollHeight - repliesRef.current.scrollTop - repliesRef.current.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  }, []);

  const replyCountLabel = useMemo(() => {
    const count = messages.length;
    return `${count} ${count === 1 ? "resposta" : "respostas"}`;
  }, [messages.length]);

  const handleSend = async () => {
    const content = input.trim();
    if (!rootMessage) return;
    if (!content && threadMedia.staged.length === 0) return;
    if (uploadingFiles) return;
    shouldAutoScrollRef.current = true;

    let attachments: ChannelAttachment[] | null = null;
    if (threadMedia.staged.length > 0) {
      setUploadingFiles(true);
      try {
        const finalized = await threadMedia.finalizeStaged(`channel-${channelId}-thread-${rootMessage.id}`);
        attachments = finalized.map((f) => ({
          name: f.name ?? "arquivo",
          url: f.url || f.base64,
          size: f.size ?? 0,
          mimeType: f.mimeType,
        }));
        threadMedia.clearStaged();
      } catch (err) {
        console.error("Thread file upload error:", err);
        setUploadingFiles(false);
        return;
      }
      setUploadingFiles(false);
    }

    const nonImageAttachments = attachments ? attachments.filter((a) => !a.mimeType?.startsWith("image/")) : [];
    const displayContent = content || (nonImageAttachments.length > 0 ? `📎 ${nonImageAttachments.map((a) => a.name).join(", ")}` : "");
    await onSendReply(displayContent, rootMessage.id, attachments);
    clearInputDraft();
    resetComposerTextarea(inputRef.current);
  };

  const handleThreadAudioStop = async () => {
    if (!rootMessage || !onSendAudioReply) return;
    recorder.setIsProcessing(true);
    try {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio. Tente novamente.");
        recorder.setIsProcessing(false);
        return;
      }
      const ext = getAudioFileExtension(blob.type);
      const fileName = `${channelId}/thread-${rootMessage.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("audio-messages")
        .upload(fileName, blob, { contentType: blob.type });
      if (uploadErr) {
        console.error("Thread audio upload error:", uploadErr);
        toast.error("Falha ao enviar o áudio.");
        recorder.setIsProcessing(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("audio-messages").getPublicUrl(fileName);
      const audioUrl = urlData.publicUrl;
      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      const { data: transcribeData, error: transcribeErr } = await supabase.functions.invoke("transcribe-audio", { body: formData });
      const transcription = transcribeErr ? "Transcrição indisponível" : (transcribeData?.text || "Mensagem de áudio");
      await onSendAudioReply(audioUrl, transcription, rootMessage.id);
    } catch (err) {
      console.error("Thread audio send error:", err);
      toast.error("Falha ao processar o áudio.");
    } finally {
      recorder.setIsProcessing(false);
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleEditSave = async (msgId: string, newContent: string) => {
    setEditingId(null);
    await supabase
      .from("channel_messages")
      .update({ content: newContent, edited_at: new Date().toISOString() } as any)
      .eq("id", msgId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    await supabase
      .from("channel_messages")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", deleteConfirmId);
    setDeleteConfirmId(null);
  };

  if (!rootMessage) return null;

  const body = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Conversa</p>
            <h3 className="text-base font-semibold text-foreground">#{channelName}</h3>
          </div>
          {isMobile && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div ref={repliesRef} onScroll={handleRepliesScroll} className="mobile-scroll-region flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Mensagem original</span>
          </div>
          <ThreadMessageCard
            message={rootMessage}
            compact
            currentUserId={currentUserId}
            reactions={reactions[rootMessage.id] ?? []}
            onImageClick={(src, alt) => setLightboxImage({ src, alt })}
            onAttachmentPreview={setPreviewAttachment}
          />
        </div>
        <div className="pt-2 text-xs font-medium text-muted-foreground">{replyCountLabel}</div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando conversa...</p>
        ) : messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
            Ainda não há respostas nesta conversa.
          </div>
        ) : (
          messages.map((message, index) => {
            const previousMessage = messages[index - 1];
            const showDateDivider = shouldShowDateDivider(message.created_at, previousMessage?.created_at);

            return (
              <Fragment key={message.id}>
                {showDateDivider && <DateDivider date={message.created_at} className="pt-1" />}
                {editingId === message.id ? (
                  <ThreadEditingCard
                    message={message}
                    onSave={(content) => handleEditSave(message.id, content)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <ThreadMessageCard
                    message={message}
                    currentUserId={currentUserId}
                    reactions={reactions[message.id] ?? []}
                    onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
                    onEdit={() => setEditingId(message.id)}
                    onDelete={() => setDeleteConfirmId(message.id)}
                    onImageClick={(src, alt) => setLightboxImage({ src, alt })}
                    onAttachmentPreview={setPreviewAttachment}
                  />
                )}
              </Fragment>
            );
          })
        )}
      </div>

      <div
        className="mobile-chat-composer border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur-sm"
        style={isMobile ? { paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${Math.min(bottomOffset, 240)}px)` } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          void threadMedia.handlePasteOrDrop(e.dataTransfer);
        }}
      >
        {threadMedia.staged.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 py-1">
            {threadMedia.staged.map((att, i) => (
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
                <button
                  onClick={() => threadMedia.removeStaged(i)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  type="button"
                >
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
            <button onClick={() => void handleThreadAudioStop()} className="btn-send-gradient" type="button">
              <Send className="h-4 w-4" />
            </button>
          </div>
        ) : uploadingFiles || recorder.isProcessing ? (
          <div className="glass-input flex items-center gap-3 px-4 py-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              {recorder.isProcessing ? "Transcrevendo áudio..." : "Enviando arquivos..."}
            </span>
          </div>
        ) : (
          <div className={`glass-input flex gap-2 px-3 py-1.5 ${isMobile ? "items-end" : "items-center"}`}>
            <button
              type="button"
              onClick={threadMedia.pickFile}
              className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
              title="Anexar arquivo"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                  title="Inserir emoji"
                >
                  <Smile className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 border-0 bg-transparent shadow-none w-auto" align="start" side="top">
                <EmojiPicker
                  onSelect={(emoji) => {
                    const ta = inputRef.current;
                    if (!ta) {
                      setInput((prev) => prev + emoji);
                      return;
                    }
                    const start = ta.selectionStart ?? ta.value.length;
                    const end = ta.selectionEnd ?? ta.value.length;
                    const next = ta.value.slice(0, start) + emoji + ta.value.slice(end);
                    setInput(next);
                    requestAnimationFrame(() => {
                      ta.focus();
                      const pos = start + emoji.length;
                      ta.setSelectionRange(pos, pos);
                      resizeComposerTextarea(ta);
                    });
                  }}
                />
              </PopoverContent>
            </Popover>
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                resizeComposerTextarea(event.currentTarget);
              }}
              onInput={(event) => resizeComposerTextarea(event.currentTarget)}
              onPaste={(event) => {
                if (event.clipboardData.files.length > 0) {
                  event.preventDefault();
                  void threadMedia.handlePasteOrDrop(event.clipboardData);
                  return;
                }
                const text = event.clipboardData.getData("text/plain");
                if (text && threadMedia.stagePastedText(text)) {
                  event.preventDefault();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
              placeholder="Responder na conversa..."
              className="min-h-[40px] max-h-[88px] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-sm leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {onSendAudioReply && !input.trim() && threadMedia.staged.length === 0 ? (
              <button
                type="button"
                onClick={() => void recorder.start()}
                className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                title="Gravar áudio"
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => void handleSend()}
                disabled={(!input.trim() && threadMedia.staged.length === 0) || uploadingFiles}
                className="btn-send-gradient shrink-0 disabled:opacity-40"
                type="button"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const overlays = (
    <>
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

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem será removida da conversa. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="flex h-[88vh] max-h-[88vh] flex-col p-0">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Conversa</DrawerTitle>
              <DrawerDescription>Respostas vinculadas à mensagem selecionada.</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
          </DrawerContent>
        </Drawer>
        {overlays}
      </>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversa</SheetTitle>
            <SheetDescription>Respostas vinculadas à mensagem selecionada.</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
      {overlays}
    </>
  );
}
