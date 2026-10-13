/**
 * No chat com agente, gravar e enviar direto — 13/10/2026.
 *
 * A sobreposição só tinha "transcrever para texto": o áudio virava rascunho na
 * caixa e a pessoa ainda precisava apertar enviar. O `handleAudioSendAsVoice`
 * do ChatPage existia, mas nada o chamava — e, se chamasse, gravava a bolha sem
 * mandar nada ao agente.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/ai-loader", () => ({ AiLoader: () => null }));

import AudioRecordingOverlay from "@/components/chat/AudioRecordingOverlay";

const base = { bars: [], duration: 3, isProcessing: false, onCancel: () => {}, onTranscribe: () => {} };

describe("AudioRecordingOverlay", () => {
  it("com onSend, oferece enviar direto além de transcrever", () => {
    const onSend = vi.fn();
    render(<AudioRecordingOverlay {...base} onSend={onSend} />);
    fireEvent.click(screen.getByTitle("Enviar ao agente"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Transcrever para texto")).toBeInTheDocument();
  });

  it("sem onSend (canal), não mostra o botão", () => {
    render(<AudioRecordingOverlay {...base} />);
    expect(screen.queryByTitle("Enviar ao agente")).toBeNull();
  });

  it("processando, o enviar fica desabilitado — não manda duas vezes", () => {
    render(<AudioRecordingOverlay {...base} isProcessing onSend={() => {}} />);
    expect(screen.getByTitle("Enviar ao agente")).toBeDisabled();
  });
});
