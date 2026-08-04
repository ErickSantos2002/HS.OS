import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MarkdownMessageContent } from "@/components/chat/MessageContent";
import { cn } from "@/lib/utils";

// Threshold in characters above which the agent bubble is initially collapsed.
// Messages longer than COLLAPSE_HARD_CAP are considered long-form and are
// rendered fully expanded (they typically go through the document / artifact
// path anyway).
const COLLAPSE_MIN = 700;
const COLLAPSE_HARD_CAP = 5000;
const COLLAPSED_MAX_HEIGHT_PX = 140;

interface CollapsibleMarkdownProps {
  text: string;
  className?: string;
}

export default function CollapsibleMarkdown({ text, className }: CollapsibleMarkdownProps) {
  const len = text.length;
  const shouldCollapse = len > COLLAPSE_MIN && len <= COLLAPSE_HARD_CAP;
  const [expanded, setExpanded] = useState(false);

  if (!shouldCollapse) {
    return <MarkdownMessageContent text={text} className={className} />;
  }

  return (
    <div>
      <div
        className={cn(
          "overflow-hidden transition-[max-height] duration-200 ease-in-out",
          !expanded && "relative",
        )}
        style={{ maxHeight: expanded ? "none" : `${COLLAPSED_MAX_HEIGHT_PX}px` }}
      >
        <MarkdownMessageContent text={text} className={className} />
        {!expanded && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-secondary/90 to-transparent" />
        )}
      </div>
      <button
        type="button"
        data-collapsible-toggle={expanded ? "collapse" : "expand"}
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex items-center gap-0.5 text-xs font-medium text-primary/80 hover:text-primary transition-colors"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
        {expanded ? "Mostrar menos" : "Mostrar mais"}
      </button>
    </div>
  );
}
