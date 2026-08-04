/**
 * Extracts code artifacts from markdown text for preview rendering.
 */

const ARTIFACT_FENCE_RE = /```(html|svg|jsx|tsx|react)\s*\n([\s\S]*?)```/i;

export type ArtifactType = "html" | "svg" | "jsx" | "react";

export interface ExtractedArtifact {
  type: ArtifactType;
  code: string;
  /** Markdown text with the artifact fence removed */
  markdownWithout: string;
}

const PREVIEWABLE: Set<string> = new Set(["html", "svg", "jsx", "tsx", "react"]);

/** Detect when agent mentions a file/URL without embedding code */
const FILE_MENTION_RE = /(?:^|\n).*?(?:aqui está|criei|gerei|segue|pronto|arquivo|salvo|criado)[^`\n]*?[`"']?([a-zA-Z0-9_-]+\.html)[`"']?/i;

export function extractArtifact(markdown: string): ExtractedArtifact | null {
  const match = ARTIFACT_FENCE_RE.exec(markdown);
  if (!match) {
    // Fallback: detect file mention without code block
    const fileMention = FILE_MENTION_RE.exec(markdown);
    if (fileMention) {
      const fileName = fileMention[1];
      const fallbackCode = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;}</style></head><body><div style="text-align:center;padding:2rem;"><p style="font-size:1.25rem;margin-bottom:0.5rem;">⚠️ Artefato não embutido</p><p style="color:#888;font-size:0.875rem;">O agente gerou o arquivo <strong>${fileName}</strong> mas não incluiu o código na mensagem.<br/>Peça para ele gerar novamente com o código completo.</p></div></body></html>`;
      const markdownWithout = markdown.replace(fileMention[0], "").trim();
      return { type: "html", code: fallbackCode, markdownWithout };
    }
    return null;
  }

  const rawLang = match[1].toLowerCase();
  const lang: ArtifactType = (rawLang === "tsx" ? "jsx" : rawLang) as ArtifactType;
  const code = match[2].trim();

  if (!code) return null;

  const markdownWithout = markdown.slice(0, match.index).trimEnd() +
    "\n" +
    markdown.slice(match.index + match[0].length).trimStart();

  return { type: lang, code, markdownWithout: markdownWithout.trim() };
}

export function isPreviewableLanguage(lang: string): boolean {
  return PREVIEWABLE.has(lang.toLowerCase());
}

export interface ConversationArtifact {
  type: ArtifactType;
  code: string;
  title: string;
  messageIndex: number;
  messageId: string;
  createdAt: string;
  live?: boolean;
  liveId?: string;
  liveInterval?: number;
}

/**
 * Infer a short descriptive title from artifact code content.
 */
function inferArtifactTitle(type: ArtifactType, code: string, index: number): string {
  // Try to find a component name (function App, const App, class App)
  const componentMatch = code.match(/(?:function|const|class)\s+([A-Z][A-Za-z0-9]+)/);
  if (componentMatch) return componentMatch[1];

  // Try to find a <title> tag
  const titleMatch = code.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim().slice(0, 40);

  // Try to find an <h1> or <h2>
  const headingMatch = code.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
  if (headingMatch) return headingMatch[1].trim().slice(0, 40);

  // Try to find id="root" content or main class
  const mainClassMatch = code.match(/class="([^"]*(?:dashboard|chart|table|form|card|hero|nav|footer|header|app|page|layout)[^"]*)"/i);
  if (mainClassMatch) {
    const keyword = mainClassMatch[1].match(/(dashboard|chart|table|form|card|hero|nav|footer|header|app|page|layout)/i);
    if (keyword) return keyword[1].charAt(0).toUpperCase() + keyword[1].slice(1);
  }

  // Fallback based on type
  const labels: Record<ArtifactType, string> = {
    html: "Página HTML",
    svg: "Ilustração SVG",
    jsx: "Componente React",
    react: "Componente React",
  };
  return `${labels[type]} #${index}`;
}


export function extractAllArtifacts(
  messages: { role: string; content: string; timestamp: string; id?: string }[],
  customTitles?: Record<string, string>
): ConversationArtifact[] {
  const results: ConversationArtifact[] = [];
  let counter = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "agent") continue;

    const artifact = extractArtifact(msg.content);
    if (!artifact) continue;

    counter++;
    // Generate a short descriptive title from code content, overridden by any custom title
    const inferredTitle = inferArtifactTitle(artifact.type, artifact.code, counter);
    const title = customTitles?.[msg.id ?? ""]?.trim() || inferredTitle;

    results.push({
      type: artifact.type,
      code: artifact.code,
      title,
      messageIndex: i,
      messageId: msg.id ?? "",
      createdAt: msg.timestamp,
    });
  }

  return results;
}

/**
 * Build sandboxed HTML for an artifact.
 */
export function buildArtifactHtml(type: ArtifactType, code: string): string {
  if (type === "svg") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;}</style></head><body>${code}</body></html>`;
  }

  if (type === "html") {
    // If it's a full document, use as-is; otherwise wrap
    if (code.includes("<html") || code.includes("<!DOCTYPE")) return code;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"><\/script><style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fff;}</style></head><body>${code}</body></html>`;
  }

  // JSX / React / TSX
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  body { margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fff; }
  * { box-sizing: border-box; }
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
try {
  ${code}
  const _Root = typeof App !== 'undefined' ? App : (typeof Component !== 'undefined' ? Component : null);
  if (_Root) {
    ReactDOM.render(React.createElement(_Root), document.getElementById('root'));
  } else {
    document.getElementById('root').innerHTML = '<div style="padding:2rem;color:#f87171;">Nenhum componente App ou Component encontrado.</div>';
  }
} catch(e) {
  document.getElementById('root').innerHTML = '<div style="padding:2rem;color:#f87171;">Erro: ' + e.message + '</div>';
}
<\/script>
</body>
</html>`;
}
