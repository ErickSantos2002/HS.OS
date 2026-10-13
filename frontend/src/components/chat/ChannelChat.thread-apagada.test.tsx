/**
 * Resposta em thread de mensagem apagada não pode sumir — 13/10/2026.
 *
 * A coordenadora de RH apagou um 👍 num canal e, com o painel da thread ainda
 * aberto, escreveu "tentei excluir e não foi." — que foi gravado como resposta
 * daquele 👍. O indicador "N respostas" ficava DENTRO do ramo da mensagem não
 * apagada: apagada a raiz, sumia o único caminho até as respostas, e a mensagem
 * dela ficou invisível para o outro lado da conversa (está no banco, intacta).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// O ChannelChat importa o leitor de PDF, que exige DOMMatrix no carregamento.
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

const apagada = {
  id: "m1", channel_id: "c1", author_id: "u1", author_type: "human", author_name: "Ana Teste",
  author_avatar: null, content: "👍", thread_id: null, created_at: "2026-10-13T17:01:06Z",
  audio_url: null, edited_at: null, deleted_at: "2026-10-13T17:01:29Z", attachments: null,
} as unknown as ChannelMessage;

const noop = () => {};

describe("mensagem apagada com respostas em thread", () => {
  it("continua mostrando o indicador de respostas", () => {
    render(
      <MessageBubble
        msg={apagada}
        currentUserId="u2"
        msgReactions={[]}
        onToggleReaction={noop}
        onEdit={noop}
        onDelete={noop}
        onReply={noop}
        onMarkUnread={() => true}
        onImageClick={noop}
        onAttachmentPreview={noop}
        threadMeta={{ count: 1, lastReplyAt: "2026-10-13T17:02:29Z", lastAuthorName: "Ana Teste", lastAuthorAvatar: null } as never}
        threadHasUnread={false}
      />,
    );
    expect(screen.getByText("Mensagem apagada")).toBeInTheDocument();
    expect(screen.getByText(/1 resposta/)).toBeInTheDocument();
  });
});
