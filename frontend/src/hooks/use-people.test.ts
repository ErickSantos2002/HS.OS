/**
 * A lista de pessoas do chat tem que perguntar de novo ao servidor.
 *
 * Até 30/10/2026 ela buscava `/profiles` uma vez, ao montar, e a cada minuto só
 * re-derivava o pontinho a partir do `last_seen_at` daquela leitura. Com o
 * chat aberto o dia inteiro, todo mundo ia apagando — amarelo em 3 min, cinza
 * em 30 — mesmo online. Sair e voltar para a página remontava a lista e as
 * cores voltavam, o que fez parecer token expirado.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ chamadas: 0, ultimoSinal: "" }));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async (caminho: string) => {
    if (caminho !== "/profiles") throw new Error(`rota inesperada ${caminho}`);
    estado.chamadas += 1;
    return [{ id: "u1", full_name: "Fulano", email: "f@x.com", avatar_url: null, status: "active",
              last_seen_at: estado.ultimoSinal, custom_status: null, custom_status_emoji: null,
              custom_status_set_at: null }];
  }),
}));
const auth = vi.hoisted(() => ({ user: { id: "eu" } }));  // estável: `user` é dependência do fetch
vi.mock("@/contexts/auth-context", () => ({ useAuthContext: () => auth }));

import { usePeople } from "./use-people";

const INICIO = new Date("2026-10-30T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(INICIO);
  estado.chamadas = 0;
  estado.ultimoSinal = new Date(INICIO).toISOString();
});
afterEach(() => vi.useRealTimers());

describe("usePeople", () => {
  it("quem continua batendo heartbeat continua verde com a tela aberta", async () => {
    const { result } = renderHook(() => usePeople());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.people[0].presence).toBe("online");

    // Dez minutos com a pessoa online: o servidor tem sinal sempre fresco.
    for (let i = 1; i <= 10; i++) {
      estado.ultimoSinal = new Date(INICIO + i * 60_000).toISOString();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    }
    expect(estado.chamadas).toBeGreaterThan(1);
    expect(result.current.people[0].presence).toBe("online");
  });
});
