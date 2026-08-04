import React, { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Check, Copy, Eye } from "lucide-react";

import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const URL_REGEX = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]\}])/gi;
const MENTION_REGEX = /(@\w+)/g;
const PREVIEWABLE_LANGS = new Set(["html", "jsx", "tsx"]);

function LinkAnchor({ href, children }: { href?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-inherit underline decoration-current/60 underline-offset-4 transition-opacity hover:opacity-80 [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
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
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function CodePreviewDialog({ code, open, onOpenChange }: { code: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[70vh]">
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
        </DialogHeader>
        <iframe
          srcDoc={code}
          title="Code preview"
          className="flex-1 w-full h-full rounded-lg border border-border/40 bg-white"
          sandbox="allow-scripts allow-downloads"
        />
      </DialogContent>
    </Dialog>
  );
}

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1] || "";
  const codeString = extractText(children);
  const canPreview = PREVIEWABLE_LANGS.has(language);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/40 bg-[hsl(var(--card))]/60">
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/40 px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {canPreview && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Eye className="h-3 w-3" />
              Ver Preview
            </button>
          )}
          <CopyButton text={codeString} />
        </div>
      </div>
      <pre className="!m-0 !rounded-none !border-0 overflow-x-auto p-3 text-sm leading-relaxed">
        <code className={cn(className, "!bg-transparent !p-0")}>{children}</code>
      </pre>
      {canPreview && (
        <CodePreviewDialog code={codeString} open={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const markdownContentClassName =
  "max-w-none min-w-0 break-words text-inherit text-sm leading-relaxed [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere] [&_strong]:font-semibold [&_em]:italic [&_s]:line-through [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_li]:my-0.5 [&_li]:pl-1 [&_li]:marker:text-current [&_table]:border [&_table]:border-collapse [&_table]:w-full [&_table]:border-border [&_thead]:border-b-2 [&_thead]:border-border [&_th]:border [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm";

function renderMentions(text: string) {
  return text.split(MENTION_REGEX).map((part, index) =>
    part.startsWith("@") ? (
      <span key={`${part}-${index}`} className="font-semibold text-primary">
        {part}
      </span>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

function renderLinkedText(text: string, highlightMentions: boolean) {
  const parts = text.split(URL_REGEX);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.match(URL_REGEX)) {
      return <LinkAnchor key={`${part}-${index}`} href={part}>{part}</LinkAnchor>;
    }

    return (
      <span key={`${part}-${index}`}>
        {highlightMentions ? renderMentions(part) : part}
      </span>
    );
  });
}

function autolinkMarkdown(text: string) {
  const existingMarkdownLinkPattern = /\[[^\]]*\]\([^\s)]+\)/g;
  const protectedLinks: string[] = [];

  const protectedText = text.replace(existingMarkdownLinkPattern, (match) => {
    const token = `__MD_LINK_${protectedLinks.length}__`;
    protectedLinks.push(match);
    return token;
  });

  const linkedText = protectedText.replace(URL_REGEX, (url, _match, offset, source) => {
    const before = source.slice(Math.max(0, offset - 3), offset);
    if (before.includes("](") || before.endsWith("\"") || before.endsWith("'") || before.endsWith("(")) {
      return url;
    }
    return `[${url}](${url})`;
  });

  return linkedText.replace(/__MD_LINK_(\d+)__/g, (_, index) => protectedLinks[Number(index)] ?? "");
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n/g, "\n");
}

export const PlainMessageContent = React.memo(function PlainMessageContent({
  text,
  className,
  highlightMentions = false,
}: {
  text: string;
  className?: string;
  highlightMentions?: boolean;
}) {
  const normalized = text.replace(/^\s+/, "").replace(/\n[ \t]+/g, "\n");
  return (
    <p className={cn("min-w-0 whitespace-pre-wrap break-words", className)}>
      {renderLinkedText(normalized, highlightMentions)}
    </p>
  );
});

/** Shared text prep used by both final and streaming renderers */
function prepareMarkdownText(text: string, autolink = true) {
  const normalized = normalizeLineEndings(text).replace(/^\s+/, "").replace(/\n[ \t]+/g, "\n");
  return autolink ? autolinkMarkdown(normalized) : normalized;
}

export const MarkdownMessageContent = React.memo(function MarkdownMessageContent({ text, className, highlightMentions = false }: { text: string; className?: string; highlightMentions?: boolean }) {
  return (
    <div className={cn(markdownContentClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={highlightMentions ? markdownComponentsWithMentions : markdownComponents}
      >
        {prepareMarkdownText(text)}
      </ReactMarkdown>
    </div>
  );
});

/** Lightweight markdown for streaming — same pipeline as final */
export const StreamingMarkdownContent = React.memo(function StreamingMarkdownContent({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn(markdownContentClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {prepareMarkdownText(text)}
      </ReactMarkdown>
    </div>
  );
});

function mapTextChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") return <>{renderMentions(child)}</>;
    return child;
  });
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children: React.ReactNode }) => <LinkAnchor href={href}>{children}</LinkAnchor>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 break-words [overflow-wrap:anywhere] last:mb-0">{children}</p>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="break-words [overflow-wrap:anywhere]">{children}</li>,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ className: codeClassName, children, ...props }: { className?: string; children?: React.ReactNode }) => {
    const isBlock = codeClassName?.includes("language-") || codeClassName?.includes("hljs");
    if (isBlock) {
      return <CodeBlock className={codeClassName}>{children}</CodeBlock>;
    }
    return (
      <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[0.85em] break-words [overflow-wrap:anywhere]" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/60 bg-background/20">
      <table className="w-full">{children}</table>
    </div>
  ),
};

const markdownComponentsWithMentions = {
  ...markdownComponents,
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 break-words [overflow-wrap:anywhere] last:mb-0">{mapTextChildren(children)}</p>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="break-words [overflow-wrap:anywhere]">{mapTextChildren(children)}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong>{mapTextChildren(children)}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em>{mapTextChildren(children)}</em>,
};
