import { beforeEach, describe, expect, it } from "vitest";
import { definirMeuNome, definirSilenciados, deveCalar, estaSilenciado } from "./canais-silenciados";

// Silenciar corta som, notificação local e toast do canal — e só isso
// (esclarecimento 5 da spec 2026-11-03). Menção a mim e @todos furam, como no
// push: silenciar não pode virar jeito de não ser encontrado.

describe("canais silenciados", () => {
  beforeEach(() => {
    definirSilenciados(["c1"]);
    definirMeuNome("José Silva");
  });

  it("cala o canal silenciado", () => {
    expect(estaSilenciado("c1")).toBe(true);
    expect(deveCalar("c1", "bom dia")).toBe(true);
  });

  it("não cala canal que não foi silenciado nem notificação sem canal", () => {
    expect(deveCalar("c2", "bom dia")).toBe(false);
    expect(deveCalar(null, "bom dia")).toBe(false);
  });

  it("@todos e menção a mim furam o silenciar", () => {
    expect(deveCalar("c1", "@todos reunião")).toBe(false);
    expect(deveCalar("c1", "@jose silva olha isso")).toBe(false);
    expect(deveCalar("c1", "@José Silvana olha isso")).toBe(true);
  });
});
