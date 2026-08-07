/**
 * Centralized key-value settings stored in Supabase app_settings table.
 * Replaces ALL localStorage usage across the app.
 */
import { api } from "@/lib/api";

// In-memory cache to avoid repeated DB reads within a session
const cache = new Map<string, any>();

export async function getSetting<T = any>(key: string): Promise<T | null> {
  if (cache.has(key)) return cache.get(key) as T;

  const data = await api<{ value: T | null }>(
    `/configuracoes/${encodeURIComponent(key)}`,
  ).catch(() => null);

  if (data && data.value !== null) {
    cache.set(key, data.value);
    return data.value;
  }
  return null;
}

export async function setSetting<T = any>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  // O `updated_at` é `now()` do servidor: o horário do navegador adiantado
  // fazia "alterado há 5 minutos" virar "daqui a 5 minutos".
  await api(`/configuracoes/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  cache.delete(key);
  await api(`/configuracoes/${encodeURIComponent(key)}`, { method: "DELETE" });
}
