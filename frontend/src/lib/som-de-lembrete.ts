/**
 * O som da janela de lembrete (spec 2026-11-13): dois toques curtos e suaves,
 * sintetizados pela Web Audio API — sem arquivo para baixar nem cache para
 * errar. Respeita o "silenciar aba/site" do navegador, porque sai pelo mesmo
 * caminho de áudio da página.
 *
 * ⚠️ A política de autoplay pode deixar o `AudioContext` suspenso até a
 * primeira interação com a página. Nesse caso não toca e não reclama: o
 * cartão aparece do mesmo jeito, e o push do sistema já tocou.
 */

let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (contexto) return contexto;
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    contexto = new Ctor();
  } catch {
    contexto = null;
  }
  return contexto;
}

function toque(ctx: AudioContext, freq: number, inicio: number, duracao: number) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Ataque e queda rápidos: sem o "clique" de ligar e desligar o oscilador seco.
  ganho.gain.setValueAtTime(0.0001, inicio);
  ganho.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
  ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao + 0.02);
}

/**
 * Desbloqueia o áudio no primeiro clique ou tecla na página. O navegador só
 * deixa tocar som de uma página que já recebeu interação; sem isto, o alarme
 * de um lembrete que chega com o HS.OS em segundo plano sairia mudo. Chamado
 * uma vez, na montagem da janela de lembrete.
 */
export function prepararSom(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const destravar = () => {
    const ctx = obterContexto();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", destravar, { passive: true });
  window.addEventListener("keydown", destravar);
  return () => {
    window.removeEventListener("pointerdown", destravar);
    window.removeEventListener("keydown", destravar);
  };
}

/** Um ciclo do alarme: três toques, mais firmes que o aviso de mensagem. */
export async function tocarAlarme(): Promise<void> {
  const ctx = obterContexto();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;
    const t = ctx.currentTime + 0.01;
    toque(ctx, 988, t, 0.18);
    toque(ctx, 988, t + 0.24, 0.18);
    toque(ctx, 1318.5, t + 0.48, 0.3);
  } catch {
    // áudio é acessório
  }
}
