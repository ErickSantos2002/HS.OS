/**
 * O catálogo tem que sobreviver ao `isOfficial: false` que produção devolve.
 *
 * Medido em 02/09/2026: `GET /agents` respondeu com os cinco agentes da casa,
 * todos com `isOfficial: false`, porque `agent_profiles.is_official` é coluna
 * herdada que nada escreve. O `fetchCatalog` filtrava por esse campo, o
 * catálogo ficava vazio, e mencionar agente em canal não acionava ninguém.
 */
import { describe, expect, it } from "vitest";

import { catalogoDaResposta } from "@/lib/catalogo-de-agentes";

// A resposta real de produção, reduzida aos campos que importam.
const RESPOSTA_DE_PRODUCAO = [
  { id: "atlas", name: "Atlas", isOfficial: false, isLeader: false, sortOrder: null },
  { id: "bruce", name: "Bruce", isOfficial: false, isLeader: false, sortOrder: null },
  { id: "flow", name: "Flow", isOfficial: false, isLeader: false, sortOrder: null },
  { id: "iris", name: "Iris", isOfficial: false, isLeader: false, sortOrder: null },
  { id: "nina", name: "Nina", isOfficial: false, isLeader: true, sortOrder: null },
];

describe("catalogoDaResposta", () => {
  it("guarda os cinco agentes mesmo com isOfficial false", () => {
    expect(catalogoDaResposta(RESPOSTA_DE_PRODUCAO).map((e) => e.id)).toEqual([
      "atlas", "bruce", "flow", "iris", "nina",
    ]);
  });

  it("preserva o líder e o nome de exibição", () => {
    const nina = catalogoDaResposta(RESPOSTA_DE_PRODUCAO).find((e) => e.id === "nina");
    expect(nina).toMatchObject({ name: "Nina", isLeader: true });
  });

  it("descarta entrada sem id, que não vira agente nenhum", () => {
    expect(catalogoDaResposta([{ name: "sem id" }, { id: "   " }])).toEqual([]);
  });

  it("aguenta resposta que não é lista", () => {
    expect(catalogoDaResposta(undefined)).toEqual([]);
    expect(catalogoDaResposta(null)).toEqual([]);
  });
});
