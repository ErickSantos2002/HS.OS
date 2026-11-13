/**
 * Os ícones dos assuntos da "Capacidade" do Guardi. O backend manda o NOME
 * (`ICONES` em `backend/app/capacidade_assuntos.py`); aqui ele vira o
 * componente. Nome desconhecido cai no `CircleHelp` — o teste
 * `capacidade.test.ts` confere que as duas listas batem.
 */
import {
  AlarmClock, AlertTriangle, Bell, BookOpen, Brain, Briefcase, Building2, CalendarClock, CalendarDays,
  CircleHelp, ClipboardList, Clock, FileText, FlaskConical, Gauge, Gift, GraduationCap, Inbox, Kanban,
  Landmark, LayoutDashboard, ListChecks, ListTodo, Megaphone, MessagesSquare, Package, Plane, Receipt,
  ShoppingCart, Target, TrendingUp, Truck, Users, Wallet, Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONES: Record<string, LucideIcon> = {
  "list-checks": ListChecks, kanban: Kanban, "alarm-clock": AlarmClock, plane: Plane, clock: Clock,
  target: Target, "messages-square": MessagesSquare, "graduation-cap": GraduationCap, gift: Gift,
  building: Building2, megaphone: Megaphone, wallet: Wallet, "trending-up": TrendingUp, "file-text": FileText,
  landmark: Landmark, "alert-triangle": AlertTriangle, users: Users, package: Package,
  "shopping-cart": ShoppingCart, "book-open": BookOpen, "list-todo": ListTodo, gauge: Gauge, truck: Truck,
  "clipboard-list": ClipboardList, flask: FlaskConical, receipt: Receipt, briefcase: Briefcase,
  "calendar-clock": CalendarClock, wrench: Wrench, "layout-dashboard": LayoutDashboard, brain: Brain,
  bell: Bell, inbox: Inbox, "calendar-days": CalendarDays,
};

export const ICONES_CONHECIDOS = Object.keys(ICONES);

export function iconeDoAssunto(nome: string): LucideIcon {
  return ICONES[nome] ?? CircleHelp;
}
