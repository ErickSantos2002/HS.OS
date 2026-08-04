import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ArenaSession {
  id: string;
  arena_id: string;
  title: string;
  parent_session_id: string | null;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface ArenaMessage {
  id: string;
  session_id: string;
  role: string;
  agent_id: string | null;
  agent_role: string | null;
  content: string | null;
  artifact_html: string | null;
  created_at: string;
}

export function useArenaSessions(arenaId: string | undefined) {
  const [sessions, setSessions] = useState<ArenaSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!arenaId) return;
    const { data } = await supabase
      .from("arena_sessions")
      .select("*")
      .eq("arena_id", arenaId)
      .order("created_at", { ascending: false });

    const sessionsData = (data ?? []) as ArenaSession[];

    // Get message counts
    for (const s of sessionsData) {
      const { count } = await supabase
        .from("arena_messages")
        .select("*", { count: "exact", head: true })
        .eq("session_id", s.id);
      s.message_count = count ?? 0;
    }

    setSessions(sessionsData);

    if (sessionsData.length > 0 && !activeSessionId) {
      setActiveSessionId(sessionsData[0].id);
    }
    setLoading(false);
  }, [arenaId, activeSessionId]);

  const loadMessages = useCallback(async () => {
    if (!activeSessionId) { setMessages([]); return; }
    const { data } = await supabase
      .from("arena_messages")
      .select("*")
      .eq("session_id", activeSessionId)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as ArenaMessage[]);
  }, [activeSessionId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  const createSession = useCallback(async (title?: string, inheritContext?: boolean) => {
    if (!arenaId) return null;

    let contextSummary: string | null = null;
    let parentId: string | null = null;

    if (inheritContext && sessions.length > 0) {
      const lastSession = sessions[0];
      parentId = lastSession.id;
      contextSummary = lastSession.context_summary || null;
    }

    const { data } = await supabase
      .from("arena_sessions")
      .insert({
        arena_id: arenaId,
        title: title || "Nova sessão",
        parent_session_id: parentId,
        context_summary: contextSummary,
      })
      .select()
      .single();

    if (data) {
      const newSession = data as ArenaSession;
      newSession.message_count = 0;
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      return newSession;
    }
    return null;
  }, [arenaId, sessions]);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    await supabase.from("arena_sessions").update({ title, updated_at: new Date().toISOString() }).eq("id", sessionId);
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    // Delete messages first (in case FK CASCADE isn't set)
    await supabase.from("arena_messages").delete().eq("session_id", sessionId);
    const { error } = await supabase.from("arena_sessions").delete().eq("id", sessionId);
    if (error) return false;
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      // Reassign active if we deleted the active one
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }
      return next;
    });
    return true;
  }, [activeSessionId]);

  const addMessage = useCallback(async (msg: Omit<ArenaMessage, "id" | "created_at">) => {
    const { data } = await supabase
      .from("arena_messages")
      .insert(msg)
      .select()
      .single();
    if (data) {
      const newMsg = data as ArenaMessage;
      setMessages((prev) => [...prev, newMsg]);
      setSessions((prev) => prev.map((s) =>
        s.id === msg.session_id ? { ...s, message_count: (s.message_count ?? 0) + 1 } : s
      ));
      return newMsg;
    }
    return null;
  }, []);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    messages,
    loading,
    createSession,
    updateSessionTitle,
    deleteSession,
    addMessage,
    refreshMessages: loadMessages,
  };
}
