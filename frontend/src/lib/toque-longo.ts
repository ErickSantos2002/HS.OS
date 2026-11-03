/**
 * Detector de "segurar o dedo" — spec 2026-11-03, Frente C3.
 *
 * Sem DOM e sem React, para dar para testar: quem liga aos eventos de toque é
 * o `useToqueLongo`. Dispara depois de `atrasoMs` parado e **cancela** se o
 * dedo andar mais de `toleranciaPx` ou se a página rolar — o long-press que
 * existia antes (500ms, sem olhar movimento) abria o menu no meio da rolagem.
 */

export interface OpcoesDoToqueLongo {
  aoDisparar: () => void;
  /** Tempo parado até disparar. ~450ms é o que o WhatsApp usa. */
  atrasoMs?: number;
  /** Quanto o dedo pode andar sem cancelar: ele nunca fica parado de verdade. */
  toleranciaPx?: number;
}

export interface DetectorDeToqueLongo {
  inicio(x: number, y: number): void;
  mover(x: number, y: number): void;
  fim(): void;
  rolou(): void;
  /** O toque em curso (ou o último) disparou? Serve para não virar clique. */
  disparou(): boolean;
}

export const ATRASO_TOQUE_LONGO_MS = 450;
export const TOLERANCIA_TOQUE_LONGO_PX = 10;

export function criarDetectorDeToqueLongo({
  aoDisparar,
  atrasoMs = ATRASO_TOQUE_LONGO_MS,
  toleranciaPx = TOLERANCIA_TOQUE_LONGO_PX,
}: OpcoesDoToqueLongo): DetectorDeToqueLongo {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origem: { x: number; y: number } | null = null;
  let jaDisparou = false;

  const cancelar = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    origem = null;
  };

  return {
    inicio(x, y) {
      cancelar();
      jaDisparou = false;
      origem = { x, y };
      timer = setTimeout(() => {
        timer = null;
        jaDisparou = true;
        aoDisparar();
      }, atrasoMs);
    },
    mover(x, y) {
      if (!origem || !timer) return;
      if (Math.hypot(x - origem.x, y - origem.y) > toleranciaPx) cancelar();
    },
    fim() {
      cancelar();
    },
    rolou() {
      if (timer) cancelar();
    },
    disparou() {
      return jaDisparou;
    },
  };
}
