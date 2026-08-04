import { useUserStatus } from "@/hooks/use-user-status";
import { USER_STATUS_PRESETS, formatStatusAge } from "@/lib/user-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserCircle2, Check, X } from "lucide-react";

interface Props {
  /** Optional trigger override. Defaults to a small chip showing current status. */
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  variant?: "default" | "header-chip";
  /** Hide the text label, show only emoji/icon. Useful for mobile headers. */
  compact?: boolean;
}

export function UserStatusPicker({ children, align = "start", variant = "default", compact = false }: Props) {
  const { status, setUserStatus, clearUserStatus } = useUserStatus();

  // Highlight stale status (>1h) to gently remind the user it's still active.
  const stale = status ? Date.now() - new Date(status.setAt).getTime() > 60 * 60 * 1000 : false;

  const headerChipTrigger = (
    <button
      className={
        status
          ? `inline-flex items-center gap-1.5 rounded-full border ${compact ? "px-2 py-1" : "px-2.5 py-1"} text-xs transition-colors ${
              stale
                ? "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300 hover:bg-amber-400/20 animate-pulse"
                : "border-border/50 bg-secondary/40 text-foreground hover:bg-secondary/70"
            }`
          : `inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-secondary/30 ${compact ? "px-2 py-1" : "px-2.5 py-1"} text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors`
      }
      title={
        status
          ? `${status.emoji} ${status.label} · ${formatStatusAge(status.setAt)}`
          : "Definir seu status"
      }
      aria-label={status ? `Status: ${status.label}` : "Definir seu status"}
    >
      {status ? (
        <>
          <span aria-hidden>{status.emoji}</span>
          {!compact && <span className="truncate max-w-[110px]">{status.label}</span>}
        </>
      ) : (
        <>
          <UserCircle2 className="h-4 w-4" strokeWidth={2.25} />
          {!compact && <span>Seu status</span>}
        </>
      )}
    </button>

  );

  const defaultTrigger = (
    <button
      className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-secondary/30 px-2 py-1 text-xs text-foreground hover:bg-secondary/60 transition-colors"
      title="Definir status"
    >
      {status ? (
        <>
          <span aria-hidden>{status.emoji}</span>
          <span className="truncate max-w-[120px]">{status.label}</span>
        </>
      ) : (
        <>
          <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.25} />
          <span className="text-muted-foreground">Seu status</span>
        </>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children ?? (variant === "header-chip" ? headerChipTrigger : defaultTrigger)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-72 p-2 bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl dark:bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.25),transparent_55%),linear-gradient(160deg,hsl(225_45%_10%),hsl(225_55%_6%))] dark:border-primary/20"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground px-2 pt-1 pb-2">
          Seu status
        </DropdownMenuLabel>
        <div className="space-y-1">
          {USER_STATUS_PRESETS.map((preset) => {
            const active = status?.label === preset.label;
            return (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => void setUserStatus(preset)}
                className={`group flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors focus:bg-accent hover:bg-accent ${
                  active ? "bg-primary/10 ring-1 ring-primary/30" : ""
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition-colors ${
                    active
                      ? "bg-primary/20 ring-1 ring-primary/40"
                      : "bg-primary/10 ring-1 ring-primary/20 group-hover:bg-primary/15"
                  }`}
                  aria-hidden
                >
                  {preset.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {preset.label}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {preset.description}
                  </div>
                </div>
                {active && <Check className="h-4 w-4 text-primary shrink-0" />}
              </DropdownMenuItem>
            );
          })}
        </div>
        {status && (
          <>
            <DropdownMenuSeparator className="my-2 bg-border" />
            <DropdownMenuItem
              onClick={() => void clearUserStatus()}
              className="flex items-center gap-2 p-2 rounded-xl text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 ring-1 ring-destructive/20">
                <X className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">Limpar status</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
