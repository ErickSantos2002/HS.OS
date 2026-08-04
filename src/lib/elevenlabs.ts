/**
 * ElevenLabs TTS integration – voice config & playback.
 * Voice configs persisted in Supabase app_settings.
 *
 * All ElevenLabs API calls are proxied through Supabase Edge Functions
 * (list-elevenlabs-voices, elevenlabs-tts) which read ELEVENLABS_API_KEY
 * from Supabase Edge Function Secrets. The API key is NEVER bundled
 * into the frontend. Make sure ELEVENLABS_API_KEY is configured in
 * Supabase → Edge Functions → Secrets.
 */

import { getSetting, setSetting } from "@/lib/app-settings";
import { supabase } from "@/integrations/supabase/client";

/* ── Default voice mapping ── */

const DEFAULT_VOICES: Record<string, { voiceId: string; voiceName: string }> = {
  lia:     { voiceId: "XrExE9yKIg1WjnnlVkGX", voiceName: "Matilda" },
  milo:    { voiceId: "cjVigY5qzO86Huf0OWal", voiceName: "Eric" },
  kira:    { voiceId: "cgSgspJ2msm6clMCkdW9", voiceName: "Jessica" },
  stories: { voiceId: "FGY2WhTYpPnrIDTdsKH5", voiceName: "Laura" },
  case:    { voiceId: "onwK4e9ZLuTAKqWW03F9", voiceName: "Daniel" },
};

const SETTINGS_KEY = "elevenlabs_voice_map";

export interface VoiceConfig {
  voiceId: string;
  voiceName: string;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

/* ── Voice config per agent (Supabase) ── */

function stripPrefix(id: string) {
  return id.includes(":") ? id.split(":").pop()! : id;
}

// In-memory cache loaded once
let voiceMapCache: Record<string, VoiceConfig> | null = null;

async function loadVoiceMap(): Promise<Record<string, VoiceConfig>> {
  if (voiceMapCache) return voiceMapCache;
  const saved = await getSetting<Record<string, VoiceConfig>>(SETTINGS_KEY);
  voiceMapCache = saved ?? {};
  return voiceMapCache;
}

export async function getVoiceForAgent(agentId: string): Promise<VoiceConfig> {
  const short = stripPrefix(agentId);

  // 1) Primary source: agent_profiles
  try {
    const { data } = await supabase
      .from("agent_profiles")
      .select("tts_voice_id, tts_voice_name")
      .eq("agent_id", short)
      .maybeSingle();
    if (data?.tts_voice_id) {
      return { voiceId: data.tts_voice_id, voiceName: data.tts_voice_name ?? "" };
    }
  } catch {
    // fall through to legacy source
  }

  // 2) Legacy fallback: app_settings.elevenlabs_voice_map
  const map = await loadVoiceMap();
  if (map[short]) return map[short];

  // 3) Hardcoded defaults
  return DEFAULT_VOICES[short] ?? { voiceId: "cjVigY5qzO86Huf0OWal", voiceName: "Eric" };
}

export async function setVoiceForAgent(agentId: string, config: VoiceConfig) {
  const short = stripPrefix(agentId);

  // Primary write target: agent_profiles
  await supabase
    .from("agent_profiles")
    .upsert(
      { agent_id: short, tts_voice_id: config.voiceId, tts_voice_name: config.voiceName },
      { onConflict: "agent_id" }
    );

  // Keep legacy map in sync so other readers stay consistent until fully migrated
  const map = await loadVoiceMap();
  map[short] = config;
  voiceMapCache = map;
  await setSetting(SETTINGS_KEY, map);
}

/* ── Fetch available voices (via edge function) ── */

export async function fetchVoices(): Promise<ElevenLabsVoice[]> {
  const { data, error } = await supabase.functions.invoke("list-elevenlabs-voices", { method: "GET" });
  if (error) throw new Error(error.message || "Failed to fetch voices");
  if (data?.error) throw new Error(data.error);
  const list = Array.isArray(data) ? data : data?.voices ?? [];
  // Edge function returns normalized { id, name, gender, preview_url }.
  // Map back to the legacy ElevenLabsVoice shape used by other callers.
  return list.map((v: any) => ({
    voice_id: v.voice_id ?? v.id,
    name: v.name,
    category: v.category,
    labels: v.labels ?? (v.gender ? { gender: v.gender } : undefined),
  }));
}

/* ── TTS playback (via edge function) ── */

let currentAudio: HTMLAudioElement | null = null;

export function stopTTS() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export async function speakText(text: string, voiceId: string): Promise<HTMLAudioElement> {
  stopTTS();

  const cleanText = text.replace(/[⚠️🔊🎤]/g, "").replace(/\[error\]/g, "").replace(/\[working\]/g, "").replace(/\[retrying\]/g, "").trim();
  if (!cleanText) throw new Error("Texto vazio");

  // Direct fetch instead of supabase.functions.invoke — invoke tries to parse
  // JSON and fails on binary audio responses with "Failed to send a request".
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ text: cleanText, voiceId, modelId: "eleven_multilingual_v2" }),
  });

  if (!res.ok) {
    let msg = `TTS error ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  audio.onended = () => {
    URL.revokeObjectURL(audioUrl);
    currentAudio = null;
  };

  await audio.play();
  return audio;
}


