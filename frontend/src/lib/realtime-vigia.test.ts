/**
 * ⚠️ **A conexão tem TRÊS estados, e o cliente só conhecia dois.** Aberta,
 * fechada — e *aberta e morta*: o TCP some no meio (wifi trocando, NAT ou
 * proxy matando o fluxo sem FIN) e o navegador não percebe. `readyState`
 * continua `OPEN`, o `onclose` nunca dispara, o backoff de reconexão nunca
 * roda, e a aba fica surda **para sempre** — até alguém recarregar.
 *
 * O servidor já contava com isto: `_INTERVALO_PING = 25` em
 * `backend/app/routers/ws.py`, com o comentário dizendo que "o cliente usa o
 * silêncio prolongado como sinal de queda". O cliente não usava. Era mecanismo
 * documentado de um lado e ausente do outro.
 *
 * Sintoma medido em 02/09/2026 (`docs/CONFERENCIA-CHAT-PESSOAS.md`): de seis
 * entregas, uma levou 11,6s e uma não chegou em 25s — e apareceu ao recarregar.
 * Nada se perdeu no banco.
 *
 * ⚠️ Isto **não prova** que aquelas duas medições foram este defeito; prova que
 * este defeito existe e produz exatamente esse sintoma. A causa daquelas duas
 * continua sem medição.
 */
import { describe, it, expect } from "vitest";
import { silencioDemais, INTERVALO_PING_SERVIDOR } from "./realtime-vigia";

describe("silencioDemais", () => {
  it("um ping perdido não é queda — a rede engasga", () => {
    // O servidor pinga a cada 25s. Derrubar no primeiro atraso trocaria uma
    // aba surda por uma aba que se reconecta o tempo todo.
    expect(silencioDemais(INTERVALO_PING_SERVIDOR + 2_000)).toBe(false);
  });

  it("dois pings perdidos e mais uma folga é queda", () => {
    expect(silencioDemais(INTERVALO_PING_SERVIDOR * 3)).toBe(true);
  });

  it("acabou de chegar frame não é queda", () => {
    expect(silencioDemais(0)).toBe(false);
  });

  it("o limiar é maior que dois pings, não igual", () => {
    // Igual a dois pings pega o caso em que o segundo ping está a caminho.
    expect(silencioDemais(INTERVALO_PING_SERVIDOR * 2)).toBe(false);
  });
});
