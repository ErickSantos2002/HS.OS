import { getAgentDisplayNameById, isLikelyAgentId, isOfficialAgentId, normalizeAgentId } from "@/lib/active-agents";
import { supabase } from "@/integrations/supabase/client";
import { getPendingAgentsForChannel, setChannelAgentPending } from "@/lib/channel-agent-pending";

/** Extract @mentions from message text, returns array of matched agent IDs */
export function extractMentionedAgents(text: string, agentIds: string[]): string[] {
  const mentioned: string[] = [];
  const lower = text.toLowerCase();
  for (const rawAgentId of agentIds) {
    const agentId = normalizeAgentId(rawAgentId);
    const name = getAgentDisplayNameById(agentId).toLowerCase();
    // Match @agentId or @AgentName
    if (lower.includes(`@${agentId}`) || lower.includes(`@${name}`)) {
      mentioned.push(agentId);
    }
  }
  return [...new Set(mentioned)];
}

/** DMs with an agent still auto-trigger; channels only respond to explicit mentions */
export function shouldAutoTriggerAgent(
  channelType: string,
  agentMembers: string[]
): string | null {
  if (channelType === "dm" && agentMembers.length >= 1) {
    return normalizeAgentId(agentMembers[0]);
  }
  return null;
}

/** Determine which agents should respond to a message */
export function getRespondingAgents(
  messageText: string,
  channelType: string,
  agentMembers: string[]
): string[] {
  const normalizedAgentMembers = agentMembers.map(normalizeAgentId).filter(isOfficialAgentId);
  // Check explicit @mentions first
  const mentioned = extractMentionedAgents(messageText, normalizedAgentMembers);
  // Filter to only agents that are members of this channel
  const validMentions = mentioned.filter((id) => normalizedAgentMembers.includes(id));
  if (validMentions.length > 0) return validMentions;

  // Auto-trigger logic
  const autoAgent = shouldAutoTriggerAgent(channelType, normalizedAgentMembers);
  if (autoAgent) return [autoAgent];

  return [];
}

/** Get agent member IDs from channel_members */
export async function getAgentMembersForChannel(channelId: string): Promise<string[]> {
  const { data } = await supabase
    .from("channel_members")
    .select("user_id, member_type")
    .eq("channel_id", channelId);

  if (!data) return [];

  // Filter to agent members
  return (data as any[])
    .filter((m) => m.member_type === "agent")
    .map((m) => normalizeAgentId(m.user_id))
    .filter(isOfficialAgentId);
}

/** Call the edge function to get an agent reply */
export async function triggerAgentReply(
  channelId: string,
  agentId: string,
  latestUserMessage?: string
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? undefined;

  await supabase.functions.invoke("channel-agent-reply", {
    body: {
      channel_id: channelId,
      agent_id: agentId,
      message_count: 10,
      latest_user_message: latestUserMessage ?? null,
      user_id: userId ?? null,
    },
  });
}

export function startChannelAgentReplies({
  channelId,
  channelType,
  agentMembers,
  messageText,
}: {
  channelId: string;
  channelType: string;
  agentMembers: string[];
  messageText: string;
}): string[] {
  const pendingAgents = getPendingAgentsForChannel(channelId);
  const respondingAgents = getRespondingAgents(messageText, channelType, agentMembers).filter(
    (agentId) => !pendingAgents.includes(agentId)
  );

  for (const agentId of respondingAgents) {
    setChannelAgentPending(channelId, agentId, true);
    void triggerAgentReply(channelId, agentId, messageText)
      .catch((error) => {
        console.error("Agent reply trigger error:", error);
      })
      .finally(() => {
        setChannelAgentPending(channelId, agentId, false);
      });
  }

  return respondingAgents;
}

export function getAgentDisplayName(agentId: string): string {
  return getAgentDisplayNameById(agentId);
}

export function isAgentId(userId: string): boolean {
  return isLikelyAgentId(userId);
}
