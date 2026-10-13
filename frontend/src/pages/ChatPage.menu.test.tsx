/**
 * Conversa com agente no mesmo estilo do canal — 13/10/2026: a seta no canto
 * abre as ações; nada de ícones embaixo da resposta; bolha até 70%.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
});

// O conteúdo da bolha não está em teste aqui — só a moldura dela.
vi.mock("@/components/chat/ArtifactMessage", () => ({ default: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("@/contexts/auth-context", () => ({ useAuthContext: () => ({ user: { id: "u" }, role: "administrador", profile: null }) }));
vi.mock("@/contexts/FileSystemContext", () => ({ useFS: () => ({}) }));

import { AgentMessageList } from "@/pages/ChatPage";

const mensagens = [
  { id: "u1", agentId: "nina", role: "user", content: "Qual o faturamento?", timestamp: "2026-10-13T17:00:00Z", channel: "web" },
  { id: "a1", agentId: "nina", role: "agent", content: "Setembro fechou em R$ 441 mil.", timestamp: "2026-10-13T17:00:05Z", channel: "web" },
] as never[];

function montar() {
  return render(
    <MemoryRouter>
      <AgentMessageList messages={mensagens} isMobile={false} isAgentWorking={false} ttsPlaying={null}
        effectiveAgentId="nina" agentName="Nina" userAvatarUrl={null} userName="Ana"
        onSetLightboxSrc={() => {}} onSetActiveArtifact={() => {}} onOpenLiveArtifact={() => {}}
        onRetry={() => {}} onTtsToggle={() => {}} activitiesByMessageId={{}} trailingActivities={[]} />
    </MemoryRouter>,
  );
}

async function abrir(indice: number) {
  const seta = screen.getAllByRole("button", { name: "Opções da mensagem" })[indice];
  seta.focus();
  fireEvent.keyDown(seta, { key: "Enter" });
  return screen.findByRole("menu");
}

describe("conversa com agente estilo WhatsApp", () => {
  it("não há mais botão de copiar solto embaixo nem barra no hover", () => {
    montar();
    expect(screen.queryByRole("button", { name: "Copiar mensagem" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Opções da mensagem" })).toHaveLength(2);
  });

  it("na resposta do agente o menu tem copiar e marcar como não lida", async () => {
    montar();
    const menu = await abrir(1);
    expect(within(menu).getByRole("menuitem", { name: "Copiar" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Marcar como não lida" })).toBeInTheDocument();
  });

  it("na mensagem da pessoa o menu tem só copiar", async () => {
    montar();
    const menu = await abrir(0);
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Copiar"]);
  });

  it("as bolhas ocupam no máximo 70%", () => {
    const { container } = montar();
    expect(container.querySelectorAll(".max-w-\\[70\\%\\]").length).toBe(2);
  });
});
