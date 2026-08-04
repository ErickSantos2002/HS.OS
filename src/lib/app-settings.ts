/**
 * Centralized key-value settings stored in Supabase app_settings table.
 * Replaces ALL localStorage usage across the app.
 */
import { supabase } from "@/integrations/supabase/client";

// In-memory cache to avoid repeated DB reads within a session
const cache = new Map<string, any>();

export async function getSetting<T = any>(key: string): Promise<T | null> {
  if (cache.has(key)) return cache.get(key) as T;

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (data) {
    cache.set(key, data.value);
    return data.value as T;
  }
  return null;
}

export async function setSetting<T = any>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  await supabase
    .from("app_settings")
    .upsert(
      { key, value: value as any, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

export async function deleteSetting(key: string): Promise<void> {
  cache.delete(key);
  await supabase.from("app_settings").delete().eq("key", key);
}
