/**
 * Agenda do Guardi (spec 2026-11-09-agenda-lembretes): o agrupamento da lista
 * e a frase de cada regra. As duas coisas são o que a pessoa LÊ para saber
 * quando vai ser lembrada — errar o dia aqui é a pessoa achar que o lembrete
 * é amanhã quando é hoje, ou que ele sumiu quando só está pausado.
 */
import { describe, expect, it } from "vitest";
import {
  agruparPorPeriodo,
  descreverRegra,
  descreverResposta,
  diasComLembrete,
  ocorreNoDia,
  regraDoFormulario,
  type Lembrete,
  type RegraLembrete,
} from "./agenda";

const lembrete = (parcial: Partial<Lembrete> & { regra: RegraLembrete }): Lembrete => ({
  id: parcial.id ?? Math.random().toString(36).slice(2),
  titulo: "t",
  instrucao: null,
  proximo_em: null,
  ativo: true,
  criado_por: "pessoa",
  ultimo_disparo_em: null,
  ultimo_status: null,
  ...parcial,
});

const unico = (id: string, em: string, extra: Partial<Lembrete> = {}) =>
  lembrete({ id, regra: { tipo: "unico", em }, proximo_em: `${em}:00-03:00`, ...extra });

// Segunda-feira, 09/11/2026, 10h de Brasília.
const HOJE = new Date("2026-11-09T10:00:00-03:00");

describe("agruparPorPeriodo", () => {
  it("separa os únicos em hoje, amanhã, esta semana (até domingo) e depois", () => {
    const g = agruparPorPeriodo([
      unico("hoje", "2026-11-09T18:00"),
      unico("amanha", "2026-11-10T08:00"),
      unico("quarta", "2026-11-11T09:00"),
      unico("domingo", "2026-11-15T23:00"),
      unico("segunda-que-vem", "2026-11-16T08:00"),
    ], HOJE);
    expect(g.hoje.map((l) => l.id)).toEqual(["hoje"]);
    expect(g.amanha.map((l) => l.id)).toEqual(["amanha"]);
    expect(g.semana.map((l) => l.id)).toEqual(["quarta", "domingo"]);
    expect(g.depois.map((l) => l.id)).toEqual(["segunda-que-vem"]);
  });

  it("o dia é o de Brasília, não o UTC do navegador", () => {
    // 22h30 de segunda em Brasília já é terça em UTC: com a data UTC, o
    // lembrete de hoje às 23h iria para "amanhã".
    const noite = new Date("2026-11-10T01:30:00Z");
    const g = agruparPorPeriodo([unico("hoje-23h", "2026-11-09T23:00")], noite);
    expect(g.hoje.map((l) => l.id)).toEqual(["hoje-23h"]);
  });

  it("recorrente vai sempre para recorrentes, mesmo disparando hoje", () => {
    const r = lembrete({ id: "r", regra: { tipo: "diario", hora: "18:00" }, proximo_em: "2026-11-09T18:00:00-03:00" });
    const g = agruparPorPeriodo([r], HOJE);
    expect(g.recorrentes.map((l) => l.id)).toEqual(["r"]);
    expect(g.hoje).toEqual([]);
  });

  it("pausado vai sempre para pausados, único ou recorrente", () => {
    const g = agruparPorPeriodo([
      unico("p1", "2026-11-09T18:00", { ativo: false }),
      lembrete({ id: "p2", regra: { tipo: "mensal", dia: 5, hora: "09:00" }, ativo: false }),
    ], HOJE);
    expect(g.pausados.map((l) => l.id)).toEqual(["p1", "p2"]);
    expect(g.hoje).toEqual([]);
    expect(g.recorrentes).toEqual([]);
  });

  it("único que já disparou (sem próximo) vai para passados, não some", () => {
    // Depois do disparo o servidor zera `proximo_em` e mantém `ativo`: sem
    // este grupo, o lembrete com status `perdido` sumiria da lista.
    const g = agruparPorPeriodo([
      unico("ontem", "2026-11-08T09:00", { proximo_em: null, ultimo_status: "perdido" }),
      unico("hoje-cedo", "2026-11-09T08:00", { proximo_em: null, ultimo_status: "entregue" }),
    ], HOJE);
    expect(g.passados.map((l) => l.id)).toEqual(["ontem", "hoje-cedo"]);
    expect(g.hoje).toEqual([]);
  });

  it("ordena cada grupo pelo horário", () => {
    const g = agruparPorPeriodo([unico("b", "2026-11-09T20:00"), unico("a", "2026-11-09T12:00")], HOJE);
    expect(g.hoje.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("descreverRegra", () => {
  it("os cinco tipos", () => {
    expect(descreverRegra({ tipo: "unico", em: "2026-11-11T09:00" })).toBe("11/11 às 09:00");
    expect(descreverRegra({ tipo: "diario", hora: "07:30" })).toBe("Todo dia às 07:30");
    expect(descreverRegra({ tipo: "dias_uteis", hora: "08:00" })).toBe("Dias úteis às 08:00");
    expect(descreverRegra({ tipo: "semanal", dias: [0], hora: "08:00" })).toBe("Toda segunda às 08:00");
    expect(descreverRegra({ tipo: "mensal", dia: 5, hora: "09:00" })).toBe("Dia 5 de todo mês às 09:00");
  });

  it("semanal com vários dias e com sábado/domingo", () => {
    // 0 = segunda, como no servidor. Ler 0 como domingo (JavaScript) mudaria
    // o dia de todo lembrete semanal na tela.
    expect(descreverRegra({ tipo: "semanal", dias: [4, 0, 2], hora: "08:00" })).toBe("Segunda, quarta e sexta às 08:00");
    expect(descreverRegra({ tipo: "semanal", dias: [5], hora: "10:00" })).toBe("Todo sábado às 10:00");
    expect(descreverRegra({ tipo: "semanal", dias: [6], hora: "10:00" })).toBe("Todo domingo às 10:00");
  });
});

describe("calendário", () => {
  it("ocorreNoDia conta a semana a partir de segunda e corta o dia 31 no fim do mês", () => {
    expect(ocorreNoDia({ tipo: "semanal", dias: [0], hora: "08:00" }, "2026-11-09")).toBe(true);
    expect(ocorreNoDia({ tipo: "semanal", dias: [0], hora: "08:00" }, "2026-11-08")).toBe(false);
    expect(ocorreNoDia({ tipo: "dias_uteis", hora: "08:00" }, "2026-11-14")).toBe(false);
    expect(ocorreNoDia({ tipo: "mensal", dia: 31, hora: "08:00" }, "2026-11-30")).toBe(true);
    expect(ocorreNoDia({ tipo: "unico", em: "2026-11-11T09:00" }, "2026-11-11")).toBe(true);
  });

  it("diasComLembrete ignora pausados", () => {
    const dias = diasComLembrete([
      unico("a", "2026-11-11T09:00"),
      unico("p", "2026-11-12T09:00", { ativo: false }),
    ], "2026-11-01", "2026-11-30");
    expect(dias).toEqual(new Set(["2026-11-11"]));
  });
});

describe("regraDoFormulario", () => {
  it("único vira `quando`; recorrente vira `repetir`", () => {
    expect(regraDoFormulario({ modo: "unico", data: "2026-11-11", hora: "09:00", tipo: "diario", dias: [], dia: 1 }))
      .toEqual({ quando: "2026-11-11T09:00" });
    expect(regraDoFormulario({ modo: "repetir", data: "", hora: "08:00", tipo: "semanal", dias: [2, 0], dia: 1 }))
      .toEqual({ repetir: { tipo: "semanal", dias: [0, 2], hora: "08:00" } });
    expect(regraDoFormulario({ modo: "repetir", data: "", hora: "09:00", tipo: "mensal", dias: [], dia: 5 }))
      .toEqual({ repetir: { tipo: "mensal", dia: 5, hora: "09:00" } });
  });
});

describe("o que a pessoa fez com o aviso (spec 2026-11-13)", () => {
  // "Entregue" dizia só que o recado saiu — a Sandra tinha o lembrete
  // "entregue" e não o viu. A linha passa a dizer o que ela fez com ele.
  const r = { tipo: "unico", em: "2026-11-13T14:00" } as const;
  const base = { regra: r, ultimo_disparo_em: "2026-11-13T14:00:27-03:00", ultimo_status: "entregue" as const };

  it("feito, adiado e avisado de novo sem resposta", () => {
    expect(descreverResposta(lembrete({ ...base, reconhecido_como: "feito",
      reconhecido_em: "2026-11-13T14:05:10.123-03:00" }))).toBe("Feito às 14:05");
    expect(descreverResposta(lembrete({ ...base, reconhecido_como: "adiado",
      reconhecido_em: "2026-11-13T14:00:40-03:00", reaviso_em: "2026-11-13T14:10:40-03:00" })))
      .toBe("Adiado para 14:10");
    expect(descreverResposta(lembrete({ ...base, aviso_em: "2026-11-13T14:05:30-03:00", reavisos: 1 })))
      .toBe("Avisado de novo às 14:05 — sem resposta");
  });

  it("aviso recém-saído ou lembrete antigo fica com o status de sempre", () => {
    expect(descreverResposta(lembrete({ ...base, aviso_em: "2026-11-13T14:00:27-03:00", reavisos: 0 }))).toBeNull();
    expect(descreverResposta(lembrete(base))).toBeNull();
  });
});
