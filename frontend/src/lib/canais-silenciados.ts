/**
 * Canais que eu silenciei — estado de módulo, para quem não é React
 * (`use-notifications`) também saber (spec 2026-11-03, `025_silenciar_canal`).
 *
 * Silenciar corta push, som, notificação local e o toast do canal. O sininho e
 * o contador de não lidas continuam (esclarecimento 5). Menção a mim e
 * `@todos` furam, como no push (`app/push_regras.py`).
 *
 * Quem enche é o `useCanaisSilenciados`, montado pelo `NotificationsProvider`.
 */
import { hasEveryoneMention } from "@/lib/channel-notifications";

let silenciados = new Set<string>();
let meuNome = "";
const ouvintes = new Set<() => void>();

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function definirSilenciados(ids: Iterable<string>): void {
  silenciados = new Set(ids);
  ouvintes.forEach((f) => f());
}

export function definirMeuNome(nome: string | null | undefined): void {
  meuNome = normalizar((nome ?? "").trim());
}

export function estaSilenciado(channelId: string | null | undefined): boolean {
  return !!channelId && silenciados.has(channelId);
}

export function listaDeSilenciados(): string[] {
  return [...silenciados];
}

export function ouvirSilenciados(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

function mencionaMe(texto: string): boolean {
  if (!meuNome) return false;
  const t = normalizar(texto);
  let i = t.indexOf(`@${meuNome}`);
  while (i >= 0) {
    const depois = t.charAt(i + 1 + meuNome.length);
    if (!depois || !/[\p{L}\p{N}_]/u.test(depois)) return true;
    i = t.indexOf(`@${meuNome}`, i + 1);
  }
  return false;
}

/** A notificação deste canal deve ficar sem som, toast e notificação local? */
export function deveCalar(channelId: string | null | undefined, previa: string): boolean {
  if (!estaSilenciado(channelId)) return false;
  return !(hasEveryoneMention(previa || "") || mencionaMe(previa || ""));
}
