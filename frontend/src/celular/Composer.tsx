/**
 * O composer do app do celular — spec 2026-11-03, item 3.
 *
 * Pílula com emoji, campo que cresce até ~6 linhas (132px) e clipe; ao lado,
 * um botão redondo: microfone com o campo vazio, enviar com texto. Segurar o
 * microfone grava, deslizar para a esquerda cancela, soltar envia. Quem grava
 * é o `useAudioRecorder` de sempre; o que fazer com o áudio é de quem usa o
 * composer (canal guarda e transcreve, agente só transcreve).
 *
 * Enter quebra linha, como no WhatsApp: no celular quem envia é o botão.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Mic, Paperclip, SendHorizontal, Smile, Square, X } from "lucide-react";
import { toast } from "sonner";

import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import type { MediaAttachment } from "@/lib/mock-data";
import { gravacaoCancelada } from "./gestos";

const ALTURA_MAX = 132;
const TOQUE_CURTO_MS = 600;

export interface PropsDoComposer {
  placeholder: string;
  valor: string;
  aoMudar: (v: string) => void;
  aoEnviar: () => void;
  /** Sem isto o botão fica sempre como "enviar" (sem microfone). */
  aoGravar?: (audio: Blob) => Promise<void> | void;
  aoAbrirAnexo?: () => void;
  aoAbrirEmoji?: () => void;
  anexos?: MediaAttachment[];
  aoRemoverAnexo?: (i: number) => void;
  resposta?: { autor: string; texto: string } | null;
  aoCancelarResposta?: () => void;
  ocupado?: boolean;
  /** Agente trabalhando e campo vazio: o botão vira "parar". */
  aoParar?: (() => void) | null;
  campoRef?: React.RefObject<HTMLTextAreaElement>;
}

function tempo(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function Composer({
  placeholder, valor, aoMudar, aoEnviar, aoGravar, aoAbrirAnexo, aoAbrirEmoji, anexos = [], aoRemoverAnexo,
  resposta, aoCancelarResposta, ocupado, aoParar, campoRef,
}: PropsDoComposer) {
  const proprio = useRef<HTMLTextAreaElement>(null);
  const ref = campoRef ?? proprio;
  const recorder = useAudioRecorder();
  const gravacao = useRef({ x0: 0, inicio: 0, ativa: false, cancelada: false, soltou: false, iniciou: false });
  const [gravando, setGravando] = useState(false);
  const temConteudo = valor.trim().length > 0 || anexos.length > 0;
  const modo: "enviar" | "parar" | "gravar" = temConteudo || !aoGravar ? (temConteudo || !aoParar ? "enviar" : "parar") : aoParar ? "parar" : "gravar";

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, ALTURA_MAX)}px`;
  }, [valor, ref]);

  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  useEffect(() => () => { if (gravacao.current.ativa) recorderRef.current.cancel(); }, []);

  const terminar = async () => {
    const g = gravacao.current;
    if (!g.ativa) return;
    g.ativa = false;
    setGravando(false);
    if (g.cancelada) return;
    if (Date.now() - g.inicio < TOQUE_CURTO_MS) {
      recorder.cancel();
      toast("Segure o microfone para gravar");
      return;
    }
    try {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) {
        toast.error("Não foi possível capturar o áudio. Tente novamente.");
        return;
      }
      recorder.setIsProcessing(true);
      await aoGravar?.(blob);
    } finally {
      recorder.setIsProcessing(false);
    }
  };

  const aoApertar = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (modo !== "gravar" || ocupado || recorder.isProcessing) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    gravacao.current = { x0: e.clientX, inicio: Date.now(), ativa: true, cancelada: false, soltou: false, iniciou: false };
    setGravando(true);
    try {
      await recorder.start();
    } catch {
      gravacao.current.ativa = false;
      setGravando(false);
      toast.error("Sem acesso ao microfone. Libere nas configurações do navegador.");
      return;
    }
    gravacao.current.iniciou = true;
    // Cancelou ou soltou enquanto o navegador pedia permissão.
    if (gravacao.current.cancelada) recorderRef.current.cancel();
    else if (gravacao.current.soltou) void terminar();
  };

  const aoArrastar = (e: React.PointerEvent) => {
    const g = gravacao.current;
    if (!g.ativa || g.cancelada) return;
    if (gravacaoCancelada(g.x0, e.clientX)) {
      g.cancelada = true;
      g.ativa = false;
      setGravando(false);
      recorder.cancel();
      try { navigator.vibrate?.(20); } catch { /* o iOS nem tem */ }
      toast("Áudio descartado");
    }
  };

  const aoSoltar = () => {
    const g = gravacao.current;
    if (!g.ativa) return;
    if (!g.iniciou) { g.soltou = true; return; }
    void terminar();
  };

  return (
    <>
      {resposta && (
        <div className="cel-resp-bar">
          <div className="cel-t"><b>{resposta.autor}</b><span>{resposta.texto}</span></div>
          <button type="button" className="cel-ib" onClick={aoCancelarResposta} aria-label="Cancelar resposta"><X /></button>
        </div>
      )}
      {anexos.length > 0 && (
        <div className="cel-anexos">
          {anexos.map((a, i) => (
            <div key={i} className="cel-anexo">
              {a.type === "image" ? <img src={a.url || a.base64} alt="" /> : <FileText className="cel-mini" />}
              <span>{a.name ?? "arquivo"}</span>
              <button type="button" onClick={() => aoRemoverAnexo?.(i)} aria-label={`Tirar ${a.name ?? "anexo"}`}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="cel-compor">
        {gravando ? (
          <div className="cel-gravacao" role="status">
            <span className="cel-rec" />
            <span className="cel-tempo">{tempo(recorder.duration)}</span>
            <span className="cel-dica">‹ deslize para cancelar</span>
          </div>
        ) : (
          <div className="cel-campo">
            {aoAbrirEmoji && <button type="button" className="cel-ib" onClick={aoAbrirEmoji} aria-label="Emoji"><Smile /></button>}
            <textarea
              ref={ref}
              rows={1}
              value={valor}
              onChange={(e) => aoMudar(e.target.value)}
              placeholder={recorder.isProcessing ? "Enviando o áudio…" : placeholder}
              aria-label="Mensagem"
              enterKeyHint="enter"
              style={aoAbrirEmoji ? undefined : { paddingLeft: 16 }}
            />
            {aoAbrirAnexo && <button type="button" className="cel-ib" onClick={aoAbrirAnexo} aria-label="Anexar"><Paperclip /></button>}
          </div>
        )}
        <button
          type="button"
          className={`cel-enviar${gravando ? " gravando" : ""}`}
          aria-label={modo === "enviar" ? "Enviar" : modo === "parar" ? "Parar a resposta" : "Segure para gravar áudio"}
          disabled={ocupado || recorder.isProcessing}
          onClick={() => { if (modo === "enviar") aoEnviar(); else if (modo === "parar") aoParar?.(); }}
          onPointerDown={aoApertar}
          onPointerMove={aoArrastar}
          onPointerUp={aoSoltar}
          onPointerCancel={() => { gravacao.current.cancelada = true; if (gravacao.current.ativa) { gravacao.current.ativa = false; setGravando(false); recorder.cancel(); } }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {modo === "enviar" ? <SendHorizontal /> : modo === "parar" ? <Square fill="currentColor" size={18} /> : <Mic />}
        </button>
      </div>
    </>
  );
}
