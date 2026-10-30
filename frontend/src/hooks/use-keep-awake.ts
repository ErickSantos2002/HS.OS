import { useEffect, useState } from "react";

/**
 * Mantém a tela acesa enquanto montado e `ativo`. Ver `lib/manter-acordada.ts`
 * para quando ligar.
 *
 * Duas camadas, na ordem do pedido do Rickelme (30/10/2026):
 *
 * 1. **Screen Wake Lock** (`navigator.wakeLock.request("screen")`). O navegador
 *    solta o lock sozinho quando a aba some, então ele é pedido de novo no
 *    `visibilitychange`.
 * 2. **Vídeo mudo em laço** — a técnica do NoSleep.js, sem a lib: um mp4 de
 *    3 KB servido daqui (`public/manter-acordada.mp4`), sem CDN. Entra quando o
 *    Wake Lock não existe ou é recusado.
 *
 * ⚠️ **Na webOS os dois rodam juntos** (`reforcarComVideo`). Wake Lock aceito
 * pelo navegador não prova que a proteção de tela do SISTEMA da TV o respeita,
 * e o único teste que separa os dois leva 35 minutos parado na frente da TV.
 * Um vídeo de 64×64 em laço custa nada; errar custa mais uma rodada de teste.
 *
 * ⚠️ O vídeo fica invisível SEM `display:none` nem `visibility:hidden` — há
 * navegador que pausa vídeo oculto, e pausado ele não segura nada.
 */

export type MetodoAcordada = "wakelock" | "video" | "wakelock+video" | "nenhum";
export interface EstadoAcordada {
  metodo: MetodoAcordada;
  /** O que está segurando a tela agora: lock vivo ou vídeo tocando. */
  rodando: boolean;
  detalhe: string | null;
}

const VIDEO_SRC = "/manter-acordada.mp4";
/** Retentativa do autoplay recusado e vigia do vídeo pausado, juntos. */
const VIGIA_MS = 60_000;
/** Quanto esperar o Wake Lock antes de desistir dele (ver `pedirLock`). */
const ESPERA_WAKE_LOCK_MS = 5_000;

interface WakeLockSentinelLike extends EventTarget { released: boolean; release(): Promise<void> }
interface WakeLockLike { request(tipo: "screen"): Promise<WakeLockSentinelLike> }

export function useKeepAwake(ativo: boolean, reforcarComVideo = false): EstadoAcordada {
  const [estado, setEstado] = useState<EstadoAcordada>({ metodo: "nenhum", rodando: false, detalhe: null });

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let lock: WakeLockSentinelLike | null = null;
    let lockVivo = false;
    let video: HTMLVideoElement | null = null;
    let vigia: ReturnType<typeof setInterval> | null = null;
    let detalhe: string | null = null;

    const publicar = () => {
      if (!vivo) return;
      const tocando = !!video && !video.paused;
      const metodo: MetodoAcordada =
        lockVivo && video ? "wakelock+video" : lockVivo ? "wakelock" : video ? "video" : "nenhum";
      setEstado({ metodo, rodando: lockVivo || tocando, detalhe });
    };

    const tocar = () => {
      if (!video) return;
      video.play().then(
        () => { detalhe = null; publicar(); },
        (e: unknown) => {
          // Autoplay recusado: a primeira tecla do controle ou o vigia resolvem.
          detalhe = `autoplay recusado: ${e instanceof Error ? e.name : String(e)}`;
          publicar();
        },
      );
    };
    const aoInteragir = () => tocar();

    const ligarVideo = () => {
      if (video || !vivo) return;
      const v = document.createElement("video");
      v.src = VIDEO_SRC;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("aria-hidden", "true");
      v.tabIndex = -1;
      Object.assign(v.style, {
        position: "fixed", left: "0", bottom: "0", width: "1px", height: "1px",
        opacity: "0.01", pointerEvents: "none", zIndex: "-1",
      });
      v.addEventListener("playing", publicar);
      v.addEventListener("pause", publicar);
      document.body.appendChild(v);
      video = v;
      document.addEventListener("click", aoInteragir);
      document.addEventListener("keydown", aoInteragir);
      vigia = setInterval(() => { if (video?.paused) tocar(); }, VIGIA_MS);
      tocar();
    };

    const pedirLock = async (): Promise<boolean> => {
      const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
      if (!wl) return false;
      try {
        // ⚠️ Na LG webOS o `request` NÃO resolve nem rejeita — fica pendurado
        // para sempre (relatado no fórum de desenvolvedores da LG, e foi o que
        // aconteceu aqui em 30/10/2026). Sem o prazo, quem esperava por ele
        // nunca ligava o vídeo.
        const l = await Promise.race([
          wl.request("screen"),
          new Promise<never>((_, recusar) =>
            setTimeout(() => recusar(new Error("sem resposta em 5 s")), ESPERA_WAKE_LOCK_MS)),
        ]);
        if (!vivo) { void l.release(); return true; }
        lock = l;
        lockVivo = true;
        l.addEventListener("release", () => { lockVivo = false; publicar(); });
        publicar();
        return true;
      } catch (e) {
        detalhe = `wake lock recusado: ${e instanceof Error ? e.name : String(e)}`;
        return false;
      }
    };

    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (lock && !lockVivo) void pedirLock();
      if (video?.paused) tocar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    // ⚠️ Na webOS o vídeo liga JÁ, sem esperar o Wake Lock. Até 30/10/2026 ele
    // só ligava depois da resposta do lock — que na LG nunca vem — e a TV
    // apagou aos 30 min com a página "protegida".
    if (reforcarComVideo) ligarVideo();
    void pedirLock().then((ok) => {
      if (!ok) ligarVideo();
      else publicar();
    });

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      document.removeEventListener("click", aoInteragir);
      document.removeEventListener("keydown", aoInteragir);
      if (vigia) clearInterval(vigia);
      if (lock && !lock.released) void lock.release().catch(() => {});
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
    };
  }, [ativo, reforcarComVideo]);

  return ativo ? estado : { metodo: "nenhum", rodando: false, detalhe: null };
}
