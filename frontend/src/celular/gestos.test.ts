import { describe, expect, it } from "vitest";

import { classificarMovimento, deslocamentoDaBolha, gravacaoCancelada, ondasDe, soltarResponde } from "./gestos";

describe("gestos da bolha", () => {
  it("tremor do dedo não é gesto", () => {
    expect(classificarMovimento(4, -6)).toBe("parado");
  });
  it("para a direita e mais horizontal que vertical é deslizar", () => {
    expect(classificarMovimento(30, 8)).toBe("deslizar");
  });
  it("para a esquerda, ou mais vertical, é rolar — e rolar cancela o segurar", () => {
    expect(classificarMovimento(-30, 2)).toBe("rolar");
    expect(classificarMovimento(15, 40)).toBe("rolar");
  });
  it("a bolha acompanha até 90px e responde passando de 60", () => {
    expect(deslocamentoDaBolha(200)).toBe(90);
    expect(deslocamentoDaBolha(-20)).toBe(0);
    expect(soltarResponde(59)).toBe(false);
    expect(soltarResponde(61)).toBe(true);
  });
});

it("microfone cancela deslizando mais de 90px para a esquerda", () => {
  expect(gravacaoCancelada(300, 220)).toBe(false);
  expect(gravacaoCancelada(300, 200)).toBe(true);
});

it("a onda é a mesma para a mesma mensagem e fica entre 20% e 90%", () => {
  const a = ondasDe("msg-1");
  expect(a).toEqual(ondasDe("msg-1"));
  expect(a).not.toEqual(ondasDe("msg-2"));
  expect(a).toHaveLength(34);
  expect(Math.min(...a)).toBeGreaterThanOrEqual(20);
  expect(Math.max(...a)).toBeLessThanOrEqual(90);
});
