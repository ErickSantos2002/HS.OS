import { describe, expect, it } from "vitest";
import {
  clienteDaResposta, consumirResposta, corpoDaRespostaRapida, guardarResposta, VALIDADE_RESPOSTA_MS,
  type RegistroDeResposta,
} from "./resposta-rapida";

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

describe("resposta rápida com o app fechado (id no Cache Storage)", () => {
  const ID = "0b9f6c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e";
  const AGORA = 1_000_000_000;
  function cacheFalso() {
    const m = new Map<string, string>();
    return {
      m,
      async put(k: string, r: Response) { m.set(k, await r.text()); },
      async match(k: string) { const v = m.get(k); return v === undefined ? undefined : new Response(v); },
      async delete(k: string) { return m.delete(k); },
    };
  }
  const guardado = async (extra: Partial<RegistroDeResposta> = {}) => {
    const c = cacheFalso();
    await guardarResposta(c, ID, { texto: "Valeu!", channel_id: "c1", thread_id: null, criado_em: AGORA, ...extra });
    return c;
  };

  it("id válido envia uma única vez", async () => {
    const c = await guardado();
    expect(await consumirResposta(c, ID, { canal: "c1", thread: null }, AGORA + 1000)).toBe("Valeu!");
    expect(await consumirResposta(c, ID, { canal: "c1", thread: null }, AGORA + 2000)).toBeNull();
  });
  it("id de outro canal ou de outra thread não envia", async () => {
    const c = await guardado();
    expect(await consumirResposta(c, ID, { canal: "c2", thread: null }, AGORA)).toBeNull();
    expect(await consumirResposta(c, ID, { canal: "c1", thread: "m9" }, AGORA)).toBeNull();
    const t = await guardado({ thread_id: "m9" });
    expect(await consumirResposta(t, ID, { canal: "c1", thread: null }, AGORA)).toBeNull();
    expect(await consumirResposta(t, ID, { canal: "c1", thread: "m9" }, AGORA)).toBe("Valeu!");
  });
  it("vencido (mais de 5 min) não envia e some", async () => {
    const c = await guardado();
    expect(await consumirResposta(c, ID, { canal: "c1", thread: null }, AGORA + VALIDADE_RESPOSTA_MS + 1)).toBeNull();
    expect(c.m.size).toBe(0);
  });
  it("id desconhecido ou malformado não envia", async () => {
    const c = await guardado();
    expect(await consumirResposta(c, "1d2a4b3c-0000-4000-8000-000000000000", { canal: "c1", thread: null }, AGORA)).toBeNull();
    expect(await consumirResposta(c, "../../x", { canal: "c1", thread: null }, AGORA)).toBeNull();
  });
});
