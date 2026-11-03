import type { ReactNode } from "react";
import { ArrowLeft, MoreVertical } from "lucide-react";

/** Cabeçalho de tela empilhada: voltar, quem, subtítulo e ⋮. */
export function Cabecalho({
  aoVoltar, avatar, titulo, sub, subVivo, aoTocarQuem, aoMenu,
}: {
  aoVoltar: () => void;
  avatar?: ReactNode;
  titulo: string;
  sub?: string;
  subVivo?: boolean;
  aoTocarQuem?: () => void;
  aoMenu?: () => void;
}) {
  return (
    <header className="cel-topo cel-topo-conv">
      <button type="button" className="cel-ib" onClick={aoVoltar} aria-label="Voltar"><ArrowLeft /></button>
      <button type="button" className="cel-quem" onClick={aoTocarQuem} disabled={!aoTocarQuem}>
        {avatar}
        <span style={{ minWidth: 0 }}>
          <span className="cel-nome" style={{ display: "block" }}>{titulo}</span>
          {sub ? <span className={`cel-sub${subVivo ? " vivo" : ""}`} style={{ display: "block" }}>{sub}</span> : null}
        </span>
      </button>
      {aoMenu && <button type="button" className="cel-ib" onClick={aoMenu} aria-label="Mais opções"><MoreVertical /></button>}
    </header>
  );
}

/** Tela cheia empilhada por cima da conversa (painéis do ⋮). */
export function Sobreposta({ titulo, aoVoltar, children }: { titulo: string; aoVoltar: () => void; children: ReactNode }) {
  return (
    <section className="cel-tela entrando" style={{ zIndex: 20 }} aria-label={titulo}>
      <Cabecalho aoVoltar={aoVoltar} titulo={titulo} />
      <div className="cel-painel">{children}</div>
    </section>
  );
}
