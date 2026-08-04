import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PlainMessageContent } from "@/components/chat/MessageContent";
import { cn } from "@/lib/utils";

const COLLAPSE_MIN = 700;
const COLLAPSED_MAX_HEIGHT_PX = 140;

interface CollapsiblePlainTextProps {
  text: string;
  className?: string;
}

export default function CollapsiblePlainText({ text, className }: CollapsiblePlainTextProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = text.length > COLLAPSE_MIN;

  if (!shouldCollapse) {
    return <PlainMessageContent text={text} className={className} />;
  }

  return (
    <div>
      <div
        className={cn("overflow-hidden transition-[max-height] duration-200 ease-in-out", !expanded && "relative")}
        style={{ maxHeight: expanded ? "none" : `${COLLAPSED_MAX_HEIGHT_PX}px` }}
      >
        <PlainMessageContent text={text} className={className} />
      </div>
      <button
        type="button"
        data-collapsible-toggle={expanded ? "collapse" : "expand"}
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex items-center gap-0.5 text-xs font-medium underline underline-offset-2 opacity-90 hover:opacity-100 transition-opacity"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
        {expanded ? "Mostrar menos" : "Mostrar mais"}
      </button>
    </div>
  );
}
