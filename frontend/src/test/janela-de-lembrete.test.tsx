/**
 * A janela de lembrete (spec 2026-11-13, "Camada 2").
 *
 * Em 13/11/2026 a Sandra não viu o lembrete das 14:00. A janela é a camada que
 * não depende do navegador dela: abre no centro do app, e só sai com Adiar ou
 * Feito. Tranca: abre ao carregar (quem abriu o app depois do aviso), abre pelo
 * tempo real (recado novo), fecha ao responder — mandando o `aviso_em` exato
 * que o servidor confere — e fecha quando a resposta veio de outro lugar.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  pendentes: [] as Array<Record<string, unknown>>,
  ouvinte: null as null | ((tipo: string, dados: unknown) => void),
  respondidos: [] as Array<[string, string, string]>,
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "u-sandra" } }),
}));
vi.mock("@/lib/realtime", () => ({
  assinar: (_topico: string, fn: (tipo: string, dados: unknown) => void) => {
    estado.ouvinte = fn;
    return () => {
      estado.ouvinte = null;
    };
  },
}));
vi.mock("@/lib/som-de-lembrete", () => ({ tocarSomDeLembrete: vi.fn(async () => undefined) }));
vi.mock("@/lib/agenda", () => ({
  lembretesPendentes: vi.fn(async () => estado.pendentes),
  responderLembrete: vi.fn(async (id: string, acao: string, aviso: string) => {
    estado.respondidos.push([id, acao, aviso]);
    estado.pendentes = estado.pendentes.filter((p) => p.id !== id);
    return { aplicado: true };
  }),
}));

import { JanelaDeLembrete } from "@/components/agenda/JanelaDeLembrete";

const AVISO = "2026-11-13T14:00:27.123456-03:00";
const hildon = {
  id: "l-1", titulo: "Retornar contato para Hildon", instrucao: "Ligar e confirmar.",
  agent_id: "sandra-bot", agente_nome: "Sandra-Guardi", aviso_em: AVISO, reavisos: 0,
};

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <JanelaDeLembrete />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  estado.pendentes = [];
  estado.respondidos = [];
  estado.ouvinte = null;
});

describe("JanelaDeLembrete", () => {
  it("abre ao carregar para aviso pendente e fecha com Feito, mandando o aviso exato", async () => {
    estado.pendentes = [hildon];
    montar();
    expect(await screen.findByText("Retornar contato para Hildon")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Feito/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(estado.respondidos).toEqual([["l-1", "feito", AVISO]]);
  });

  it("abre pelo tempo real quando o recado chega com o app aberto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      montar();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

      estado.pendentes = [hildon];
      await act(async () => {
        estado.ouvinte?.("mudanca", { tabela: "conversations", op: "INSERT" });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

      // Respondido noutro aparelho: o evento de `lembretes` fecha aqui também.
      estado.pendentes = [];
      await act(async () => {
        estado.ouvinte?.("mudanca", { tabela: "lembretes", op: "UPDATE" });
        await vi.advanceTimersByTimeAsync(500);
      });
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("Abrir conversa recolhe sem dispensar: a decisão continua à vista", async () => {
    estado.pendentes = [hildon];
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Retornar contato para Hildon");
    fireEvent.click(screen.getByRole("button", { name: /Adiar 10 min/ }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(estado.respondidos).toEqual([["l-1", "adiar", AVISO]]);
  });
});
