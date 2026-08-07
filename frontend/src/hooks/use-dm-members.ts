import { api } from "@/lib/api";
import { useState, useEffect, useMemo } from "react";
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
      // O join é do banco: buscar membros, peneirar quem não sou eu e então
      // buscar os perfis dava duas viagens e um Map no navegador.
      const linhas = await api<Array<{
        channel_id: string;
        user_id: string;
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
        status: string | null;
      }>>("/channels/dms/interlocutores").catch(() => null);

      if (cancelled || !linhas) return;

      const dmSet = new Set(dmIds);
      const result: Record<string, DmPeerInfo> = {};
      for (const l of linhas) {
        if (!dmSet.has(l.channel_id)) continue;
        result[l.channel_id] = {
          channelId: l.channel_id,
          peerId: l.user_id,
          peerName: l.full_name || l.email || "Usuário",
          peerAvatar: l.avatar_url || null,
          peerStatus: l.status || "offline",
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
