import { useEffect, useState } from "react";
import { NavLink } from "@/components/NavLink";
import { useBranding, useThemedLogo, useThemedMark } from "@/hooks/use-branding";
import { useTheme } from "next-themes";
import logoClaro from "@/assets/hs-os-logo.png";
import marcaClara from "@/assets/hs-mark.png";
import marcaEscura from "@/assets/hs-mark.png";
import { useAuthContext } from "@/contexts/auth-context";
import type { AppRole } from "@/hooks/use-auth";
import { APP_VERSION, formatBuildDate } from "@/lib/app-version";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  BookOpen,
  Bot,
  Settings,
  Zap,
  Radio,
  BarChart2,
  MonitorPlay,
  Swords,
  Plug,
  Puzzle,
  User,
  LogOut,
  ChevronUp,
  Check,
  X as XIcon,
  ListChecks,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { useUserStatus } from "@/hooks/use-user-status";
import { UserStatusBadge } from "@/components/UserStatusBadge";
import { USER_STATUS_PRESETS } from "@/lib/user-status";

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const memberGroups: NavGroup[] = [
  {
    items: [
      { title: "Chat", url: "/chat", icon: MessageSquare },
      { title: "Arenas", url: "/arenas", icon: Swords },
      { title: "Super agentes", url: "/agents", icon: Bot },
      { title: "Tasks", url: "/tasks", icon: ListChecks },
      { title: "Artefatos Vivos", url: "/artefatos", icon: Radio },
      { title: "Conhecimento", url: "/base-de-conhecimento", icon: BookOpen },
    ],
  },
];


const adminGroups: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { title: "Chat", url: "/chat", icon: MessageSquare },
      { title: "Arenas", url: "/arenas", icon: Swords },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "Super agentes", url: "/agents", icon: Bot },
      { title: "Tasks", url: "/tasks", icon: ListChecks },
      { title: "Automações", url: "/automacoes", icon: Zap },
      { title: "Artefatos Vivos", url: "/artefatos", icon: Radio },
      { title: "Conhecimento", url: "/base-de-conhecimento", icon: BookOpen },
    ],
  },

  {
    label: "Sistema",
    items: [
      { title: "Conectores", url: "/settings?tab=integrations", icon: Plug },
      { title: "Skills", url: "/skills", icon: Puzzle },
      { title: "Analytics", url: "/analytics", icon: BarChart2 },
      // Abre em aba separada: a war room é uma tela cheia que fica espelhada
      // na TV, não uma seção que se navega dentro do app.
      { title: "War room", url: "/warroom", icon: MonitorPlay },
      { title: "Configurações", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { branding } = useBranding();
  const themedLogo = useThemedLogo();
  const themedMark = useThemedMark();
  const { resolvedTheme } = useTheme();
  const [isLight, setIsLight] = useState(resolvedTheme === "light");

  useEffect(() => {
    const t = setTimeout(() => setIsLight(resolvedTheme === "light"), 1000);
    return () => clearTimeout(t);
  }, [resolvedTheme]);
  const { role, profile, user, signOut } = useAuthContext();
  const { unreadCount } = useNotificationsContext();
  const { status: userStatus, setUserStatus, clearUserStatus } = useUserStatus();

  const navigate = useNavigate();

  const groups: NavGroup[] = role === "super_admin" ? adminGroups : memberGroups;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const displayName = profile?.full_name || user?.email || "";

  const renderNavItem = (item: NavItem) => {
    const isChatItem = item.url === "/chat";
    const showBadge = isChatItem && unreadCount > 0;
    // For querystring routes, NavLink "to" needs path only; matching uses pathname.
    const [path] = item.url.split("?");

    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild className={collapsed ? "!w-full !max-w-none mx-auto justify-center" : ""}>
          <NavLink
            to={item.url}
            end={path === "/"}
            className={`flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-3"} py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150 ${collapsed ? "" : "border-l-2 border-transparent"}`}
            activeClassName={collapsed ? "bg-primary/10 text-primary font-semibold" : "bg-primary/10 text-primary !border-primary font-semibold"}
          >
            <span className="relative">
              <item.icon className="h-4 w-4 shrink-0" />
              {showBadge && collapsed && (
                <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
            </span>
            {!collapsed && (
              <>
                <span className="text-sm flex-1">{item.title}</span>
                {showBadge && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className={collapsed ? "p-2" : "p-4"}>
        <div className="flex items-center justify-center gap-2">
          {collapsed ? (
            <img
              src={themedMark || "/icons/icon-192.png"}
              alt={branding.companyName || "HS.OS"}
              className="h-9 w-9 object-contain shrink-0 rounded-md"
            />
          ) : themedLogo ? (
            <img
              src={themedLogo}
              alt={branding.companyName || "HS.OS"}
              className="h-[42px] w-auto object-contain shrink-0"
            />
          ) : isLight ? (
            <img
              src={logoClaro}
              alt={branding.companyName || "HS.OS"}
              className="h-9 w-auto object-contain shrink-0"
            />

          ) : (
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
          )}
        </div>
      </SidebarHeader>


      <SidebarContent>
        {groups.map((group, idx) => (
          <SidebarGroup key={group.label ?? `g-${idx}`}>
            {group.label && !collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-display">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(renderNavItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <div className="relative h-7 w-7 shrink-0">
                <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden ring-1 ring-primary/30">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
                <UserStatusBadge emoji={userStatus?.emoji ?? null} label={userStatus?.label} className="h-3.5 w-3.5" />
              </div>

              {!collapsed && (
                <>
                  <span className="truncate text-xs flex-1 text-left flex flex-col leading-tight">
                    <span className="truncate">{displayName}</span>
                    {userStatus && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {userStatus.emoji} {userStatus.label}
                      </span>
                    )}
                  </span>
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-display">
              Status
            </div>
            <div className="max-h-60 overflow-y-auto px-1">
              {USER_STATUS_PRESETS.map((preset) => {
                const active = userStatus?.label === preset.label;
                return (
                  <button
                    key={preset.id}
                    onClick={() => void setUserStatus(preset)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary"}`}
                  >
                    <span className="text-base leading-none w-5 text-center" aria-hidden>
                      {preset.emoji}
                    </span>
                    <span className="flex-1 truncate text-left">{preset.label}</span>
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
              {userStatus && (
                <button
                  onClick={() => void clearUserStatus()}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <XIcon className="h-3.5 w-3.5" />
                  <span>Limpar status</span>
                </button>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings?tab=profile")}>
              <User className="h-4 w-4 mr-2" />
              Meu Perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!collapsed && (
          <div className="space-y-1.5">
            <div className="glass-card px-3 py-2 flex items-center gap-2">
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-success" />
                <div className="absolute inset-0 h-2 w-2 rounded-full bg-success animate-ping opacity-40" />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">Gateway Online</span>
            </div>
            <div
              className="px-3 py-1 flex items-center justify-between text-[10px] text-muted-foreground/70 font-mono"
              title={`Build: ${formatBuildDate()}`}
            >
              <span>HS.OS</span>
              <span className="truncate">{APP_VERSION}</span>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
