/**
 * Rascunho persistente: o que se escreve ENQUANTO o rascunho do servidor ainda
 * está chegando não pode ser apagado quando ele chega.
 *
 * Achado na revisão do encaminhar (27/11/2026): o texto encaminhado ao Guardi
 * entra no campo no mesmo commit em que a conversa abre — e o `setValue` lia o
 * `loading` da closure, ainda `false` naquele render. O GET voltava, o valor do
 * servidor (vazio) passava por cima e só os anexos ficavam no campo.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

let resolver: (v: { content: string }) => void = () => {};
vi.mock("@/lib/api", () => ({
  api: vi.fn((caminho: string) =>
    caminho.startsWith("/drafts/") ? new Promise((r) => { resolver = r; }) : Promise.resolve({})),
}));
vi.mock("@/lib/realtime", () => ({ assinar: () => () => {} }));
vi.mock("@/contexts/auth-context", () => ({ useAuthContext: () => ({ user: { id: "u1" } }) }));

import { usePersistentDraft } from "./use-persistent-draft";

describe("usePersistentDraft", () => {
  it("texto posto no mesmo commit da abertura sobrevive à chegada do servidor", async () => {
    const { result } = renderHook(() => {
      const d = usePersistentDraft("agent:ana-bot");
      // Como o handoff do encaminhar: escreve num efeito do primeiro commit.
      useEffect(() => { d.setValue("> encaminhada"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return d;
    });
    await act(async () => { resolver({ content: "" }); });
    await waitFor(() => expect(result.current.value).toBe("> encaminhada"));
  });
});
