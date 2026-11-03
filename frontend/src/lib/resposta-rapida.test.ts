import { describe, expect, it } from "vitest";
import { clienteDaResposta, corpoDaRespostaRapida } from "./resposta-rapida";

// Resposta rápida pela notificação: com o PWA e uma aba abertos ela saía
// duas vezes; respondendo a uma thread, caía na raiz do canal.

describe("clienteDaResposta", () => {
  it("manda para uma aba só — a focada", () => {
    const abas = [{ id: "a", focused: false }, { id: "b", focused: true }];
    expect(clienteDaResposta(abas)?.id).toBe("b");
  });

  it("sem aba focada, a primeira; sem aba, ninguém", () => {
    expect(clienteDaResposta([{ id: "a", focused: false }, { id: "b", focused: false }])?.id).toBe("a");
    expect(clienteDaResposta([])).toBeNull();
  });
});

describe("corpoDaRespostaRapida", () => {
  const autor = { nome: "Ana", avatar: null };

  it("resposta a thread leva o thread_id", () => {
    expect(corpoDaRespostaRapida({ channelId: "c1", threadId: "t9", text: "ok" }, autor))
      .toMatchObject({ content: "ok", thread_id: "t9", author_name: "Ana" });
  });

  it("resposta ao canal não leva thread_id", () => {
    expect(corpoDaRespostaRapida({ channelId: "c1", text: "ok" }, autor)).not.toHaveProperty("thread_id");
  });
});
