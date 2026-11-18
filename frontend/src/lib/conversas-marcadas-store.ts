/**
 * As conversas que a pessoa marcou como não lidas pela lista (18/11/2026).
 *
 * Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.
 *
 * Store de MÓDULO, uma carga por aba: desktop e celular, lista e conversa
 * aberta leem o mesmo conjunto. Otimista — o clique muda o conjunto antes da
 * rota responder, e desfaz se ela recusar.
 *
 * ⚠️ **Não é notificação.** A marca não entra no sininho nem em contador, e o
 * re-sweep de 2 s da conversa aberta não a toca — foi esse re-sweep que fazia o
 * "Marcar como não lida" por mensagem sumir na hora. Quem a apaga é só a
 * ABERTURA da conversa (`use-conversa-ativa.ts`).
 *
 * Outro aparelho acompanha pelo tópico `usuario:<id>` (trigger da 039) e ao
 * voltar para a aba (`visibilitychange`).
 */
import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";
import { chaveDaMarca, idDoAgenteNaMarca, type AlvoDaMarca } from "@/lib/conversa-marcada";

interface MarcaDoServidor {
  canal_id: string | null;
  agent_id: string | null;
  marcada_em: string;
}

let marcadas: ReadonlySet<string> = new Set();
let carregado = false;
const ouvintes = new Set<() => void>();

function trocar(novo: ReadonlySet<string>) {
  marcadas = novo;
  ouvintes.forEach((fn) => fn());
}

function com(chave: string, presente: boolean): ReadonlySet<string> {
  const novo = new Set(marcadas);
  if (presente) novo.add(chave);
  else novo.delete(chave);
  return novo;
}

function query(alvo: AlvoDaMarca): string {
  return alvo.canalId
    ? `canal_id=${encodeURIComponent(alvo.canalId)}`
    : `agent_id=${encodeURIComponent(idDoAgenteNaMarca(alvo.agentId ?? ""))}`;
}

/** O conjunto atual (referência nova a cada mudança — serve ao `useSyncExternalStore`). */
export function instantaneo(): ReadonlySet<string> {
  return marcadas;
}

// ⚠️ Carga velha não sobrescreve mudança nova. A aba que nasce com a conversa
// aberta manda o GET e, no mesmo ciclo, o DELETE da abertura; se o GET responde
// depois, trazia a marca de volta para a conversa aberta. Toda mudança local
// sobe `geracao`, toda carga sobe `geracaoDaCarga`: resposta de carga que viu
// uma das duas mudar é descartada.
let geracao = 0;
let geracaoDaCarga = 0;

export async function carregar(): Promise<void> {
  const minha = ++geracaoDaCarga;
  const vista = geracao;
  try {
    const lista = await api<MarcaDoServidor[]>("/conversas/marcadas");
    if (minha !== geracaoDaCarga || vista !== geracao) return;
    carregado = true;
    trocar(new Set((lista ?? []).map((m) =>
      chaveDaMarca({ canalId: m.canal_id, agentId: m.agent_id }))));
  } catch {
    /* sem a lista, segue com o que tem — a marca é acessório */
  }
}

export function estaMarcada(alvo: AlvoDaMarca): boolean {
  if (!alvo.canalId && !alvo.agentId) return false;
  return marcadas.has(chaveDaMarca(alvo));
}

async function mudar(alvo: AlvoDaMarca, presente: boolean): Promise<boolean> {
  if (!alvo.canalId && !alvo.agentId) return false;
  const chave = chaveDaMarca(alvo);
  const antes = marcadas.has(chave);
  geracao += 1;
  trocar(com(chave, presente));
  try {
    await api(`/conversas/marcadas?${query(alvo)}`, { method: presente ? "PUT" : "DELETE" });
    return true;
  } catch {
    if (marcadas.has(chave) !== antes) trocar(com(chave, antes));
    return false;
  }
}

export function marcar(alvo: AlvoDaMarca): Promise<boolean> {
  return mudar(alvo, true);
}

/** Depois de carregado, desmarcar o que não está marcado não vai à rota:
 *  é chamado a cada abertura de conversa, e quase nenhuma está marcada. */
export function desmarcar(alvo: AlvoDaMarca): Promise<boolean> {
  if (carregado && !estaMarcada(alvo)) return Promise.resolve(true);
  return mudar(alvo, false);
}

export function assinarMudancas(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

// Quantos componentes pediram para acompanhar: uma assinatura por aba.
let usuarioAtual: string | null = null;
let usos = 0;
let pararTudo: (() => void) | null = null;

/** Carrega e passa a acompanhar as mudanças da pessoa. Devolve o cancelar. */
export function iniciar(userId: string): () => void {
  if (usuarioAtual !== userId) {
    pararTudo?.();
    usos = 0;
    usuarioAtual = userId;
    carregado = false;
    trocar(new Set());
    const cancelarRealtime = assinar(`usuario:${userId}`, (_tipo, dados) => {
      if ((dados as { tabela?: string } | null)?.tabela === "conversas_marcadas") void carregar();
    });
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    pararTudo = () => {
      cancelarRealtime();
      document.removeEventListener("visibilitychange", aoVoltar);
    };
    void carregar();
  }
  usos += 1;
  return () => {
    usos -= 1;
    if (usos <= 0 && usuarioAtual === userId) {
      pararTudo?.();
      pararTudo = null;
      usuarioAtual = null;
      usos = 0;
    }
  };
}

/** Só para teste: volta ao estado de aba nova. */
export function __zerarParaTeste() {
  pararTudo?.();
  pararTudo = null;
  usuarioAtual = null;
  usos = 0;
  carregado = false;
  marcadas = new Set();
  ouvintes.clear();
}
