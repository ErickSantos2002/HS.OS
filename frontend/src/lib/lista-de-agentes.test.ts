/**
 * Lista de agentes do chat (05/11/2026): o PRÓPRIO bot fica fixo no topo; o
 * bloco recolhido "Bots pessoais" só existe para bots de OUTRAS pessoas — que
 * só admin enxerga. O colaborador, que só vê o dele, abria um bloco para
 * achar um único item.
 */
import { describe, expect, it } from "vitest";
import { organizarAgentes } from "./lista-de-agentes";

const iris = { id: "iris", donoId: null };
const meu = { id: "welton-bot", donoId: "u-welton" };
const outro = { id: "andre-bot", donoId: "u-andre" };

describe("organizarAgentes", () => {
  it("colaborador: o bot dele no topo, sem bloco", () => {
    const r = organizarAgentes([iris, meu], "u-welton");
    expect(r.meu?.id).toBe("welton-bot");
    expect(r.especialistas.map((a) => a.id)).toEqual(["iris"]);
    expect(r.outrosBots).toEqual([]);
  });
  it("admin: o dele no topo e os dos outros no bloco", () => {
    const r = organizarAgentes([iris, outro, meu], "u-welton");
    expect(r.meu?.id).toBe("welton-bot");
    expect(r.outrosBots.map((a) => a.id)).toEqual(["andre-bot"]);
  });
  it("quem não tem bot", () => {
    const r = organizarAgentes([iris, outro], "u-nicholson");
    expect(r.meu).toBeNull();
    expect(r.outrosBots.map((a) => a.id)).toEqual(["andre-bot"]);
  });
});
