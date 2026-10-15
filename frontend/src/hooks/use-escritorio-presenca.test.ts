/**
 * O hook que diz quem está no escritório agora.
 *
 * Tranca três coisas: o e-mail casa sem diferenciar maiúsculas (o perfil do
 * HS.OS e o WA podem grafar diferente), a assinatura de tempo real é desfeita
 * ao desmontar (senão cada visita ao chat deixa um ouvinte órfão no socket) e
 * erro da API deixa a presença indefinida em silêncio — o bloco some, não
 * vira toast de "não foi possível falar com o servidor".
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  resposta: null as unknown,
  falhar: false,
  assinadas: [] as string[],
  canceladas: 0,
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async (caminho: string) => {
    if (caminho !== "/escritorio/presenca") throw new Error(`rota inesperada ${caminho}`);
    if (estado.falhar) throw new Error("500");
    return estado.resposta;
  }),
}));
vi.mock("@/lib/realtime", () => ({
  assinarTabela: (tabela: string) => {
    estado.assinadas.push(tabela);
    return () => {
      estado.canceladas += 1;
    };
  },
}));

import { useEscritorioPresenca } from "./use-escritorio-presenca";

function embrulho() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  estado.resposta = {
    conectado: true,
    pessoas: [{ email: "fulano@x.com", nome: "Fulano", user_id: "u1", avatar_url: null, desde: "2026-10-15T10:00:00Z" }],
  };
  estado.falhar = false;
  estado.assinadas = [];
  estado.canceladas = 0;
});

describe("useEscritorioPresenca", () => {
  it("estaNoEscritorio casa o e-mail sem diferenciar maiúsculas", async () => {
    const { result } = renderHook(() => useEscritorioPresenca(), { wrapper: embrulho() });
    await waitFor(() => expect(result.current.presenca).toBeDefined());
    expect(result.current.estaNoEscritorio("Fulano@X.com")).toBe(true);
    expect(result.current.estaNoEscritorio("outro@x.com")).toBe(false);
  });

  it("estaNoEscritorio de e-mail ausente é falso", async () => {
    const { result } = renderHook(() => useEscritorioPresenca(), { wrapper: embrulho() });
    await waitFor(() => expect(result.current.presenca).toBeDefined());
    expect(result.current.estaNoEscritorio(null)).toBe(false);
    expect(result.current.estaNoEscritorio(undefined)).toBe(false);
  });

  it("assina escritorio_presenca e cancela ao desmontar", () => {
    const { unmount } = renderHook(() => useEscritorioPresenca(), { wrapper: embrulho() });
    expect(estado.assinadas).toEqual(["escritorio_presenca"]);
    unmount();
    expect(estado.canceladas).toBe(1);
  });

  it("erro da API deixa a presença indefinida, sem lançar", async () => {
    estado.falhar = true;
    const { result } = renderHook(() => useEscritorioPresenca(), { wrapper: embrulho() });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current.presenca).toBeUndefined();
    expect(result.current.estaNoEscritorio("fulano@x.com")).toBe(false);
  });
});
