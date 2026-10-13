/**
 * Mensagem só com imagem — 13/10/2026.
 *
 * Ia junto uma bolha de texto vazia (com a seta e o reagir presos nela), a
 * imagem saía depois do horário e espremida em 240 px.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});
vi.mock("@/hooks/use-agent-avatar", () => ({ useAgentAvatar: () => ({ avatar: null }) }));
vi.mock("@/lib/anexos", () => ({ urlDoAnexo: async () => "https://r2.exemplo/print.png", esquecerUrl: vi.fn() }));

import { MessageBubble } from "@/components/chat/ChannelChat";
import type { ChannelMessage } from "@/hooks/use-channels";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const soImagem = {
  id: "m1", channel_id: "c1", author_id: "eu", author_type: "human", author_name: "Ana Teste",
  author_avatar: null, content: "", thread_id: null, created_at: "2026-10-13T17:11:00Z",
  audio_url: null, edited_at: null, deleted_at: null,
  attachments: [{ id: "6f1c2d3e-0000-4000-8000-000000000009", url: "", name: "print.png", size: 1, mimeType: "image/png" }],
} as unknown as ChannelMessage;
const noop = () => {};

function montar() {
  return render(
    <MessageBubble msg={soImagem} currentUserId="eu" msgReactions={[]} onToggleReaction={noop}
      onEdit={noop} onDelete={noop} onReply={noop} onMarkUnread={() => true} onImageClick={noop}
      onAttachmentPreview={noop} threadMeta={null} threadHasUnread={false} />,
  );
}

describe("mensagem só com imagem", () => {
  it("não desenha bolha de texto vazia; a seta e o reagir ficam na imagem", async () => {
    const { container } = montar();
    const img = await screen.findByRole("img", { name: "print.png" });
    expect(container.querySelector(".pr-7")).toBeNull();          // a bolha de texto
    const seta = screen.getByRole("button", { name: "Opções da mensagem" });
    const bloco = img.closest("[data-bloco-anexos]");
    expect(bloco).not.toBeNull();
    expect(bloco!.contains(seta)).toBe(true);
    expect(bloco!.contains(screen.getByTitle("Reagir"))).toBe(true);
  });

  it("a imagem vem antes do horário e não fica espremida", async () => {
    montar();
    const img = await screen.findByRole("img", { name: "print.png" });
    const hora = screen.getByText(/^\d\d:\d\d$/);
    expect(img.compareDocumentPosition(hora) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(img.className).toContain("max-w-[360px]");
  });
});
