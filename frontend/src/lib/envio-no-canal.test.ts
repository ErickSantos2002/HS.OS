/**
 * Responder citando no celular põe `> **Autor:** trecho` na frente do texto.
 * Mandado inteiro para o aviso e para o agente, a citação repetia a menção
 * (o citado era notificado de novo) e acordava o agente citado outra vez.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const avisos = vi.hoisted(() => ({ notifyChannelRecipients: vi.fn(async (..._a: unknown[]) => undefined) }));
const agentes = vi.hoisted(() => ({ startChannelAgentReplies: vi.fn((..._a: unknown[]) => undefined) }));
vi.mock("@/lib/channel-notifications", () => avisos);
vi.mock("@/lib/channel-agents", () => agentes);

import { enviarGifNoCanal, publicarNaThread, publicarNoCanal, type ContextoDeEnvio } from "./envio-no-canal";
import { autorDaCitacao, montarResposta } from "@/lib/citacao";

const ctx = (): ContextoDeEnvio => ({
  canal: { id: "c1", type: "public" },
  user: { id: "u1", email: "erick@hs.com" },
  profile: { full_name: "Erick Santos", avatar_url: null },
  sendMessage: vi.fn(async () => undefined),
  agentMembers: ["nina"],
});

describe("publicar com citação", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava a citação, mas avisa e acorda o agente só com o texto novo", async () => {
    const c = ctx();
    const texto = montarResposta({ autor: "Rafael Lima", texto: "@nina resume a semana" }, "valeu!");
    await publicarNoCanal(c, texto, null, { textoNovo: "valeu!" });
    expect((c.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(texto);
    expect(avisos.notifyChannelRecipients.mock.calls[0][0]).toMatchObject({ contentText: "valeu!", contentPreview: "valeu!" });
    expect(agentes.startChannelAgentReplies.mock.calls[0][0]).toMatchObject({ messageText: "valeu!" });
  });

  it("sem citação continua como antes", async () => {
    await publicarNoCanal(ctx(), "@nina oi", null);
    expect(agentes.startChannelAgentReplies.mock.calls[0][0]).toMatchObject({ messageText: "@nina oi" });
  });

  it("na thread também", async () => {
    const c = ctx();
    await publicarNaThread(c, montarResposta({ autor: "Ana", texto: "@Erick Santos olha" }, "ok"), "m9", null, { textoNovo: "ok" });
    expect(avisos.notifyChannelRecipients.mock.calls[0][0]).toMatchObject({ contentText: "ok", threadRootId: "m9" });
  });
});

it("a citação grava o nome de verdade, nunca 'Você'", () => {
  expect(autorDaCitacao(true, "Erick Santos", "Erick Santos")).toBe("Erick Santos");
  expect(autorDaCitacao(false, "Erick Santos", "Rafael Lima")).toBe("Rafael Lima");
});

/**
 * O GIF saiu do `ChannelChat` (13/11/2026) para o celular usar o mesmo envio.
 * Sem o `forceNotifyAll` na DM o aviso seguia a regra de canal e a outra
 * pessoa não era avisada; sem o "🎬 GIF" o push saía vazio.
 */
describe("GIF", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava um anexo image/gif sem texto e avisa com 🎬 GIF, sem acordar agente", async () => {
    const c = ctx();
    await enviarGifNoCanal(c, { title: "gato dançando", url: "https://media.giphy.com/x.gif" });
    const args = (c.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args.slice(0, 7)).toEqual(["c1", "u1", "Erick Santos", "", "human", null, null]);
    expect(args[7]).toEqual([{ name: "gato dançando.gif", url: "https://media.giphy.com/x.gif", size: 0, mimeType: "image/gif" }]);
    expect(avisos.notifyChannelRecipients.mock.calls[0][0]).toMatchObject({
      channelId: "c1", senderUserId: "u1", authorName: "Erick Santos",
      contentPreview: "🎬 GIF", contentText: "🎬 GIF", forceNotifyAll: false,
    });
    expect(agentes.startChannelAgentReplies).not.toHaveBeenCalled();
  });

  it("na DM avisa a outra pessoa sempre; sem título vira gif.gif", async () => {
    const c = { ...ctx(), canal: { id: "d1", type: "dm" as const } };
    await enviarGifNoCanal(c, { title: "", url: "u" });
    expect((c.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][7][0].name).toBe("gif.gif");
    expect(avisos.notifyChannelRecipients.mock.calls[0][0]).toMatchObject({ forceNotifyAll: true });
  });
});
