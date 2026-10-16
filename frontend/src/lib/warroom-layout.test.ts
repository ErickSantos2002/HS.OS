import { describe, expect, it } from "vitest";
import {
  QUADRO, ROTULO_STATUS, calcularLayout, caixaSetor, caixasAgente, caixasPessoa,
  type Caixa, type EntradaLayout,
} from "./warroom-layout";

/** O time real em 16/10/2026: 26 pessoas em 6 setores — o caso da foto. */
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

const cruza = (a: Caixa, b: Caixa) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const dentro = (c: Caixa) => c.x0 >= 0 && c.x1 <= QUADRO.w && c.y0 >= 0 && c.y1 <= QUADRO.h;

/** O status mais largo — o teste supõe que TODO MUNDO está em reunião, que é
 *  o rótulo de duas linhas mais largo e mais alto que a tela desenha. */
const PIOR_STATUS = Object.values(ROTULO_STATUS).sort((a, b) => b.length - a.length)[0];

function caixas(e: EntradaLayout) {
  const s = calcularLayout(e);
  const out = Object.entries(s.pessoas).map(([id, p]) => ({
    id, ...caixasPessoa(p, e.nomes[id], PIOR_STATUS, s.escala),
  }));
  return { s, out };
}

/** Os agentes no pior caso: ocupados, conversando com o nome mais comprido do
 *  time, há mais de uma hora — a linha mais larga que a tela escreve. */
function caixasDosAgentes(e: EntradaLayout) {
  const s = calcularLayout(e);
  const longo = Object.values(e.nomes).sort((a, b) => b.length - a.length)[0];
  return Object.entries(s.agentes).map(([id, p]) => ({
    id, ...caixasAgente(p, id, `conversando com ${longo}`, "125min 59s"),
  }));
}

describe.each([["26 pessoas reais", REAL], ["40 pessoas", QUARENTA]])("layout com %s", (_, setores) => {
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

  it("tudo dentro do quadro, rótulos de setor e de agente inclusive", () => {
    const { s, out } = caixas(e);
    for (const { id, rotulo, no } of out) {
      expect(dentro(rotulo), `rótulo ${id}`).toBe(true);
      expect(dentro(no), `nó ${id}`).toBe(true);
    }
    for (const r of s.setores) expect(dentro(caixaSetor(r)), `setor ${r.nome}`).toBe(true);
    for (const a of caixasDosAgentes(e)) expect(dentro(a.rotulo), `agente ${a.id}`).toBe(true);
  });

  it("o nome do setor não encosta em pessoa nem em nome de pessoa", () => {
    const { s, out } = caixas(e);
    for (const r of s.setores)
      for (const p of out) {
        expect(cruza(caixaSetor(r), p.no), `${r.nome} × nó ${p.id}`).toBe(false);
        expect(cruza(caixaSetor(r), p.rotulo), `${r.nome} × ${p.id}`).toBe(false);
      }
  });

  it("agente ocupado: o rótulo não encosta em outro agente, no núcleo nem no anel de pessoas", () => {
    const { s, out } = caixas(e);
    const ag = caixasDosAgentes(e);
    const nucleo: Caixa = { x0: s.nucleo.x - 40, y0: s.nucleo.y - 40, x1: s.nucleo.x + 40, y1: s.nucleo.y + 60 };
    for (const a of ag) {
      expect(cruza(a.rotulo, nucleo), `${a.id} × núcleo`).toBe(false);
      for (const b of ag) if (b !== a) {
        expect(cruza(a.rotulo, b.rotulo), `${a.id} × ${b.id}`).toBe(false);
        expect(cruza(a.rotulo, b.no), `${a.id} × nó ${b.id}`).toBe(false);
      }
      for (const p of out) {
        expect(cruza(a.rotulo, p.no), `${a.id} × nó ${p.id}`).toBe(false);
        expect(cruza(a.rotulo, p.rotulo), `${a.id} × ${p.id}`).toBe(false);
        expect(cruza(a.no, p.rotulo), `nó ${a.id} × ${p.id}`).toBe(false);
      }
    }
  });

  it("mesma entrada, mesma saída — a parede não dança", () => {
    expect(calcularLayout(e)).toEqual(calcularLayout(e));
  });
});

it("cada setor ganha um rótulo, na ordem", () => {
  expect(calcularLayout(entrada(REAL)).setores.map((s) => s.nome)).toEqual(REAL.map(([s]) => s));
});
