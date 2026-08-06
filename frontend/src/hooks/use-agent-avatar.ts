import { useState, useEffect, useCallback } from "react";
import { toCanonicalAgentId } from "@/lib/agent-id";
import { api } from "@/lib/api";
import { enviarArquivo, removerArquivos, urlPublica } from "@/lib/storage";

/** O que `/agents` devolve e este hook usa. */
interface AgenteComAvatar {
  id: string;
  openclawId: string | null;
  avatarUrl: string | null;
}

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
  return withCacheBust(urlPublica("agent-files", path));
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
  // Antes eram duas consultas — `agent_avatars` e `agent_profiles`. O
  // `/agents` já junta as duas fontes no servidor e devolve `avatarUrl`, então
  // basta uma. A tabela `agent_avatars` deixou de ser lida daqui.
  const { agents } = await api<{ agents: AgenteComAvatar[] }>("/agents?incluir_inativos=true");

  const candidatesByAgent = new Map<string, string[]>();
  const ensureCandidates = (agentId: string) => {
    const canonical = canonicalizeAgentId(agentId);
    if (!canonical) return null;
    const existing = candidatesByAgent.get(canonical) ?? [];
    candidatesByAgent.set(canonical, existing);
    return existing;
  };

  for (const row of agents) {
    const candidates = ensureCandidates(row.id);
    if (candidates) addCandidate(candidates, row.avatarUrl);
    // O agente pode ser referido pelo id do gateway; o alias aponta para a
    // mesma foto.
    if (row.openclawId && row.openclawId !== row.id) {
      const alias = ensureCandidates(row.openclawId);
      if (alias) addCandidate(alias, row.avatarUrl);
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
  try {
    const { agents } = await api<{ agents: AgenteComAvatar[] }>("/agents?incluir_inativos=true");
    for (const row of agents) {
      if (canonicalizeAgentId(row.id) === canonical
          || (row.openclawId && canonicalizeAgentId(row.openclawId) === canonical)) {
        addCandidate(candidates, row.avatarUrl);
      }
    }
  } catch (e) {
    console.warn("[avatar] Não foi possível consultar os agentes:", e);
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
  await enviarArquivo("agent-files", path, blob, `avatar.${ext}`);
  // O caminho é sempre o mesmo, então sem o `?t=` o navegador mostraria a foto
  // anterior até o cache expirar.
  return `${urlPublica("agent-files", path)}?t=${Date.now()}`;
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
      // A URL passa a viver em `agent_profiles.avatar_url`, que é o que o
      // `/agents` devolve. A tabela `agent_avatars` sai do caminho.
      await api(`/agents/${encodeURIComponent(canonical)}`, {
        method: "PATCH",
        body: { avatar_url: publicUrl },
      });
    } else {
      avatarCache.delete(canonical);
      setAvatarState(null);
      await api(`/agents/${encodeURIComponent(canonical)}`, {
        method: "PATCH",
        body: { avatar_url: null },
      });
      // As duas extensões: a tela não sabe qual foi gravada, e apagar o que não
      // existe não é erro.
      await removerArquivos("agent-files", [
        `avatars/${canonical}.png`,
        `avatars/${canonical}.jpg`,
      ]);
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
