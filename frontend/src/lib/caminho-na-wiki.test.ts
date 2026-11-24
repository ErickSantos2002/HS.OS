/* PK-09 (24/11/2026): o nome do arquivo da wiki era <ms>-<6 de Math.random>,
   adivinhável num bucket público. Ver `caminhoNaWiki`. */
import { describe, expect, it } from "vitest";
import { caminhoNaWiki } from "@/lib/caminho-de-anexo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("caminhoNaWiki", () => {
  it("usuário/documento/<uuid>.<ext>", () => {
    const p = caminhoNaWiki("u1", "d1", "Relatório Final.PDF");
    const [usuario, documento, arquivo] = p.split("/");
    expect([usuario, documento]).toEqual(["u1", "d1"]);
    expect(arquivo.replace(/\.pdf$/, "")).toMatch(UUID);
  });
  it("sem documento vai para misc", () => {
    expect(caminhoNaWiki("u1", null, "a.png").split("/")[1]).toBe("misc");
  });
  it("não carrega carimbo de tempo nem o nome original", () => {
    const p = caminhoNaWiki("u1", "d1", "contrato-cliente.docx");
    expect(p).not.toMatch(/\d{13}/);
    expect(p).not.toContain("contrato");
  });
  it("dois envios do mesmo arquivo não colidem", () => {
    expect(caminhoNaWiki("u", "d", "a.png")).not.toBe(caminhoNaWiki("u", "d", "a.png"));
  });
});
