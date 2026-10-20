import { format, isSameDay, isToday, isValid, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

function toDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return isValid(date) ? date : new Date();
}

export function shouldShowDateDivider(current: string | Date, previous?: string | Date | null) {
  if (!previous) return true;
  return !isSameDay(toDate(current), toDate(previous));
}

export function getDateDividerLabel(value: string | Date) {
  const date = toDate(value);

  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";

  const currentYear = new Date().getFullYear();
  const formatPattern = date.getFullYear() === currentYear ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy";

  return format(date, formatPattern, { locale: ptBR });
}
/** Janela em que uma mensagem ainda "continua" a anterior do mesmo autor. */
export const JANELA_DE_SEQUENCIA_MS = 5 * 60 * 1000;

type MensagemDaSequencia = { author_id: string; created_at: string | Date };

/**
 * A mensagem continua a anterior — e por isso sai sem foto e sem nome — quando
 * é do mesmo autor, do mesmo dia e chegou em até cinco minutos. Igual ao
 * WhatsApp: quem manda cinco linhas seguidas não ganha cinco cabeçalhos.
 */
export function continuaSequencia(atual: MensagemDaSequencia, anterior?: MensagemDaSequencia | null) {
  if (!anterior || anterior.author_id !== atual.author_id) return false;
  if (shouldShowDateDivider(atual.created_at, anterior.created_at)) return false;
  const intervalo = toDate(atual.created_at).getTime() - toDate(anterior.created_at).getTime();
  return intervalo >= 0 && intervalo <= JANELA_DE_SEQUENCIA_MS;
}
