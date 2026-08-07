import { assinarTabela } from "@/lib/realtime";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Reaction {
  emoji: string;
  user_ids: string[];
  count: number;
}

export interface MessageReactions {
  [messageId: string]: Reaction[];
}

export function useMessageReactions(channelId: string | null) {
  const [reactions, setReactions] = useState<MessageReactions>({});

  const buildReactionsMap = (rows: any[]): MessageReactions => {
    const map: MessageReactions = {};
    for (const row of rows) {
      if (!map[row.message_id]) map[row.message_id] = [];
      const existing = map[row.message_id].find((r) => r.emoji === row.emoji);
      if (existing) {
        existing.user_ids.push(row.user_id);
        existing.count++;
      } else {
        map[row.message_id].push({ emoji: row.emoji, user_ids: [row.user_id], count: 1 });
      }
    }
    return map;
  };

  const applyReactionUpdate = useCallback(
    (
      current: MessageReactions,
      messageId: string,
      emoji: string,
      userId: string,
      shouldAdd: boolean,
    ): MessageReactions => {
      const currentMessageReactions = current[messageId] ?? [];
      const nextMessageReactions = [...currentMessageReactions];
      const reactionIndex = nextMessageReactions.findIndex((reaction) => reaction.emoji === emoji);

      if (shouldAdd) {
        if (reactionIndex >= 0) {
          const reaction = nextMessageReactions[reactionIndex];
          if (!reaction.user_ids.includes(userId)) {
            nextMessageReactions[reactionIndex] = {
              ...reaction,
              user_ids: [...reaction.user_ids, userId],
              count: reaction.count + 1,
            };
          }
        } else {
          nextMessageReactions.push({ emoji, user_ids: [userId], count: 1 });
        }
      } else if (reactionIndex >= 0) {
        const reaction = nextMessageReactions[reactionIndex];
        const nextUserIds = reaction.user_ids.filter((id) => id !== userId);

        if (nextUserIds.length === 0) {
          nextMessageReactions.splice(reactionIndex, 1);
        } else {
          nextMessageReactions[reactionIndex] = {
            ...reaction,
            user_ids: nextUserIds,
            count: nextUserIds.length,
          };
        }
      }

      if (nextMessageReactions.length === 0) {
        const { [messageId]: _, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [messageId]: nextMessageReactions,
      };
    },
    [],
  );

  const load = useCallback(async () => {
    if (!channelId) {
      setReactions({});
      return;
    }

    const { data: messagesData } = await supabase
      .from("channel_messages")
      .select("id")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(200);

    const messageIds = messagesData?.map((message: any) => message.id) ?? [];

    if (messageIds.length === 0) {
      setReactions({});
      return;
    }

    const { data } = await supabase
      .from("message_reactions")
      .select("*")
      .in("message_id", messageIds);

    setReactions(data ? buildReactionsMap(data) : {});
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;

    load();

    const cancelar =
      assinarTabela("message_reactions", () => { load(); });

    return cancelar;
  }, [channelId, load]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    const existing = reactions[messageId]?.find((r) => r.emoji === emoji);
    const alreadyReacted = existing?.user_ids.includes(userId) ?? false;
    const previousReactions = reactions;

    setReactions((current) => applyReactionUpdate(current, messageId, emoji, userId, !alreadyReacted));

    const { error } = alreadyReacted
      ? await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
        .eq("emoji", emoji)
      : await supabase
        .from("message_reactions")
        .insert({ message_id: messageId, user_id: userId, emoji } as any);

    if (error) {
      setReactions(previousReactions);
      return;
    }

    await load();
  }, [applyReactionUpdate, load, reactions]);

  return { reactions, toggleReaction };
}
