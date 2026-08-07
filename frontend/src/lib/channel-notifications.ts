import { api } from "@/lib/api";

const EVERYONE_MENTION_REGEX = /(^|\s)@todos\b/iu;
const PERSON_MENTION_REGEX = /@(\w+(?:\s\w+)*)/g;

function normalizeMentionValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractMentionLabels(text: string) {
  return Array.from(text.matchAll(PERSON_MENTION_REGEX), (match) => normalizeMentionValue(match[1] ?? ""))
    .filter(Boolean)
    .filter((mention) => mention !== "todos");
}

export function hasEveryoneMention(text: string) {
  return EVERYONE_MENTION_REGEX.test(text);
}

interface NotifyChannelRecipientsParams {
  channelId: string;
  senderUserId: string;
  authorName: string;
  contentPreview: string;
  contentText: string;
  forceNotifyAll?: boolean;
  threadRootId?: string | null;
}

export async function notifyChannelRecipients({
  channelId,
  senderUserId,
  authorName,
  contentPreview,
  contentText,
  forceNotifyAll = false,
  threadRootId = null,
}: NotifyChannelRecipientsParams) {
  // O filtro (só humanos, menos quem enviou) acompanha o INSERT no servidor —
  // a lista de destinatários não faz mais a volta pela rede antes de virar
  // linha na tabela.
  await api(`/channels/${channelId}/notificar`, {
    method: "POST",
    body: {
      author_name: authorName,
      content_preview: contentPreview,
      message_id: threadRootId ?? null,
    },
  });

}