import { getAgentDisplayNameById, isLikelyAgentId, isOfficialAgentId, normalizeAgentId } from "@/lib/active-agents";
import { api } from "@/lib/api";
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

/** Ids dos agentes que são membros do canal. */
export async function getAgentMembersForChannel(channelId: string): Promise<string[]> {
  const membros = await api<{ user_id: string; member_type: string }[]>(
    `/channels/${channelId}/members`,
  );
  return membros
    .filter((m) => m.member_type === "agent")
    .map((m) => normalizeAgentId(m.user_id))
    .filter(isOfficialAgentId);
}

/** Aciona o agente para responder no canal. Devolve assim que o backend aceita. */
export async function triggerAgentReply(
  channelId: string,
  agentId: string,
  _latestUserMessage?: string
): Promise<void> {
  // O contexto não vai mais daqui: o backend monta a partir de
  // `channel_messages`, que é a fonte, e assim a mensagem que dispara não
  // precisa dar a volta pelo navegador.
  await api(`/channels/${channelId}/agentes/${encodeURIComponent(agentId)}/responder`, {
    method: "POST",
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
