// frontend/src/components/settings/PreferenciaResumoEmAudio.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }));

import PreferenciaResumoEmAudio from "@/components/settings/PreferenciaResumoEmAudio";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PreferenciaResumoEmAudio /></QueryClientProvider>);
}

describe("PreferenciaResumoEmAudio", () => {
  it("mostra ligado quando o perfil diz ligado, e desligar manda PATCH", async () => {
    api.mockImplementation(async (rota: string, op?: { method?: string }) =>
      op?.method === "PATCH" ? { resumo_em_audio: false } : { resumo_em_audio: true });
    montar();
    const chave = await screen.findByRole("switch");
    await waitFor(() => expect(chave).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(chave);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/profiles/me",
      expect.objectContaining({ method: "PATCH", body: { resumo_em_audio: false } })));
  });
});
