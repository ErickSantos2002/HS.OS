/**
 * O visto que a bolha mostra (spec 2026-10-14). Errar aqui é mentir para quem
 * mandou — e o caso mais caro é o ⚠ numa pergunta que o agente respondeu.
 */
import { describe, expect, it } from "vitest";
import { estadoNoAgente, estadoNoCanal, UUID_RE } from "./vistos";
import type { ChatMessage } from "./mock-data";

const U = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10";
const U2 = "7f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10";

function m(id: string, role: "user" | "agent", extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, agentId: "nina", role, content: "x", timestamp: "", channel: "web", ...extra };
}

describe("estadoNoCanal", () => {
  it("bolha otimista é pendente", () => {
    expect(estadoNoCanal("optimistic-123", {})).toBe("pendente");
  });
  it("usa o estado do servidor", () => {
    expect(estadoNoCanal(U, { [U]: "lida" })).toBe("lida");
    expect(estadoNoCanal(U, { [U]: "entregue" })).toBe("entregue");
  });
  it("sem estado conhecido é enviada", () => {
    expect(estadoNoCanal(U, {})).toBe("enviada");
    expect(estadoNoCanal(U, { [U]: "bobagem" })).toBe("enviada");
  });
});

describe("estadoNoAgente", () => {
  it("id que não é uuid é pendente — inclusive o das bolhas de arquivo", () => {
    expect(estadoNoAgente([m(`m${Date.now()}-fileop`, "user")], 0, false)).toBe("pendente");
    expect(UUID_RE.test(`m${Date.now()}-fileop`)).toBe(false);
  });
  it("resposta posterior vence o 'falhou' do servidor (resposta via /recuperar)", () => {
    const lista = [m(U, "user", { recibo: "falhou" }), m(U2, "agent")];
    expect(estadoNoAgente(lista, 0, false)).toBe("lida");
  });
  it("erro antes de qualquer resposta é falhou", () => {
    const lista = [m(U, "user"), m("erro-1", "agent", { isError: true })];
    expect(estadoNoAgente(lista, 0, false)).toBe("falhou");
  });
  it("última pergunta com o agente trabalhando é entregue", () => {
    expect(estadoNoAgente([m(U, "user")], 0, true)).toBe("entregue");
  });
  it("pergunta antiga sem resposta não vira entregue só porque o agente trabalha em outra", () => {
    const lista = [m(U, "user"), m(U2, "user")];
    expect(estadoNoAgente(lista, 0, true)).toBe("enviada");
  });
  it("sem nada mais, usa o recibo do servidor ou enviada", () => {
    expect(estadoNoAgente([m(U, "user", { recibo: "entregue" })], 0, false)).toBe("entregue");
    expect(estadoNoAgente([m(U, "user")], 0, false)).toBe("enviada");
  });
});
