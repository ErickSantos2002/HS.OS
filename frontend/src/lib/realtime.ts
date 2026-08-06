/**
 * Eventos em tempo real — substitui o `postgres_changes` do Supabase.
 *
 * Uma conexão por aba, compartilhada por quem precisar. Os assinantes dizem que
 * tópicos querem; a conexão é refeita quando o conjunto muda, porque os tópicos
 * vão na URL (o servidor os lê da query ao aceitar).
 *
 * Reconecta sozinha com espera crescente. Enquanto está fora do ar, quem chamou
 * continua funcionando pelo carregamento normal — o tempo real é aceleração, não
 * requisito: nenhuma tela depende dele para mostrar o que já está gravado.
 */

import { lerToken } from "@/lib/api";

type Ouvinte = (tipo: string, dados: unknown) => void;

const BASE = import.meta.env.VITE_API_URL || "/api";

/** Tópicos assinados → ouvintes. */
const ouvintes = new Map<string, Set<Ouvinte>>();

let socket: WebSocket | null = null;
let tentativas = 0;
let reconectarTimer: number | null = null;
let assinaturaAtual = "";

function urlDoSocket(): string | null {
  const token = lerToken();
  if (!token) return null;

  const canais = [...ouvintes.keys()]
    .filter((t) => t.startsWith("canal:"))
    .map((t) => t.slice("canal:".length));

  // `/api` é caminho relativo: vira ws:// ou wss:// conforme a página, o que
  // mantém o mesmo esquema de segurança do resto do site.
  const base = BASE.startsWith("http")
    ? BASE.replace(/^http/, "ws")
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${BASE}`;

  const params = new URLSearchParams({ token });
  if (canais.length) params.set("canais", canais.join(","));
  return `${base}/ws?${params}`;
}

function conectar() {
  if (reconectarTimer) {
    window.clearTimeout(reconectarTimer);
    reconectarTimer = null;
  }
  const url = urlDoSocket();
  if (!url || ouvintes.size === 0) return;

  assinaturaAtual = [...ouvintes.keys()].sort().join("|");
  socket?.close();
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    tentativas = 0;
  };

  ws.onmessage = (evento) => {
    let payload: { topico?: string; tipo?: string; dados?: unknown };
    try {
      payload = JSON.parse(evento.data);
    } catch {
      return;
    }
    if (!payload.tipo || payload.tipo === "ping") return;
    const alvo = payload.topico ? ouvintes.get(payload.topico) : null;
    alvo?.forEach((fn) => {
      try {
        fn(payload.tipo!, payload.dados);
      } catch (e) {
        console.error("[realtime] ouvinte falhou:", e);
      }
    });
  };

  ws.onclose = (evento) => {
    if (socket === ws) socket = null;
    // 1008 é token recusado — insistir com a mesma credencial só gera ruído.
    // O logout/login refaz a conexão pela próxima assinatura.
    if (evento.code === 1008 || ouvintes.size === 0) return;
    // Espera crescente até 30s: um backend reiniciando não deve receber uma
    // enxurrada de reconexões de todas as abas abertas ao mesmo tempo.
    const espera = Math.min(30_000, 1000 * 2 ** tentativas++);
    reconectarTimer = window.setTimeout(conectar, espera);
  };

  ws.onerror = () => {
    // O `onclose` vem logo depois e cuida da reconexão; aqui só evitamos que o
    // erro suba como exceção não tratada.
  };
}

/**
 * Assina um tópico. Devolve a função de cancelar.
 *
 * Tópicos: `canal:<id>` para mensagens de um canal, `usuario:<id>` para o que é
 * dirigido à pessoa (resposta de agente, por exemplo).
 */
export function assinar(topico: string, ouvinte: Ouvinte): () => void {
  const existentes = ouvintes.get(topico) ?? new Set<Ouvinte>();
  existentes.add(ouvinte);
  ouvintes.set(topico, existentes);

  // Só reconecta quando o conjunto de tópicos muda de verdade: um segundo
  // componente ouvindo o mesmo canal não deve derrubar a conexão.
  const nova = [...ouvintes.keys()].sort().join("|");
  if (nova !== assinaturaAtual || !socket) conectar();

  return () => {
    const conjunto = ouvintes.get(topico);
    conjunto?.delete(ouvinte);
    if (conjunto && conjunto.size === 0) {
      ouvintes.delete(topico);
      // Não reconecta agora: sair de um canal é comum ao navegar, e refazer a
      // conexão a cada troca de tela custaria mais que deixar o tópico órfão
      // até a próxima assinatura.
      assinaturaAtual = "";
    }
    if (ouvintes.size === 0) {
      socket?.close();
      socket = null;
    }
  };
}

/** Fecha tudo — usado no logout, para o token velho não seguir conectado. */
export function encerrarRealtime() {
  ouvintes.clear();
  assinaturaAtual = "";
  socket?.close();
  socket = null;
}
