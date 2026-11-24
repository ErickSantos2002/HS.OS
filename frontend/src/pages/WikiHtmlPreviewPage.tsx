import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { chaveDaPrevia, enderecoDaPrevia } from "@/lib/previa-html";

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

function withBaseHref(html: string, fileUrl: string): string {
  if (/<base\s/i.test(html)) return html;
  const base = `<base href="${escapeAttr(fileUrl)}">`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  return `${base}${html}`;
}

export default function WikiHtmlPreviewPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [title, setTitle] = useState(params.get("name") || "Arquivo HTML");
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // ⚠️ PK-01 (24/11/2026): só a chave de uso único que o openPreview grava.
    // Antes `?key=` apagava QUALQUER chave do localStorage — `?key=hsos.token`
    // deslogava quem clicasse no link, e esta rota é pública.
    const key = chaveDaPrevia(params.get("key"));
    let stored: { url?: string; filename?: string } | null = null;

    try {
      const raw = key ? localStorage.getItem(key) : null;
      stored = raw ? JSON.parse(raw) : null;
      if (key) localStorage.removeItem(key);
    } catch {
      stored = null;
    }

    const pedido = (typeof stored?.url === "string" && stored.url) || params.get("url") || "";
    const filename = (typeof stored?.filename === "string" && stored.filename) || params.get("name") || "Arquivo HTML";
    setTitle(filename);
    document.title = filename;

    if (!pedido) {
      setError("Arquivo não encontrado.");
      return;
    }

    // ⚠️ PK-01: só arquivo do storage da API ou da própria origem. `?url=` de
    // qualquer site virava página em tela cheia com o endereço do HS.OS —
    // um login falso pronto, numa rota sem login.
    const fileUrl = enderecoDaPrevia(pedido, window.location.origin, import.meta.env.VITE_API_URL || "/api");
    if (!fileUrl) {
      setError("Endereço não permitido");
      return;
    }

    fetch(fileUrl, { credentials: "omit" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((html) => {
        if (!cancelled) setSrcDoc(withBaseHref(html, fileUrl));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {srcDoc ? (
        <iframe
          srcDoc={srcDoc}
          title={title}
          className="h-screen w-screen border-0 bg-background"
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          {error ? (
            <p className="text-sm text-destructive">Não foi possível abrir o HTML: {error}</p>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Carregando HTML…</p>
            </>
          )}
        </div>
      )}
    </main>
  );
}