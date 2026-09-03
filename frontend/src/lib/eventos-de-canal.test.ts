/**
 * ⚠️ **Editar e apagar mensagem não usavam o tempo real.**
 *
 * O backend publica quatro tipos no tópico do canal (`app/routers/channels.py`):
 * `mensagem` (duas vezes), `mensagem-editada` e `mensagem-removida`. O front
 * tinha **um** assinante, e ele começava com `if (tipo !== "mensagem") return`.
 * Os outros dois eventos chegavam e eram descartados em silêncio.
 *
 * O que salvava era a rede de segurança de 60s do próprio hook — um `load()` no
 * intervalo, escrito como "plano B". Medido na pilha local em 03/09/2026: uma
 * edição feita pela API levou **10,6 s** para aparecer (o intervalo pegando no
 * meio do ciclo), e o apagar levou mais de dez minutos para a aba de quem
 * apagou — que é o pior caso possível, porque a pessoa clica em "Apagar", nada
 * acontece na tela, e o reflexo é clicar de novo.
 *
 * Mensagem nova chega em ~40 ms. Não é o transporte que é lento; são dois
 * eventos que ninguém escutava.
 */
import { describe, it, expect } from "vitest";
import { aplicarEventoDeCanal } from "./eventos-de-canal";

const msg = (id: string, extra: Record<string, unknown> = {}) => ({
  id, channel_id: "c1", author_id: "a1", content: "oi", message_type: "text",
  thread_id: null, created_at: "2026-09-03T12:00:00Z", audio_url: null,
  edited_at: null, deleted_at: null, attachments: null, ...extra,
} as never);

describe("aplicarEventoDeCanal", () => {
  it("mensagem nova entra na lista", () => {
    const fim = aplicarEventoDeCanal([msg("m1")], "mensagem", msg("m2"));
    expect(fim.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("mensagem editada troca o conteúdo da que já está na tela", () => {
    const fim = aplicarEventoDeCanal(
      [msg("m1", { content: "texto velho" })],
      "mensagem-editada",
      msg("m1", { content: "texto novo", edited_at: "2026-09-03T12:05:00Z" }),
    );
    expect(fim).toHaveLength(1);
    expect(fim[0].content).toBe("texto novo");
    expect(fim[0].edited_at).not.toBeNull();
  });

  it("mensagem removida vira apagada, e não some da lista", () => {
    // Sumir abriria buraco no meio da conversa. O que a tela mostra para uma
    // mensagem com `deleted_at` é "Mensagem apagada" — igual ao que aparece
    // depois de recarregar, que é a referência do que está certo.
    const fim = aplicarEventoDeCanal([msg("m1")], "mensagem-removida", { id: "m1" });
    expect(fim).toHaveLength(1);
    expect(fim[0].deleted_at).not.toBeNull();
  });

  it("remoção de mensagem que não está na lista não inventa linha", () => {
    const fim = aplicarEventoDeCanal([msg("m1")], "mensagem-removida", { id: "outra" });
    expect(fim.map((m) => m.id)).toEqual(["m1"]);
  });

  it("tipo desconhecido não mexe em nada", () => {
    const antes = [msg("m1")];
    expect(aplicarEventoDeCanal(antes, "mudanca", { tabela: "channel_messages" })).toBe(antes);
  });

  it("resposta de thread é ignorada — o painel dela é outro", () => {
    const antes = [msg("m1")];
    expect(aplicarEventoDeCanal(antes, "mensagem", msg("m2", { thread_id: "m1" }))).toBe(antes);
  });

  it("edição dentro de thread também é ignorada aqui", () => {
    const antes = [msg("m1")];
    expect(aplicarEventoDeCanal(antes, "mensagem-editada", msg("m9", { thread_id: "m1" }))).toBe(antes);
  });
});
