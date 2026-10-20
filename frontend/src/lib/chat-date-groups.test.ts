import { describe, expect, it } from "vitest";
import { continuaSequencia } from "./chat-date-groups";

/**
 * O que estes testes protegem: **cada mensagem com foto e nome próprios fazia
 * a conversa subir rápido demais.** Cinco linhas curtas da mesma pessoa, no
 * mesmo minuto, ocupavam a tela inteira (pedido do Erick, 20/10/2026). A
 * sequência junta as mensagens; o que não pode é juntar demais — autor
 * diferente, outro dia ou uma pausa longa precisam voltar a mostrar quem fala.
 */

const msg = (author_id: string, created_at: string) => ({ author_id, created_at });

describe("continuaSequencia", () => {
  it("junta mensagens seguidas do mesmo autor", () => {
    expect(continuaSequencia(msg("lara", "2026-10-20T12:12:30"), msg("lara", "2026-10-20T12:12:00"))).toBe(true);
  });

  it("a primeira da conversa sempre abre sequência", () => {
    expect(continuaSequencia(msg("lara", "2026-10-20T12:12:00"), undefined)).toBe(false);
  });

  it("autor diferente abre sequência nova", () => {
    expect(continuaSequencia(msg("erick", "2026-10-20T12:12:30"), msg("lara", "2026-10-20T12:12:00"))).toBe(false);
  });

  it("pausa de mais de cinco minutos abre sequência nova", () => {
    expect(continuaSequencia(msg("lara", "2026-10-20T12:12:00"), msg("lara", "2026-10-20T11:59:00"))).toBe(false);
  });

  it("virada de dia abre sequência nova, mesmo com um minuto de diferença", () => {
    expect(continuaSequencia(msg("lara", "2026-10-21T00:00:30"), msg("lara", "2026-10-20T23:59:50"))).toBe(false);
  });
});
