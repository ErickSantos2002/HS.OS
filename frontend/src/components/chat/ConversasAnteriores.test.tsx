/**
 * Painel de conversas anteriores (spec 2026-10-14). O que tranca: abrir uma
 * conversa a mostra só para leitura, e citar entrega o texto da mensagem para
 * a conversa de hoje.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (caminho: string) => {
    if (caminho.endsWith("/anteriores")) {
      return [{ id: "r1", ate: "2026-10-13T15:00:00.000Z", inicio: "2026-10-13T12:24:15.000Z",
                titulo: "planilha com os eventos (atestado e declaração)", mensagens: 2 }];
    }
    return [
      { id: "m1", agent_id: "bruce", role: "user", content: "planilha com os eventos", created_at: "2026-10-13T12:24:15.000Z" },
      { id: "m2", agent_id: "bruce", role: "agent", content: "22 eventos em setembro", created_at: "2026-10-13T12:25:24.000Z" },
      { id: "m3", agent_id: "bruce", role: "agent", content: "📎 eventos.xlsx", created_at: "2026-10-13T12:25:30.000Z",
        media: [{ type: "document", name: "eventos.xlsx", id: "a1" }] },
    ];
  }),
}));

import ConversasAnteriores from "./ConversasAnteriores";

describe("ConversasAnteriores", () => {
  it("lista, abre só para leitura e cita a mensagem", async () => {
    const onCitar = vi.fn();
    render(<ConversasAnteriores agentId="bruce" open onOpenChange={() => {}} onCitar={onCitar} />);
    fireEvent.click(await screen.findByText("planilha com os eventos (atestado e declaração)"));
    expect(await screen.findByText(/só leitura/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    const citar = await screen.findAllByRole("button", { name: "Citar na conversa atual" });
    fireEvent.click(citar[1]);
    expect(onCitar).toHaveBeenCalledWith("22 eventos em setembro");
  });

  it("abre direto na conversa pedida pela busca", async () => {
    render(<ConversasAnteriores agentId="bruce" open onOpenChange={() => {}} onCitar={() => {}} abrirConversa="r1" />);
    expect(await screen.findByText("22 eventos em setembro")).toBeInTheDocument();
  });

  it("o arquivo que o agente entregou aparece na conversa antiga (revisão final)", async () => {
    // ⚠️ O `relatorio_ponto` e o `enviar_arquivo` gravam a bolha como
    // "📎 <nome>" com o arquivo em `media`. Sem desenhar a mídia, a conversa
    // que motivou o pedido abria com o nome do arquivo e nada para baixar.
    const renderMidia = vi.fn((media: { name?: string }[]) => <span>baixar {media[0].name}</span>);
    render(<ConversasAnteriores agentId="bruce" open onOpenChange={() => {}} onCitar={() => {}} abrirConversa="r1" renderMidia={renderMidia} />);
    expect(await screen.findByText("baixar eventos.xlsx")).toBeInTheDocument();
  });
});
