/**
 * O áudio de canal toca pela URL assinada do anexo, pedida na hora — e uma URL
 * antiga (de antes de 13/10/2026) continua tocando como veio.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const urlDoAnexo = vi.fn(async (id: string) => `https://r2.exemplo/${id}?assinada`);
vi.mock("@/lib/anexos", () => ({ urlDoAnexo: (id: string) => urlDoAnexo(id), esquecerUrl: vi.fn() }));

import AudioDaMensagem from "@/components/chat/AudioDaMensagem";

const ID = "6f1c2d3e-0000-4000-8000-000000000001";

describe("AudioDaMensagem", () => {
  it("anexo: pede a URL assinada e toca por ela", async () => {
    const { container } = render(<AudioDaMensagem audioUrl={`anexo:${ID}`} />);
    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src"))
      .toBe(`https://r2.exemplo/${ID}?assinada`));
    expect(urlDoAnexo).toHaveBeenCalledWith(ID);
  });

  it("URL antiga toca direto, sem pedir nada", () => {
    urlDoAnexo.mockClear();
    const antiga = "https://hsosapi.healthsafetytech.com/storage/audio-messages/c/a.webm";
    const { container } = render(<AudioDaMensagem audioUrl={antiga} />);
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(antiga);
    expect(urlDoAnexo).not.toHaveBeenCalled();
  });
});
