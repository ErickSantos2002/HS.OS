/**
 * Conversa consigo mesmo (10/11/2026). O banco guarda `name = 'Anotações'`;
 * se algum título usar o `name` cru, a pessoa vê "#Anotações" — um canal de
 * grupo que não existe. Todo título passa por `nomeDaConversaPessoal`.
 */
import { describe, expect, it } from "vitest";

import { ehPessoal, nomeDaConversaPessoal } from "@/lib/conversa-pessoal";

describe("conversa pessoal", () => {
  it("nome como no Teams: Fulano (você)", () => {
    expect(nomeDaConversaPessoal("Erick Santos", "e@x")).toBe("Erick Santos (você)");
  });

  it("sem nome, o começo do e-mail", () => {
    expect(nomeDaConversaPessoal(null, "erick@hs.com")).toBe("erick (você)");
  });

  it("sem nada, só Você", () => {
    expect(nomeDaConversaPessoal("", null)).toBe("Você");
  });

  it("reconhece só o tipo pessoal", () => {
    expect(ehPessoal({ type: "pessoal" })).toBe(true);
    expect(ehPessoal({ type: "dm" })).toBe(false);
    expect(ehPessoal(null)).toBe(false);
  });
});
