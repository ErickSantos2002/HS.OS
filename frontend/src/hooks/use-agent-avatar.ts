import { useState, useEffect, useCallback } from "react";
import { toCanonicalAgentId } from "@/lib/agent-id";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for sync access from components that don't use the hook
const avatarCache = new Map<string, string>();
const brokenAvatarUrls = new Set<string>();

function canonicalizeAgentId(agentId: string) {
  return toCanonicalAgentId(agentId).trim().toLowerCase();
}

function withCacheBust(url: string) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

function stripCacheBust(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("t");
    return parsed.toString();
  } catch {
    return url.split("?t=")[0].split("&t=")[0];
  }
}

function addCandidate(candidates: string[], url: string | null | undefined) {
  const clean = url?.trim();
  if (!clean) return;
  const stable = stripCacheBust(clean);
  if (brokenAvatarUrls.has(stable)) return;
  if (!candidates.some((existing) => stripCacheBust(existing) === stable)) {
    candidates.push(stable);
  }
}

function buildPublicAvatarUrl(path: string) {
  const { data } = supabase.storage.from("agent-files").getPublicUrl(path);
  return withCacheBust(data.publicUrl);
}

async function canLoadImage(url: string): Promise<boolean> {
  if (typeof window === "undefined") return true;

  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function firstLoadableAvatar(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const cacheBusted = withCacheBust(candidate);
    if (await canLoadImage(cacheBusted)) return cacheBusted;
    brokenAvatarUrls.add(stripCacheBust(candidate));
  }
  return null;
}

async function discoverAvatarUrl(agentId: string): Promise<string | null> {
  // Only look for explicitly named avatar files under avatars/<id>.<ext>.
  // Do NOT scan the agent's working folder (<agentId>/...) — that contains
  // arbitrary user uploads (screenshots, docs) and would pick them as avatars.
  const candidates: string[] = [];
  ["png", "jpg", "jpeg", "webp"].forEach((ext) => {
    candidates.push(buildPublicAvatarUrl(`avatars/${agentId}.${ext}`));
  });

  return firstLoadableAvatar(candidates);
}

async function resolveAvatarUrl(agentId: string, savedUrl: string | null | undefined) {
  const candidates: string[] = [];
  if (savedUrl) {
    addCandidate(candidates, savedUrl);
  }
  const saved = await firstLoadableAvatar(candidates);
  return saved ?? discoverAvatarUrl(agentId);
}

/** Sync accessor — returns cached value or null */
export function getAgentAvatar(agentId: string): string | null {
  const canonical = canonicalizeAgentId(agentId);
  return avatarCache.get(canonical) ?? null;
}

export function markAgentAvatarBroken(agentId: string, url: string | null | undefined) {
  const canonical = canonicalizeAgentId(agentId);
  if (url) brokenAvatarUrls.add(stripCacheBust(url));
  if (avatarCache.get(canonical) === url) avatarCache.delete(canonical);
}

/** Fetch all avatar URLs from DB into cache (call once on app load) */
let allAvatarsLoaded = false;
let allAvatarsPromise: Promise<Record<string, string>> | null = null;

export async function loadAllAvatars(): Promise<Record<string, string>> {
  // Only fetch lightweight avatar_url column — never avatar_data
  const [avatarRows, profileRows] = await Promise.all([
    supabase.from("agent_avatars").select("agent_id, avatar_url"),
    supabase.from("agent_profiles").select("agent_id, openclaw_id, avatar_url"),
  ]);

  const candidatesByAgent = new Map<string, string[]>();
  const ensureCandidates = (agentId: string) => {
    const canonical = canonicalizeAgentId(agentId);
    if (!canonical) return null;
    const existing = candidatesByAgent.get(canonical) ?? [];
    candidatesByAgent.set(canonical, existing);
    return existing;
  };

  for (const row of (avatarRows.data ?? []) as Array<{ agent_id: string; avatar_url: string | null }>) {
    const candidates = ensureCandidates(row.agent_id);
    if (candidates) addCandidate(candidates, row.avatar_url);
  }

  for (const row of (profileRows.data ?? []) as Array<{ agent_id: string; openclaw_id: string | null; avatar_url: string | null }>) {
    const candidates = ensureCandidates(row.agent_id);
    if (candidates) addCandidate(candidates, row.avatar_url);
    if (row.openclaw_id && row.openclaw_id !== row.agent_id) {
      const aliasCandidates = ensureCandidates(row.openclaw_id);
      if (aliasCandidates) addCandidate(aliasCandidates, row.avatar_url);
    }
  }

  const map: Record<string, string> = {};
  await Promise.all(
    Array.from(candidatesByAgent.entries()).map(async ([canonical, candidates]) => {
      const namedFallback = await discoverAvatarUrl(canonical);
      if (namedFallback) addCandidate(candidates, namedFallback);
      const url = await firstLoadableAvatar(candidates);
      if (url) {
        avatarCache.set(canonical, url);
        map[canonical] = url;
      } else {
        avatarCache.delete(canonical);
      }
    }),
  );

  // Named files may exist for agents that do not have a DB avatar row yet.
  const knownIds = new Set<string>([
    ...Array.from(candidatesByAgent.keys()),
    "lia", "kira", "milo", "radar", "rodrigo", "cs", "rock", "sigma",
  ]);
  await Promise.all(
    Array.from(knownIds).map(async (canonical) => {
      if (map[canonical]) return;
      const discovered = await discoverAvatarUrl(canonical);
      if (discovered) {
        avatarCache.set(canonical, discovered);
        map[canonical] = discovered;
      }
    }),
  );

  // Rodrigo IA is still referenced both ways in a few legacy places.
  if (map.rodrigo && !map["rodrigo-ia"]) {
    avatarCache.set("rodrigo-ia", map.rodrigo);
    map["rodrigo-ia"] = map.rodrigo;
  }
  if (map["rodrigo-ia"] && !map.rodrigo) {
    avatarCache.set("rodrigo", map["rodrigo-ia"]);
    map.rodrigo = map["rodrigo-ia"];
  }

  allAvatarsLoaded = true;
  return map;
}

async function loadAvatarForAgent(canonical: string): Promise<string | null> {
  const candidates: string[] = [];
  const [avatarRow, profileRows] = await Promise.all([
    supabase
      .from("agent_avatars")
      .select("avatar_url")
      .eq("agent_id", canonical)
      .maybeSingle(),
    supabase
      .from("agent_profiles")
      .select("agent_id, openclaw_id, avatar_url")
      .or(`agent_id.eq.${canonical},openclaw_id.eq.${canonical}`),
  ]);

  addCandidate(candidates, avatarRow.data?.avatar_url ?? null);
  for (const row of (profileRows.data ?? []) as Array<{ avatar_url: string | null }>) {
    addCandidate(candidates, row.avatar_url);
  }

  const saved = await firstLoadableAvatar(candidates);
  if (saved) return saved;

  if (canonical === "rodrigo-ia") {
    return loadAvatarForAgent("rodrigo");
  }

  return discoverAvatarUrl(canonical);
}

export async function refreshAgentAvatar(agentId: string): Promise<string | null> {
  const canonical = canonicalizeAgentId(agentId);
  const url = await loadAvatarForAgent(canonical);
  if (url) {
    avatarCache.set(canonical, url);
    return url;
  }
  avatarCache.delete(canonical);
  return null;
}

export function useResolvedAgentAvatar(agentId?: string | null) {
  const canonical = agentId ? canonicalizeAgentId(agentId) : "";
  const [avatar, setAvatar] = useState<string | null>(() => (canonical ? avatarCache.get(canonical) ?? null : null));

  useEffect(() => {
    if (!canonical) {
      setAvatar(null);
      return;
    }
    setAvatar(avatarCache.get(canonical) ?? null);
    let cancelled = false;
    loadAllAvatarsSingleton().then(() => {
      if (!cancelled) setAvatar(avatarCache.get(canonical) ?? null);
    });
    return () => { cancelled = true; };
  }, [canonical]);

  const handleBrokenAvatar = useCallback(() => {
    if (!canonical) return;
    const current = avatarCache.get(canonical) ?? avatar;
    markAgentAvatarBroken(canonical, current);
    setAvatar(null);
    refreshAgentAvatar(canonical).then((next) => setAvatar(next));
  }, [avatar, canonical]);

  return { avatar, handleBrokenAvatar };
}

function loadAllAvatarsSingleton(): Promise<Record<string, string>> {
  if (!allAvatarsPromise) {
    allAvatarsPromise = loadAllAvatars().finally(() => { allAvatarsPromise = null; });
  }
  return allAvatarsPromise;
}

// Eagerly preload avatar URLs at module import time (lightweight — only URLs)
loadAllAvatarsSingleton();

/** Upload base64 data URL to Storage and return the public URL */
async function uploadAvatarToStorage(agentId: string, dataUrl: string): Promise<string> {
  // Convert data URL to blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type.includes("png") ? "png" : "jpg";
  const path = `avatars/${agentId}.${ext}`;

  // Upload (upsert)
  const { error } = await supabase.storage
    .from("agent-files")
    .upload(path, blob, { upsert: true, contentType: blob.type });

  if (error) throw error;

  const { data } = supabase.storage.from("agent-files").getPublicUrl(path);
  // Add cache-busting param
  return `${data.publicUrl}?t=${Date.now()}`;
}

export function useAgentAvatar(agentId: string) {
  const canonical = canonicalizeAgentId(agentId);
  const [avatar, setAvatarState] = useState<string | null>(() => avatarCache.get(canonical) ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = await loadAvatarForAgent(canonical);
      if (cancelled) return;
      if (url) {
        avatarCache.set(canonical, url);
        setAvatarState(url);
      } else {
        avatarCache.delete(canonical);
        setAvatarState(null);
      }
    })();
    return () => { cancelled = true; };
  }, [canonical]);

  const setAvatar = useCallback(async (dataUrl: string | null) => {
    if (dataUrl) {
      // Upload to storage, then save URL in DB
      const publicUrl = await uploadAvatarToStorage(canonical, dataUrl);
      avatarCache.set(canonical, publicUrl);
      setAvatarState(publicUrl);
      await supabase.from("agent_avatars").upsert(
        { agent_id: canonical, avatar_url: publicUrl, avatar_data: "migrated", updated_at: new Date().toISOString() },
        { onConflict: "agent_id" }
      );
    } else {
      avatarCache.delete(canonical);
      setAvatarState(null);
      await supabase.from("agent_avatars").delete().eq("agent_id", canonical);
      // Also delete from storage
      await supabase.storage.from("agent-files").remove([`avatars/${canonical}.png`, `avatars/${canonical}.jpg`]);
    }
  }, [canonical]);

  const pickAvatar = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    };
    input.click();
  }, [setAvatar]);

  return { avatar, setAvatar, pickAvatar };
}

/** Hook to bulk-load all avatars (for list pages) */
export function useAllAvatars() {
  const [avatars, setAvatars] = useState<Record<string, string>>(() => {
    if (allAvatarsLoaded) return Object.fromEntries(avatarCache.entries());
    return {};
  });

  useEffect(() => {
    let cancelled = false;
    loadAllAvatarsSingleton().then((map) => {
      if (!cancelled) setAvatars(map);
    });
    return () => { cancelled = true; };
  }, []);

  return avatars;
}
