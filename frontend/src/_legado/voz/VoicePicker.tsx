import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Volume2, Square, Check, User, Loader2, AlertTriangle } from "lucide-react";

/* ── Types ── */

interface Voice {
  id: string;
  name: string;
  gender: string;
  preview_url?: string;
}

interface VoicePickerProps {
  value: string | null;
  onChange: (voiceId: string | null) => void;
}

/* ── Fetch voices via Supabase Edge Function ──
 * Edge function: list-elevenlabs-voices
 * Requires ELEVENLABS_API_KEY secret configured in Supabase → Edge Functions → Secrets.
 */

const VOICES_FN = "list-elevenlabs-voices";

async function fetchVoices(): Promise<Voice[]> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${VOICES_FN}`;
  console.log("[VoicePicker] Fetching voices from edge function:", url);

  const { data, error } = await supabase.functions.invoke(VOICES_FN, { method: "GET" });

  if (error) {
    console.error("[VoicePicker] Edge function error:", {
      url,
      message: error.message,
      context: (error as any).context,
      error,
    });
    throw new Error(error.message || "Falha ao chamar edge function");
  }

  if (data?.error) {
    console.error("[VoicePicker] Edge function returned error payload:", data.error);
    throw new Error(data.error);
  }

  const list = Array.isArray(data) ? data : data?.voices ?? [];
  console.log("[VoicePicker] Loaded", list.length, "voices");
  return list;
}

/* ── Gender helpers ── */

const GENDER_LABELS: Record<string, string> = {
  male: "Masculino",
  female: "Feminino",
  neutral: "Neutro",
};

const GENDER_ORDER = ["female", "male", "neutral"];

function groupByGender(voices: Voice[]): Record<string, Voice[]> {
  const groups: Record<string, Voice[]> = {};
  for (const v of voices) {
    const g = (v.gender || "neutral").toLowerCase();
    if (!groups[g]) groups[g] = [];
    groups[g].push(v);
  }
  return groups;
}

/* ── Component ── */

export default function VoicePicker({ value, onChange }: VoicePickerProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchVoices()
      .then((v) => { if (!cancelled) { setVoices(v); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const playPreview = useCallback((voice: Voice) => {
    stopPreview();
    if (!voice.preview_url) return;

    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    setPlayingId(voice.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null));
  }, [stopPreview]);

  // Cleanup on unmount
  useEffect(() => () => stopPreview(), [stopPreview]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando vozes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 py-2">
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 inline shrink-0" />
          Não foi possível carregar vozes: {error}
        </p>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-display block">
          Inserir Voice ID manualmente
        </label>
        <input
          type="text"
          defaultValue={value ?? ""}
          placeholder="ElevenLabs voice ID (ex: XrExE9yKIg1WjnnlVkGX)"
          onBlur={(e) => {
            const v = e.target.value.trim();
            onChange(v ? v : null);
          }}
          className="w-full px-2.5 py-2 rounded-lg border border-border/60 bg-secondary/30 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
        />
        {value && (
          <p className="text-[10px] text-primary font-mono">Selecionada: {value}</p>
        )}
      </div>
    );
  }

  if (voices.length === 0) return null;

  const groups = groupByGender(voices);
  const orderedKeys = GENDER_ORDER.filter((g) => groups[g]?.length);
  // Add any gender not in the standard list
  for (const k of Object.keys(groups)) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }

  return (
    <div className="space-y-3">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">
        Voz do personagem
      </label>

      {orderedKeys.map((gender) => (
        <div key={gender}>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <User className="h-3 w-3" />
            {GENDER_LABELS[gender] || gender}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {groups[gender].map((voice) => {
              const selected = value === voice.id;
              const playing = playingId === voice.id;

              return (
                <div
                  key={voice.id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-all text-sm ${
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                  onClick={() => onChange(selected ? null : voice.id)}
                >
                  {/* Selection indicator */}
                  <div
                    className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                      selected ? "border-primary bg-primary" : "border-muted-foreground/30"
                    }`}
                  >
                    {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>

                  <span className="flex-1 truncate text-xs font-medium">{voice.name}</span>

                  {/* Preview button */}
                  {voice.preview_url && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playing ? stopPreview() : playPreview(voice);
                      }}
                      className={`p-1 rounded-md shrink-0 transition-colors ${
                        playing
                          ? "text-primary bg-primary/20"
                          : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                      }`}
                      title={playing ? "Parar" : "Ouvir preview"}
                    >
                      {playing ? <Square className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {value && (
        <p className="text-[10px] text-primary font-mono">
          Selecionada: {voices.find((v) => v.id === value)?.name || value}
        </p>
      )}
    </div>
  );
}
