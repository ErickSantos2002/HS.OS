/**
 * O pontinho da lista de pessoas. Duas armadilhas, as duas vistas na TV em
 * 30/10/2026 ("nem sempre mostra certo quem está online"):
 *
 * - **Relógio atrasado apagava todo mundo.** O `last_seen_at` é a hora do
 *   banco; o `Date.now()` é a da máquina que olha. Numa máquina um segundo
 *   atrasada, quem acabou de bater ficava com tempo decorrido negativo — e
 *   negativo caía em "offline".
 * - **A janela era do tamanho do heartbeat.** Com 2 min contra 60 s de
 *   intervalo, um ping estrangulado pelo navegador já bastava para piscar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivePresence } from "./presence-status";

const AGORA = new Date("2026-10-30T12:00:00Z").getTime();
const ha = (s: number) => new Date(AGORA - s * 1000).toISOString();

describe("derivePresence", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AGORA); });
  afterEach(() => vi.useRealTimers());

  it("sinal no futuro (relógio local atrasado) é online, não offline", () => {
    expect(derivePresence(ha(-5))).toBe("online");
  });

  it("aguenta um heartbeat atrasado sem piscar", () => {
    expect(derivePresence(ha(170))).toBe("online");
    expect(derivePresence(ha(190))).toBe("away");
  });

  it("sem sinal ou sinal velho é offline", () => {
    expect(derivePresence(null)).toBe("offline");
    expect(derivePresence("lixo")).toBe("offline");
    expect(derivePresence(ha(31 * 60))).toBe("offline");
  });
});
