import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DmReadRow {
  channel_id: string;
  user_id: string;
  last_read_at: string;
}

/**
 * Tracks read receipts for a human-to-human DM channel.
 * - peerLastReadAt: when the other participant last read the channel.
 * - markRead(): upserts current user's last_read_at = now().
 */
export function useDmReads(channelId: string | null, peerUserId: string | null, currentUserId: string | null) {
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);
  const lastMarkRef = useRef<number>(0);

  const safeSet = useCallback((value: unknown) => {
    if (typeof value !== "string" || !value) {
      setPeerLastReadAt(null);
      return;
    }
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms) || ms <= 0) {
      setPeerLastReadAt(null);
      return;
    }
    setPeerLastReadAt(value);
  }, []);

  useEffect(() => {
    if (!channelId || !peerUserId) {
      setPeerLastReadAt(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const { last_read_at } = await api<{ last_read_at: string | null }>(
        `/dm-reads/${channelId}?user_id=${encodeURIComponent(peerUserId)}`,
      ).catch(() => ({ last_read_at: null }));
      if (cancelled) return;
      safeSet(last_read_at ?? null);
    };
    load();

    // O evento diz que `dm_reads` mudou neste canal, não o que virou — quem
    // devolve o horário é o endpoint, com o RLS valendo. Vai pelo tópico do
    // canal porque o backend roteia por `channel_id`.
    const cancelar = assinar(`canal:${channelId}`, (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela === "dm_reads") void load();
    });

    return () => {
      cancelled = true;
      cancelar();
    };
  }, [channelId, peerUserId]);

  const markRead = useCallback(async () => {
    if (!channelId || !currentUserId) return;
    // Throttle: at most one upsert every 2s
    const now = Date.now();
    if (now - lastMarkRef.current < 2000) return;
    lastMarkRef.current = now;
    await supabase
      .from("dm_reads")
      .upsert(
        { channel_id: channelId, user_id: currentUserId, last_read_at: new Date().toISOString() } as any,
        { onConflict: "channel_id,user_id" },
      );
  }, [channelId, currentUserId]);

  return { peerLastReadAt, markRead };
}
