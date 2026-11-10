/**
 * Conversa consigo mesmo no desktop (10/11/2026). O ícone do cabeçalho caía
 * no `#` de canal de grupo para todo tipo desconhecido — a conversa pessoal
 * aparecia como canal.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});
vi.mock("@/hooks/use-agent-avatar", () => ({ useAgentAvatar: () => ({ avatar: null }) }));

import { ChannelIcon } from "@/components/chat/ChannelChat";

describe("conversa pessoal no desktop", () => {
  it("o ícone não é o # de canal", () => {
    const { container } = render(<ChannelIcon type="pessoal" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-notebook-pen");
  });
});
