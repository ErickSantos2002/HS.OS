import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useState, useEffect, useCallback } from "react";

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

  /**
   * O agrupamento por (mensagem, emoji) agora vem do servidor — era montado
   * aqui a partir de uma linha por reação. Só falta a contagem, que é o
   * tamanho da lista.
   */
  const buildReactionsMap = (
    rows: { message_id: string; emoji: string; user_ids: string[] }[],
  ): MessageReactions => {
    const map: MessageReactions = {};
    for (const row of rows) {
      if (!map[row.message_id]) map[row.message_id] = [];
      map[row.message_id].push({
        emoji: row.emoji,
        user_ids: row.user_ids,
        count: row.user_ids.length,
      });
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

    // A busca das mensagens saiu daqui: o endpoint de reações já se limita às
    // recentes do canal. Eram duas idas para o que é uma.
    const data = await api<{ message_id: string; emoji: string; user_ids: string[] }[]>(
      `/channels/${channelId}/reactions`,
    ).catch(() => null);

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

    // O `user_id` sai do token no servidor: reagir em nome de outra pessoa não
    // é caso de uso, e mandá-lo daqui abria para isso.
    const error = await api("/reactions", {
      method: alreadyReacted ? "DELETE" : "POST",
      body: { message_id: messageId, emoji },
    }).then(() => null, (e: Error) => e);

    if (error) {
      setReactions(previousReactions);
      return;
    }

    await load();
  }, [applyReactionUpdate, load, reactions]);

  return { reactions, toggleReaction };
}
