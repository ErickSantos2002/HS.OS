import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

export type RichFormat =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "link"
  | "ul"
  | "ol";

export interface RichComposerHandle {
  focus(): void;
  el(): HTMLDivElement | null;
  getMarkdown(): string;
  getPlainText(): string;
  getCaretPlainOffset(): number;
  setMarkdown(md: string): void;
  insertText(text: string): void;
  /** Replace the `@\w*` token immediately before the caret with `@name ` (with trailing space). */
  replaceMentionTrigger(name: string): void;
  applyFormat(format: RichFormat): void;
  /** True if the caret is currently inside a <li>. */
  isInsideList(): boolean;
}

interface Props {
  initialMarkdown: string;
  onChange: (markdown: string, plainText: string, caretOffset: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}

/* ---------------- Markdown <-> HTML (minimal) ---------------- */

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Very small markdown → HTML used only to hydrate an existing draft. */
export function markdownToHtml(md: string): string {
  if (!md) return "";
  const lines = md.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const flushLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const renderInline = (text: string) => {
    let s = escapeHtml(text);
    // code first to avoid interfering with other syntax
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // links [txt](url)
    s = s.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, t, u) => `<a href="${u}">${t}</a>`,
    );
    // bold **txt**
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic _txt_  (avoid eating snake_case by requiring word boundary)
    s = s.replace(/(^|\W)_([^_ \n]+)_(?=\W|$)/g, "$1<em>$2</em>");
    // strike ~~txt~~
    s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    return s;
  };

  for (const raw of lines) {
    const ulMatch = raw.match(/^\s*[-•]\s+(.*)$/);
    const olMatch = raw.match(/^\s*\d+\.\s+(.*)$/);
    if (ulMatch) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${renderInline(ulMatch[1])}</li>`);
    } else if (olMatch) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${renderInline(olMatch[1])}</li>`);
    } else {
      flushLists();
      if (raw === "") {
        out.push("<div><br></div>");
      } else {
        out.push(`<div>${renderInline(raw)}</div>`);
      }
    }
  }
  flushLists();
  return out.join("");
}

/** HTML → Markdown serializer used on every input and on send. */
export function htmlToMarkdown(root: HTMLElement): string {
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    lines.push(current);
    current = "";
  };

  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/\u00a0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(serialize).join("");
    switch (tag) {
      case "br":
        return "\n";
      case "strong":
      case "b":
        return inner ? `**${inner}**` : "";
      case "em":
      case "i":
        return inner ? `_${inner}_` : "";
      case "s":
      case "del":
      case "strike":
        return inner ? `~~${inner}~~` : "";
      case "code":
        return inner ? `\`${inner}\`` : "";
      case "a": {
        const href = el.getAttribute("href") || "";
        return inner ? `[${inner}](${href})` : "";
      }
      default:
        return inner;
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += (node.textContent ?? "").replace(/\u00a0/g, " ");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      flush();
      return;
    }
    if (tag === "ul" || tag === "ol") {
      if (current.length > 0) flush();
      const ordered = tag === "ol";
      let i = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== "li") continue;
        const content = Array.from(li.childNodes).map(serialize).join("");
        lines.push(`${ordered ? `${i}.` : "-"} ${content}`);
        i++;
      }
      return;
    }
    if (tag === "div" || tag === "p") {
      if (current.length > 0) flush();
      for (const child of Array.from(el.childNodes)) walk(child);
      flush();
      return;
    }
    current += serialize(el);
  };

  for (const child of Array.from(root.childNodes)) walk(child);
  if (current.length > 0) flush();

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/* ---------------- Plain text / caret helpers ---------------- */

function nodePlainLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").length;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return 1;
  let len = 0;
  for (const c of Array.from(el.childNodes)) len += nodePlainLength(c);
  if (
    tag === "div" ||
    tag === "p" ||
    tag === "li" ||
    tag === "ul" ||
    tag === "ol"
  ) {
    len += 1;
  }
  return len;
}

function plainTextOf(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      out += "\n";
      return;
    }
    for (const c of Array.from(el.childNodes)) walk(c);
    if (
      tag === "div" ||
      tag === "p" ||
      tag === "li"
    ) {
      out += "\n";
    }
  };
  for (const c of Array.from(root.childNodes)) walk(c);
  return out;
}

function caretPlainOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return plainTextOf(root).length;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return plainTextOf(root).length;

  let offset = 0;
  let stop = false;
  const walk = (node: Node) => {
    if (stop) return;
    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.endOffset;
        stop = true;
        return;
      }
      const el = node as HTMLElement;
      const kids = Array.from(el.childNodes);
      for (let i = 0; i < range.endOffset && i < kids.length; i++) {
        walk(kids[i]);
      }
      stop = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? "").length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      offset += 1;
      return;
    }
    for (const c of Array.from(el.childNodes)) {
      walk(c);
      if (stop) return;
    }
    if (tag === "div" || tag === "p" || tag === "li") offset += 1;
  };
  walk(root);
  return offset;
}

/* ---------------- Component ---------------- */

const RichComposer = forwardRef<RichComposerHandle, Props>(function RichComposer(
  {
    initialMarkdown,
    onChange,
    onKeyDown,
    onPaste,
    onFocus,
    placeholder,
    disabled,
    className,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(initialMarkdown);
  const lastCaretRef = useRef<number>(0);
  const savedRangeRef = useRef<Range | null>(null);

  const saveSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editorRef.current;
    const saved = savedRangeRef.current;
    if (!el || !saved || !el.contains(saved.commonAncestorContainer)) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(saved);
    return true;
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const md = htmlToMarkdown(el);
    const plain = plainTextOf(el);
    const caret = caretPlainOffset(el);
    lastEmittedRef.current = md;
    lastCaretRef.current = caret;
    onChange(md, plain, caret);
  }, [onChange]);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML === "" && initialMarkdown) {
      el.innerHTML = markdownToHtml(initialMarkdown);
      lastEmittedRef.current = initialMarkdown;
    }
  }, []);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.dataset.placeholder = placeholder;
  }, [placeholder]);

  useImperativeHandle(
    ref,
    (): RichComposerHandle => ({
      focus: () => editorRef.current?.focus(),
      el: () => editorRef.current,
      getMarkdown: () =>
        editorRef.current ? htmlToMarkdown(editorRef.current) : "",
      getPlainText: () =>
        editorRef.current ? plainTextOf(editorRef.current) : "",
      getCaretPlainOffset: () =>
        editorRef.current ? caretPlainOffset(editorRef.current) : 0,
      setMarkdown: (md: string) => {
        const el = editorRef.current;
        if (!el) return;
        el.innerHTML = markdownToHtml(md);
        lastEmittedRef.current = md;
        const plain = plainTextOf(el);
        onChange(md, plain, plain.length);
      },
      insertText: (text: string) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        // Restore the caret position from before focus left the editor
        // (e.g. when the user opened the emoji popover).
        restoreSelection();
        document.execCommand("insertText", false, text);
        saveSelection();
        emit();
      },
      replaceMentionTrigger: (name: string) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const node = range.endContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;
        const text = node.textContent ?? "";
        const upto = text.slice(0, range.endOffset);
        const m = upto.match(/@\w*$/);
        if (!m) return;
        const startOffset = range.endOffset - m[0].length;
        const replacement = `@${name} `;
        const newText =
          text.slice(0, startOffset) + replacement + text.slice(range.endOffset);
        node.textContent = newText;
        const newPos = startOffset + replacement.length;
        const r = document.createRange();
        r.setStart(node, newPos);
        r.setEnd(node, newPos);
        sel.removeAllRanges();
        sel.addRange(r);
        emit();
      },
      applyFormat: (format: RichFormat) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        switch (format) {
          case "bold":
            document.execCommand("bold");
            break;
          case "italic":
            document.execCommand("italic");
            break;
          case "strikethrough":
            document.execCommand("strikeThrough");
            break;
          case "code": {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) break;
            const range = sel.getRangeAt(0);
            if (range.collapsed) {
              const code = document.createElement("code");
              code.appendChild(document.createTextNode("\u200b"));
              range.insertNode(code);
              const r = document.createRange();
              r.setStart(code.firstChild!, 1);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            } else {
              const code = document.createElement("code");
              code.appendChild(range.extractContents());
              range.insertNode(code);
              const r = document.createRange();
              r.setStartAfter(code);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            }
            break;
          }
          case "link": {
            const url = window.prompt("URL do link", "https://");
            if (!url) break;
            document.execCommand("createLink", false, url);
            break;
          }
          case "ul":
            document.execCommand("insertUnorderedList");
            break;
          case "ol":
            document.execCommand("insertOrderedList");
            break;
        }
        emit();
      },
      isInsideList: () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        let node: Node | null = sel.getRangeAt(0).startContainer;
        while (node) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).tagName === "LI"
          ) {
            return true;
          }
          node = node.parentNode;
        }
        return false;
      },
    }),
    [emit, onChange],
  );

  return (
    <div
      ref={editorRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={() => { emit(); saveSelection(); }}
      onKeyUp={() => {
        const el = editorRef.current;
        if (!el) return;
        lastCaretRef.current = caretPlainOffset(el);
        saveSelection();
      }}
      onMouseUp={() => {
        const el = editorRef.current;
        if (!el) return;
        lastCaretRef.current = caretPlainOffset(el);
        saveSelection();
      }}
      onBlur={saveSelection}
      onKeyDown={(e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && !e.shiftKey && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === "b") {
            e.preventDefault();
            document.execCommand("bold");
            emit();
            return;
          }
          if (k === "i") {
            e.preventDefault();
            document.execCommand("italic");
            emit();
            return;
          }
        }
        onKeyDown?.(e);
      }}
      onPaste={(e) => {
        // Let the parent inspect/intercept first (e.g. promote big text to attachment).
        onPaste?.(e);
        if (!e.defaultPrevented && !e.clipboardData.files.length) {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emit();
        }
      }}
      onFocus={() => {
        onFocus?.();
        // iOS/Android já reposicionam o input focado acima do teclado.
        // Não forçamos scrollIntoView aqui — o antigo block:"center" combinado com
        // o paddingBottom do container empurrava o composer para o meio da tela,
        // deixando um espaço vazio enorme entre o input e o teclado.
      }}
      className={`rich-composer ${className ?? ""}`}
      style={{
        minHeight: 22,
        maxHeight: 160,
        overflowY: "auto",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    />

  );
});

export default RichComposer;
