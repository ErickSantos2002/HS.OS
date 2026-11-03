/**
 * A bolha de mensagem do app do celular e os gestos dela (spec 2026-11-03,
 * itens 2 e 4): segurar 450 ms abre as ações; deslizar para a direita
 * responde. O "segurar" é o detector que já existia (`lib/toque-longo.ts`);
 * o deslizar usa os limiares de `gestos.ts`.
 *
 * ⚠️ Durante o gesto nada é estado React — a bolha anda pelo `style` direto,
 * como no protótipo. Com estado, cada movimento do dedo re-renderizaria a
 * conversa inteira.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, CheckCheck, Clock, Download, Pause, Play, Reply } from "lucide-react";

import AnexoResolvido from "@/components/chat/AnexoResolvido";
import { criarDetectorDeToqueLongo } from "@/lib/toque-longo";
import { downloadAttachment, formatFileSize } from "@/lib/file-upload";
import { gravarVelocidade, lerVelocidade, proximaVelocidade, rotuloVelocidade } from "@/lib/velocidade-audio";
import type { EstadoDoVisto } from "@/lib/vistos";
import { classificarMovimento, deslocamentoDaBolha, ondasDe, soltarResponde } from "./gestos";

export function Visto({ estado }: { estado: EstadoDoVisto }) {
  if (estado === "pendente") return <Clock aria-label="Enviando" />;
  if (estado === "falhou") return <AlertCircle aria-label="Falhou" style={{ color: "var(--danger)" }} />;
  if (estado === "enviada") return <Check aria-label="Enviada" />;
  return <CheckCheck aria-label={estado === "lida" ? "Lida" : "Entregue"} className={estado === "lida" ? "lido" : undefined} />;
}

export interface ReacaoNaBolha {
  emoji: string;
  quantos: number;
  minha: boolean;
}

interface Props {
  id: string;
  eu: boolean;
  /** Primeira do grupo do mesmo autor: leva a cauda (e, no canal, nome e foto). */
  inicio: boolean;
  /** Canal com mais gente: reserva a coluna do avatar. */
  grupo?: boolean;
  avatar?: ReactNode;
  autor?: { nome: string; cor: string } | null;
  hora: string;
  visto?: EstadoDoVisto | null;
  editada?: boolean;
  erro?: boolean;
  reacoes?: ReacaoNaBolha[];
  aoReagir?: (emoji: string) => void;
  thread?: { quantos: number; avatares: ReactNode; aoAbrir: () => void } | null;
  aoSegurar?: () => void;
  aoResponder?: () => void;
  destaque?: boolean;
  children: ReactNode;
}

export const Bolha = memo(function Bolha({
  id, eu, inicio, grupo, avatar, autor, hora, visto, editada, erro, reacoes, aoReagir, thread,
  aoSegurar, aoResponder, destaque, children,
}: Props) {
  const bolhaRef = useRef<HTMLDivElement>(null);
  const puxaRef = useRef<HTMLSpanElement>(null);
  const aoSegurarRef = useRef(aoSegurar);
  aoSegurarRef.current = aoSegurar;
  const aoResponderRef = useRef(aoResponder);
  aoResponderRef.current = aoResponder;
  const gesto = useRef({ x: 0, y: 0, dx: 0, ativo: false, arrastando: false });

  const detector = useMemo(() => criarDetectorDeToqueLongo({
    aoDisparar: () => {
      bolhaRef.current?.classList.remove("pressionada");
      try { navigator.vibrate?.(12); } catch { /* o iOS nem tem */ }
      aoSegurarRef.current?.();
    },
  }), []);
  useEffect(() => () => detector.fim(), [detector]);

  const soltar = () => {
    const g = gesto.current;
    detector.fim();
    const b = bolhaRef.current;
    b?.classList.remove("pressionada");
    if (g.arrastando && b) {
      b.style.transition = "";
      b.style.transform = "";
      if (puxaRef.current) puxaRef.current.style.opacity = "0";
      if (soltarResponde(g.dx)) {
        try { navigator.vibrate?.(10); } catch { /* idem */ }
        aoResponderRef.current?.();
      }
    }
    g.ativo = false;
    g.arrastando = false;
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,a,audio,input,textarea")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      gesto.current = { x: e.clientX, y: e.clientY, dx: 0, ativo: true, arrastando: false };
      if (aoSegurarRef.current) {
        bolhaRef.current?.classList.add("pressionada");
        detector.inicio(e.clientX, e.clientY);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = gesto.current;
      if (!g.ativo) return;
      const mx = e.clientX - g.x;
      const my = e.clientY - g.y;
      const mov = classificarMovimento(mx, my);
      if (!g.arrastando && mov !== "parado") {
        detector.fim();
        bolhaRef.current?.classList.remove("pressionada");
        if (mov === "deslizar" && aoResponderRef.current) {
          g.arrastando = true;
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* sem captura */ }
        } else {
          g.ativo = false;
          return;
        }
      }
      if (g.arrastando && bolhaRef.current) {
        g.dx = deslocamentoDaBolha(mx);
        bolhaRef.current.style.transition = "none";
        bolhaRef.current.style.transform = `translateX(${g.dx}px)`;
        if (puxaRef.current) puxaRef.current.style.opacity = String(Math.min(1, g.dx / 60));
      }
    },
    onPointerUp: soltar,
    onPointerCancel: soltar,
    onContextMenu: (e: React.MouseEvent) => {
      // Botão direito (ou o menu nativo do toque longo): as ações, nunca o
      // menu do navegador por cima da bolha.
      e.preventDefault();
      if (!detector.disparou()) aoSegurarRef.current?.();
    },
  };

  const temReacoes = !!reacoes && reacoes.length > 0;
  return (
    <>
      <div className={`cel-linha${eu ? " eu" : ""}${inicio ? " inicio" : ""}`} data-message-id={id}>
        <span ref={puxaRef} className="cel-puxa" aria-hidden="true"><Reply className="cel-i" style={{ width: 18, height: 18 }} /></span>
        {grupo && !eu && (inicio ? avatar : <span className="cel-vaga" />)}
        <div ref={bolhaRef} className={`cel-bolha${destaque ? " destaque" : ""}${erro ? " erro" : ""}`} {...handlers}>
          {autor && <div className="cel-autor" style={{ color: autor.cor }}>{autor.nome}</div>}
          {children}
          <span className="cel-rodape">
            {editada ? "editada · " : ""}{hora}
            {eu && visto ? <span className={visto === "lida" ? "lido" : ""}><Visto estado={visto} /></span> : null}
          </span>
          <div className="cel-fim" />
        </div>
      </div>
      {temReacoes && (
        <div className={`cel-reacoes${eu ? " eu" : grupo ? " grupo" : ""}`}>
          {reacoes!.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={`cel-reac${r.minha ? " minha" : ""}`}
              onClick={() => aoReagir?.(r.emoji)}
              aria-label={`${r.emoji} ${r.quantos}${r.minha ? ", inclusive a sua" : ""}`}
            >
              {r.emoji}{r.quantos > 1 ? ` ${r.quantos}` : ""}
            </button>
          ))}
        </div>
      )}
      {thread && thread.quantos > 0 && (
        <button type="button" className={`cel-thr${eu ? " eu" : ""}`} onClick={thread.aoAbrir}>
          <span className="cel-avs">{thread.avatares}</span>
          {thread.quantos} {thread.quantos === 1 ? "resposta" : "respostas"} · ver thread
        </button>
      )}
    </>
  );
});

function formatar(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * Player do áudio: o resumo falado do agente (`voz_entrega`) e a voz de quem
 * escreveu. Ondas desenhadas a partir do id (`ondasDe`) e pintadas conforme
 * toca; a velocidade é a mesma preferência do player do desktop.
 */
export function PlayerDeAudio({ src, semente, rotulo, aoErro }: { src: string; semente: string; rotulo: string; aoErro?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState(lerVelocidade);
  const ondas = useMemo(() => ondasDe(semente), [semente]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.defaultPlaybackRate = velocidade;
    a.playbackRate = velocidade;
  }, [velocidade, src]);

  const alternar = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Um áudio por vez, como no WhatsApp.
      document.querySelectorAll<HTMLAudioElement>(".app-celular audio").forEach((o) => { if (o !== a) o.pause(); });
      void a.play().catch(() => aoErro?.());
    } else a.pause();
  };
  const ouvidas = duracao > 0 ? Math.round((atual / duracao) * ondas.length) : 0;

  return (
    <div className="cel-audio">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setAtual(0); }}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuracao(d); }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuracao(d); }}
        onError={() => aoErro?.()}
      />
      <button type="button" className="cel-play" onClick={alternar} aria-label={tocando ? "Pausar" : `Ouvir ${rotulo}`}>
        {tocando ? <Pause fill="currentColor" strokeWidth={0} /> : <Play fill="currentColor" strokeWidth={0} />}
      </button>
      <div className="cel-onda" aria-hidden="true">
        {ondas.map((v, k) => <i key={k} className={k < ouvidas ? "ouvido" : undefined} style={{ height: `${v}%` }} />)}
      </div>
      <div className="cel-info">
        <span>{formatar(tocando || atual ? atual : duracao)}</span>
        <button
          type="button"
          onClick={() => setVelocidade((v) => { const n = proximaVelocidade(v); gravarVelocidade(n); return n; })}
          aria-label={`Velocidade ${rotuloVelocidade(velocidade)}`}
        >
          {velocidade === 1 ? rotulo : rotuloVelocidade(velocidade)}
        </button>
      </div>
    </div>
  );
}

/** Áudio guardado como anexo privado (`anexo:<id>`) ou URL antiga. */
export function AudioDoAnexo({ id, url, semente, rotulo }: { id?: string; url?: string; semente: string; rotulo: string }) {
  return (
    <AnexoResolvido id={id} url={url}>
      {(u, renovar) => <PlayerDeAudio src={u} semente={semente} rotulo={rotulo} aoErro={renovar} />}
    </AnexoResolvido>
  );
}

const TIPOS: Record<string, { rotulo: string; cor: string }> = {
  pdf: { rotulo: "PDF", cor: "#d0453a" },
  xls: { rotulo: "XLS", cor: "#1d7a4f" }, xlsx: { rotulo: "XLS", cor: "#1d7a4f" }, csv: { rotulo: "CSV", cor: "#1d7a4f" },
  doc: { rotulo: "DOC", cor: "#2f6fd0" }, docx: { rotulo: "DOC", cor: "#2f6fd0" },
  ppt: { rotulo: "PPT", cor: "#c2721a" }, pptx: { rotulo: "PPT", cor: "#c2721a" },
  zip: { rotulo: "ZIP", cor: "#5b6e7d" },
};

/** Cartão de arquivo com o botão de baixar — tocar no cartão abre. */
export function CartaoDeArquivo({ nome, tamanho, url, urlAgora }: { nome: string; tamanho?: number; url: string; urlAgora?: () => Promise<string> }) {
  const ext = (nome.split(".").pop() || "").toLowerCase();
  const tipo = TIPOS[ext] ?? { rotulo: (ext || "ARQ").slice(0, 4).toUpperCase(), cor: "#5b6e7d" };
  const agora = async () => (urlAgora ? urlAgora().catch(() => url) : url);
  return (
    <div className="cel-arq">
      <button
        type="button"
        style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textAlign: "left" }}
        onClick={async () => { const u = await agora(); if (u) window.open(u, "_blank", "noopener,noreferrer"); }}
      >
        <span className="cel-tipo" style={{ background: tipo.cor }}>{tipo.rotulo}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="cel-n" style={{ display: "block" }}>{nome}</span>
          <span className="cel-t">{tipo.rotulo}{tamanho ? ` · ${formatFileSize(tamanho)}` : ""}</span>
        </span>
      </button>
      <button type="button" className="cel-bx" aria-label={`Baixar ${nome}`} onClick={async () => { const u = await agora(); void downloadAttachment({ url: u, name: nome }); }}>
        <Download />
      </button>
    </div>
  );
}

/** Imagem dentro da bolha; tocar amplia. */
export function ImagemDaBolha({ src, nome, aoAmpliar, aoErro }: { src: string; nome: string; aoAmpliar: (src: string) => void; aoErro?: () => void }) {
  return (
    <button type="button" className="cel-img" onClick={() => aoAmpliar(src)} aria-label={`Ampliar ${nome}`}>
      <img src={src} alt={nome} onError={aoErro} loading="lazy" />
    </button>
  );
}

export function Pensando({ nome }: { nome: string }) {
  return (
    <>
      <span className="cel-pensando" aria-hidden="true"><i /><i /><i /></span>
      <span className="cel-pensando-txt">{nome} está pensando…</span>
    </>
  );
}
