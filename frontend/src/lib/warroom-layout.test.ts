import { describe, expect, it } from "vitest";
import { QUADRO, R_PESSOA, calcularLayout, larguraRotulo, type EntradaLayout } from "./warroom-layout";

/** O time real em 16/10/2026: 28 pessoas, 7 setores — o caso da foto. */
const REAL: [string, string[]][] = [
  ["Diretoria", ["Nicholson"]],
  ["Comercial", ["Adriana", "André", "Cláudia", "Eduardo", "Ellen", "Gislayne", "Karolaine",
    "Lara", "Leticia", "Miguel", "Sandra"]],
  ["Operação", ["Gustavo", "Hyago", "Leandro", "Lucas", "Paulo", "Rafael", "Walbert"]],
  ["Suporte", ["Gabriel", "Suelen"]],
  ["TI", ["Erick", "Rickelme", "Welton"]],
  ["Administrativo", ["Djalma", "Lidisay"]],
];
const AGENTES = ["nina", "iris", "atlas", "flow", "bruce"];

function entrada(setores: [string, string[]][]): EntradaLayout {
  const nomes: Record<string, string> = {};
  return {
    setores: setores.map(([nome, ps]) => ({
      nome, pessoas: ps.map((p, i) => { const id = `${nome}-${i}`; nomes[id] = p; return id; }),
    })),
    agentes: AGENTES,
    nomes,
  };
}

/** 40 pessoas: o time crescendo não pode trazer a bagunça de volta. */
const QUARENTA: [string, string[]][] = REAL.map(([s, ps]) => [s, [...ps]]);
for (let i = 0; QUARENTA.flatMap(([, p]) => p).length < 40; i++) QUARENTA[1][1].push(`Pessoa${i}`);

type Caixa = { x0: number; y0: number; x1: number; y1: number };
const cruza = (a: Caixa, b: Caixa) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function caixas(e: EntradaLayout) {
  const s = calcularLayout(e);
  const r = R_PESSOA * s.escala;
  const out: { id: string; no: Caixa; rotulo: Caixa }[] = [];
  for (const [id, p] of Object.entries(s.pessoas)) {
    const w = larguraRotulo(e.nomes[id], s.escala);
    out.push({
      id,
      no: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r },
      rotulo: { x0: p.x - w / 2, y0: p.y + r + 2, x1: p.x + w / 2, y1: p.y + r + 2 + 30 * s.escala },
    });
  }
  return { s, out };
}

describe.each([["28 pessoas reais", REAL], ["40 pessoas", QUARENTA]])("layout com %s", (_, setores) => {
  const e = entrada(setores);

  it("todo mundo tem lugar", () => {
    const s = calcularLayout(e);
    expect(Object.keys(s.pessoas)).toHaveLength(setores.flatMap(([, p]) => p).length);
    expect(Object.keys(s.agentes)).toEqual(AGENTES);
  });

  it("nenhum rótulo de nome encosta em outro nem em outro nó — o defeito da foto de 16/10", () => {
    const { out } = caixas(e);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        expect(cruza(out[i].rotulo, out[j].rotulo), `${out[i].id} × ${out[j].id}`).toBe(false);
        expect(cruza(out[i].rotulo, out[j].no), `${out[i].id} × nó ${out[j].id}`).toBe(false);
        expect(cruza(out[i].no, out[j].rotulo), `nó ${out[i].id} × ${out[j].id}`).toBe(false);
      }
  });

  it("tudo dentro do quadro, rótulos de setor inclusive", () => {
    const { s, out } = caixas(e);
    for (const { rotulo, no } of out)
      for (const c of [rotulo, no]) {
        expect(c.x0).toBeGreaterThanOrEqual(0); expect(c.x1).toBeLessThanOrEqual(QUADRO.w);
        expect(c.y0).toBeGreaterThanOrEqual(0); expect(c.y1).toBeLessThanOrEqual(QUADRO.h);
      }
    for (const r of s.setores) {
      const w = larguraRotulo(r.nome, 1.2);
      const x0 = r.ancora === "end" ? r.x - w : r.ancora === "middle" ? r.x - w / 2 : r.x;
      expect(x0).toBeGreaterThanOrEqual(0); expect(x0 + w).toBeLessThanOrEqual(QUADRO.w);
      expect(r.y).toBeGreaterThanOrEqual(12); expect(r.y).toBeLessThanOrEqual(QUADRO.h);
    }
  });

  it("mesma entrada, mesma saída — a parede não dança", () => {
    expect(calcularLayout(e)).toEqual(calcularLayout(e));
  });
});

it("cada setor ganha um rótulo, na ordem", () => {
  expect(calcularLayout(entrada(REAL)).setores.map((s) => s.nome)).toEqual(REAL.map(([s]) => s));
});
