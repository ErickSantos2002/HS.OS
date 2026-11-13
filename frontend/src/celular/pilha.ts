/**
 * A pilha de telas do app do celular, derivada da URL — spec
 * `2026-11-03-app-celular-design.md`, "Como encaixa no sistema".
 *
 * ⚠️ **A URL é a fonte da verdade, não um estado React.** É o que faz o voltar
 * do Android e do navegador desempilhar, e o que deixa os links profundos do
 * push (`/chat?agent=…`, `/chat?channel=…&thread=…`) abrirem a tela certa em
 * cima da lista. Uma pilha em estado precisaria espelhar a URL nos dois
 * sentidos, e os dois sentidos divergem.
 *
 * Parâmetros: `aba` (raiz), `agent` ou `channel` (conversa), `thread` (em cima
 * do canal) e `painel` (em cima de tudo).
 */

export type Aba = "conversas" | "atividade" | "eu";
export type Painel = "arquivos" | "anteriores" | "contexto" | "capacidade" | "participantes" | "busca" | "silenciados";

export type Tela =
  | { tipo: "inicio"; aba: Aba }
  | { tipo: "agente"; id: string }
  | { tipo: "canal"; id: string }
  | { tipo: "thread"; canal: string; raiz: string }
  | { tipo: "painel"; painel: Painel };

const ABAS: Aba[] = ["conversas", "atividade", "eu"];
const PAINEIS: Painel[] = ["arquivos", "anteriores", "contexto", "capacidade", "participantes", "busca", "silenciados"];

export function pilhaDaUrl(search: string, agenteDoCanal?: (canalId: string) => string | null): Tela[] {
  const p = new URLSearchParams(search);
  const aba = p.get("aba") as Aba | null;
  const telas: Tela[] = [{ tipo: "inicio", aba: aba && ABAS.includes(aba) ? aba : "conversas" }];
  const agente = p.get("agent");
  const canal = p.get("channel");
  if (agente) {
    telas.push({ tipo: "agente", id: agente });
  } else if (canal) {
    const doAgente = agenteDoCanal?.(canal) ?? null;
    if (doAgente) {
      telas.push({ tipo: "agente", id: doAgente });
    } else {
      telas.push({ tipo: "canal", id: canal });
      const thread = p.get("thread");
      if (thread) telas.push({ tipo: "thread", canal, raiz: thread });
    }
  }
  const painel = p.get("painel") as Painel | null;
  if (painel && PAINEIS.includes(painel)) telas.push({ tipo: "painel", painel });
  return telas;
}

export function urlDaPilha(telas: Tela[]): string {
  const p = new URLSearchParams();
  for (const t of telas) {
    if (t.tipo === "inicio" && t.aba !== "conversas") p.set("aba", t.aba);
    if (t.tipo === "agente") p.set("agent", t.id);
    if (t.tipo === "canal") p.set("channel", t.id);
    if (t.tipo === "thread") p.set("thread", t.raiz);
    if (t.tipo === "painel") p.set("painel", t.painel);
  }
  const s = p.toString();
  return s ? `/chat?${s}` : "/chat";
}

/** A URL depois de empilhar `tela` sobre o que está aberto. */
export function urlAoAbrir(search: string, tela: Tela): string {
  return urlDaPilha([...pilhaDaUrl(search), tela]);
}

/**
 * Para onde o voltar leva quando não há histórico dentro do app — o caso do
 * push, que abre a conversa direto. Sem isto, o voltar saía do app.
 */
export function urlDoPai(search: string): string {
  const telas = pilhaDaUrl(search);
  return urlDaPilha(telas.length > 1 ? telas.slice(0, -1) : telas);
}

export function urlDaAba(aba: Aba): string {
  return urlDaPilha([{ tipo: "inicio", aba }]);
}

/** O app do celular cobre a raiz e o chat; o resto continua no `AppLayout`. */
export function usaAppCelular(isMobile: boolean, pathname: string): boolean {
  return isMobile && (pathname === "/" || pathname === "/chat");
}
