/**
 * Responder citando no desktop — 10/11/2026.
 *
 * Substituiu o "Responder em thread". A citação é texto (`> **Autor:** trecho`),
 * e sem o cartão a tela mostraria o Markdown cru — com o `**` do autor —, que
 * era o que o desktop fazia com as respostas vindas do celular.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});
vi.mock("@/hooks/use-agent-avatar", () => ({ useAgentAvatar: () => ({ avatar: null }) }));

import { MessageBubble } from "@/components/chat/ChannelChat";
import type { ChannelMessage } from "@/hooks/use-channels";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const resposta = {
  id: "m2", channel_id: "c1", author_id: "outro", author_type: "human", author_name: "Bia",
  author_avatar: null, content: "> **Ana Teste:** o laudo saiu?\n\nSaiu sim, mando já.",
  thread_id: null, created_at: "2026-11-10T13:00:00Z",
  audio_url: null, edited_at: null, deleted_at: null, attachments: null,
} as unknown as ChannelMessage;
const noop = () => {};

describe("resposta citando no desktop", () => {
  it("desenha o cartão com autor e trecho, sem o Markdown cru, e o clique leva à citada", () => {
    const aoClicar = vi.fn();
    render(
      <MessageBubble msg={resposta} currentUserId="eu" msgReactions={[]} onToggleReaction={noop}
        onEdit={noop} onDelete={noop} onReply={noop} onMarkUnread={() => true} onImageClick={noop}
        onAttachmentPreview={noop} threadMeta={null} threadHasUnread={false} onCitacaoClick={aoClicar} />,
    );
    expect(screen.getByText("Ana Teste")).toBeInTheDocument();
    expect(screen.getByText("o laudo saiu?")).toBeInTheDocument();
    expect(screen.getByText("Saiu sim, mando já.")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).toBeNull();

    fireEvent.click(screen.getByTitle("Ir para a mensagem"));
    expect(aoClicar).toHaveBeenCalledWith({ autor: "Ana Teste", texto: "o laudo saiu?" });
  });
});
