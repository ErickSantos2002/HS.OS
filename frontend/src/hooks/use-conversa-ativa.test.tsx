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
const marcas = vi.hoisted(() => ({ desmarcar: vi.fn(async () => true) }));
vi.mock("@/lib/conversas-marcadas-store", () => marcas);

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

/**
 * A marca "voltarei aqui" some ao ABRIR a conversa, nunca por varredura. O
 * "Marcar como não lida" por mensagem morria no re-sweep de 2 s com a conversa
 * aberta — foi o "já some" que a Leticia relatou.
 */
describe("a marca de não lida some ao abrir", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });

  it("abrir a conversa desmarca uma vez, e o re-sweep de 2 s não desmarca de novo", () => {
    const h = renderHook(() => useConversaAtivaNasNotificacoes({
      agentId: "nina", canalId: null, agentDmChannelMap: { nina: "dm-1" },
    }));
    expect(marcas.desmarcar).toHaveBeenCalledTimes(1);
    expect(marcas.desmarcar).toHaveBeenCalledWith({ canalId: null, agentId: "nina" });
    vi.advanceTimersByTime(2000);
    expect(notif.markAllAsReadForChannel).toHaveBeenCalledTimes(3); // o re-sweep rodou
    expect(marcas.desmarcar).toHaveBeenCalledTimes(1);
    h.unmount();
    vi.useRealTimers();
  });

  it("marcar a conversa que já está aberta não a desmarca (re-render sem trocar de alvo)", () => {
    const h = renderHook((p: { mapa: Record<string, string> }) => useConversaAtivaNasNotificacoes({
      agentId: null, canalId: "c1", agentDmChannelMap: p.mapa,
    }), { initialProps: { mapa: {} } });
    expect(marcas.desmarcar).toHaveBeenCalledTimes(1);
    marcas.desmarcar.mockClear();
    h.rerender({ mapa: { outro: "x" } });
    vi.advanceTimersByTime(5000);
    expect(marcas.desmarcar).not.toHaveBeenCalled();
    h.unmount();
    vi.useRealTimers();
  });

  it("trocar de conversa desmarca a nova; tela inativa não desmarca", () => {
    const h = renderHook((p: { canal: string; ativa: boolean }) => useConversaAtivaNasNotificacoes({
      agentId: null, canalId: p.canal, agentDmChannelMap: {}, ativa: p.ativa,
    }), { initialProps: { canal: "c1", ativa: false } });
    expect(marcas.desmarcar).not.toHaveBeenCalled();
    h.rerender({ canal: "c2", ativa: true });
    expect(marcas.desmarcar).toHaveBeenCalledWith({ canalId: "c2", agentId: null });
    h.unmount();
    vi.useRealTimers();
  });
});
