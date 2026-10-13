/**
 * Áudio de canal guardado como anexo privado — 13/10/2026.
 *
 * Até aqui `audio_url` era uma URL pública do bucket `audio-messages`, que
 * qualquer um com o link ouvia sem login. Agora o áudio é anexo (`anexos`, regra
 * de membro do canal) e a mensagem guarda `anexo:<id>`; a URL para tocar é
 * pedida na hora, assinada por 5 minutos.
 */
import { describe, expect, it, vi } from "vitest";

import { enviarAudioDoCanal, idDoAnexoDeAudio, referenciaDeAudio } from "@/lib/audio-de-mensagem";

describe("áudio de mensagem", () => {
  it("referência e leitura fazem ida e volta", () => {
    const id = "6f1c2d3e-0000-4000-8000-000000000001";
    expect(idDoAnexoDeAudio(referenciaDeAudio(id))).toBe(id);
  });

  it("URL antiga não é anexo", () => {
    expect(idDoAnexoDeAudio("https://hsosapi.healthsafetytech.com/storage/audio-messages/c/a.webm")).toBeNull();
  });

  it("vazio e lixo não são anexo", () => {
    expect(idDoAnexoDeAudio(null)).toBeNull();
    expect(idDoAnexoDeAudio("anexo:")).toBeNull();
    expect(idDoAnexoDeAudio("anexo:../../etc")).toBeNull();
  });
});

describe("enviarAudioDoCanal", () => {
  it("sobe como anexo privado do canal e devolve a referência", async () => {
    const enviar = vi.fn(async () => ({ id: "6f1c2d3e-0000-4000-8000-000000000002", name: "audio.webm", size: 3, mimeType: "audio/webm", url: "" }));
    const blob = new Blob(["abc"], { type: "audio/webm;codecs=opus" });
    const ref = await enviarAudioDoCanal("canal-1", blob, enviar);
    expect(ref).toBe("anexo:6f1c2d3e-0000-4000-8000-000000000002");
    const [destino, arquivo] = enviar.mock.calls[0] as unknown as [unknown, File];
    expect(destino).toEqual({ contexto: "canal", channelId: "canal-1" });
    expect(arquivo.name).toBe("audio.webm");
    expect(arquivo.type).toBe("audio/webm;codecs=opus");
  });
});
