/**
 * Tirar a própria reação (11/11/2026).
 *
 * ⚠️ O `DELETE /reactions` lê `message_id` e `emoji` da query string. O hook
 * mandava os dois no corpo: o servidor respondia 422, o hook desfazia a
 * remoção otimista e a reação voltava na tela — no desktop e no celular,
 * porque os dois usam este hook. Ninguém conseguia tirar reação nenhuma.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: { caminho: string; method?: string; body?: unknown }[] = [];
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (caminho: string, opcoes?: { method?: string; body?: unknown }) => {
    chamadas.push({ caminho, method: opcoes?.method, body: opcoes?.body });
    if (caminho.startsWith("/channels/")) {
      return [{ message_id: "m1", emoji: "👍", user_ids: ["eu"] }];
    }
    return null;
  }),
}));
vi.mock("@/lib/realtime", () => ({ assinarTabela: () => () => {} }));

import { useMessageReactions } from "./use-message-reactions";

beforeEach(() => { chamadas.length = 0; });

describe("toggleReaction", () => {
  it("tirar a reação manda message_id e emoji na query string, sem corpo", async () => {
    const { result } = renderHook(() => useMessageReactions("c1"));
    await waitFor(() => expect(result.current.reactions.m1).toBeDefined());

    await act(() => result.current.toggleReaction("m1", "👍", "eu"));

    const del = chamadas.find((c) => c.method === "DELETE");
    expect(del).toBeDefined();
    const url = new URL(del!.caminho, "http://x");
    expect(url.pathname).toBe("/reactions");
    expect(url.searchParams.get("message_id")).toBe("m1");
    expect(url.searchParams.get("emoji")).toBe("👍");
    expect(del!.body).toBeUndefined();
  });

  it("pôr a reação continua sendo POST com corpo", async () => {
    const { result } = renderHook(() => useMessageReactions("c1"));
    await waitFor(() => expect(result.current.reactions.m1).toBeDefined());

    await act(() => result.current.toggleReaction("m1", "❤️", "eu"));

    const post = chamadas.find((c) => c.method === "POST");
    expect(post).toEqual({ caminho: "/reactions", method: "POST", body: { message_id: "m1", emoji: "❤️" } });
  });
});
