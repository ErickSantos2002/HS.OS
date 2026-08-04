interface Props {
  emoji: string | null | undefined;
  label?: string | null;
  /** Tailwind size class for the badge container. Default: h-4 w-4 */
  className?: string;
}

/**
 * Small emoji badge overlaid on the bottom-right of an avatar.
 * Render it as a sibling inside a `relative` parent.
 */
export function UserStatusBadge({ emoji, label, className }: Props) {
  if (!emoji) return null;
  return (
    <span
      title={label ?? undefined}
      className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-background ring-1 ring-border/60 text-[10px] leading-none shadow-sm ${className ?? "h-4 w-4"}`}
      aria-label={label ? `Status: ${label}` : "Status"}
    >
      {emoji}
    </span>
  );
}
