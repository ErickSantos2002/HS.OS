/**
 * Painel "Arquivos" — o mesmo componente serve o canal e a conversa com o
 * agente (pedido da Lidisay, 15/10/2026). O que tranca: o painel busca na
 * rota que recebeu, e mostra quem enviou cada arquivo — na conversa com o
 * agente, "Você" ou o nome dele.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: vi.fn(async () => [
    { id: "m1", created_at: "2026-10-13T12:24:15.000Z", author_name: "Você",
      attachments: [{ id: "a1", name: "ponto-setembro.xlsx", size: 2048, mimeType: "application/vnd.ms-excel" }] },
    { id: "m2", created_at: "2026-10-13T12:25:30.000Z", author_name: "Bruce",
      attachments: [{ id: "a2", name: "relatorio.xlsx", size: 1024, mimeType: "application/vnd.ms-excel" }] },
  ]),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/components/chat/AnexoResolvido", () => ({
  default: ({ children }: { children: (u: string, r: () => void, a: () => Promise<string>) => JSX.Element }) =>
    children("", () => {}, async () => ""),
}));

import ChannelFilesPanel from "./ChannelFilesPanel";

describe("ChannelFilesPanel", () => {
  it("busca no endpoint recebido e mostra o autor de cada arquivo", async () => {
    render(<ChannelFilesPanel endpoint="/conversations/bruce/arquivos" open onClose={() => {}} />);
    expect(await screen.findByText("ponto-setembro.xlsx")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/conversations/bruce/arquivos");
    expect(screen.getByText(/^Você ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Bruce ·/)).toBeInTheDocument();
  });

  it("fechado não busca nada", () => {
    api.mockClear();
    render(<ChannelFilesPanel endpoint="/channels/x/arquivos" open={false} onClose={() => {}} />);
    expect(api).not.toHaveBeenCalled();
  });
});
