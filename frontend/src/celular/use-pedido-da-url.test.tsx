/**
 * ⚠️ Segurança: `/chat?channel=X&prefill=…&autosend=1` publicava em nome de
 * quem abrisse o link. Agora a query string nunca envia; só o id guardado
 * pelo service worker no Cache Storage, conferido e de uso único.
 */
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CACHE_RESPOSTA, guardarResposta } from "@/lib/resposta-rapida";
import { usePedidoDaUrl } from "./use-pedido-da-url";

const ID = "0b9f6c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e";

function instalarCaches() {
  const m = new Map<string, string>();
  const cache = {
    async put(k: string, r: Response) { m.set(k, await r.text()); },
    async match(k: string) { const v = m.get(k); return v === undefined ? undefined : new Response(v); },
    async delete(k: string) { return m.delete(k); },
  };
  vi.stubGlobal("caches", { open: async (nome: string) => { expect(nome).toBe(CACHE_RESPOSTA); return cache; } });
  return cache;
}

function montar(url: string, onde: string, alvo = { canal: "c1", thread: null as string | null }) {
  const acoes = { rascunho: vi.fn(), enviar: vi.fn(), focar: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  renderHook(() => usePedidoDaUrl(onde, true, false, alvo, acoes), { wrapper });
  return acoes;
}

describe("usePedidoDaUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("autosend=1&prefill=x na URL não envia nada: vira rascunho", async () => {
    instalarCaches();
    const a = montar("/chat?channel=c1&prefill=oi%20pessoal&autosend=1&focus=composer", "t1");
    await new Promise((r) => setTimeout(r, 20));
    expect(a.enviar).not.toHaveBeenCalled();
    expect(a.rascunho).toHaveBeenCalledWith("oi pessoal");
  });

  it("id guardado pelo SW envia uma única vez; o mesmo id de novo não envia", async () => {
    const c = instalarCaches();
    await guardarResposta(c, ID, { texto: "Valeu!", channel_id: "c1", thread_id: null, criado_em: Date.now() });
    const a = montar(`/chat?channel=c1&resposta=${ID}`, "t2");
    await waitFor(() => expect(a.enviar).toHaveBeenCalledWith("Valeu!"));
    const b = montar(`/chat?channel=c1&resposta=${ID}`, "t2-outra-tela");
    await new Promise((r) => setTimeout(r, 20));
    expect(b.enviar).not.toHaveBeenCalled();
    expect(a.enviar).toHaveBeenCalledTimes(1);
  });

  it("id de outro canal ou vencido não envia", async () => {
    const c = instalarCaches();
    await guardarResposta(c, ID, { texto: "x", channel_id: "c2", thread_id: null, criado_em: Date.now() });
    const a = montar(`/chat?channel=c1&resposta=${ID}`, "t3");
    await guardarResposta(c, "1d2a4b3c-0000-4000-8000-000000000000", { texto: "y", channel_id: "c1", thread_id: null, criado_em: Date.now() - 6 * 60_000 });
    const b = montar("/chat?channel=c1&resposta=1d2a4b3c-0000-4000-8000-000000000000", "t4");
    await new Promise((r) => setTimeout(r, 30));
    expect(a.enviar).not.toHaveBeenCalled();
    expect(b.enviar).not.toHaveBeenCalled();
  });
});
