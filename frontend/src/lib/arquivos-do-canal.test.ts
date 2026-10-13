/**
 * Tranca o filtro do painel "Arquivos" do canal.
 *
 * ⚠️ Anexo novo (desde 13/10/2026) chega com `url: ""` e um `id`: a URL é
 * pedida ao backend na hora de exibir. O painel descartava todo item sem
 * `url`, e por isso os anexos novos sumiam dele EM SILÊNCIO — a lista mostrava
 * só os antigos, sem nada dizendo que faltava algo.
 */
import { describe, expect, it } from "vitest";
import { arquivosDoCanal } from "./arquivos-do-canal";

const linha = (attachments: unknown[]) => ({
  id: "m1",
  created_at: "2026-10-13T10:00:00Z",
  author_name: "Erick",
  attachments,
});

describe("arquivosDoCanal", () => {
  it("anexo novo, com id e url vazia, entra — e guarda o id", () => {
    const [it0] = arquivosDoCanal([linha([{ id: "a1", url: "", name: "x.csv", size: 3, mimeType: "text/csv" }])]);
    expect(it0).toMatchObject({ id: "a1", url: "", name: "x.csv", message_id: "m1", author_name: "Erick" });
  });

  it("anexo antigo, só com url, continua igual", () => {
    const [it0] = arquivosDoCanal([linha([{ url: "/storage/agent-files/a.png", name: "a.png", mimeType: "image/png" }])]);
    expect(it0.url).toBe("/storage/agent-files/a.png");
    expect(it0.id).toBeUndefined();
  });

  it("item sem id e sem url fica fora", () => {
    expect(arquivosDoCanal([linha([{ name: "fantasma" }, null, {}])])).toEqual([]);
  });

  it("linha sem attachments não quebra", () => {
    expect(arquivosDoCanal([{ id: "m2", created_at: "x" }])).toEqual([]);
    expect(arquivosDoCanal(null)).toEqual([]);
  });
});
