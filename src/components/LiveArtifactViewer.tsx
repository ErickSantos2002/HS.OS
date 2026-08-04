import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";
import {
  Zap, X, RefreshCw, Pause, Code as CodeIcon, Link2, Trash2, Save, Loader2, ArrowLeft,
  Maximize2, Minimize2, Copy, Check, Download, ChevronDown, MoreVertical, Globe, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { exportArtifactAsPdf, exportArtifactAsDocx } from "@/lib/artifact-export";

interface LiveArtifact {
  id: string;
  user_id: string;
  agent_id: string | null;
  title: string;
  description: string | null;
  html_content: string;
  refresh_interval: number;
  is_published: boolean;
  published_slug: string | null;
  is_public: boolean;
  expires_at: string | null;
  last_refreshed_at: string | null;
  updated_at: string;
}

const LIVE_INTERVALS = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1min", value: 60 },
  { label: "5min", value: 300 },
  { label: "Manual", value: 0 },
];

const FALLBACK_DATA_ENDPOINTS: Record<string, string[]> = {
  meta: ["insights", "campaigns"],
};

function buildBridge(args: {
  user: { id: string; email: string; role: string; name: string } | null;
  refreshInterval: number;
  publicMode: boolean;
  integrations: Array<{ integration_type: string; endpoints: string[] }>;
}): string {
  const publicMode = args.publicMode ? "true" : "false";

  // Generate window.dnos.<integration>.<endpoint>(params) modules dynamically.
  // These are the canonical way agents call external APIs — internally they
  // route through window.dnos.invoke, which posts to the parent viewer.
  const integrationModules = args.integrations
    .map(({ integration_type, endpoints }) => {
      const safeType = integration_type.replace(/[^a-z0-9_]/gi, "_");
      const methods = endpoints
        .map(
          (ep) =>
            `    ${JSON.stringify(ep)}: function(params){ return window.dnos.invoke(${JSON.stringify(integration_type)}, { endpoint: ${JSON.stringify(ep)}, params: params || {} }); }`,
        )
        .join(",\n");
      return `  window.dnos[${JSON.stringify(safeType)}] = {\n${methods}\n  };`;
    })
    .join("\n");

  return `<script>
(function () {
  var pending = {};
  window.dnos = {
    user: ${JSON.stringify(args.user)},
    refreshInterval: ${args.refreshInterval},
    lastRefreshed: new Date(),
    _cb: [],
    query: function (table, options) {
      return new Promise(function (resolve, reject) {
        var id = Math.random().toString(36).slice(2);
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: 'dnos_query', id: id, table: table, options: options || {} }, '*');
      });
    },
    invoke: function (integration, options) {
      return new Promise(function (resolve, reject) {
        if (${publicMode}) { reject(new Error('Integrações não disponíveis no modo público.')); return; }
        var id = Math.random().toString(36).slice(2);
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'dnos_invoke', id: id,
          integration: integration,
          endpoint: (options || {}).endpoint,
          params: (options || {}).params || {}
        }, '*');
      });
    },
    onRefresh: function (cb) { this._cb.push(cb); },
    _triggerRefresh: function () {
      this.lastRefreshed = new Date();
      for (var i = 0; i < this._cb.length; i++) { try { this._cb[i](); } catch (e) { console.error(e); } }
    }
  };
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'dnos_query_result' || d.type === 'dnos_invoke_result') {
      var p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      if (d.error) p.reject(new Error(d.error)); else p.resolve(d.data);
    }
    if (d.type === 'dnos_refresh') { window.dnos._triggerRefresh(); }
  });

  // ─── Integration modules (window.dnos.<integration>.<endpoint>) ─────────
${integrationModules}

  // ─── Automatic error overlay ────────────────────────────────────────────
  // Any unhandled Promise rejection surfaces as a red banner. Agents must
  // never wrap window.dnos calls in try/catch with fake fallback data — if
  // the API fails, the user must see it.
  function _dnosShowError(msg) {
    var el = document.getElementById('_dnos_err');
    if (!el) {
      el = document.createElement('div');
      el.id = '_dnos_err';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:#fff;padding:12px 16px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;z-index:2147483647;display:flex;align-items:center;justify-content:space-between;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
      var span = document.createElement('span');
      span.id = '_dnos_err_msg';
      span.style.cssText = 'flex:1;min-width:0;word-break:break-word';
      var btn = document.createElement('button');
      btn.textContent = 'Fechar';
      btn.style.cssText = 'background:rgba(0,0,0,0.25);border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;flex-shrink:0';
      btn.onclick = function(){ el.style.display = 'none'; };
      el.appendChild(span); el.appendChild(btn);
      (document.body || document.documentElement).appendChild(el);
    }
    document.getElementById('_dnos_err_msg').textContent = 'Falha ao carregar dados: ' + msg;
    el.style.display = 'flex';
  }
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = (r && r.message) ? r.message : (typeof r === 'string' ? r : 'erro desconhecido');
    _dnosShowError(msg);
    e.preventDefault && e.preventDefault();
  });
  window.dnos.showError = _dnosShowError;

  // ─── Download helpers (delegated to parent) ─────────────────────────────
  // Sandbox de artefato tem origem opaca — <a download>.click() em blob URL
  // é bloqueado com frequência mesmo com allow-downloads. A gente monta o
  // blob AQUI e delega o clique ao parent (sem sandbox) via postMessage.
  var _scriptCache = {};
  function _loadScript(src) {
    if (_scriptCache[src]) return _scriptCache[src];
    _scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Falha ao carregar ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
    return _scriptCache[src];
  }
  function _postDownload(filename, mime, bytes) {
    window.parent.postMessage({
      type: 'dnos_download',
      filename: filename || 'arquivo',
      mime: mime || 'application/octet-stream',
      bytes: bytes,
    }, '*');
  }
  window.dnos.saveBlob = function (blob, filename) {
    return blob.arrayBuffer().then(function (buf) {
      _postDownload(filename, blob.type || 'application/octet-stream', buf);
    });
  };
  window.dnos.downloadPDF = async function (docDefinition, filename) {
    await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js');
    await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.min.js');
    return await new Promise(function (resolve, reject) {
      try {
        window.pdfMake.createPdf(docDefinition).getBlob(function (blob) {
          blob.arrayBuffer().then(function (buf) {
            _postDownload(filename || 'documento.pdf', 'application/pdf', buf);
            resolve();
          }, reject);
        });
      } catch (e) { reject(e); }
    });
  };
  window.dnos.downloadDOCX = async function (doc, filename) {
    await _loadScript('https://unpkg.com/docx@8.5.0/build/index.js');
    var blob = await window.docx.Packer.toBlob(doc);
    var buf = await blob.arrayBuffer();
    _postDownload(
      filename || 'documento.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buf,
    );
  };
})();
</script>
`;
}




function buildSrcdoc(artifact: LiveArtifact, bridge: string): string {
  const html = artifact.html_content || "";
  // If it's a full document, inject bridge right after <head>. Otherwise wrap.
  if (/<html[\s>]/i.test(html) || /<!doctype/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(/<html([^>]*)>/i, `<html$1><head>${bridge}</head>`);
    }
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${bridge}<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fff;}</style></head><body>${html}</body></html>`;
}

interface LiveArtifactViewerProps {
  artifactId?: string;
  slug?: string;
  publicMode?: boolean;
  onClose?: () => void;
}

const PUBLIC_APP_ORIGIN = "https://dnos.dnia.ai";

function getPublicAppOrigin() {
  if (typeof window === "undefined") return PUBLIC_APP_ORIGIN;
  const origin = window.location.origin;
  const isPreviewHost =
    origin.includes("lovableproject.com") ||
    origin.includes("id-preview--") ||
    origin.includes("localhost");

  return isPreviewHost ? PUBLIC_APP_ORIGIN : origin;
}

function canonicalIntegrationType(row: {
  integration_type?: string | null;
  name?: string | null;
  key_name?: string | null;
}): string {
  const rawType = (row.integration_type ?? "").toString().toLowerCase();
  const name = (row.name ?? "").toString().toLowerCase();
  const keyName = (row.key_name ?? "").toString().toLowerCase();

  if (rawType === "meta" || name.includes("meta") || keyName.includes("meta") || keyName.includes("prisma_user_token")) {
    return "meta";
  }

  return rawType;
}

export default function LiveArtifactViewer({
  artifactId,
  slug,
  publicMode = false,
  onClose,
}: LiveArtifactViewerProps) {
  const navigate = useNavigate();
  const { user, profile, role, session } = useAuthContext();

  const [artifact, setArtifact] = useState<LiveArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [editingHtml, setEditingHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishSlug, setPublishSlug] = useState("");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishIsPublic, setPublishIsPublic] = useState(true);
  const [publishExpiration, setPublishExpiration] = useState<"never" | "7" | "30">("never");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null);

  // Load artifact by id (owner/authenticated) or by slug (public)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const query = supabase.from("live_artifacts" as any).select("*");
      const { data, error } = artifactId
        ? await query.eq("id", artifactId).is("deleted_at", null).maybeSingle()
        : await query.eq("published_slug", slug).eq("is_published", true).is("deleted_at", null).maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else if (!data) setError("Artefato não encontrado.");
      else {
        setArtifact(data as any);
        setLastRefreshed((data as any).last_refreshed_at ? new Date((data as any).last_refreshed_at) : null);
        setDataError(null);
        setPublishSlug(((data as any).published_slug as string) || "");
        // increment view_count for public views (best-effort, fire and forget)
        if (publicMode) {
          void supabase
            .from("live_artifacts" as any)
            .update({ view_count: ((data as any).view_count ?? 0) + 1 } as any)
            .eq("id", (data as any).id);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [artifactId, slug, publicMode]);

  // Tick for "atualizado há Xs"
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Load active integrations + their data_endpoints so the bridge can expose
  // window.dnos.<integration>.<endpoint>() modules. Public mode: skip (invoke
  // is blocked anyway).
  const [integrations, setIntegrations] = useState<
    Array<{ integration_type: string; endpoints: string[] }>
  >([]);
  const [integrationsReady, setIntegrationsReady] = useState(false);
  useEffect(() => {
    if (publicMode) { setIntegrations([]); setIntegrationsReady(true); return; }
    let cancelled = false;
    setIntegrationsReady(false);
    (async () => {
      const [intRes, tplRes] = await Promise.all([
        supabase.from("integrations").select("integration_type, name, key_name").eq("is_configured", true),
        supabase.from("integration_templates").select("integration_type, playbook"),
      ]);
      if (cancelled) return;
      const active = new Set(
        ((intRes.data ?? []) as any[])
          .map((r) => canonicalIntegrationType(r))
          .filter(Boolean),
      );
      const out: Array<{ integration_type: string; endpoints: string[] }> = [];
      for (const tpl of ((tplRes.data ?? []) as any[])) {
        const key = (tpl.integration_type ?? "").toString().toLowerCase();
        if (!key || !active.has(key)) continue;
        const de = tpl.playbook?.data_endpoints;
        if (!de || typeof de !== "object") continue;
        const endpoints = Object.keys(de);
        if (endpoints.length > 0) out.push({ integration_type: key, endpoints });
      }
      for (const [key, endpoints] of Object.entries(FALLBACK_DATA_ENDPOINTS)) {
        if (!active.has(key)) continue;
        if (out.some((item) => item.integration_type === key)) continue;
        out.push({ integration_type: key, endpoints });
      }
      setIntegrations(out);
      setIntegrationsReady(true);
    })();
    return () => { cancelled = true; };
  }, [publicMode]);

  const bridge = useMemo(() => {
    return buildBridge({
      user: publicMode
        ? null
        : user
        ? {
            id: user.id,
            email: user.email ?? "",
            role: (role as any) ?? "user",
            name: profile?.full_name ?? "",
          }
        : null,
      refreshInterval: artifact?.refresh_interval ?? 0,
      publicMode,
      integrations,
    });
  }, [user, profile, role, artifact?.refresh_interval, publicMode, integrations]);

  const srcdoc = useMemo(
    () => (artifact ? buildSrcdoc(artifact, bridge) : ""),
    [artifact, bridge],
  );

  // Listener for iframe → parent messages
  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const jwt = session?.access_token;

    async function handleMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== "object" || !data.type) return;
      const inline = iframeRef.current?.contentWindow;
      const full = fullscreenIframeRef.current?.contentWindow;
      if (e.source !== inline && e.source !== full) return;
      const target = (e.source === full ? full : inline) as Window | null;

      const post = (msg: any) => target?.postMessage(msg, "*");

      if (data.type === "dnos_query") {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/artifact-query`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
            },
            body: JSON.stringify({ table: data.table, ...(data.options || {}) }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body?.error) {
            const message = body?.error || `HTTP ${res.status}`;
            setDataError(message);
            post({ type: "dnos_query_result", id: data.id, error: message });
          } else {
            setDataError(null);
            const refreshedAt = new Date();
            setLastRefreshed(refreshedAt);
            if (!publicMode && artifactId) {
              void supabase
                .from("live_artifacts" as any)
                .update({ last_refreshed_at: refreshedAt.toISOString() } as any)
                .eq("id", artifactId);
            }
            post({ type: "dnos_query_result", id: data.id, data: body?.data ?? body });
          }
        } catch (err: any) {
          const message = String(err?.message ?? err);
          setDataError(message);
          post({ type: "dnos_query_result", id: data.id, error: message });
        }
      }

      if (data.type === "dnos_invoke") {
        if (publicMode || !jwt) {
          post({ type: "dnos_invoke_result", id: data.id, error: "Integrações não disponíveis no modo público." });
          return;
        }
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/invoke-integration`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${jwt}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
            },
            body: JSON.stringify({
              integration: data.integration,
              endpoint: data.endpoint,
              params: data.params,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body?.error) {
            const message = body?.error || `HTTP ${res.status}`;
            setDataError(message);
            post({ type: "dnos_invoke_result", id: data.id, error: message });
          } else {
            setDataError(null);
            const refreshedAt = new Date();
            setLastRefreshed(refreshedAt);
            if (!publicMode && artifactId) {
              void supabase
                .from("live_artifacts" as any)
                .update({ last_refreshed_at: refreshedAt.toISOString() } as any)
                .eq("id", artifactId);
            }
            post({ type: "dnos_invoke_result", id: data.id, data: body?.data ?? body });
          }
        } catch (err: any) {
          const message = String(err?.message ?? err);
          setDataError(message);
          post({ type: "dnos_invoke_result", id: data.id, error: message });
        }
      }

      if (data.type === "dnos_download") {

        try {
          const bytes = data.bytes as ArrayBuffer | undefined;
          if (!bytes) throw new Error("download sem bytes");
          const mime = typeof data.mime === "string" ? data.mime : "application/octet-stream";
          const filename = (typeof data.filename === "string" && data.filename) || "arquivo";
          const blob = new Blob([bytes], { type: mime });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast.success(`Baixado: ${filename}`);
        } catch (err: any) {
          toast.error(`Falha no download: ${String(err?.message ?? err)}`);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [session, publicMode, artifactId]);


  // Auto-refresh timer
  useEffect(() => {
    if (!artifact || artifact.refresh_interval <= 0) return;
    const timer = window.setInterval(() => {
      setDataError(null);
      iframeRef.current?.contentWindow?.postMessage({ type: "dnos_refresh" }, "*");
      fullscreenIframeRef.current?.contentWindow?.postMessage({ type: "dnos_refresh" }, "*");
    }, artifact.refresh_interval * 1000);
    return () => window.clearInterval(timer);
  }, [artifact?.refresh_interval, artifact?.id, publicMode]);

  const manualRefresh = useCallback(() => {
    setDataError(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "dnos_refresh" }, "*");
    fullscreenIframeRef.current?.contentWindow?.postMessage({ type: "dnos_refresh" }, "*");
  }, []);

  const changeInterval = useCallback(async (value: number) => {
    if (!artifact) return;
    const { error } = await supabase
      .from("live_artifacts" as any)
      .update({ refresh_interval: value } as any)
      .eq("id", artifact.id);
    if (error) {
      toast.error("Falha ao alterar intervalo.");
      return;
    }
    setArtifact({ ...artifact, refresh_interval: value });
  }, [artifact]);

  const saveHtml = useCallback(async () => {
    if (!artifact || editingHtml == null) return;
    setSaving(true);
    const { error } = await supabase
      .from("live_artifacts" as any)
      .update({ html_content: editingHtml } as any)
      .eq("id", artifact.id);
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar HTML.");
      return;
    }
    setArtifact({ ...artifact, html_content: editingHtml });
    setEditingHtml(null);
    toast.success("HTML atualizado.");
  }, [artifact, editingHtml]);

  const openPublishDialog = useCallback(() => {
    if (!artifact) return;
    setPublishTitle(artifact.title || "");
    setPublishSlug(artifact.published_slug || "");
    setPublishIsPublic(artifact.is_public ?? true);
    setPublishExpiration("never");
    setPublishedUrl(
      artifact.is_published && artifact.published_slug
        ? `${getPublicAppOrigin()}/p/${artifact.published_slug}`
        : null,
    );
    setUrlCopied(false);
    setPublishOpen(true);
  }, [artifact]);

  const publish = useCallback(async () => {
    if (!artifact) return;
    const finalTitle = publishTitle.trim() || artifact.title || "Artefato sem título";
    const rawSlug = publishSlug.trim() || finalTitle;
    const slug = rawSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (!slug) {
      toast.error("Slug inválido.");
      return;
    }
    const expiresAt =
      publishExpiration === "never"
        ? null
        : new Date(Date.now() + parseInt(publishExpiration) * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("live_artifacts" as any)
      .update({
        title: finalTitle,
        is_published: true,
        published_slug: slug,
        published_at: new Date().toISOString(),
        is_public: publishIsPublic,
        expires_at: expiresAt,
      } as any)
      .eq("id", artifact.id);
    if (error) {
      toast.error(error.message.includes("unique") ? "Slug já em uso." : "Falha ao publicar.");
      return;
    }
    setArtifact({
      ...artifact,
      title: finalTitle,
      is_published: true,
      published_slug: slug,
      is_public: publishIsPublic,
      expires_at: expiresAt,
    });
    const url = `${getPublicAppOrigin()}/p/${slug}`;
    setPublishedUrl(url);
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    toast.success("Publicado — link copiado.");
  }, [artifact, publishSlug, publishTitle, publishIsPublic, publishExpiration]);

  const copyPublishedUrl = useCallback(async () => {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setUrlCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      toast.error("Falha ao copiar.");
    }
  }, [publishedUrl]);


  const remove = useCallback(async () => {
    if (!artifact) return;
    const { error } = await supabase
      .from("live_artifacts" as any)
      .update({ deleted_at: new Date().toISOString(), is_published: false, refresh_interval: 0 } as any)
      .eq("id", artifact.id);
    if (error) {
      toast.error("Falha ao excluir.");
      return;
    }
    toast.success("Artefato removido.");
    if (onClose) onClose();
    else navigate("/artefatos");
  }, [artifact, onClose, navigate]);

  const handleCopy = useCallback(() => {
    if (!artifact) return;
    void navigator.clipboard.writeText(artifact.html_content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [artifact]);

  const handleExportPdf = useCallback(async () => {
    if (!artifact) return;
    setExporting("pdf");
    try {
      await exportArtifactAsPdf(srcdoc, `${artifact.title || "artefato"}-${Date.now()}`);
      toast.success("PDF exportado.");
    } catch (e: any) {
      toast.error("Erro ao exportar PDF: " + (e?.message || "desconhecido"));
    } finally {
      setExporting(null);
    }
  }, [artifact, srcdoc]);

  const handleExportDocx = useCallback(async () => {
    if (!artifact) return;
    setExporting("docx");
    try {
      await exportArtifactAsDocx(artifact.html_content, `${artifact.title || "artefato"}-${Date.now()}`);
      toast.success("DOCX exportado.");
    } catch (e: any) {
      toast.error("Erro ao exportar DOCX: " + (e?.message || "desconhecido"));
    } finally {
      setExporting(null);
    }
  }, [artifact]);

  useEffect(() => {
    if (!downloadOpen && !moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (downloadOpen && downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [downloadOpen, moreOpen]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !artifact) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center text-sm text-muted-foreground">
        {error || "Artefato não encontrado."}
      </div>
    );
  }

  const isLive = artifact.refresh_interval > 0;
  const secondsSince = lastRefreshed ? Math.max(0, Math.floor((now - lastRefreshed.getTime()) / 1000)) : 0;
  const relative = lastRefreshed
    ? secondsSince < 5
      ? "agora"
      : secondsSince < 60
      ? `há ${secondsSince}s`
      : `há ${Math.floor(secondsSince / 60)}min`
    : null;
  const refreshedLabel = dataError
    ? "falha na atualização"
    : relative
    ? `atualizado ${relative}`
    : "aguardando dados reais";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border/30 bg-card/70 backdrop-blur-xl px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!publicMode && (
              <button
                onClick={() => (onClose ? onClose() : navigate("/artefatos"))}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                title="Voltar"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <Zap className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{artifact.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
                {isLive ? (
                  <>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    <span className="uppercase tracking-wide text-emerald-500 font-semibold">Ao vivo</span>
                    <span className="opacity-60">·</span>
                    <span>{refreshedLabel}</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3" />
                    <span className="uppercase tracking-wide font-semibold">Manual</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={manualRefresh}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Atualizar agora"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFullscreen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Expandir"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Mais ações"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px] z-[60]">
                <DropdownMenuItem onClick={handleCopy} className="text-xs">
                  {copied ? <Check className="h-3.5 w-3.5 text-success mr-2" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground mr-2" />}
                  {copied ? "Copiado" : "Copiar HTML"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf} disabled={exporting !== null} className="text-xs">
                  <Download className="h-3.5 w-3.5 text-muted-foreground mr-2" /> Baixar PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportDocx} disabled={exporting !== null} className="text-xs">
                  <Download className="h-3.5 w-3.5 text-muted-foreground mr-2" /> Baixar DOCX
                </DropdownMenuItem>
                {!publicMode && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setEditingHtml(artifact.html_content)} className="text-xs">
                      <CodeIcon className="h-3.5 w-3.5 text-muted-foreground mr-2" /> Editar HTML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openPublishDialog} className="text-xs">
                      <Link2 className={cn("h-3.5 w-3.5 mr-2", artifact.is_published ? "text-primary" : "text-muted-foreground")} />
                      {artifact.is_published ? "Republicar" : "Publicar"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-xs text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {onClose && (
              <button
                onClick={() => { setFullscreen(false); onClose(); }}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>


        {!publicMode && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Intervalo:</span>
            {LIVE_INTERVALS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeInterval(opt.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium border transition-colors",
                  artifact.refresh_interval === opt.value
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Iframe */}
      <div className="relative flex-1 min-h-0 bg-[#0a0a0a]">
        {dataError && (
          <div className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-destructive/50 bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground shadow-lg">
            Falha ao atualizar dados: {dataError}
          </div>
        )}
        {integrationsReady ? (
          <iframe
            key={artifact.id}
            ref={iframeRef}
            srcDoc={srcdoc}
            title={artifact.title}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms allow-downloads"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Fullscreen dialog */}
      <DialogPrimitive.Root open={fullscreen} onOpenChange={setFullscreen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/72 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex flex-col bg-background outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          >
            <VisuallyHidden>
              <DialogPrimitive.Title>{artifact.title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>Visualização em tela cheia do artefato ao vivo</DialogPrimitive.Description>
            </VisuallyHidden>
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-4 py-2.5 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary shrink-0">
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{artifact.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {isLive ? (
                      <>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        </span>
                        <span className="uppercase tracking-wide text-emerald-500 font-semibold">Ao vivo</span>
                        <span className="opacity-60">·</span>
                         <span>{refreshedLabel}</span>
                      </>
                    ) : (
                      <span className="uppercase tracking-wide font-semibold">Manual</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={manualRefresh} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Atualizar agora">
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button onClick={() => setFullscreen(false)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Minimize2 className="h-3.5 w-3.5" /> Fechar
                </button>
              </div>
            </div>
            <div className="relative flex-1 min-h-0 bg-[#0a0a0a]">
              {dataError && (
                <div className="absolute left-4 right-4 top-4 z-10 rounded-lg border border-destructive/50 bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground shadow-lg">
                  Falha ao atualizar dados: {dataError}
                </div>
              )}
              <iframe
                ref={fullscreenIframeRef}
                srcDoc={srcdoc}
                title={`${artifact.title} — fullscreen`}
                className="h-full w-full border-0 block"
                sandbox="allow-scripts allow-forms allow-downloads"
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>


      {/* Edit HTML dialog */}
      <Dialog open={editingHtml != null} onOpenChange={(o) => !o && setEditingHtml(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CodeIcon className="h-4 w-4 text-primary" /> Editar HTML
            </DialogTitle>
            <DialogDescription>
              Salvar recarrega o iframe. O objeto <code>window.dnos</code> continua disponível.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={editingHtml ?? ""}
            onChange={(e) => setEditingHtml(e.target.value)}
            spellCheck={false}
            className="min-h-[400px] w-full rounded-md border border-border/50 bg-card/60 p-3 font-mono text-xs outline-none focus:border-primary/50"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditingHtml(null)}
              className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={saveHtml}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {publishedUrl ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Link2 className="h-4 w-4 text-primary" />
              )}
              {publishedUrl ? "Artefato publicado" : "Publicar artefato"}
            </DialogTitle>
            <DialogDescription>
              {publishedUrl
                ? "Compartilhe o link abaixo. Você pode republicar a qualquer momento para atualizar as configurações."
                : "Escolha visibilidade, expiração e um nome para o link. Chamadas a integrações externas ficam bloqueadas no modo público."}
            </DialogDescription>
          </DialogHeader>

          {publishedUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={publishedUrl}
                  onClick={copyPublishedUrl}
                  className="flex-1 rounded-md border border-border/50 bg-card/60 px-3 py-2 font-mono text-xs outline-none cursor-pointer"
                />
                <button
                  onClick={copyPublishedUrl}
                  className="rounded-md border border-border/50 bg-card/60 p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Copiar link"
                >
                  {urlCopied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setPublishedUrl(null)}
                  className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Editar configurações
                </button>
                <button
                  onClick={() => setPublishOpen(false)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Título</label>
                <input
                  value={publishTitle}
                  onChange={(e) => setPublishTitle(e.target.value)}
                  placeholder="Nome do artefato"
                  className="mt-1 w-full rounded-md border border-border/50 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Slug (URL pública)</label>
                <div className="mt-1 flex items-center gap-1 rounded-md border border-border/50 bg-card/60 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">/p/</span>
                  <input
                    value={publishSlug}
                    onChange={(e) => setPublishSlug(e.target.value)}
                    placeholder="meu-artefato"
                    className="flex-1 bg-transparent outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-2">
                  {publishIsPublic ? (
                    <Globe className="h-4 w-4 text-primary" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-sm font-medium">
                      {publishIsPublic ? "Público" : "Privado"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {publishIsPublic
                        ? "Qualquer pessoa com o link"
                        : "Somente usuários logados da dnos"}
                    </div>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={publishIsPublic}
                  onClick={() => setPublishIsPublic((v) => !v)}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    publishIsPublic ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform",
                      publishIsPublic ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Expiração</label>
                <select
                  value={publishExpiration}
                  onChange={(e) => setPublishExpiration(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-border/50 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50"
                >
                  <option value="never">Nunca expira</option>
                  <option value="7">7 dias</option>
                  <option value="30">30 dias</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setPublishOpen(false)}
                  className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={publish}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {artifact.is_published ? "Republicar e copiar link" : "Publicar e copiar link"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> Excluir artefato
            </DialogTitle>
            <DialogDescription>
              Essa ação não pode ser desfeita. O artefato "{artifact.title}" será removido.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteOpen(false)}
              className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={remove}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
