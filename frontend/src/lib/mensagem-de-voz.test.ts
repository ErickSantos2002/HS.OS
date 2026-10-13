/**
 * Mensagem de voz para agente — 13/10/2026.
 *
 * O agente não ouve: o modelo dele é só texto. A voz vai como transcrição, e o
 * agente precisa saber que é transcrição — "Fresh" pode ter sido "Flash", e um
 * agente que trata a transcrição como texto digitado responde com confiança
 * sobre a palavra errada.
 */
import { describe, expect, it } from "vitest";

import { avisoDeVoz, conteudoDeVoz } from "@/lib/mensagem-de-voz";

describe("mensagem de voz", () => {
  it("a transcrição vira conteúdo marcado com o microfone", () => {
    expect(conteudoDeVoz("  manda o ponto de setembro ")).toBe("🎤 manda o ponto de setembro");
  });

  it("transcrição vazia não vira mensagem", () => {
    expect(conteudoDeVoz("   ")).toBeNull();
    expect(conteudoDeVoz(undefined)).toBeNull();
  });

  it("o agente é avisado de que é transcrição automática", () => {
    expect(avisoDeVoz("🎤 manda o ponto")).toMatch(/transcri/i);
  });

  it("mensagem digitada não ganha aviso", () => {
    expect(avisoDeVoz("manda o ponto")).toBe("");
    expect(avisoDeVoz(undefined)).toBe("");
  });
});
