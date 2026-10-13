/**
 * A bolha do agente desenha o resumo em áudio — 13/10/2026.
 *
 * O `MediaBubble` só sabia imagem e arquivo; mídia `audio` caía no `return
 * null` e o resumo falado do agente sumia da conversa.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});

import { MediaBubble } from "@/pages/ChatPage";

describe("MediaBubble", () => {
  it("mídia de áudio vira player com a URL resolvida", () => {
    const { container } = render(
      <MediaBubble attachment={{ type: "audio", url: "https://r2.exemplo/a.mp3", name: "audio.mp3", mimeType: "audio/mpeg", base64: "" }} onImageClick={() => {}} />,
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("https://r2.exemplo/a.mp3");
  });
});
