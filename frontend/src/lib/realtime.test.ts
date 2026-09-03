/**
 * O ciclo de vida da conexão de tempo real, com um WebSocket falso.
 *
 * Estes testes existem porque `docs/CONFERENCIA-CHAT-PESSOAS.md` mediu, em
 * 02/09/2026, seis entregas: cinco abaixo de 1s, uma em 11,6s e uma que não
 * chegou em 25s (apareceu ao recarregar). Nada se perdeu no banco — o defeito
 * era só na tela de quem esperava, e ficou sem causa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api", () => ({ lerToken: () => "token-de-teste" }));

class SocketFalso {
  static abertos: SocketFalso[] = [];
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  fechado = false;

  constructor(public url: string) {
    SocketFalso.abertos.push(this);
  }
  close() {
    if (this.fechado) return;
    this.fechado = true;
    this.readyState = 3;
    // O navegador entrega o `close` de forma assíncrona; aqui basta ser depois.
    queueMicrotask(() => this.onclose?.({ code: 1000 }));
  }
  abrir() { this.onopen?.(); }
  receber(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

async function carregar() {
  vi.resetModules();
  SocketFalso.abertos = [];
  (globalThis as any).WebSocket = SocketFalso;
  return await import("./realtime");
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("ciclo de vida da conexão", () => {
  it("trocar de tópico não deixa o socket velho agendar uma reconexão", async () => {
    const rt = await carregar();
    rt.assinar("canal:um", () => {});
    const primeiro = SocketFalso.abertos[0];
    primeiro.abrir();

    // Navegar para outro canal: o conjunto de tópicos muda, a conexão é refeita.
    rt.assinar("canal:dois", () => {});
    await Promise.resolve(); // deixa o onclose do primeiro rodar
    await vi.advanceTimersByTimeAsync(1);
    const depoisDaTroca = SocketFalso.abertos.length;
    expect(depoisDaTroca).toBe(2);

    // ⚠️ Aqui mora o defeito: o `onclose` do socket VELHO agendava
    // `setTimeout(conectar, espera)`. Passado o backoff, aquela reconexão
    // fantasma derruba a conexão saudável e abre uma terceira — e a janela
    // entre uma e outra é tempo em que o navegador não recebe evento nenhum.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(SocketFalso.abertos.length).toBe(depoisDaTroca);
  });

  it("silêncio prolongado é tratado como queda, e reconecta", async () => {
    // O servidor pinga a cada 25s (`_INTERVALO_PING` em `app/routers/ws.py`).
    // Se nem isso chega, a conexão morreu sem avisar: `readyState` continua
    // OPEN e o `onclose` nunca vem. Sem vigia, a aba fica surda para sempre.
    const rt = await carregar();
    rt.assinar("canal:um", () => {});
    SocketFalso.abertos[0].abrir();

    await vi.advanceTimersByTimeAsync(65_000);
    expect(SocketFalso.abertos.length).toBeGreaterThan(1);
  });

  it("ping conta como sinal de vida e não deixa o vigia derrubar", async () => {
    const rt = await carregar();
    rt.assinar("canal:um", () => {});
    const ws = SocketFalso.abertos[0];
    ws.abrir();

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(25_000);
      ws.receber({ tipo: "ping" });
    }
    expect(SocketFalso.abertos.length).toBe(1);
  });

  it("trocar de canal NÃO ressincroniza — não houve queda, e invalidar tudo a cada navegação é um custo que ninguém pediu", async () => {
    const invalidar = vi.fn();
    const rt = await carregar();
    rt.definirQueryClientDoRealtime({ invalidateQueries: invalidar } as never);

    rt.assinar("canal:um", () => {});
    SocketFalso.abertos[0].abrir();
    rt.assinar("canal:dois", () => {});
    await vi.advanceTimersByTimeAsync(1);
    SocketFalso.abertos[SocketFalso.abertos.length - 1].abrir();

    expect(invalidar).not.toHaveBeenCalled();
  });

  it("ao RE-conectar, manda ressincronizar — o que passou na queda não volta pelo socket", async () => {
    // Não há replay: evento publicado enquanto a conexão estava fora não é
    // reenviado. Sem ressincronizar, a tela fica com o estado de antes da
    // queda e ninguém percebe.
    const invalidar = vi.fn();
    const rt = await carregar();
    rt.definirQueryClientDoRealtime({ invalidateQueries: invalidar } as never);

    rt.assinar("canal:um", () => {});
    SocketFalso.abertos[0].abrir();
    expect(invalidar, "primeira conexão não é reconexão").not.toHaveBeenCalled();

    SocketFalso.abertos[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(2_000);
    SocketFalso.abertos[SocketFalso.abertos.length - 1].abrir();
    expect(invalidar).toHaveBeenCalled();
  });

  it("voltar para a aba reconecta na hora, sem esperar o backoff", async () => {
    // ⚠️ **Medido em 03/09/2026, na pilha local.** Com a cascata consertada, a
    // aba passa a esperar o backoff inteiro — até 30s — depois de o backend
    // voltar. No teste de ponta a ponta a recuperação levou 55,9s com o
    // conserto contra 33,5s sem ele: o código antigo se recuperava mais rápido
    // porque martelava, o que é vantagem por acidente e custa 113 conexões.
    //
    // Quem decide não é o relógio, é a pessoa: quando ela volta para a aba,
    // reconectar na hora. É também o único momento em que a tela desatualizada
    // é vista por alguém.
    const rt = await carregar();
    rt.assinar("canal:um", () => {});
    const ws = SocketFalso.abertos[0];
    ws.abrir();
    ws.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1);
    const depoisDaQueda = SocketFalso.abertos.length;

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);

    expect(SocketFalso.abertos.length).toBeGreaterThan(depoisDaQueda);
  });

  it("voltar para a aba com a conexão viva não reconecta à toa", async () => {
    const rt = await carregar();
    rt.assinar("canal:um", () => {});
    SocketFalso.abertos[0].abrir();

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);

    expect(SocketFalso.abertos.length).toBe(1);
  });
});
