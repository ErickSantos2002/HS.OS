/**
 * Peças visuais do app do celular: avatar, folha de baixo e menu suspenso.
 * Medidas e comportamento do protótipo aprovado.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Hash, Sparkles } from "lucide-react";

import { useResolvedAgentAvatar } from "@/hooks/use-agent-avatar";

const CORES = ["#1885c8", "#0f8f84", "#5a54c7", "#c2721a", "#b84a6a", "#7c5cc4", "#2f8a52", "#c0533a", "#3a6fb0"];
const CORES_DE_NOME = ["--n1", "--n2", "--n3", "--n4", "--n5"];

function hash(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return h;
}

/** Cor de fundo do avatar com letra — a mesma pessoa tem sempre a mesma. */
export function corDoAvatar(chave: string): string {
  return CORES[hash(chave) % CORES.length];
}

/** Cor do nome do autor no canal (`--n1`…`--n5`, ajustadas ao tema). */
export function corDoNome(chave: string): string {
  return `var(${CORES_DE_NOME[hash(chave) % CORES_DE_NOME.length]})`;
}

type Tam = "" | "sm" | "xs";

export function Avatar({
  tipo, nome, chave, foto, tam = "",
}: {
  tipo: "agente" | "pessoa" | "canal";
  nome: string;
  /** id do agente/pessoa — decide a cor e, no agente, a foto. */
  chave: string;
  foto?: string | null;
  tam?: Tam;
}) {
  if (tipo === "canal") {
    return <div className={`cel-av canal ${tam}`} aria-hidden="true"><Hash className="cel-i" /></div>;
  }
  if (tipo === "agente") return <AvatarDeAgente nome={nome} id={chave} tam={tam} />;
  return (
    <div className={`cel-av ${tam}`} style={{ background: corDoAvatar(chave) }} aria-hidden="true">
      {foto ? <img src={foto} alt="" /> : (nome.trim()[0] || "?").toUpperCase()}
    </div>
  );
}

function AvatarDeAgente({ nome, id, tam }: { nome: string; id: string; tam: Tam }) {
  const { avatar: foto, handleBrokenAvatar } = useResolvedAgentAvatar(id);
  return (
    <div className={`cel-av agente ${tam}`} style={{ background: corDoAvatar(id) }} aria-hidden="true">
      {foto ? <img src={foto} alt="" onError={handleBrokenAvatar} /> : (nome.trim()[0] || "?").toUpperCase()}
      <span className="cel-selo"><Sparkles className="cel-i" fill="currentColor" strokeWidth={0} /></span>
    </div>
  );
}

/**
 * Folha de baixo: fecha tocando no véu, arrastando a alça para baixo (> 90px)
 * ou pelo voltar do sistema (Esc no teclado).
 */
export function Folha({ aberta, aoFechar, children, rotulo }: { aberta: boolean; aoFechar: () => void; children: ReactNode; rotulo: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [desvio, setDesvio] = useState(0);
  const inicio = useRef<number | null>(null);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta, aoFechar]);

  if (!aberta) return null;
  return (
    <>
      <div className="cel-veu" onClick={aoFechar} />
      <div
        ref={ref}
        className="cel-folha"
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        style={desvio ? { transform: `translateY(${desvio}px)`, transition: "none" } : undefined}
        onPointerDown={(e) => { if ((ref.current?.scrollTop ?? 0) <= 0 && !(e.target as HTMLElement).closest("input,textarea,[data-sem-arrasto]")) inicio.current = e.clientY; }}
        onPointerMove={(e) => { if (inicio.current !== null) setDesvio(Math.max(0, e.clientY - inicio.current)); }}
        onPointerUp={() => { const d = desvio; inicio.current = null; setDesvio(0); if (d > 90) aoFechar(); }}
        onPointerCancel={() => { inicio.current = null; setDesvio(0); }}
      >
        <div className="cel-alca" />
        {children}
      </div>
    </>
  );
}

export interface ItemDeMenu {
  rotulo: string;
  icone: ReactNode;
  aoEscolher: () => void;
}

export function MenuSuspenso({ aberto, aoFechar, itens }: { aberto: boolean; aoFechar: () => void; itens: ItemDeMenu[] }) {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <>
      <div className="cel-veu transparente" onClick={aoFechar} />
      <div className="cel-menu" role="menu">
        {itens.map((i) => (
          <button key={i.rotulo} type="button" role="menuitem" className="cel-acao" onClick={() => { aoFechar(); i.aoEscolher(); }}>
            {i.icone}{i.rotulo}
          </button>
        ))}
      </div>
    </>
  );
}

/** Hora curta de uma mensagem ("09:41"). */
export function horaCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "Hoje", "Ontem" ou a data — o separador de dia da conversa. */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const zero = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((zero(agora) - zero(d)) / 864e5);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias < 7) {
    const s = d.toLocaleDateString("pt-BR", { weekday: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: d.getFullYear() === agora.getFullYear() ? undefined : "numeric" });
}

export function mesmoDia(a: string, b: string | undefined): boolean {
  if (!b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}
