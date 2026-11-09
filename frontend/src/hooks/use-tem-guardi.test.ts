/**
 * O menu da Agenda depende de `existeGuardi`. Se qualquer falha virasse `false`
 * (e ficasse 30 min em cache), um soluço de rede esconderia a Agenda de quem tem
 * Guardi. Só o 404 de `/bots/meu` quer dizer "não tem".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, api: vi.fn() };
});
vi.mock("@/contexts/auth-context", () => ({ useAuthContext: () => ({ user: { id: "u" } }) }));

import { api, ErroApi } from "@/lib/api";
import { existeGuardi } from "./use-tem-guardi";

beforeEach(() => { vi.mocked(api).mockReset(); });

describe("existeGuardi", () => {
  it("200 -> true", async () => {
    vi.mocked(api).mockResolvedValue({});
    expect(await existeGuardi()).toBe(true);
  });
  it("404 -> false", async () => {
    vi.mocked(api).mockImplementation(async () => { throw new ErroApi(404, "sem bot"); });
    expect(await existeGuardi()).toBe(false);
  });
  it("falha de rede ou 5xx lança, para não ser guardada como false", async () => {
    vi.mocked(api).mockImplementation(async () => { throw new ErroApi(0, "rede"); });
    await expect(existeGuardi()).rejects.toBeInstanceOf(ErroApi);
    vi.mocked(api).mockImplementation(async () => { throw new ErroApi(503, "fora"); });
    await expect(existeGuardi()).rejects.toBeInstanceOf(ErroApi);
  });
});
