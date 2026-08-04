import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AppSidebar } from "@/components/AppSidebar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationsProvider } from "@/components/NotificationsProvider";
import { BottomNav } from "@/components/BottomNav";
import { CompanyOnboardingBanner } from "@/components/CompanyOnboardingBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuthContext } from "@/contexts/auth-context";
import { usePresence } from "@/hooks/use-presence";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const { user, profile, signOut } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  usePresence(user?.id);
  useAgentCatalog(); // preload the official agents catalog once authenticated
  // Chat page manages its own bottom layout (composer sits flush above bottom nav)
  const isChatRoute = location.pathname.startsWith("/chat");

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const displayName = profile?.full_name || user?.email || "";

  return (
    <SidebarProvider defaultOpen={false} style={{ "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      <NotificationsProvider>
        <div className="h-[100dvh] flex w-full bg-background overflow-hidden">
          {/* Sidebar: hidden on mobile, icon-only could be set for tablet via CSS */}
          {!isMobile && <AppSidebar />}

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Header: simplified on mobile, respects iOS status bar via safe-area */}
            <header className="relative z-40 flex items-center border-b border-border px-4 shrink-0 bg-card/30 backdrop-blur-sm gap-4 md:gap-4 mobile-safe-top h-12 md:h-12">
              {!isMobile && (
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              )}
              {!isMobile && <Breadcrumbs />}
              {isMobile && (
                <h1 className="text-sm font-display font-bold text-foreground truncate">dn.os</h1>
              )}
              {!isMobile && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 px-4">
                  <div className="pointer-events-auto">
                    <GlobalSearch />
                  </div>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {isMobile && <GlobalSearch compact />}
                <ThemeToggle />
                {isMobile && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="Menu do usuário"
                        className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 hover:bg-primary/30 transition-colors"
                      >
                        <User className="h-4 w-4 text-primary" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                        {displayName}
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
                )}
              </div>
            </header>

            <main className={`flex-1 min-h-0 ${isChatRoute ? "overflow-hidden" : "overflow-auto"} ${isMobile && !isChatRoute ? "mobile-bottom-offset" : ""} ${isMobile && isChatRoute ? "mobile-chat-bottom" : ""}`}>
              {!isChatRoute && <CompanyOnboardingBanner />}
              {children}
            </main>
          </div>

          {/* Bottom Nav: mobile only */}
          {isMobile && <BottomNav />}
        </div>
      </NotificationsProvider>
    </SidebarProvider>
  );
}
