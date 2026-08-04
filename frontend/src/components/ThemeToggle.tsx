import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "group relative h-9 w-9 shrink-0 flex-none overflow-hidden rounded-full border border-border/50 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--secondary)/0.52))] text-muted-foreground shadow-[0_0_24px_-14px_hsl(var(--primary)/0.8),inset_0_1px_0_hsl(var(--background)/0.45)] backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:text-foreground hover:shadow-[0_0_32px_-12px_hsl(var(--primary)/0.95),inset_0_1px_0_hsl(var(--background)/0.6)] focus-visible:ring-primary/40 focus-visible:ring-offset-0",
        className,
      )}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
    >
      <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.24),transparent_65%)] opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(135deg,transparent,hsl(var(--primary)/0.12),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="relative z-10">
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </span>
    </Button>
  );
}