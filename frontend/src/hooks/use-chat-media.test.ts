/**
 * Colar mais de 10 mil caracteres vira anexo .txt — e o envio acontece no
 * mesmo toque. O `finalizeStaged` daquela renderização lia a lista antiga e a
 * mensagem saía vazia (desktop e celular).
 */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/anexos", () => ({
  enviarAnexo: vi.fn(async (_d: unknown, f: File) => ({ id: "anexo-1", mimeType: f.type, size: f.size })),
}));

import { useChatMedia } from "./use-chat-media";

it("texto colado longo entra no envio da mesma renderização", async () => {
  const { result } = renderHook(() => useChatMedia());
  let finalizados: Awaited<ReturnType<typeof result.current.finalizeStaged>> = [];
  await act(async () => {
    const media = result.current; // a MESMA renderização para os dois passos
    expect(media.stagePastedText("x".repeat(12_000))).toBe(true);
    finalizados = await media.finalizeStaged({ contexto: "canal", channelId: "c1" });
  });
  expect(finalizados).toHaveLength(1);
  expect(finalizados[0]).toMatchObject({ type: "file", id: "anexo-1" });
  expect(finalizados[0].name).toMatch(/^Texto colado .*\.txt$/);
});
