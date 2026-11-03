/**
 * Segurar a mensagem no celular — spec 2026-11-03, Frente C3.
 *
 * O que fica trancado: a folha do celular mostra exatamente as ações do menu
 * da seta (uma fonte só), a seta de hover não é desenhada no toque, e rolar
 * com o dedo em cima da bolha não abre nada — era o defeito do long-press
 * anterior, que disparava no meio da rolagem.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  author_avatar: null, content: "Mensagem para segurar.", thread_id: null, created_at: "2026-10-13T17:01:06Z",
  audio_url: null, edited_at: null, deleted_at: null, attachments: null,
} as unknown as ChannelMessage;
const noop = () => {};

function montar(toque: boolean, onToggleReaction = noop) {
  return render(
    <MessageBubble msg={msg} currentUserId="eu" msgReactions={[]} onToggleReaction={onToggleReaction}
      onEdit={noop} onDelete={noop} onReply={noop} onMarkUnread={() => true} onImageClick={noop}
      onAttachmentPreview={noop} threadMeta={null} threadHasUnread={false} toque={toque} />,
  );
}

function segurar(alvo: Element) {
  fireEvent.touchStart(alvo, { touches: [{ clientX: 10, clientY: 10 }] });
}

describe("toque longo na mensagem de canal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no toque não há seta nem reagir de hover", () => {
    montar(true);
    expect(screen.queryByRole("button", { name: "Opções da mensagem" })).toBeNull();
    expect(screen.queryByTitle("Reagir")).toBeNull();
  });

  it("segurar 450ms abre a folha com as mesmas ações do menu e as reações", () => {
    montar(true);
    segurar(screen.getByText("Mensagem para segurar."));
    act(() => { vi.advanceTimersByTime(450); });
    for (const r of ["Responder em thread", "Copiar", "Marcar como não lida", "Editar", "Apagar"]) {
      expect(screen.getByRole("button", { name: r })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Reagir com 👍" })).toBeInTheDocument();
  });

  it("arrastar o dedo (rolar) não abre a folha", () => {
    montar(true);
    const alvo = screen.getByText("Mensagem para segurar.");
    segurar(alvo);
    fireEvent.touchMove(alvo, { touches: [{ clientX: 10, clientY: 40 }] });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("button", { name: "Responder em thread" })).toBeNull();
  });

  it("fora do toque (desktop) o desenho é o de sempre", () => {
    const { container } = montar(false);
    expect(screen.getByRole("button", { name: "Opções da mensagem" })).toBeInTheDocument();
    expect(container.querySelector(".max-w-\\[70\\%\\]")).not.toBeNull();
  });
});
