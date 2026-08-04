import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, status, last_seen_at, custom_status, custom_status_emoji, custom_status_set_at")
        .order("full_name", { ascending: true });
      if (error) {
        console.error("Erro ao carregar pessoas:", error);
      }
      if (data && data.length > 0) {
        const enriched = (data as Array<Omit<Person, "presence">>).map((p) => ({
          ...p,
          presence: derivePresence(p.last_seen_at),
        }));
        cachedPeople = enriched;
        setPeople(enriched);
      }
    } catch (err) {
      console.error("Erro inesperado ao carregar pessoas:", err);
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

  // Realtime: when any profile's custom_status changes, patch the matching row
  // so chat list + DM headers update without a page refresh.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("profiles-status-sync")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const next = payload.new as Partial<Person> & { id: string };
          setPeople((prev) => {
            const updated = prev.map((p) =>
              p.id === next.id
                ? {
                    ...p,
                    full_name: next.full_name ?? p.full_name,
                    avatar_url: next.avatar_url ?? p.avatar_url,
                    status: next.status ?? p.status,
                    last_seen_at: next.last_seen_at ?? p.last_seen_at,
                    custom_status: next.custom_status ?? null,
                    custom_status_emoji: next.custom_status_emoji ?? null,
                    custom_status_set_at: next.custom_status_set_at ?? null,
                    presence: derivePresence(next.last_seen_at ?? p.last_seen_at),
                  }
                : p,
            );
            cachedPeople = updated;
            return updated;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);


  return { people, loading, refetch: fetchPeople };
}

/** Find or create a DM channel using server-side RPC (atomic, no RLS issues) */
export async function findOrCreateDm(
  _currentUserId: string,
  targetUserId: string,
  targetName: string
): Promise<string | null> {
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
