/**
 * A regra da janela de lembrete (spec 2026-11-13, "Camada 2").
 *
 * A janela só abre e só toca para aviso NOVO: sem isso, cada evento do tempo
 * real (a resposta do Guardi chega em várias linhas) tocaria o som de novo.
 * E o re-aviso é aviso novo — senão "de novo" chegaria mudo.
 */
import { describe, expect, it } from "vitest";

import { chaveDoAviso, compararAvisos, deveTocar, mudaAJanela } from "./janela-de-lembrete";

const a1 = { id: "l-1", aviso_em: "2026-11-13T14:00:27.1-03:00" };
const a1DeNovo = { id: "l-1", aviso_em: "2026-11-13T14:05:30.2-03:00" };
const a2 = { id: "l-2", aviso_em: "2026-11-13T14:01:00-03:00" };

describe("janela de lembrete", () => {
  it("aviso nunca visto é novo; o mesmo aviso, não", () => {
    const vistos = new Set<string>();
    expect(compararAvisos(vistos, [], [a1]).novos).toEqual([a1]);
    vistos.add(chaveDoAviso(a1));
    expect(compararAvisos(vistos, [a1], [a1]).novos).toEqual([]);
  });

  it("o re-aviso do mesmo lembrete é aviso novo", () => {
    const vistos = new Set([chaveDoAviso(a1)]);
    expect(compararAvisos(vistos, [a1], [a1DeNovo]).novos).toEqual([a1DeNovo]);
    expect(compararAvisos(vistos, [a1], [a1DeNovo]).sumiram).toEqual([]);
  });

  it("lembrete respondido noutro lugar sai da lista e fecha a notificação daqui", () => {
    const vistos = new Set([chaveDoAviso(a1), chaveDoAviso(a2)]);
    expect(compararAvisos(vistos, [a1, a2], [a2])).toEqual({ novos: [], sumiram: ["l-1"] });
  });

  it("só conversations e lembretes mexem na janela", () => {
    expect(mudaAJanela({ tabela: "conversations" })).toBe(true);
    expect(mudaAJanela({ tabela: "lembretes" })).toBe(true);
    expect(mudaAJanela({ tabela: "channel_messages" })).toBe(false);
    expect(mudaAJanela(null)).toBe(false);
  });

  it("som só para aviso novo com a aba à vista (oculta, quem avisa é o push)", () => {
    expect(deveTocar(1, true)).toBe(true);
    expect(deveTocar(1, false)).toBe(false);
    expect(deveTocar(0, true)).toBe(false);
  });
});
