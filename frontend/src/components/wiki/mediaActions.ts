// Shared helpers for media actions (preview / download)

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  csv: "text/csv",
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function extOf(name: string): string {
  return (name.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

function openDirectUrl(url: string) {
  const targetUrl = new URL(url, window.location.href).href;
  const opened = window.open(targetUrl, "_blank");
  if (opened) {
    opened.opener = null;
    opened.focus();
    return;
  }

  const a = document.createElement("a");
  a.href = targetUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openHtmlPreviewRoute(url: string, filename: string) {
  const key = `wiki-html-preview:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(key, JSON.stringify({ url, filename }));
  } catch {
    // Query params below keep this working if storage is unavailable.
  }
  const params = new URLSearchParams({ key, url, name: filename });
  openDirectUrl(`/wiki-html-preview?${params.toString()}`);
}

function writePopupLoading(win: Window, filename: string) {
  win.document.open();
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(filename || "Arquivo")}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fff;font:14px system-ui,sans-serif}</style></head><body>Carregando…</body></html>`);
  win.document.close();
  win.focus();
}

/**
 * Opens the URL in a new tab. For file types where Supabase Storage may
 * serve the wrong Content-Type (e.g. .html as text/plain), we re-wrap the
 * blob with the correct MIME so the browser renders it instead of showing
 * raw source.
 */
export async function openPreview(url: string, filename?: string) {
  if (!url) return;
  const name = filename || url.split("/").pop() || "";
  const ext = extOf(name) || extOf(url);
  const mime = MIME_BY_EXT[ext];

  const needsRewrap = ext && ["html", "htm", "svg", "md", "txt", "csv", "xml", "yaml", "yml", "json"].includes(ext);

  if (ext === "html" || ext === "htm") {
    openHtmlPreviewRoute(url, name);
    return;
  }

  if (!needsRewrap) {
    openDirectUrl(url);
    return;
  }

  // Open the tab synchronously to preserve the user gesture (avoids popup block).
  // NOTE: must NOT use noopener — we need to write into the popup.
  const win = window.open("about:blank", "_blank");
  if (win) writePopupLoading(win, name);
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // For SVG/MD/TXT/CSV/etc, blob URL written into the popup (created in popup's context).
    const buf = await res.arrayBuffer();
    if (win) {
      const w = win as unknown as { Blob: typeof Blob; URL: typeof URL };
      const popupBlob = new w.Blob([buf], { type: mime || "application/octet-stream" });
      const popupUrl = w.URL.createObjectURL(popupBlob);
      win.location.href = popupUrl;
    } else {
      const blob = new Blob([buf], { type: mime || "application/octet-stream" });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  } catch (err) {
    console.error("Preview falhou, abrindo URL direta:", err);
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function downloadUrl(url: string, filename?: string) {
  if (!url) return;
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || url.split("/").pop()?.split("?")[0] || "arquivo";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    console.error("Download falhou, abrindo em nova aba:", err);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
