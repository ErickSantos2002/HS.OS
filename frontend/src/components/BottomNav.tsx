import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Bot, MessageSquare, Swords, Settings, Zap } from "lucide-react";
import { useAuthContext } from "@/contexts/auth-context";
import { useNotificationsContext } from "@/components/NotificationsProvider";

interface BottomTab {
  label: string;
  icon: React.ElementType;
  path: string;
  matchPaths: string[];
}

const adminTabs: BottomTab[] = [
  { label: "Chat", icon: MessageSquare, path: "/chat", matchPaths: ["/chat"] },
  { label: "Super agentes", icon: Bot, path: "/agents", matchPaths: ["/agents"] },
  { label: "Automações", icon: Zap, path: "/automacoes", matchPaths: ["/automacoes"] },
  { label: "Config", icon: Settings, path: "/settings", matchPaths: ["/settings", "/users"] },
];

const memberTabs: BottomTab[] = [
  { label: "Chat", icon: MessageSquare, path: "/chat", matchPaths: ["/chat"] },
  { label: "Arenas", icon: Swords, path: "/arenas", matchPaths: ["/arenas"] },
  { label: "Super agentes", icon: Bot, path: "/agents", matchPaths: ["/agents"] },
  { label: "Conhecimento", icon: BookOpen, path: "/base-de-conhecimento", matchPaths: ["/base-de-conhecimento"] },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role } = useAuthContext();
  const { unreadCount } = useNotificationsContext();

  const tabs = role === "super_admin" ? adminTabs : memberTabs;

  const isActive = (tab: BottomTab) =>
    tab.matchPaths.some((p) =>
      p === "/" ? location.pathname === "/" : location.pathname.startsWith(p)
    );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-card/95 backdrop-blur-lg safe-area-bottom">
      <div className="flex items-stretch justify-around h-14">
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <button
              key={tab.path}
              onClick={() => {
                if (tab.path === "/chat" && location.pathname === "/chat") {
                  navigate("/chat", { replace: true });
                } else if (location.pathname === tab.path) {
                  window.dispatchEvent(new CustomEvent("nav-reset-view", { detail: { path: tab.path } }));
                } else {
                  navigate(tab.path);
                }
              }}
              className={`flex flex-col items-center justify-center flex-1 gap-0.5 min-h-[48px] min-w-[44px] transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="relative">
                <tab.icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                {tab.path === "/chat" && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-0.5">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
              <span className={`text-[10px] font-display ${active ? "font-bold" : "font-medium"}`}>
                {tab.label}
              </span>
              {active && (
                <div className="absolute top-0 h-0.5 w-8 bg-primary rounded-b-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
