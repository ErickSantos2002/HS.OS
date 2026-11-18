/**
 * O store da marca "voltarei aqui" (`/conversas/marcadas`).
 *
 * O que se tranca: a marca aparece NA HORA do clique (otimista) e volta atrás
 * se a rota recusar — senão a pessoa vê a bolinha e ela não existe no servidor,
 * ou clica e nada acontece por um segundo. E só evento da própria tabela
 * recarrega: o tópico `usuario:<id>` carrega resposta de agente o tempo todo, e
 * recarregar a cada uma seria um GET por mensagem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
const rt = vi.hoisted(() => ({
  ouvintes: [] as Array<(tipo: string, dados: unknown) => void>,
  assinar: vi.fn(),
}));
vi.mock("@/lib/api", () => apiMock);
vi.mock("@/lib/realtime", () => ({
  assinar: (topico: string, fn: (tipo: string, dados: unknown) => void) => {
    rt.assinar(topico);
    rt.ouvintes.push(fn);
    return () => {};
  },
}));

import * as store from "./conversas-marcadas-store";

const CANAL = { canalId: "c1", agentId: null };

beforeEach(() => {
  vi.clearAllMocks();
  rt.ouvintes = [];
  store.__zerarParaTeste();
});

describe("marcar e desmarcar", () => {
  it("marcar mostra na hora, antes de a rota responder", async () => {
    let responder: (v?: unknown) => void = () => {};
    apiMock.api.mockImplementation(() => new Promise((r) => { responder = r; }));
    const p = store.marcar(CANAL);
    expect(store.estaMarcada(CANAL)).toBe(true);
    responder();
    expect(await p).toBe(true);
    expect(store.estaMarcada(CANAL)).toBe(true);
    expect(apiMock.api).toHaveBeenCalledWith("/conversas/marcadas?canal_id=c1", { method: "PUT" });
  });

  it("se a rota recusar, a marca volta atrás", async () => {
    apiMock.api.mockRejectedValue(new Error("403"));
    expect(await store.marcar(CANAL)).toBe(false);
    expect(store.estaMarcada(CANAL)).toBe(false);
  });

  it("desmarcar que falha devolve a marca", async () => {
    apiMock.api.mockResolvedValueOnce(undefined);
    await store.marcar(CANAL);
    apiMock.api.mockRejectedValueOnce(new Error("rede"));
    expect(await store.desmarcar(CANAL)).toBe(false);
    expect(store.estaMarcada(CANAL)).toBe(true);
  });

  it("agente vai pela query agent_id", async () => {
    apiMock.api.mockResolvedValue(undefined);
    await store.marcar({ canalId: null, agentId: "nina" });
    expect(apiMock.api).toHaveBeenCalledWith("/conversas/marcadas?agent_id=nina", { method: "PUT" });
    expect(store.estaMarcada({ canalId: null, agentId: "openclaw:nina" })).toBe(true);
  });

  it("depois de carregado, desmarcar o que não está marcado não chama a rota", async () => {
    apiMock.api.mockResolvedValueOnce([]);
    await store.carregar();
    apiMock.api.mockClear();
    expect(await store.desmarcar(CANAL)).toBe(true);
    expect(apiMock.api).not.toHaveBeenCalled();
  });
});

describe("carregar e acompanhar", () => {
  it("carregar traz as marcas do servidor e avisa quem assina", async () => {
    apiMock.api.mockResolvedValueOnce([
      { canal_id: "c1", agent_id: null, marcada_em: "2026-11-18T12:00:00Z" },
      { canal_id: null, agent_id: "iris", marcada_em: "2026-11-18T12:00:00Z" },
    ]);
    const aviso = vi.fn();
    const cancelar = store.assinarMudancas(aviso);
    await store.carregar();
    expect(store.estaMarcada(CANAL)).toBe(true);
    expect(store.estaMarcada({ canalId: null, agentId: "iris" })).toBe(true);
    expect(aviso).toHaveBeenCalled();
    cancelar();
  });

  it("carga que começou antes de um desmarcar não devolve a marca (abrir logo ao carregar a página)", async () => {
    // A aba nasce com a conversa aberta: o GET sai, a abertura desmarca, e a
    // resposta do GET (com a marca ainda lá) chega DEPOIS — sem descarte, a
    // bolinha voltava na conversa aberta.
    let responderGet: (v: unknown) => void = () => {};
    apiMock.api.mockImplementationOnce(() => new Promise((r) => { responderGet = r; }));
    const carga = store.carregar();
    apiMock.api.mockResolvedValueOnce(undefined);
    await store.desmarcar(CANAL);
    responderGet([{ canal_id: "c1", agent_id: null, marcada_em: "2026-11-18T12:00:00Z" }]);
    await carga;
    expect(store.estaMarcada(CANAL)).toBe(false);
  });

  it("de duas cargas, só vale a mais nova", async () => {
    let primeira: (v: unknown) => void = () => {};
    apiMock.api.mockImplementationOnce(() => new Promise((r) => { primeira = r; }));
    const a = store.carregar();
    apiMock.api.mockResolvedValueOnce([]);
    await store.carregar();
    primeira([{ canal_id: "c1", agent_id: null, marcada_em: "2026-11-18T12:00:00Z" }]);
    await a;
    expect(store.estaMarcada(CANAL)).toBe(false);
  });

  it("evento usuario: de outra tabela não recarrega; da própria tabela, sim", async () => {
    apiMock.api.mockResolvedValue([]);
    const parar = store.iniciar("u1");
    expect(rt.assinar).toHaveBeenCalledWith("usuario:u1");
    await Promise.resolve();
    apiMock.api.mockClear();

    rt.ouvintes[0]("mudanca", { tabela: "conversations", op: "INSERT" });
    expect(apiMock.api).not.toHaveBeenCalled();

    rt.ouvintes[0]("mudanca", { tabela: "conversas_marcadas", op: "DELETE" });
    expect(apiMock.api).toHaveBeenCalledWith("/conversas/marcadas");
    parar();
  });
});
