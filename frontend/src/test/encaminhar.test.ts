/**
 * Encaminhar (spec 2026-11-27-encaminhar-mensagem-design).
 *
 * O handoff para o Guardi é de uso ÚNICO e por agente: o anexo copiado no
 * servidor viaja até o campo da conversa com ele. Consumir duas vezes poria o
 * mesmo anexo duas vezes no campo; consumir na conversa de OUTRO agente
 * entregaria a ele um arquivo copiado para o Guardi — que ele não consegue
 * ler (`ler_anexo` confere o agente) e que sumiria do Guardi.
 */
import { describe, expect, it } from "vitest";

import { acoesDaMensagemDoAgente, acoesDaMensagemDoCanal } from "@/lib/acoes-da-mensagem";
import { consumirParaOGuardi, guardarParaOGuardi, textoParaOGuardi } from "@/lib/encaminhar";

const UUID = "3f2b8c1e-1d2a-4c5b-9e8f-0a1b2c3d4e5f";
const ctxCanal = { souAutor: false, aoEditar: () => {}, aoApagar: () => {} };

describe("handoff para o Guardi", () => {
  it("consome uma vez só", () => {
    guardarParaOGuardi({ agentId: "ana-bot", texto: "oi", anexos: [] });
    expect(consumirParaOGuardi("ana-bot")?.texto).toBe("oi");
    expect(consumirParaOGuardi("ana-bot")).toBeNull();
  });

  it("outro agente não consome nem estraga o do Guardi", () => {
    guardarParaOGuardi({ agentId: "ana-bot", texto: "oi", anexos: [] });
    expect(consumirParaOGuardi("nina")).toBeNull();
    expect(consumirParaOGuardi("ana-bot")?.texto).toBe("oi");
  });

  it("o texto entra citado, com quem escreveu, sem apagar o rascunho", () => {
    expect(textoParaOGuardi("já tinha", "Bia", "linha 1\nlinha 2")).toBe(
      "já tinha\n\n> *Encaminhada de Bia:*\n> linha 1\n> linha 2\n\n",
    );
  });
});

describe("ação Encaminhar", () => {
  const rotulos = (a: { rotulo: string }[]) => a.map((x) => x.rotulo);

  it("aparece na mensagem de canal", () => {
    expect(rotulos(acoesDaMensagemDoCanal({ id: UUID, content: "oi", deleted_at: null }, ctxCanal))).toContain("Encaminhar");
  });

  it("não aparece na apagada nem na otimista", () => {
    expect(acoesDaMensagemDoCanal({ id: UUID, content: "oi", deleted_at: "2026-11-27" }, ctxCanal)).toEqual([]);
    expect(acoesDaMensagemDoCanal({ id: "optimistic-1", content: "oi", deleted_at: null }, ctxCanal)).toEqual([]);
  });

  it("aparece na resposta do agente gravada, não na que ainda não tem id do banco", () => {
    const base = { agentId: "nina", role: "agent" as const, content: "relatório", timestamp: "", channel: "" };
    expect(rotulos(acoesDaMensagemDoAgente({ ...base, id: UUID }))).toContain("Encaminhar");
    expect(rotulos(acoesDaMensagemDoAgente({ ...base, id: "recuperada-1" }))).not.toContain("Encaminhar");
  });
});
