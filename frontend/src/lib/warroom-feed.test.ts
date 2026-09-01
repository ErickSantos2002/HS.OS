/**
 * A parede não pode dar tela branca.
 *
 * Em 01/09/2026 o painel subiu em produção mostrando "Algo deu errado": o
 * backend implantado era uma versão anterior do `/warroom/feed`, sem o campo
 * `filhos`, e a tela fazia `a.filhos.filter(...)` direto. Um campo ausente
 * derrubou o ErrorBoundary inteiro.
 *
 * ⚠️ O erro não foi o campo faltar — versão de API descasa, e numa TV que
 * ninguém opera isso vai acontecer de novo. O erro foi a tela confiar na forma
 * da resposta em seis lugares diferentes. A defesa mora aqui, na fronteira: o
 * que sai daqui é sempre desenhável.
 */
import { describe, expect, it } from "vitest";

import { normalizar } from "./warroom-feed";

describe("normalizar", () => {
  it("sobrevive a uma resposta completamente vazia", () => {
    const f = normalizar({});
    expect(f.agentes).toEqual([]);
    expect(f.pessoas).toEqual([]);
    expect(f.eventos).toEqual([]);
  });

  it("sobrevive a null, que é o que um backend fora do ar devolve", () => {
    expect(normalizar(null).agentes).toEqual([]);
  });

  it("dá filhos vazio ao agente que veio sem o campo", () => {
    // Exatamente a resposta da versão antiga que quebrou a produção.
    const f = normalizar({ agentes: [{ id: "iris", nome: "Iris" }] });
    expect(f.agentes[0].filhos).toEqual([]);
  });

  it("descarta filho que não é lista", () => {
    const f = normalizar({ agentes: [{ id: "iris", filhos: "nenhum" }] });
    expect(f.agentes[0].filhos).toEqual([]);
  });

  it("mantém os filhos de verdade", () => {
    const f = normalizar({ agentes: [{ id: "iris", filhos: [{ nome: "sub", vivo: true }] }] });
    expect(f.agentes[0].filhos).toHaveLength(1);
  });

  it("estado desconhecido vira ocioso, que é o desenho neutro", () => {
    expect(normalizar({ agentes: [{ id: "x" }] }).agentes[0].estado).toBe("ocioso");
  });

  it("garante numeros mesmo quando o bloco inteiro falta", () => {
    const n = normalizar({}).numeros;
    expect(n.tokens).toBe(0);
    expect(n.entregas).toBe(0);
  });

  it("não inventa taxa de cache", () => {
    // Zero afirmaria que o cache nunca acerta. Nulo diz que ninguém mediu.
    expect(normalizar({}).numeros.cacheTaxa).toBeNull();
  });

  it("preserva contexto nulo em vez de virar zero", () => {
    const f = normalizar({ agentes: [{ id: "x", contexto: null }] });
    expect(f.agentes[0].contexto).toBeNull();
  });

  it("descarta agente sem id, que não teria onde ser desenhado", () => {
    expect(normalizar({ agentes: [{ nome: "sem id" }, { id: "ok" }] }).agentes).toHaveLength(1);
  });
});
