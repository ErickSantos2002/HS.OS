/**
 * Folha aberta de dentro de outra fechava sozinha ("Nova conversa", "Apagar",
 * "Mais emojis") e deixava uma entrada órfã: o voltar seguinte não fazia
 * nada. Ver `historico-da-folha.ts`.
 */
import { describe, expect, it } from "vitest";

import { criarControleDeFolhas, type HistoricoMinimo } from "./historico-da-folha";

function historicoFalso() {
  const pilha: unknown[] = [{ idx: 3 }];
  const h: HistoricoMinimo & { pilha: unknown[]; voltas: number } = {
    pilha,
    voltas: 0,
    get state() { return pilha[pilha.length - 1]; },
    pushState(e) { pilha.push(e); },
    replaceState(e) { pilha[pilha.length - 1] = e; },
    back() { h.voltas++; pilha.pop(); },
  };
  return h;
}

function relogioFalso() {
  const fila: Array<() => void> = [];
  return {
    agendar: (fn: () => void) => { fila.push(fn); return fila.length - 1; },
    cancelar: (id: unknown) => { fila[id as number] = () => {}; },
    rodar: () => { while (fila.length) fila.shift()!(); },
  };
}

describe("controle de folhas", () => {
  it("abrir B de dentro de A: B assume a entrada, nada de back, um nível só", () => {
    const h = historicoFalso();
    const r = relogioFalso();
    const c = criarControleDeFolhas(h, r.agendar, r.cancelar);
    c.abrir(1);
    expect(h.pilha).toHaveLength(2);
    c.fechar(1, false); // A fecha pelo toque…
    c.abrir(2); // …e no mesmo commit B abre
    r.rodar();
    expect(h.voltas).toBe(0);
    expect(h.pilha).toHaveLength(2);
    expect(h.state).toEqual({ idx: 3, celFolha: 2 });
    c.fechar(2, false);
    r.rodar();
    expect(h.voltas).toBe(1);
    expect(h.pilha).toEqual([{ idx: 3 }]);
  });

  it("fechar pelo toque devolve a entrada; pelo voltar, não mexe", () => {
    const h = historicoFalso();
    const r = relogioFalso();
    const c = criarControleDeFolhas(h, r.agendar, r.cancelar);
    c.abrir(1);
    c.fechar(1, false);
    r.rodar();
    expect(h.pilha).toEqual([{ idx: 3 }]);
    c.abrir(2);
    h.back(); // o voltar do Android consumiu a entrada
    c.fechar(2, true);
    r.rodar();
    expect(h.voltas).toBe(2);
    expect(h.pilha).toEqual([{ idx: 3 }]);
  });

  it("ação que navegou: a entrada não é mais o topo, o back não desfaz a navegação", () => {
    const h = historicoFalso();
    const r = relogioFalso();
    const c = criarControleDeFolhas(h, r.agendar, r.cancelar);
    c.abrir(1);
    h.replaceState({ idx: 4, usr: null }, ""); // navigate(..., { replace: true }) a partir da folha
    c.fechar(1, false);
    r.rodar();
    expect(h.voltas).toBe(0);
  });
});
