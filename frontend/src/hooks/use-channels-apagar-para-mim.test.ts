/**
 * "Apagar para mim" (30/10/2026) — a mensagem some só da tela de quem apagou.
 *
 * O caso que este teste tranca é a corrida: a lista do canal se recarrega
 * sozinha (foco, enquete de 60 s), e uma leitura que saiu ANTES do clique volta
 * com a mensagem. Sem o filtro do hook, o `reconcileMessages` a reporia na
 * tela — o GIF que a pessoa acabou de esconder voltaria sozinho.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ lista: [] as unknown[] }));

vi.mock("@/lib/api", () => ({ api: vi.fn(async () => estado.lista) }));
vi.mock("@/lib/realtime", () => ({ assinar: () => () => {} }));
const auth = vi.hoisted(() => ({ user: { id: "eu" } }));
vi.mock("@/contexts/auth-context", () => ({ useAuthContext: () => auth }));

import { api } from "@/lib/api";
import { useChannelMessages, type ChannelMessage } from "./use-channels";

const msg = (id: string, minuto: number): ChannelMessage => ({
  id, channel_id: "c1", author_id: "outro", author_type: "human", author_name: "Outro",
  content: id, created_at: `2026-10-30T12:0${minuto}:00.000Z`,
} as ChannelMessage);

const assentar = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  estado.lista = [msg("oi", 1), msg("gif", 2)];
});

describe("apagar para mim", () => {
  it("some na hora e não volta com a recarga que já estava a caminho", async () => {
    const { result } = renderHook(() => useChannelMessages("c1"));
    await assentar();
    expect(result.current.messages.map((m) => m.id)).toEqual(["oi", "gif"]);

    act(() => result.current.esconder("gif"));
    expect(result.current.messages.map((m) => m.id)).toEqual(["oi"]);

    // A leitura atrasada ainda traz o "gif": o foco da janela dispara o load.
    const antes = vi.mocked(api).mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await assentar();
    expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(antes);
    expect(result.current.messages.map((m) => m.id)).toEqual(["oi"]);
  });

  it("desfazer devolve a mensagem no lugar dela", async () => {
    // Ids próprios: o que se esconde vale para a sessão inteira (é do módulo).
    estado.lista = [msg("a", 1), msg("b", 2), msg("c", 3)];
    const { result } = renderHook(() => useChannelMessages("c2"));
    await assentar();
    const b = result.current.messages.find((m) => m.id === "b")!;
    act(() => result.current.esconder("b"));
    act(() => result.current.reexibir(b));
    expect(result.current.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
