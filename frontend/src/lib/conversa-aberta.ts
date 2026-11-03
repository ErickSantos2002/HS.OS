/**
 * Qual conversa está na tela — para o push não tocar para quem está olhando
 * (spec 2026-11-03, Frente B).
 *
 * O servidor não sabe o que está visível, então quem decide é o service
 * worker: ao receber um push, ele pergunta às abas visíveis e com foco
 * "você está nesta conversa?" (`esta-na-conversa`, com um `MessagePort` de
 * resposta). Esta é a ponta que responde.
 *
 * ⚠️ **Pergunta do SW, não aviso do app.** A spec pedia que o app avisasse o SW
 * a cada troca de conversa. O SW é encerrado pelo navegador depois de ~30 s
 * ocioso, e o mapa que ele guardaria some junto — justamente quando o push o
 * acorda. Perguntar na hora não depende de memória do SW.
 *
 * ⚠️ No iOS o SW mostra sempre (push sem notificação visível faz o Safari
 * revogar a inscrição) e avisa as abas com `push-mostrado`; a aba que estiver
 * olhando fecha a notificação logo em seguida.
 *
 * Quem alimenta são `setActiveChannel`/`setActiveAgent` do `use-notifications`,
 * que o `ChatPage` já chama na troca de conversa.
 */
import { getAgentIdAliases } from "@/lib/agent-id";

let canalAberto: string | null = null;
let agenteAberto: string | null = null;

export function definirCanalAberto(id: string | null): void {
  canalAberto = id;
  void fecharNotificacoesDaTela();
}

export function definirAgenteAberto(id: string | null): void {
  agenteAberto = id;
  void fecharNotificacoesDaTela();
}

function telaAtiva(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

function conversaCasa(conversa: string): boolean {
  if (!conversa) return false;
  if (conversa.startsWith("canal:")) {
    return !!canalAberto && conversa === `canal:${canalAberto}`;
  }
  if (conversa.startsWith("agente:")) {
    if (!agenteAberto) return false;
    const id = conversa.slice("agente:".length);
    return getAgentIdAliases(agenteAberto).includes(id);
  }
  return false;
}

/** A conversa está aberta nesta aba, que está visível e com foco. */
export function estaVendoConversa(conversa: string): boolean {
  return telaAtiva() && conversaCasa(conversa);
}

/** Fecha as notificações da conversa que está na tela. */
async function fecharNotificacoesDaTela(): Promise<void> {
  if (!telaAtiva() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.getNotifications) return;
    const abertas = await reg.getNotifications();
    for (const n of abertas) {
      const conversa = (n.data as { conversa?: string } | null)?.conversa;
      if (conversa && conversaCasa(conversa)) n.close();
    }
  } catch {
    // acessório
  }
}

function instalar(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener?.("message", (event: MessageEvent) => {
    const dados = event.data as { type?: string; conversa?: string } | undefined;
    if (dados?.type === "esta-na-conversa") {
      event.ports?.[0]?.postMessage({ sim: estaVendoConversa(dados.conversa ?? "") });
    } else if (dados?.type === "push-mostrado" && dados.conversa && estaVendoConversa(dados.conversa)) {
      void fecharNotificacoesDaTela();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void fecharNotificacoesDaTela();
  });
}

instalar();
