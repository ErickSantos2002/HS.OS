/**
 * `useHoje` precisa virar à meia-noite sozinho: as listas de mensagem são
 * `memo` e é só ele que faz o "Hoje" da conversa aberta virar "Ontem".
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agoraDoDia, diaDe, useHoje } from "./use-hoje";

describe("useHoje", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("muda de dia na virada da meia-noite", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 0));
    const { result } = renderHook(() => useHoje());
    expect(result.current).toBe("2026-11-13");

    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(result.current).toBe("2026-11-14");
  });

  it("agoraDoDia cai dentro do mesmo dia local", () => {
    expect(diaDe(agoraDoDia("2026-01-05"))).toBe("2026-01-05");
  });
});
