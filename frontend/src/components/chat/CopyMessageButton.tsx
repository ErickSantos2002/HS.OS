import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

const actionClassName = "inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-secondary/20 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground";

export default function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={actionClassName}
      title={copied ? "Copiado!" : "Copiar mensagem"}
      aria-label={copied ? "Mensagem copiada" : "Copiar mensagem"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
