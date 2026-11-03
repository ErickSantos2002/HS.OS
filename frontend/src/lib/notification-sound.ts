/**
 * Som curto de notificação (Web Audio).
 *
 * ⚠️ **Um `AudioContext` só, reaproveitado.** Criar um por som esgota o limite
 * do navegador (o Chrome recusa depois de ~6 vivos) e, no iOS, cada contexto
 * novo nasce suspenso — o som simplesmente não tocava a partir de certo ponto.
 */
let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!contexto || contexto.state === "closed") contexto = new AudioContext();
  if (contexto.state === "suspended") void contexto.resume().catch(() => undefined);
  return contexto;
}

export function playNotificationSound() {
  try {
    const ctx = obterContexto();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // silent fallback
  }
}
