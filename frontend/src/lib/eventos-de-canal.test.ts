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
import { aplicarEventoDeCanal, mudancaPedeRecarga, threadDepoisDeApagar } from "./eventos-de-canal";
import type { ChannelMessage } from "@/hooks/use-channels";

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


// ── Apagar a raiz fecha a thread — 13/10/2026 ───────────────────────────────
//
// A coordenadora de RH apagou um 👍 com o painel da thread dele aberto e
// escreveu ali "tentei excluir e não foi." — achando que era a conversa. A
// mensagem virou resposta de uma raiz apagada e sumiu para o outro lado.

describe("threadDepoisDeApagar", () => {
  const aberta = { id: "m1" } as ChannelMessage;

  it("apagar a mensagem cuja thread está aberta fecha o painel", () => {
    expect(threadDepoisDeApagar(aberta, "m1")).toBeNull();
  });

  it("apagar outra mensagem não mexe no painel", () => {
    expect(threadDepoisDeApagar(aberta, "m2")).toBe(aberta);
    expect(threadDepoisDeApagar(null, "m1")).toBeNull();
  });
});


// ── Edição parcial de mensagem que a tela ainda não tem — 13/10/2026 ────────
//
// O resumo em áudio publica `mensagem-editada` só com `{id, audio_url}`. Se a
// mensagem ainda não chegou à lista (a pessoa abriu o canal no meio), inserir
// esse pedaço criava uma mensagem sem `content` e a bolha quebrava a tela.

describe("mensagem-editada parcial", () => {
  const existente = {
    id: "m1", channel_id: "c1", author_id: "nina", author_type: "agent", author_name: "Nina",
    content: "Resposta.", thread_id: null, created_at: "2026-10-13T17:00:00Z", deleted_at: null,
  } as unknown as ChannelMessage;

  it("mescla na mensagem que já está na tela, sem apagar o resto", () => {
    const [m] = aplicarEventoDeCanal([existente], "mensagem-editada", { id: "m1", audio_url: "anexo:x" });
    expect(m.content).toBe("Resposta.");
    expect(m.audio_url).toBe("anexo:x");
  });

  it("ignora quando a mensagem ainda não está na tela", () => {
    const prev = [existente];
    expect(aplicarEventoDeCanal(prev, "mensagem-editada", { id: "m9", audio_url: "anexo:x" })).toBe(prev);
  });
});

describe("mudancaPedeRecarga (vistos, 14/10/2026)", () => {
  // ⚠️ Com 2 workers, o `"mensagem"` só sai pelo worker que atendeu o POST.
  // No outro, a mensagem nova chegava só como `"mudanca"` (do banco) e era
  // ignorada até a enquete de 60s — enquanto o visto, que vem do banco, já
  // dizia ✓✓ "entregue" para quem mandou.
  it("INSERT de mensagem que a tela não tem pede recarga", () => {
    expect(mudancaPedeRecarga([msg("m1")], "mudanca", { tabela: "channel_messages", op: "INSERT", id: "m2" })).toBe(true);
  });
  it("mensagem que a tela já tem não pede", () => {
    expect(mudancaPedeRecarga([msg("m1")], "mudanca", { tabela: "channel_messages", op: "INSERT", id: "m1" })).toBe(false);
  });
  it("outras tabelas, outras operações e outros tipos não pedem", () => {
    expect(mudancaPedeRecarga([], "mudanca", { tabela: "recibos_mensagem", op: "UPDATE", id: null })).toBe(false);
    expect(mudancaPedeRecarga([], "mudanca", { tabela: "channel_messages", op: "UPDATE", id: "m2" })).toBe(false);
    expect(mudancaPedeRecarga([], "mensagem", msg("m2"))).toBe(false);
  });
});
