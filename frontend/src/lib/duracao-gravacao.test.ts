/**
 * Áudio gravado já sai com a duração no arquivo — 13/10/2026.
 *
 * O webm do MediaRecorder do Chrome não declara a duração. O player herdado a
 * descobria pulando para o fim, e sem índice o pulo às vezes quebrava o
 * `<audio>` ("demuxer seek failed"): 0:00 na tela e áudio mudo para quem
 * recebia. Calcular a duração baixando o arquivo não dá — depois do
 * redirecionamento para o R2 a origem vira `null` e o CORS bloqueia. O jeito é
 * o arquivo nascer certo: quem grava sabe quanto tempo gravou.
 */
import { describe, expect, it, vi } from "vitest";

import { comDuracao } from "@/lib/duracao-gravacao";

describe("comDuracao", () => {
  it("webm ganha a duração gravada", async () => {
    const original = new Blob(["a"], { type: "audio/webm;codecs=opus" });
    const corrigido = new Blob(["ab"], { type: "audio/webm" });
    const corrigir = vi.fn(async () => corrigido);
    expect(await comDuracao(original, 8279, corrigir)).toBe(corrigido);
    expect(corrigir).toHaveBeenCalledWith(original, 8279, { logger: false });
  });

  it("formato que já declara duração (mp4 do Safari) passa intacto", async () => {
    const original = new Blob(["a"], { type: "audio/mp4" });
    const corrigir = vi.fn();
    expect(await comDuracao(original, 5000, corrigir)).toBe(original);
    expect(corrigir).not.toHaveBeenCalled();
  });

  it("falha ao corrigir devolve o original — melhor sem duração que sem áudio", async () => {
    const original = new Blob(["a"], { type: "audio/webm" });
    const corrigir = vi.fn(async () => { throw new Error("ebml"); });
    expect(await comDuracao(original, 5000, corrigir)).toBe(original);
  });

  it("duração inválida não chama a correção", async () => {
    const original = new Blob(["a"], { type: "audio/webm" });
    const corrigir = vi.fn();
    expect(await comDuracao(original, 0, corrigir)).toBe(original);
    expect(corrigir).not.toHaveBeenCalled();
  });
});
