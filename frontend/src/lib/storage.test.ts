/**
 * O envio passou a ter dois passos e um PUT no meio, direto para o R2.
 * Este teste tranca a ordem e o que cada passo leva: se o `concluir` sair
 * antes do PUT terminar, o servidor confere um objeto que ainda não existe e
 * a pessoa recebe "o arquivo não chegou" para um envio que estava a caminho.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  lerToken: () => "tok",
}));

import { api } from "@/lib/api";
import * as storage from "@/lib/storage";

afterEach(() => vi.restoreAllMocks());

describe("enviarArquivo", () => {
  it("inicia, sobe direto e só então conclui", async () => {
    const ordem: string[] = [];
    vi.mocked(api).mockImplementation(async (caminho: string, op?: { body?: unknown }) => {
      ordem.push(caminho);
      if (caminho === "/storage/upload/iniciar") {
        expect(op.body).toEqual({ bucket: "agent-files", caminho: "avatars/a.png", mime: "image/png", tamanho: 3 });
        return { url_put: "https://r2.invalido/put", ticket: "T", expira_em: 900 };
      }
      expect(op.body).toEqual({ ticket: "T" });
      return { bucket: "agent-files", path: "avatars/a.png", url: "/storage/agent-files/avatars/a.png", size: 3 };
    });
    vi.spyOn(storage.interno, "putDireto").mockImplementation(async () => {
      ordem.push("PUT");
    });

    const r = await storage.enviarArquivo("agent-files", "avatars/a.png", new Blob(["abc"], { type: "image/png" }));

    expect(ordem).toEqual(["/storage/upload/iniciar", "PUT", "/storage/upload/concluir"]);
    expect(r.size).toBe(3);
  });
});
