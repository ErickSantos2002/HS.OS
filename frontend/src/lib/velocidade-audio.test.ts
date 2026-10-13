/**
 * Velocidade dos áudios — 13/10/2026. O resumo em áudio dos agentes vai a toda
 * resposta; quem ouve muitos quer acelerar, e a escolha vale para os próximos.
 */
import { afterEach, describe, expect, it } from "vitest";

import { lerVelocidade, gravarVelocidade, proximaVelocidade, rotuloVelocidade } from "@/lib/velocidade-audio";

afterEach(() => localStorage.clear());

describe("velocidade do áudio", () => {
  it("alterna 1x → 1,5x → 2x → 0,5x → 1x", () => {
    expect([1, 1.5, 2, 0.5].map(proximaVelocidade)).toEqual([1.5, 2, 0.5, 1]);
  });

  it("valor fora da lista volta para 1,5x (o próximo depois de 1x)", () => {
    expect(proximaVelocidade(3)).toBe(1.5);
  });

  it("rótulo com vírgula decimal", () => {
    expect([0.5, 1, 1.5, 2].map(rotuloVelocidade)).toEqual(["0,5x", "1x", "1,5x", "2x"]);
  });

  it("lembra a escolha; sem nada guardado é 1x; lixo guardado é 1x", () => {
    expect(lerVelocidade()).toBe(1);
    gravarVelocidade(2);
    expect(lerVelocidade()).toBe(2);
    localStorage.setItem("hsos.velocidade-audio", "999");
    expect(lerVelocidade()).toBe(1);
  });
});
