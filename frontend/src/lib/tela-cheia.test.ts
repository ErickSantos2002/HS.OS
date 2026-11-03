/**
 * Conversa em tela cheia no celular — spec 2026-11-03, Frente C1.
 *
 * Com a conversa aberta somem o cabeçalho do HS.OS e a barra de baixo, como no
 * WhatsApp. A lista continua com os dois — é de lá que se sai do chat. Abrir
 * pelo link profundo (notificação, busca) tem que cair no mesmo estado.
 */
import { describe, expect, it } from "vitest";

import { conversaEmTelaCheia } from "@/lib/tela-cheia";

describe("conversaEmTelaCheia", () => {
  it("lista do chat mantém cabeçalho e barra", () => {
    expect(conversaEmTelaCheia("/chat", "", true)).toBe(false);
    expect(conversaEmTelaCheia("/chat", "?tab=dms", true)).toBe(false);
  });
  it("agente aberto no celular é tela cheia", () => {
    expect(conversaEmTelaCheia("/chat", "?agent=nina", true)).toBe(true);
  });
  it("canal ou DM aberto no celular é tela cheia, inclusive vindo de link", () => {
    expect(conversaEmTelaCheia("/chat", "?channel=abc&message=m1", true)).toBe(true);
  });
  it("desktop nunca", () => {
    expect(conversaEmTelaCheia("/chat", "?agent=nina", false)).toBe(false);
  });
  it("outras rotas nunca", () => {
    expect(conversaEmTelaCheia("/agents", "?agent=nina", true)).toBe(false);
    expect(conversaEmTelaCheia("/chatbot", "?agent=nina", true)).toBe(false);
  });
});
