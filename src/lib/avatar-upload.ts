import { supabase } from "@/integrations/supabase/client";

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/** Upload a cropped avatar for a HUMAN user → updates profiles.avatar_url */
export async function uploadUserAvatar(userId: string, dataUrl: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `avatars/users/${userId}.png`;
  const { error } = await supabase.storage
    .from("agent-files")
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  const { data } = supabase.storage.from("agent-files").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ avatar_url: url, updated_at: new Date().toISOString() } as any)
    .eq("id", userId);
  if (upErr) throw upErr;
  return url;
}

/** Upload a cropped avatar for an AGENT → upserts agent_avatars */
export async function uploadAgentAvatar(agentId: string, dataUrl: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `avatars/${agentId}.png`;
  const { error } = await supabase.storage
    .from("agent-files")
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  const { data } = supabase.storage.from("agent-files").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;
  const { error: upErr } = await supabase.from("agent_avatars").upsert(
    {
      agent_id: agentId,
      avatar_url: url,
      avatar_data: "migrated",
      updated_at: new Date().toISOString(),
    } as any,
    { onConflict: "agent_id" },
  );
  if (upErr) throw upErr;
  return url;
}
