/**
 * Gestos da bolha e do microfone — spec 2026-11-03 (app do celular), itens 3 e 4.
 *
 * Segurar (450 ms) é o detector que já existe (`lib/toque-longo.ts`); aqui fica
 * o que é novo: deslizar a bolha para a direita responde, e deslizar o
 * microfone para a esquerda cancela a gravação. Os números são os do protótipo.
 */

/** Quanto a bolha acompanha o dedo, no máximo. */
export const ARRASTO_MAX_PX = 90;
/** Soltar depois disto responde. */
export const LIMIAR_RESPONDER_PX = 60;
/** Microfone: deslizar isto para a esquerda descarta o áudio. */
export const LIMIAR_CANCELAR_GRAVACAO_PX = 90;
/** Até aqui o dedo é "parado" — ele nunca fica parado de verdade. */
export const FOLGA_PX = 10;

export type Movimento = "parado" | "deslizar" | "rolar";

/** O que o dedo está fazendo, a partir do quanto andou desde o toque. */
export function classificarMovimento(dx: number, dy: number): Movimento {
  if (Math.abs(dx) <= FOLGA_PX && Math.abs(dy) <= FOLGA_PX) return "parado";
  if (dx > FOLGA_PX && Math.abs(dx) > Math.abs(dy)) return "deslizar";
  return "rolar";
}

export function deslocamentoDaBolha(dx: number): number {
  return Math.max(0, Math.min(dx, ARRASTO_MAX_PX));
}

export function soltarResponde(dx: number): boolean {
  return deslocamentoDaBolha(dx) > LIMIAR_RESPONDER_PX;
}

export function gravacaoCancelada(xInicio: number, xAgora: number): boolean {
  return xInicio - xAgora > LIMIAR_CANCELAR_GRAVACAO_PX;
}

/**
 * Barras da onda do player de áudio: determinísticas pela semente (o id da
 * mensagem), para a mesma mensagem ter sempre o mesmo desenho. Não é a forma
 * de onda real — decodificar cada áudio só para desenhar não se pagaria.
 * Mesma fórmula do protótipo; alturas em % entre 20 e 90.
 */
export function ondasDe(semente: string, n = 34): number[] {
  let s = 0;
  for (let i = 0; i < semente.length; i++) s = (s * 31 + semente.charCodeAt(i)) % 1000;
  return Array.from({ length: n }, (_, k) => 20 + Math.round(70 * Math.abs(Math.sin(k * 1.7 + s) * Math.cos(k * 0.37 + s))));
}
