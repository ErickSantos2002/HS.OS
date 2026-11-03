/**
 * A tela que sai da pilha desligava a conversa que entrou: re-renderizava
 * inativa depois da nova e zerava o agente/canal ativo. A conversa aberta
 * passava a tocar som, receber push e não marcar lido.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notif = vi.hoisted(() => ({
  markAllAsReadForChannel: vi.fn(async () => undefined),
  markAllAsReadForAgent: vi.fn(async () => undefined),
  setActiveChannel: vi.fn(),
  setActiveAgent: vi.fn(),
}));
const sender = vi.hoisted(() => ({ setActiveAgentId: vi.fn(), clearUnreadAgent: vi.fn() }));
vi.mock("@/components/NotificationsProvider", () => ({ useNotificationsContext: () => notif }));
vi.mock("@/lib/chat-sender", () => sender);

import { useConversaAtivaNasNotificacoes } from "./use-conversa-ativa";

const ultimo = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)?.[0];

describe("conversa ativa com duas telas ao mesmo tempo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a tela que sai (inativa) não zera a que entrou, nem ao desmontar", () => {
    const a = renderHook((p: { ativa: boolean }) =>
      useConversaAtivaNasNotificacoes({ agentId: "nina", canalId: null, agentDmChannelMap: {}, ativa: p.ativa }), { initialProps: { ativa: true } });
    expect(ultimo(sender.setActiveAgentId)).toBe("nina");

    // B entra por cima…
    renderHook(() => useConversaAtivaNasNotificacoes({ agentId: null, canalId: "c-geral", agentDmChannelMap: {}, ativa: true }));
    // …e A, deslizando para fora, re-renderiza inativa e depois desmonta.
    a.rerender({ ativa: false });
    a.unmount();

    expect(ultimo(notif.setActiveChannel)).toBe("c-geral");
    expect(notif.setActiveChannel).not.toHaveBeenLastCalledWith(null);
    expect(ultimo(notif.setActiveAgent)).toBeNull(); // B é canal: agente nulo é o valor DELE
  });

  it("tela inativa desde o começo não mexe em nada", () => {
    renderHook(() => useConversaAtivaNasNotificacoes({ agentId: "iris", canalId: null, agentDmChannelMap: {}, ativa: false }));
    expect(sender.setActiveAgentId).not.toHaveBeenCalled();
    expect(notif.setActiveChannel).not.toHaveBeenCalled();
  });

  it("sozinha, ao sair, zera como antes (desktop)", () => {
    const a = renderHook(() => useConversaAtivaNasNotificacoes({ agentId: null, canalId: "c1", agentDmChannelMap: {} }));
    a.unmount();
    expect(ultimo(notif.setActiveChannel)).toBeNull();
  });
});
