/**
 * Resposta de agente no canal com resumo em áudio — 13/10/2026.
 *
 * Mensagem com `audio_url` era sempre "voz de pessoa": player em cima e o texto
 * recolhido como transcrição. A de agente é o contrário — o texto é a resposta
 * e vem inteiro; o áudio é o resumo e vai embaixo. Quem desligou a preferência
 * não vê o player.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});
vi.mock("@/hooks/use-agent-avatar", () => ({ useAgentAvatar: () => ({ avatar: null }) }));
vi.mock("@/lib/anexos", () => ({ urlDoAnexo: async () => "https://r2.exemplo/resumo.mp3", esquecerUrl: vi.fn() }));

import { MessageBubble } from "@/components/chat/ChannelChat";
import type { ChannelMessage } from "@/hooks/use-channels";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const TEXTO = "Faturamento de setembro fechou em R$ 441 mil, doze por cento acima de agosto.";
const doAgente = {
  id: "m1", channel_id: "c1", author_id: "nina", author_type: "agent", author_name: "Nina",
  author_avatar: null, content: TEXTO, thread_id: null, created_at: "2026-10-13T17:01:06Z",
  audio_url: "anexo:6f1c2d3e-0000-4000-8000-000000000001", edited_at: null, deleted_at: null, attachments: null,
} as unknown as ChannelMessage;
const noop = () => {};

function montar(resumoLigado: boolean) {
  return render(
    <MessageBubble msg={doAgente} currentUserId="u2" msgReactions={[]} onToggleReaction={noop}
      onEdit={noop} onDelete={noop} onReply={noop} onMarkUnread={() => true} onImageClick={noop}
      onAttachmentPreview={noop} threadMeta={null} threadHasUnread={false} resumoLigado={resumoLigado} />,
  );
}

describe("resposta de agente com resumo em áudio no canal", () => {
  it("mostra o texto inteiro e o player embaixo", async () => {
    const { container } = montar(true);
    const texto = screen.getByText(/441 mil/);
    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src"))
      .toBe("https://r2.exemplo/resumo.mp3"));
    // Embaixo do texto: o player vem DEPOIS no documento.
    const audio = container.querySelector("audio")!;
    expect(texto.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("quem desligou não vê o player", async () => {
    const { container } = montar(false);
    expect(screen.getByText(/441 mil/)).toBeInTheDocument();
    // Dá tempo de a URL do anexo chegar; se o player fosse desenhar, já estaria aqui.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("audio")).toBeNull();
  });
});
