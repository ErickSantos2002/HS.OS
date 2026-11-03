/**
 * Peças visuais do app do celular: avatar, folha de baixo e menu suspenso.
 * Medidas e comportamento do protótipo aprovado.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Hash, Sparkles } from "lucide-react";

import { useResolvedAgentAvatar } from "@/hooks/use-agent-avatar";
import { corDoAvatar } from "./formato";
import { controleDeFolhas } from "./historico-da-folha";


/**
 * Folha e menu fecham com o voltar do Android, como no WhatsApp — em vez de o
 * voltar desempilhar a conversa que está por baixo.
 *
 * Abrir empilha uma entrada no histórico com a MESMA URL (a pilha de telas
 * não muda); o voltar a consome e fecha. Fechar pelo toque devolve a entrada
 * — mas só se ela ainda for a atual: se a ação escolhida navegou (abrir a
 * thread), voltar ali desfaria a navegação.
 */
function useFecharComVoltar(aberto: boolean, aoFechar: () => void) {
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;
  useEffect(() => {
    if (!aberto) return;
    const marca = Date.now() + Math.random();
    const controle = controleDeFolhas();
    controle.abrir(marca);
    let peloVoltar = false;
    const aoPop = () => {
      // Só o voltar que tirou A NOSSA entrada fecha esta folha.
      if ((window.history.state as { celFolha?: number } | null)?.celFolha === marca) return;
      peloVoltar = true;
      aoFecharRef.current();
    };
    window.addEventListener("popstate", aoPop);
    return () => {
      window.removeEventListener("popstate", aoPop);
      controle.fechar(marca, peloVoltar);
    };
  }, [aberto]);
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
  useFecharComVoltar(aberta, aoFechar);

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
  useFecharComVoltar(aberto, aoFechar);
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

