/**
 * O `expr` do gateway é UTC e não tem campo de fuso: `30 10 * * 1-5` é 07h30
 * de Brasília. As duas telas que descreviam cron — `CronTab` e
 * `AgentDetailPanel` — cuspiam a hora crua, "Dias úteis às 10:30", e o
 * `CronTab` ainda mostra o `expr` colado ao lado. Quem lê às 10h30 e vê o
 * briefing chegando às 07h30 conclui que a tela está quebrada.
 */
import { describe, it, expect } from "vitest";
import { descreverCron } from "./descrever-cron";

describe("descreverCron", () => {
  it("converte a hora do briefing para Brasília", () => {
    expect(descreverCron("30 10 * * 1-5")).toBe("Dias úteis às 07h30 (Brasília)");
  });

  it("diz de quem é o fuso, porque o expr cru aparece ao lado", () => {
    expect(descreverCron("0 12 * * *")).toBe("Diariamente às 09h00 (Brasília)");
  });

  it("volta um dia quando a conversão cruza a meia-noite", () => {
    // 02h30 UTC de segunda a sexta é 23h30 de DOMINGO a quinta em Brasília.
    // Continuar dizendo "dias úteis" aqui seria trocar um erro de hora por um
    // erro de dia — pior, porque some da vista.
    expect(descreverCron("30 2 * * 1-5")).toBe("Dom, Seg, Ter, Qua, Qui às 23h30 (Brasília)");
  });

  it("volta um dia também no dia único", () => {
    expect(descreverCron("0 1 * * 1")).toBe("Dom às 22h00 (Brasília)");
  });

  it("lista de dias sem virada fica como está", () => {
    expect(descreverCron("0 10 * * 1,3")).toBe("Seg, Qua às 07h00 (Brasília)");
  });

  it("a cada N minutos não tem hora para converter", () => {
    expect(descreverCron("*/15 * * * *")).toBe("A cada 15 minutos");
  });

  it("a cada hora preserva o minuto, que o fuso não mexe", () => {
    expect(descreverCron("30 * * * *")).toBe("A cada hora, no minuto 30");
  });

  it("dia do mês volta cru, em vez de arriscar um palpite", () => {
    // Converter a hora aqui pode mudar o dia do mês, e às vezes o mês. Dizer
    // o expr é honesto; inventar "todo dia 1º às 07h00" não é.
    expect(descreverCron("0 10 1 * *")).toBe("0 10 1 * *");
  });

  it("hora que não é número volta crua", () => {
    expect(descreverCron("0 8,20 * * *")).toBe("0 8,20 * * *");
  });

  it("expr incompleto volta cru", () => {
    expect(descreverCron("30 10")).toBe("30 10");
  });

  it("vazio não quebra a tela", () => {
    expect(descreverCron(null)).toBe("");
  });
});
