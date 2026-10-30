import { describe, expect, it } from "vitest";
import { contarConversas, horaMinuto, normalizar } from "./warroom-feed";

describe("normalizar — a TV nunca cai por forma de resposta", () => {
  it("payload vazio vira feed vazio desenhável", () => {
    const f = normalizar(null);
    expect(f.pessoas).toEqual([]);
    expect(f.setores).toEqual([]);
    expect(f.conversasTime).toEqual([]);
    expect(f.numeros).toEqual({ entregas: 0, atendidas: 0, pessoasAtivas: 0, conversasTime: 0 });
  });

  it("backend antigo (sem setores, com tarefa) não derruba e não mostra tarefa", () => {
    // Deploy não atômico: o front novo pode falar com o back velho por minutos.
    const f = normalizar({
      pessoas: [{ id: "p1", nome: "Erick Santos" }],
      agentes: [{ id: "nina", nome: "Nina", estado: "pensando", tarefa: "segredo", parceiro: "Erick" }],
      numeros: { entregas: 2, conversas: 9, tokens: 1, custo: 1 },
    });
    expect(f.setores).toEqual([{ nome: "Time", pessoas: ["p1"] }]);
    expect(f.pessoas[0]).toMatchObject({ id: "p1", setor: "Time", online: false, status: null });
    expect(JSON.stringify(f)).not.toContain("segredo");
    expect(f.agentes[0].parceiroId).toBeNull();
    expect(f.numeros.entregas).toBe(2);
  });

  it("status desconhecido vira null, nunca texto", () => {
    const f = normalizar({ pessoas: [{ id: "p", nome: "X", setor: "TI", status: "doente" }] });
    expect(f.pessoas[0].status).toBeNull();
  });

  it("conversa entre pessoas sem as duas pontas é descartada", () => {
    const f = normalizar({ conversasTime: [{ a: "p1", b: "" }, { a: "p1", b: "p2", ultima: "x" }] });
    expect(f.conversasTime).toEqual([{ a: "p1", b: "p2", ultima: "x" }]);
  });

  // Herdados do teste de 01/09/2026 (tela branca por campo ausente), no contrato novo.
  it("sobrevive a uma resposta completamente vazia", () => {
    const f = normalizar({});
    expect(f.agentes).toEqual([]);
    expect(f.eventos).toEqual([]);
  });

  it("estado desconhecido vira ocioso, que é o desenho neutro", () => {
    expect(normalizar({ agentes: [{ id: "x" }] }).agentes[0].estado).toBe("ocioso");
  });

  it("preserva contexto nulo em vez de virar zero", () => {
    const f = normalizar({ agentes: [{ id: "x", contexto: null }] });
    expect(f.agentes[0].contexto).toBeNull();
  });

  it("descarta agente sem id, que não teria onde ser desenhado", () => {
    expect(normalizar({ agentes: [{ nome: "sem id" }, { id: "ok" }] }).agentes).toHaveLength(1);
  });
});

describe("horaMinuto — o Fluxo não escreve \"Invalid Date\" na parede", () => {
  it("hora válida sai HH:MM", () => {
    expect(horaMinuto("2026-10-16T13:05:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("ts vazio ou lixo vira travessão", () => {
    // O `normalizar` transforma ts ausente em "", e `new Date("")` é Invalid
    // Date — que o `toLocaleTimeString` escreve por extenso na TV.
    expect(horaMinuto("")).toBe("—");
    expect(horaMinuto("ontem")).toBe("—");
  });
});

describe("contarConversas — o \"N conversas agora\" do cabeçalho", () => {
  it("agente trabalhando sozinho não é conversa", () => {
    // Um cron rodando de madrugada acendia "1 conversa agora" numa sala vazia.
    const f = normalizar({
      pessoas: [{ id: "p1", nome: "A" }, { id: "p2", nome: "B" }, { id: "p3", nome: "C" }],
      agentes: [
        { id: "nina", estado: "pensando", parceiroId: "p1" },
        { id: "bruce", estado: "pensando" },
        { id: "iris", estado: "ocioso", parceiroId: "p2" },
      ],
      conversasTime: [{ a: "p2", b: "p3" }],
    });
    expect(contarConversas(f)).toBe(2);
  });

  it("agente que respondeu há pouco conta, como a conversa entre pessoas", () => {
    const f = normalizar({
      pessoas: [{ id: "p1", nome: "A" }],
      agentes: [
        { id: "nina", estado: "ocioso", recenteCom: "p1" },
        { id: "iris", estado: "ocioso", recenteCom: "fantasma" },
      ],
    });
    expect(f.agentes[0].recenteCom).toBe("p1");
    expect(f.agentes[1].recenteCom).toBeNull();
    expect(contarConversas(f)).toBe(1);
  });
});
