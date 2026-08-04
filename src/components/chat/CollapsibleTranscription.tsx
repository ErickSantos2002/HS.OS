import React, { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlainMessageContent } from "./MessageContent";

const MAX_LINES = 2;
const LINE_HEIGHT_PX = 18;
const MAX_HEIGHT = MAX_LINES * LINE_HEIGHT_PX;

interface CollapsibleTranscriptionProps {
  text: string;
  className?: string;
}

export default React.memo(function CollapsibleTranscription({ text, className }: CollapsibleTranscriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setNeedsCollapse(el.scrollHeight > MAX_HEIGHT + 4);
  }, [text]);

  return (
    <div className={cn("mt-1", className)}>
      <div
        ref={contentRef}
        className={cn(
          "overflow-hidden transition-[max-height] duration-200 ease-in-out",
          !expanded && needsCollapse && "relative"
        )}
        style={{
          maxHeight: expanded || !needsCollapse ? "none" : `${MAX_HEIGHT}px`,
        }}
      >
        <PlainMessageContent
          text={text}
          highlightMentions
          className="text-xs text-muted-foreground leading-[18px]"
        />
        {!expanded && needsCollapse && (
          <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
        )}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-primary/80 hover:text-primary transition-colors"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Ver menos" : "Ler mais"}
        </button>
      )}
    </div>
  );
});
