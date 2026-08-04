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