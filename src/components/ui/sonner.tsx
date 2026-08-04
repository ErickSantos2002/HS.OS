import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      expand
      richColors
      toastOptions={{
        classNames: {
          toast:
            "group toast overflow-hidden rounded-2xl border border-border/50 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--secondary)/0.72))] text-foreground shadow-[0_18px_60px_-24px_hsl(var(--primary)/0.8),0_0_0_1px_hsl(var(--background)/0.35)_inset] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_48%)] before:content-[''] group-[.toaster]:w-[380px]",
          title: "font-display text-sm font-semibold text-foreground",
          description: "text-sm leading-snug text-muted-foreground",
          actionButton: "rounded-xl border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))] px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.85)] hover:opacity-90",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
