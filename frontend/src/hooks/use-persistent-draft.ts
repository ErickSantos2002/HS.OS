import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthContext } from "@/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";

const draftCache = new Map<string, string>();

function getCacheKey(userId: string, draftKey: string) {
  return `${userId}:${draftKey}`;
}

function getStorageKey(userId: string, draftKey: string) {
  return `draft:${userId}:${draftKey}`;
}

function readLocalDraft(userId: string, draftKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getStorageKey(userId, draftKey)) ?? "";
  } catch {
    return "";
  }
}

function writeLocalDraft(userId: string, draftKey: string, content: string) {
  if (typeof window === "undefined") return;
  try {
    const key = getStorageKey(userId, draftKey);
    if (content) window.localStorage.setItem(key, content);
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore quota errors */
  }
}

async function persistDraft(userId: string, draftKey: string, content: string, cacheKey: string) {
  const normalizedContent = content;

  if (normalizedContent) {
    const { error } = await supabase
      .from("drafts")
      .upsert({ user_id: userId, draft_key: draftKey, content: normalizedContent }, { onConflict: "user_id,draft_key" });

    if (error) throw error;
    draftCache.set(cacheKey, normalizedContent);
    return normalizedContent;
  }

  const { error } = await supabase
    .from("drafts")
    .delete()
    .eq("user_id", userId)
    .eq("draft_key", draftKey);

  if (error) throw error;
  draftCache.delete(cacheKey);
  return "";
}

export function usePersistentDraft(draftKey: string | null) {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const cacheKey = useMemo(() => (userId && draftKey ? getCacheKey(userId, draftKey) : null), [draftKey, userId]);

  const initialValue = useMemo(() => {
    if (!userId || !draftKey || !cacheKey) return "";
    return readLocalDraft(userId, draftKey) || draftCache.get(cacheKey) || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const [value, setValueState] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const lastSyncedRef = useRef(initialValue);
  const valueRef = useRef(initialValue);
  const dirtyDuringLoadRef = useRef(false);
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const activeKeyRef = useRef<string | null>(cacheKey);

  // Synchronously reset state when the draft key changes so the consumer
  // never sees the previous chat's draft on the first render after a switch.
  // NOTE: do not mutate valueRef here — pending flush of the previous key
  // (run in effect cleanup below) still needs the old value.
  if (activeKeyRef.current !== cacheKey) {
    activeKeyRef.current = cacheKey;
    dirtyDuringLoadRef.current = false;
    setValueState(initialValue);
  }

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setValue = useCallback(
    (next: string | ((prev: string) => string)) => {
      setValueState((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        valueRef.current = resolved;
        if (loading) dirtyDuringLoadRef.current = true;

        if (cacheKey) {
          if (resolved) draftCache.set(cacheKey, resolved);
          else draftCache.delete(cacheKey);
        }

        // Immediate local persistence so refresh never loses the in-progress text.
        if (userId && draftKey) writeLocalDraft(userId, draftKey, resolved);

        if (resolved === previous) return previous;
        return resolved;
      });
    },
    [cacheKey, draftKey, loading, userId],
  );

  const clear = useCallback(() => {
    setValue("");
  }, [setValue]);

  useEffect(() => {
    persistRef.current = async () => {
      if (!userId || !draftKey || !cacheKey) return;
      if (valueRef.current === lastSyncedRef.current) return;

      try {
        const persistedValue = await persistDraft(userId, draftKey, valueRef.current, cacheKey);
        lastSyncedRef.current = persistedValue;
      } catch (error) {
        console.error("Failed to persist draft", error);
      }
    };
  }, [cacheKey, draftKey, userId]);

  useEffect(() => {
    let cancelled = false;

    if (!userId || !draftKey || !cacheKey) {
      setValueState("");
      valueRef.current = "";
      lastSyncedRef.current = "";
      dirtyDuringLoadRef.current = false;
      setLoading(false);
      return;
    }

    // Prefer localStorage first for instant restoration after refresh, then fall back to in-memory cache.
    const localValue = readLocalDraft(userId, draftKey);
    const cachedValue = localValue || draftCache.get(cacheKey) || "";
    setValueState(cachedValue);
    valueRef.current = cachedValue;
    lastSyncedRef.current = cachedValue;
    dirtyDuringLoadRef.current = false;
    setLoading(true);

    void supabase
      .from("drafts")
      .select("content")
      .eq("user_id", userId)
      .eq("draft_key", draftKey)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          console.error("Failed to load draft", error);
          setLoading(false);
          return;
        }

        const remoteValue = data?.content ?? "";

        // Choose the more recent value: if the user already typed locally (dirty), keep local.
        // Otherwise, server wins (covers cross-device case where another session typed something).
        if (dirtyDuringLoadRef.current) {
          if (remoteValue) draftCache.set(cacheKey, remoteValue);
          else draftCache.delete(cacheKey);
          lastSyncedRef.current = remoteValue;
          setLoading(false);
          return;
        }

        if (remoteValue !== valueRef.current) {
          setValueState(remoteValue);
          valueRef.current = remoteValue;
          writeLocalDraft(userId, draftKey, remoteValue);
        }
        if (remoteValue) draftCache.set(cacheKey, remoteValue);
        else draftCache.delete(cacheKey);
        lastSyncedRef.current = remoteValue;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, draftKey, userId]);

  // Cross-device realtime sync: listen for updates from other sessions of the same user.
  useEffect(() => {
    if (!userId || !draftKey || !cacheKey) return;

    // O evento diz que `drafts` mudou, não qual virou o quê — então o conteúdo
    // vem do endpoint. Vai pelo tópico da pessoa: o backend roteia por
    // `user_id`, então só as sessões DELA recebem, que é justamente o ponto
    // deste hook (sincronizar rascunho entre dispositivos do mesmo usuário).
    const cancelar = assinar(`usuario:${userId}`, async (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela !== "drafts") return;

      const { content } = await api<{ content: string }>(
        `/drafts/${encodeURIComponent(draftKey)}`,
      ).catch(() => ({ content: "" }));
      const incoming = content ?? "";

      // Eco da nossa própria escrita — ignorar, senão o cursor pula enquanto
      // a pessoa digita.
      if (incoming === valueRef.current) return;
      if (incoming === lastSyncedRef.current) return;

      setValueState(incoming);
      valueRef.current = incoming;
      lastSyncedRef.current = incoming;
      if (incoming) draftCache.set(cacheKey, incoming);
      else draftCache.delete(cacheKey);
      writeLocalDraft(userId, draftKey, incoming);
    });

    return () => {
      cancelar();
    };
  }, [cacheKey, draftKey, userId]);

  useEffect(() => {
    let cancelled = false;

    if (!userId || !draftKey || !cacheKey) {
      setValueState("");
      valueRef.current = "";
      lastSyncedRef.current = "";
      dirtyDuringLoadRef.current = false;
      setLoading(false);
      return;
    }

    // Prefer localStorage first for instant restoration after refresh, then fall back to in-memory cache.
    const localValue = readLocalDraft(userId, draftKey);
    const cachedValue = localValue || draftCache.get(cacheKey) || "";
    setValueState(cachedValue);
    valueRef.current = cachedValue;
    lastSyncedRef.current = cachedValue;
    dirtyDuringLoadRef.current = false;
    setLoading(true);

    void supabase
      .from("drafts")
      .select("content")
      .eq("user_id", userId)
      .eq("draft_key", draftKey)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          console.error("Failed to load draft", error);
          setLoading(false);
          return;
        }

        const remoteValue = data?.content ?? "";

        // Choose the more recent value: if the user already typed locally (dirty), keep local.
        // Otherwise, server wins (covers cross-device case where another session typed something).
        if (dirtyDuringLoadRef.current) {
          if (remoteValue) draftCache.set(cacheKey, remoteValue);
          else draftCache.delete(cacheKey);
          lastSyncedRef.current = remoteValue;
          setLoading(false);
          return;
        }

        if (remoteValue !== valueRef.current) {
          setValueState(remoteValue);
          valueRef.current = remoteValue;
          writeLocalDraft(userId, draftKey, remoteValue);
        }
        if (remoteValue) draftCache.set(cacheKey, remoteValue);
        else draftCache.delete(cacheKey);
        lastSyncedRef.current = remoteValue;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, draftKey, userId]);

  // Cross-device realtime sync: listen for updates from other sessions of the same user.
  useEffect(() => {
    if (!userId || !draftKey || !cacheKey) return;

    const cancelar = assinar(`usuario:${userId}`, async (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela !== "drafts") return;

      const { content } = await api<{ content: string }>(
        `/drafts/${encodeURIComponent(draftKey)}`,
      ).catch(() => ({ content: "" }));
      const incoming = content ?? "";
      if (incoming === valueRef.current) return;
      if (incoming === lastSyncedRef.current) return;

      setValueState(incoming);
      valueRef.current = incoming;
      lastSyncedRef.current = incoming;
      if (incoming) draftCache.set(cacheKey, incoming);
      else draftCache.delete(cacheKey);
      writeLocalDraft(userId, draftKey, incoming);
    });

    return () => {
      cancelar();
    };
  }, [cacheKey, draftKey, userId]);

  useEffect(() => {
    if (!userId || !draftKey || !cacheKey || loading) return;
    if (value === lastSyncedRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void persistRef.current();
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cacheKey, draftKey, loading, userId, value]);

  useEffect(() => {
    if (!userId || !draftKey || !cacheKey) return;

    return () => {
      void persistRef.current();
    };
  }, [cacheKey, draftKey, userId]);

  useEffect(() => {
    const flushDraft = () => {
      void persistRef.current();
    };

    window.addEventListener("beforeunload", flushDraft);
    return () => {
      window.removeEventListener("beforeunload", flushDraft);
    };
  }, []);

  return {
    value,
    setValue,
    clear,
    loading,
  };
}
