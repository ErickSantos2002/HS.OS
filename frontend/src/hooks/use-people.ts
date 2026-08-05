import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { useAuthContext } from "@/contexts/auth-context";
import { derivePresence, type Presence } from "@/lib/presence-status";

export interface Person {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  status: string;
  last_seen_at: string | null;
  presence: Presence;
  custom_status: string | null;
  custom_status_emoji: string | null;
  custom_status_set_at: string | null;
}

let cachedPeople: Person[] | null = null;

export function usePeople() {
  const { user } = useAuthContext();
  const [people, setPeople] = useState<Person[]>(cachedPeople || []);
  const [loading, setLoading] = useState(!cachedPeople);

  const fetchPeople = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api<Array<Omit<Person, "presence">>>("/profiles");
      if (data && data.length > 0) {
        const enriched = data.map((p) => ({
          ...p,
          presence: derivePresence(p.last_seen_at),
        }));
        cachedPeople = enriched;
        setPeople(enriched);
      }
    } catch (err) {
      console.error("Erro ao carregar pessoas:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  // Re-derive presence every 60s so dots fade to away/offline without refetching
  useEffect(() => {
    const id = setInterval(() => {
      setPeople((prev) =>
        prev.map((p) => ({ ...p, presence: derivePresence(p.last_seen_at) })),
      );
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Antes havia uma assinatura de realtime do Supabase que sincronizava
  // custom_status entre abas. O substituto (WebSocket próprio) ainda não
  // existe; até lá, a lista atualiza no refetch e a presença é re-derivada a
  // cada 60s pelo efeito acima. Nada quebra — só demora mais a refletir.

  return { people, loading, refetch: fetchPeople };
}

/** Find or create a DM channel using server-side RPC (atomic, no RLS issues) */
export async function findOrCreateDm(
  _currentUserId: string,
  targetUserId: string,
  targetName: string
): Promise<string | null> {
  // TODO: ainda no Supabase — pertence ao lote do chat (channels/conversations),
  // que será portado em seguida.
  const { data, error } = await supabase.rpc("find_or_create_dm", {
    _target_user_id: targetUserId,
    _target_name: targetName,
  });
  if (error) {
    console.error("Erro ao buscar/criar DM:", error);
    return null;
  }
  return data as string;
}
