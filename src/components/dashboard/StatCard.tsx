import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  gradient: string;
}

export default function StatCard({ label, value, sub, icon: Icon, trend, trendValue, gradient }: StatCardProps) {
  return (
    <div className="glass-card p-3 md:p-5 space-y-2 md:space-y-3 rounded-2xl">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5 md:space-y-1 min-w-0 flex-1">
          <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg md:text-2xl font-bold font-display text-foreground">{value}</p>
          {(trendValue || sub) && (
            <p className="text-[10px] md:text-xs text-muted-foreground flex items-center gap-1">
              {trendValue && (
                <span className={trend === "up" ? "text-success font-semibold" : trend === "down" ? "text-destructive font-semibold" : "text-muted-foreground"}>
                  {trendValue}
                </span>
              )}
              {sub && <span className="truncate">{sub}</span>}
            </p>
          )}
        </div>
        <div className={`h-9 w-9 md:h-11 md:w-11 rounded-xl ${gradient} flex items-center justify-center shadow-lg shrink-0`}>
          <Icon className="h-4 w-4 md:h-5 md:w-5 text-foreground" />
        </div>
      </div>
    </div>
  );
}
