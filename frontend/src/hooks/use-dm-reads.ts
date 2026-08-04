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
      const { data } = await supabase
        .from("dm_reads")
        .select("last_read_at")
        .eq("channel_id", channelId)
        .eq("user_id", peerUserId)
        .maybeSingle();
      if (cancelled) return;
      safeSet((data as DmReadRow | null)?.last_read_at ?? null);
    };
    load();

    const sub = supabase
      .channel(`dm-reads-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_reads", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as DmReadRow | undefined;
          if (!row || row.user_id !== peerUserId) return;
          const newRow = payload.new as DmReadRow | undefined;
          if (newRow?.last_read_at) safeSet(newRow.last_read_at);
        },
      )
      .subscribe();


    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
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
