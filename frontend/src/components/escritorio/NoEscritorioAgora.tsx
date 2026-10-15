/**
 * "No escritório agora (N)" — topo da lista de DMs do chat (EscritorioHS B).
 * Spec: docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md
 *
 * Componente só de apresentação: quem busca a presença é a `ChatPage`, uma
 * vez, e passa para as duas listas (desktop e celular). Assim dá para testar
 * os estados sem rede.
 *
 * `conectado: false` mostra só o botão de entrar, nunca "Ninguém agora": o
 * backend não estar ouvindo o escritório não quer dizer que ele está vazio.
 */
import { useState } from "react";
import { Building2, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

import { ESCRITORIO_URL, type PresencaEscritorio } from "@/lib/escritorio";

const CHAVE_ABERTO = "hsos:escritorio-aberto";
const MAX_VISIVEIS = 8;

function lerAberto(): boolean {
  try {
    return localStorage.getItem(CHAVE_ABERTO) !== "0";
  } catch {
    return true;
  }
}

function gravarAberto(aberto: boolean) {
  try {
    localStorage.setItem(CHAVE_ABERTO, aberto ? "1" : "0");
  } catch {
    /* aba anônima ou armazenamento bloqueado: só não lembra */
  }
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return partes.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

function BotaoEntrar() {
  return (
    <a
      href={ESCRITORIO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
    >
      Entrar
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function NoEscritorioAgora({ presenca }: { presenca: PresencaEscritorio | undefined }) {
  const [aberto, setAberto] = useState(lerAberto);

  if (!presenca) return null;

  if (!presenca.conectado) {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 mb-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-display">
          <Building2 className="h-3 w-3" />
          Escritório
        </span>
        <BotaoEntrar />
      </div>
    );
  }

  const { pessoas } = presenca;
  const visiveis = pessoas.slice(0, MAX_VISIVEIS);
  const resto = pessoas.length - visiveis.length;

  const alternar = () => {
    setAberto((atual) => {
      gravarAberto(!atual);
      return !atual;
    });
  };

  return (
    <div className="mb-2 pb-2 border-b border-border/40">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="flex items-center gap-1 min-w-0 text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-foreground font-display transition-colors"
        >
          {aberto ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">No escritório agora ({pessoas.length})</span>
        </button>
        <BotaoEntrar />
      </div>

      {aberto && (
        <div className="px-2">
          {pessoas.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 py-1">Ninguém agora</p>
          ) : (
            <ul className="space-y-0.5">
              {visiveis.map((p) => (
                <li key={p.email} className="flex items-center gap-2 min-w-0 py-0.5" title={p.email}>
                  <div className="h-6 w-6 shrink-0 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[9px] font-bold text-foreground">{iniciais(p.nome || p.email)}</span>
                    )}
                  </div>
                  <span className="text-xs text-foreground truncate">{p.nome || p.email}</span>
                </li>
              ))}
              {resto > 0 && <li className="text-[11px] text-muted-foreground pl-8">+{resto}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
