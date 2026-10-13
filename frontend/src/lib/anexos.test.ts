/**
 * A URL de um anexo privado vale 5 minutos. Sem cache, cada render de cada
 * bolha pediria uma nova ao backend; com cache ingênuo, uma aba aberta há
 * horas mostraria imagem quebrada. O cache renova 30 s antes de vencer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn(), lerToken: () => "tok" }));

import { api } from "@/lib/api";
import { esquecerUrl, urlDoAnexo, enviarAnexo } from "@/lib/anexos";
import * as storage from "@/lib/storage";

beforeEach(() => {
  (api as any).mockReset();
  esquecerUrl("a1");
});

describe("urlDoAnexo", () => {
  it("reaproveita a URL enquanto ela vale", async () => {
    (api as any).mockResolvedValue({ url: "https://r2/1", expira_em: 300 });
    let t = 0;
    expect(await urlDoAnexo("a1", () => t)).toBe("https://r2/1");
    t = 200_000;
    expect(await urlDoAnexo("a1", () => t)).toBe("https://r2/1");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("pede outra quando faltam menos de 30 s", async () => {
    (api as any)
      .mockResolvedValueOnce({ url: "https://r2/1", expira_em: 300 })
      .mockResolvedValueOnce({ url: "https://r2/2", expira_em: 300 });
    let t = 0;
    await urlDoAnexo("a1", () => t);
    t = 275_000;
    expect(await urlDoAnexo("a1", () => t)).toBe("https://r2/2");
  });

  it("esquecerUrl força buscar de novo (imagem que falhou ao carregar)", async () => {
    (api as any)
      .mockResolvedValueOnce({ url: "https://r2/1", expira_em: 300 })
      .mockResolvedValueOnce({ url: "https://r2/2", expira_em: 300 });
    await urlDoAnexo("a1", () => 0);
    esquecerUrl("a1");
    expect(await urlDoAnexo("a1", () => 0)).toBe("https://r2/2");
  });
});

describe("enviarAnexo", () => {
  it("o PUT usa o mime que o iniciar devolveu (o assinado)", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ url_put: "https://r2/put", ticket: "T", mime: "audio/webm" })
      .mockResolvedValueOnce({ id: "x", name: "a", size: 1, mimeType: "audio/webm", url: "" });
    const put = vi.spyOn(storage.interno, "putDireto").mockResolvedValue();
    await enviarAnexo({ contexto: "canal", channelId: "c" }, new File(["a"], "a.webm", { type: "Audio/WebM;codecs=opus" }));
    expect(put.mock.calls[0][2]).toBe("audio/webm");
  });
});
