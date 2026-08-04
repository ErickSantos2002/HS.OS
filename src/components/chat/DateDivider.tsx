import { getDateDividerLabel } from "@/lib/chat-date-groups";
import { cn } from "@/lib/utils";

interface DateDividerProps {
  date: string | Date;
  className?: string;
}

export default function DateDivider({ date, className }: DateDividerProps) {
  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <div className="h-px flex-1 bg-border/60" />
      <div className="rounded-full border border-border/60 bg-card/75 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-md">
        {getDateDividerLabel(date)}
      </div>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}