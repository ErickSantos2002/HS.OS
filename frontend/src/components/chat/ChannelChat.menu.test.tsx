/**
 * Mensagem de canal no estilo WhatsApp — 13/10/2026.
 *
 * Passar o mouse mostrava seis ícones (e, na mensagem larga, embaixo dela).
 * Agora: só o botão de reagir, ao lado da bolha; o resto num menu pela seta no
 * canto; e a bolha ocupa no máximo 70% da conversa.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const msg = {
  id: "m1", channel_id: "c1", author_id: "eu", author_type: "human", author_name: "Ana Teste",
  author_avatar: null, content: "Mensagem bem comprida.", thread_id: null, created_at: "2026-10-13T17:01:06Z",
  audio_url: null, edited_at: null, deleted_at: null, attachments: null,
} as unknown as ChannelMessage;
const noop = () => {};

function montar(currentUserId: string) {
  return render(
    <MessageBubble msg={msg} currentUserId={currentUserId} msgReactions={[]} onToggleReaction={noop}
      onEdit={noop} onDelete={noop} onReply={noop} onMarkUnread={() => true} onImageClick={noop}
      onAttachmentPreview={noop} threadMeta={null} threadHasUnread={false} />,
  );
}

function abrirMenu() {
  const seta = screen.getByRole("button", { name: "Opções da mensagem" });
  seta.focus();
  fireEvent.keyDown(seta, { key: "Enter" });
}

describe("mensagem de canal estilo WhatsApp", () => {
  it("só reagir fica à mão; a barra de ícones sumiu", () => {
    montar("eu");
    expect(screen.getByTitle("Reagir")).toBeInTheDocument();
    expect(screen.queryByTitle("Responder na conversa")).toBeNull();
    expect(screen.queryByTitle("Apagar")).toBeNull();
  });

  it("a seta abre o menu com tudo, inclusive editar e apagar na própria mensagem", async () => {
    montar("eu");
    abrirMenu();
    const menu = await screen.findByRole("menu");
    for (const r of ["Responder em thread", "Copiar", "Marcar como não lida", "Editar", "Apagar"]) {
      expect(within(menu).getByRole("menuitem", { name: r })).toBeInTheDocument();
    }
  });

  it("na mensagem de outra pessoa não há editar nem apagar", async () => {
    montar("outra-pessoa");
    abrirMenu();
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Editar" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Apagar" })).toBeNull();
  });

  it("a bolha ocupa no máximo 70% da conversa", () => {
    const { container } = montar("eu");
    expect(container.querySelector(".max-w-\\[70\\%\\]")).not.toBeNull();
  });
});
