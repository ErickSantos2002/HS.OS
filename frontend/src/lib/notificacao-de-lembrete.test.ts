/**
 * Notificação de lembrete no SW (spec 2026-11-13, "Camada 1").
 *
 * Em 13/11/2026 a Sandra não viu o lembrete das 14:00: a notificação apareceu
 * e sumiu, como a de qualquer mensagem. O que se tranca aqui é o que faz o
 * lembrete ficar: `requireInteraction`, as ações "Adiar 10 min"/"Feito" e o
 * lembrete não ser calado para quem está com a conversa aberta.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ACAO_ADIAR,
  ACAO_FEITO,
  ehLembrete,
  enviarAcaoDoLembrete,
  notificacaoDoLembrete,
  respeitaQuemOlha,
  tokenDaAcao,
  type PayloadDeLembrete,
} from "./notificacao-de-lembrete";

const payload: PayloadDeLembrete = {
  tipo: "lembrete",
  lembrete_id: "l-1",
  aviso_em: "2026-11-13T17:00:27.123456+00:00",
  title: "⏰ Retornar contato para Hildon",
  body: "Ligar e confirmar a proposta.",
  url: "/agenda",
  tag: "lembrete:l-1",
  acoes: { adiar: "tok-adiar", feito: "tok-feito" },
};

describe("notificação de lembrete", () => {
  it("lembrete toca mesmo com a conversa aberta; mensagem comum não", () => {
    // Quem olha a conversa também recebe a janela do app — e a notificação
    // persistente é o que sobra se a aba sumir da frente.
    expect(respeitaQuemOlha(payload)).toBe(false);
    expect(respeitaQuemOlha({ title: "Nina", conversa: "agente:nina" })).toBe(true);
    expect(ehLembrete({ tipo: "lembrete" })).toBe(false);
  });

  it("fica na tela, re-toca com a mesma tag e traz Adiar e Feito", () => {
    const { titulo, opcoes } = notificacaoDoLembrete(payload);
    expect(titulo).toBe("⏰ Retornar contato para Hildon");
    expect(opcoes.requireInteraction).toBe(true);
    expect(opcoes.renotify).toBe(true);
    expect(opcoes.tag).toBe("lembrete:l-1");
    expect(opcoes.actions).toEqual([
      { action: ACAO_ADIAR, title: "Adiar 10 min" },
      { action: ACAO_FEITO, title: "Feito" },
    ]);
  });

  it("sem tokens (segredo ausente no backend) não mostra botões que falhariam", () => {
    const { opcoes } = notificacaoDoLembrete({ ...payload, acoes: undefined });
    expect(opcoes.actions).toEqual([]);
    expect(opcoes.requireInteraction).toBe(true);
  });

  it("cada botão manda o token DELE, e só em notificação de lembrete", () => {
    const { opcoes } = notificacaoDoLembrete(payload);
    expect(tokenDaAcao(ACAO_ADIAR, opcoes.data)).toBe("tok-adiar");
    expect(tokenDaAcao(ACAO_FEITO, opcoes.data)).toBe("tok-feito");
    expect(tokenDaAcao("", opcoes.data)).toBeNull(); // clique no corpo
    expect(tokenDaAcao(ACAO_FEITO, { acoes: { feito: "x" } })).toBeNull();
    expect(tokenDaAcao("reply", opcoes.data)).toBeNull();
  });

  it("a ação vai à rota pública só com o token", async () => {
    const buscar = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await enviarAcaoDoLembrete("tok-feito", "/api", buscar as unknown as typeof fetch)).toBe(true);
    expect(buscar).toHaveBeenCalledWith("/api/agenda/lembretes/acao", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: "tok-feito" }),
    }));
    const falha = vi.fn(async () => {
      throw new Error("rede");
    });
    expect(await enviarAcaoDoLembrete("t", "/api", falha as unknown as typeof fetch)).toBe(false);
    const recusa = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(await enviarAcaoDoLembrete("t", "/api", recusa as unknown as typeof fetch)).toBe(false);
  });
});
