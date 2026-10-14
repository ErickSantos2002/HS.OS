/**
 * O "eu li" do visto (revisão final dos vistos, 14/10/2026).
 *
 * ⚠️ I1: o limite de 2s DESCARTAVA a chamada. Com duas mensagens em menos de
 * 2s, a segunda nunca era marcada lida e quem mandou ficava no cinza até a
 * próxima mensagem. E o limite sobrevivia à troca de canal (o `ChannelChat`
 * não remonta), então o canal aberto logo depois não era lido.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: string[] = [];
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (caminho: string, opcoes?: { method?: string }) => {
    if (opcoes?.method === "POST") chamadas.push(caminho);
    return {};
  }),
}));
vi.mock("@/lib/realtime", () => ({ assinar: () => () => {} }));

import { useRecibos } from "./use-recibos";

beforeEach(() => {
  chamadas.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("marcarLido", () => {
  it("a chamada dentro da janela é adiada, não descartada", () => {
    const { result } = renderHook(() => useRecibos("c1", 0));
    act(() => result.current.marcarLido());
    act(() => result.current.marcarLido());
    expect(chamadas).toEqual(["/channels/c1/lido"]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(chamadas).toEqual(["/channels/c1/lido", "/channels/c1/lido"]);
  });

  it("trocar de canal não herda o limite do anterior", () => {
    const { result, rerender } = renderHook(({ id }) => useRecibos(id, 0), { initialProps: { id: "c1" } });
    act(() => result.current.marcarLido());
    rerender({ id: "c2" });
    act(() => result.current.marcarLido());
    expect(chamadas).toEqual(["/channels/c1/lido", "/channels/c2/lido"]);
  });

  it("thread lê a si mesma, com limite próprio (I2)", () => {
    const { result } = renderHook(() => useRecibos("c1", 0));
    act(() => result.current.marcarLido());
    act(() => result.current.marcarLido("t1"));
    expect(chamadas).toEqual(["/channels/c1/lido", "/channels/c1/lido?thread_id=t1"]);
  });
});
