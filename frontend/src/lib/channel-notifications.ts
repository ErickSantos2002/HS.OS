import { supabase } from "@/integrations/supabase/client";

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
  const { data: membersData, error: membersError } = await supabase
    .from("channel_members")
    .select("user_id, member_type")
    .eq("channel_id", channelId);

  if (membersError || !membersData) return;

  const humanMemberIds = (membersData as Array<{ user_id: string; member_type: string }>)
    .filter((member) => member.member_type === "human" && member.user_id !== senderUserId)
    .map((member) => member.user_id);

  if (humanMemberIds.length === 0) return;

  const recipientIds = humanMemberIds;

  const uniqueRecipientIds = [...new Set(recipientIds)];
  if (uniqueRecipientIds.length === 0) return;

  await supabase.from("notifications").insert(
    uniqueRecipientIds.map((userId) => ({
      user_id: userId,
      channel_id: channelId,
      message_id: threadRootId,
      author_name: authorName,
      content_preview: contentPreview,
    })) as any,
  );
}