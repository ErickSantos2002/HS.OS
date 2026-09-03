/**
 * A decisão "esta conexão está morta?", separada da camada de rede para poder
 * ser testada sem WebSocket. Ver `realtime-vigia.test.ts` para o defeito que
 * ela fecha e para o que ela **não** prova.
 */

/** `_INTERVALO_PING` em `backend/app/routers/ws.py`. Os dois lados combinam. */
export const INTERVALO_PING_SERVIDOR = 25_000;

/**
 * Dois pings mais uma folga. A folga não é decoração: derrubar no primeiro
 * atraso trocaria uma aba surda por uma aba que se reconecta o tempo todo, e
 * reconectar tem custo (handshake, nova assinatura, ressincronização).
 */
export const LIMIAR_SILENCIO = INTERVALO_PING_SERVIDOR * 2 + 10_000;

export function silencioDemais(msDesdeUltimoFrame: number): boolean {
  return msDesdeUltimoFrame > LIMIAR_SILENCIO;
}

/**
 * De quanto em quanto tempo o vigia olha o relógio.
 *
 * Olhar a cada 25s (o período do ping) daria detecção só no 75º segundo, no
 * pior caso: o silêncio começa logo depois de uma checagem e a próxima que
 * passa do limiar é a terceira. Olhar a cada 5s custa nada e detecta em ~65s.
 */
export const INTERVALO_VIGIA = 5_000;
