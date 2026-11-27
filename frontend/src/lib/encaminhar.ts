/**
 * Encaminhar mensagem, estilo WhatsApp — o que não é tela.
 * Spec: docs/superpowers/specs/2026-11-27-encaminhar-mensagem-design.md
 *
 * Dois stores de módulo:
 * - a ORIGEM aberta no seletor: a ação "Encaminhar" (`acoes-da-mensagem.ts`)
 *   chama `abrirEncaminhar` sem precisar de contexto React, e o seletor,
 *   montado uma vez no `App.tsx`, serve o desktop e o app do celular;
 * - o HANDOFF para o Guardi: o servidor copia os anexos para a conversa com
 *   ele e devolve texto + anexos; quem abre a conversa consome UMA vez.
 *
 * Encaminhar para o Guardi não envia nada — vira rascunho no campo (decisão do
 * Erick, 27/11/2026). A pessoa diz o que quer com aquilo e aperta Enviar.
 */
import { useSyncExternalStore } from "react";

import { api } from "@/lib/api";
import { acrescentarCitacao } from "@/lib/conversas-anteriores";
import type { MediaAttachment } from "@/lib/mock-data";

export const LIMITE_DESTINOS = 10;

export interface OrigemEncaminhar {
  tipo: "canal" | "agente";
  id: string;
  /** Uma linha da mensagem, para o topo do seletor. */
  previa: string;
}

// ── seletor ──────────────────────────────────────────────────────────────────

let origemAberta: OrigemEncaminhar | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function abrirEncaminhar(o: OrigemEncaminhar) {
  origemAberta = o;
  avisar();
}

export function fecharEncaminhar() {
  origemAberta = null;
  avisar();
}

export function useOrigemEncaminhar(): OrigemEncaminhar | null {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => origemAberta,
  );
}

// ── handoff para o Guardi ────────────────────────────────────────────────────

interface ParaOGuardi { agentId: string; autor: string; texto: string; anexos: MediaAttachment[] }

let pendente: ParaOGuardi | null = null;
let versaoDoPendente = 0;
const ouvintesDoGuardi = new Set<() => void>();

/**
 * Avisa quem já está na conversa do Guardi. Encaminhar uma resposta dele para
 * ele mesmo cai na MESMA URL: o id do agente não muda, e só o id não bastava
 * para a tela saber que havia o que consumir (achado da revisão, 27/11/2026).
 */
export function ouvirParaOGuardi(fn: () => void): () => void {
  ouvintesDoGuardi.add(fn);
  return () => { ouvintesDoGuardi.delete(fn); };
}

/** Muda a cada `guardarParaOGuardi` — entra na dependência do efeito que consome. */
export function useVersaoParaOGuardi(): number {
  return useSyncExternalStore(ouvirParaOGuardi, () => versaoDoPendente);
}

export function guardarParaOGuardi(p: ParaOGuardi) {
  pendente = p;
  versaoDoPendente++;
  ouvintesDoGuardi.forEach((f) => f());
}

/** Uso único, e só na conversa do agente para quem foi guardado. */
export function consumirParaOGuardi(agentId: string): Omit<ParaOGuardi, "agentId"> | null {
  if (!pendente || pendente.agentId !== agentId) return null;
  const { autor, texto, anexos } = pendente;
  pendente = null;
  return { autor, texto, anexos };
}

/** O que entra no campo: a mensagem inteira citada, com quem a escreveu. */
export function textoParaOGuardi(rascunho: string, autor: string, texto: string): string {
  return acrescentarCitacao(rascunho, `*Encaminhada de ${autor}:*\n${texto}`);
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface DestinosEncaminhar {
  guardi: { id: string; nome: string } | null;
  pessoal: string | null;
  grupos: { id: string; nome: string }[];
  pessoas: { id: string; nome: string; avatar_url: string | null }[];
}

export interface RespostaEncaminhar {
  enviados: { destino: string; channel_id: string; message_id: string }[];
  falhas: { destino: string; motivo: string }[];
  guardi: { agent_id: string; autor: string; texto: string; anexos: MediaAttachment[] } | null;
}

export function carregarDestinos(): Promise<DestinosEncaminhar> {
  return api<DestinosEncaminhar>("/encaminhar/destinos");
}

export function encaminhar(
  origem: OrigemEncaminhar,
  destinos: { pessoas: string[]; canais: string[]; guardi: boolean },
): Promise<RespostaEncaminhar> {
  return api<RespostaEncaminhar>("/encaminhar", {
    method: "POST",
    body: { origem: { tipo: origem.tipo, id: origem.id }, ...destinos },
  });
}
