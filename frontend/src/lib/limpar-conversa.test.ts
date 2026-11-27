/**
 * Limpar conversa (spec 2026-11-27-limpar-conversa-design): a chamada e o
 * aviso para a conversa aberta esvaziar. Sem o aviso, a tela seguia mostrando
 * as mensagens até recarregar — e parecia que limpar não tinha funcionado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { executarLimpeza, ouvirConversaLimpa } from "./limpar-conversa";

beforeEach(() => vi.clearAllMocks());

describe("executarLimpeza", () => {
  it("limpa, avisa a tela e oferece desfazer o mesmo lote", async () => {
    api.mockResolvedValueOnce({ limpo_em: "2026-11-27T12:00:00Z", quantas: 3 });
    const vistos: string[] = [];
    const parar = ouvirConversaLimpa((id) => vistos.push(id));
    await executarLimpeza("c1");
    expect(api).toHaveBeenCalledWith("/channels/c1/limpar", { method: "POST" });
    expect(vistos).toEqual(["c1"]);

    const desfazer = toast.success.mock.calls[0][1].action.onClick;
    api.mockResolvedValueOnce(undefined);
    await desfazer();
    expect(api).toHaveBeenLastCalledWith("/channels/c1/limpar/desfazer",
      { method: "POST", body: { limpo_em: "2026-11-27T12:00:00Z" } });
    expect(vistos).toEqual(["c1", "c1"]);
    parar();
  });

  it("falhou: diz e não avisa a tela", async () => {
    api.mockRejectedValueOnce(new Error("x"));
    const vistos: string[] = [];
    const parar = ouvirConversaLimpa((id) => vistos.push(id));
    await executarLimpeza("c1");
    expect(toast.error).toHaveBeenCalled();
    expect(vistos).toEqual([]);
    parar();
  });
});
