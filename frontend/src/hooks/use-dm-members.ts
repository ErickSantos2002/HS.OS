import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Channel } from "@/hooks/use-channels";

export interface DmPeerInfo {
  channelId: string;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerStatus: string;
}

/**
 * For each DM channel, resolve who the "other person" is
 * by fetching members + profiles in a single batch.
 */
let cachedPeers: Record<string, DmPeerInfo> | null = null;

export function useDmPeers(channels: Channel[], currentUserId: string | undefined) {
  const dmChannels = useMemo(() => channels.filter((c) => c.type === "dm"), [channels]);
  const [peers, setPeers] = useState<Record<string, DmPeerInfo>>(cachedPeers || {});

  useEffect(() => {
    if (!currentUserId || dmChannels.length === 0) {
      setPeers({});
      return;
    }

    let cancelled = false;
    (async () => {
      const dmIds = dmChannels.map((c) => c.id);
      const { data: members } = await supabase
        .from("channel_members")
        .select("channel_id, user_id")
        .in("channel_id", dmIds)
        .eq("member_type", "human");

      if (cancelled || !members) return;

      const otherUserIds = new Set<string>();
      const channelToOther: Record<string, string> = {};
      for (const m of members) {
        if (m.user_id !== currentUserId) {
          channelToOther[m.channel_id] = m.user_id;
          otherUserIds.add(m.user_id);
        }
      }

      if (otherUserIds.size === 0) {
        setPeers({});
        return;
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, status")
        .in("id", Array.from(otherUserIds));

      if (cancelled || !profiles) return;

      const profileMap = new Map(profiles.map((p) => [p.id, p]));
      const result: Record<string, DmPeerInfo> = {};
      for (const [channelId, userId] of Object.entries(channelToOther)) {
        const profile = profileMap.get(userId);
        result[channelId] = {
          channelId,
          peerId: userId,
          peerName: profile?.full_name || profile?.email || "Usuário",
          peerAvatar: profile?.avatar_url || null,
          peerStatus: profile?.status || "offline",
        };
      }
      cachedPeers = result;
      setPeers(result);
    })();

    return () => { cancelled = true; };
  }, [dmChannels, currentUserId]);

  /** Reverse lookup: peerId → channelId */
  const peerIdToChannelId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const info of Object.values(peers)) {
      map[info.peerId] = info.channelId;
    }
    return map;
  }, [peers]);

  return { peers, peerIdToChannelId };
}
