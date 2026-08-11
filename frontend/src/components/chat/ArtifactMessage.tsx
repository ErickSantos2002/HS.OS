import { useEffect, useMemo, useRef, useState } from "react";
import { extractArtifact } from "@/lib/artifact-extractor";
import { MarkdownMessageContent } from "@/components/chat/MessageContent";

import { type ArtifactType } from "@/lib/artifact-extractor";
import { Eye } from "lucide-react";
import { stripFileOps } from "@/hooks/useFileOpParser";
import { useFS } from "@/contexts/FileSystemContext";
import { FileOpCard } from "@/components/chat/FileOpCard";
import type { FileOperation } from "@/hooks/useFileSystem";
import {
  stripLiveArtifacts,
  useLiveArtifactParser,
  type ParsedLiveArtifact,
} from "@/hooks/useLiveArtifactParser";
import LiveArtifactCard from "@/components/chat/LiveArtifactCard";
import {
  stripGenerateDocuments,
  useGenerateDocumentParser,
  type ParsedGenerateDocument,
  type GeneratedDocument,
} from "@/hooks/useGenerateDocumentParser";
import GeneratedDocumentCard from "@/components/chat/GeneratedDocumentCard";

interface ArtifactMessageProps {
  content: string;
  className?: string;
  agentId?: string;
  onArtifactClick?: (artifact: { type: ArtifactType; code: string; title?: string }) => void;
  onLiveArtifactClick?: (id: string) => void;
}

// Global dedup persisted in sessionStorage so reloading the page does not
// re-execute <file_op> blocks from historical agent messages (which would
// also re-trigger the auto-reply pipeline and look like "messages sent alone").
const EXECUTED_STORAGE_KEY = "hsos:executed-file-ops";
function loadExecuted(): Set<string> {
  try {
    const raw = sessionStorage.getItem(EXECUTED_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
const EXECUTED_OPS = loadExecuted();
function persistExecuted() {
  try { sessionStorage.setItem(EXECUTED_STORAGE_KEY, JSON.stringify([...EXECUTED_OPS])); } catch { /* ignore */ }
}

function FileOpsRenderer({ text }: { text: string }) {
  const fs = useFS();
  const ops = useMemo(() => stripFileOps(text).ops, [text]);
  const [localOps, setLocalOps] = useState<FileOperation[]>([]);
  const ranRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (ops.length === 0) return;

    ops.forEach((op, idx) => {
      const sig = `${text.length}:${idx}:${op.action}:${op.path}:${op.newPath || ""}:${(op.content || "").length}`;
      if (ranRef.current.has(sig) || EXECUTED_OPS.has(sig)) return;
      ranRef.current.add(sig);
      EXECUTED_OPS.add(sig);
      persistExecuted();

      const card: FileOperation = {
        id: sig,
        action: op.action,
        path: op.path,
        newPath: op.newPath,
        content: op.content,
        timestamp: new Date(),
        status: "pending",
      };
      setLocalOps((prev) => [...prev, card]);

      const finish = (update: Partial<FileOperation>) =>
        setLocalOps((prev) => prev.map((c) => (c.id === sig ? { ...c, ...update } : c)));

      // Folder revoked: refuse execution and inform the agent so it stops trying.
      if (!fs.isConnected) {
        // Folder is disconnected. Show the card as error but do NOT auto-send a
        // reply back to the agent — the revoke notice already informed it once,
        // and re-sending on every <file_op> creates a self-message loop.
        finish({ status: "error", error: "Pasta local desconectada." });
        return;
      }

      (async () => {
        try {
          let resultText = "";
          if (op.action === "read") {
            const content = await fs.readFile(op.path);
            resultText = content;
          } else if (op.action === "write" || op.action === "create") {
            await fs.writeFile(op.path, op.content || "");
            resultText = `OK — arquivo "${op.path}" salvo (${(op.content || "").length} chars).`;
          } else if (op.action === "list") {
            const entries = await fs.listFiles(op.path);
            resultText = entries.length === 0
              ? "(pasta vazia)"
              : entries.map((e) => `${e.kind === "directory" ? "[dir]" : "[file]"} ${e.name}`).join("\n");
          } else if (op.action === "delete") {
            await fs.deleteEntry(op.path);
            resultText = `OK — "${op.path}" apagado.`;
          } else if (op.action === "rename" || op.action === "move") {
            if (!op.newPath) throw new Error(`"${op.action}" requer campo "newPath"`);
            if (op.action === "rename") await fs.renameFile(op.path, op.newPath);
            else await fs.moveFile(op.path, op.newPath);
            resultText = `OK — "${op.path}" → "${op.newPath}".`;
          }
          finish({ status: "done", content: op.action === "read" ? resultText : undefined });
          window.dispatchEvent(new CustomEvent("hsos:file-op-result", {
            detail: { action: op.action, path: op.path, newPath: op.newPath, ok: true, result: resultText },
          }));
        } catch (err) {
          const errMsg = String(err);
          finish({ status: "error", error: errMsg });
          window.dispatchEvent(new CustomEvent("hsos:file-op-result", {
            detail: { action: op.action, path: op.path, newPath: op.newPath, ok: false, result: errMsg },
          }));
        }
      })();


    });
  }, [ops, text, fs]);

  if (localOps.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {localOps.map((op) => (
        <FileOpCard key={op.id} op={op} />
      ))}
    </div>
  );
}

/**
 * Renders an agent message. Strips <file_op> blocks (rendering inline cards),
 * then extracts any previewable artifact code-block.
 */
export default function ArtifactMessage({ content, className, agentId, onArtifactClick, onLiveArtifactClick }: ArtifactMessageProps) {
  // Strip live_artifact tags first so they don't leak into the visible text
  // OR into the fenced-code artifact extractor.
  const { cleanText: withoutLive, artifacts: liveParsed } = useMemo(
    () => stripLiveArtifacts(content),
    [content],
  );
  const { cleanText: withoutDocs, documents: docsParsed } = useMemo(
    () => stripGenerateDocuments(withoutLive),
    [withoutLive],
  );
  const cleaned = useMemo(() => stripFileOps(withoutDocs).cleanText, [withoutDocs]);
  const artifact = useMemo(() => extractArtifact(cleaned), [cleaned]);

  return (
    <div className="space-y-2">
      {artifact ? (
        <>
          {artifact.markdownWithout && (
            <MarkdownMessageContent text={artifact.markdownWithout} className={className} />
          )}
          <button
            onClick={() => onArtifactClick?.({ type: artifact.type, code: artifact.code })}
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors w-full"
          >
            <Eye className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Ver artefato ({artifact.type.toUpperCase()})</span>
          </button>
        </>
      ) : (
        cleaned && <MarkdownMessageContent text={cleaned} className={className} />
      )}
      <GenerateDocumentsRenderer parsed={docsParsed} agentId={agentId} messageKey={content} />
      <LiveArtifactsRenderer parsed={liveParsed} agentId={agentId} messageKey={content} onOpen={onLiveArtifactClick} />
      <FileOpsRenderer text={content} />
    </div>
  );
}

/* ── Live artifacts renderer ── */

const LIVE_EXECUTED_KEY = "hsos:executed-live-artifacts";
function loadLiveExecuted(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(LIVE_EXECUTED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
const LIVE_EXECUTED: Record<string, string> = loadLiveExecuted();
// Module-scoped registry of in-flight persists, keyed by signature. Prevents
// duplicate INSERTs when a message component remounts (or re-renders during
// streaming) before the first persist promise resolves and writes to
// LIVE_EXECUTED/sessionStorage.
const LIVE_INFLIGHT: Map<string, Promise<string | null>> = new Map();
function persistLiveExecuted() {
  try {
    sessionStorage.setItem(LIVE_EXECUTED_KEY, JSON.stringify(LIVE_EXECUTED));
  } catch {
    /* ignore */
  }
}

function LiveArtifactsRenderer({
  parsed,
  agentId,
  messageKey,
  onOpen,
}: {
  parsed: ParsedLiveArtifact[];
  agentId?: string;
  messageKey: string;
  onOpen?: (id: string) => void;
}) {
  const { persist } = useLiveArtifactParser();
  const [ids, setIds] = useState<(string | null)[]>(() => parsed.map(() => null));
  const ranRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (parsed.length === 0) return;
    parsed.forEach((p, idx) => {
      const sig = `${messageKey.length}:${idx}:${p.existingId || ""}:${p.title}:${p.html.length}`;
      if (ranRef.current.has(sig)) return;
      ranRef.current.add(sig);

      const applyId = (id: string) => {
        setIds((prev) => {
          const next = [...prev];
          next[idx] = id;
          return next;
        });
      };

      // Already resolved in this session — reuse the persisted id.
      const cached = LIVE_EXECUTED[sig];
      if (cached) {
        applyId(cached);
        return;
      }

      // Another instance is already persisting this exact artifact — await it
      // instead of firing a second INSERT.
      const inflight = LIVE_INFLIGHT.get(sig);
      if (inflight) {
        inflight.then((id) => id && applyId(id));
        return;
      }

      const task = (async () => {
        const id = await persist(p, agentId);
        if (id) {
          LIVE_EXECUTED[sig] = id;
          persistLiveExecuted();
        }
        LIVE_INFLIGHT.delete(sig);
        return id;
      })();
      LIVE_INFLIGHT.set(sig, task);
      task.then((id) => id && applyId(id));
    });
  }, [parsed, messageKey, persist, agentId]);


  if (parsed.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {parsed.map((p, idx) => {
        const id = ids[idx];
        if (!id) return null;
        return (
          <LiveArtifactCard
            key={id}
            artifactId={id}
            title={p.title}
            refreshInterval={p.refreshInterval}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}

/* ── Generate document renderer ── */

const DOCS_EXECUTED_KEY = "hsos:executed-generate-documents";
type DocsRecord = { id: string; size_bytes: number };
function loadDocsExecuted(): Record<string, DocsRecord> {
  try {
    const raw = sessionStorage.getItem(DOCS_EXECUTED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DocsRecord>) : {};
  } catch { return {}; }
}
const DOCS_EXECUTED: Record<string, DocsRecord> = loadDocsExecuted();
const DOCS_INFLIGHT: Map<string, Promise<GeneratedDocument | null>> = new Map();
function persistDocsExecuted() {
  try { sessionStorage.setItem(DOCS_EXECUTED_KEY, JSON.stringify(DOCS_EXECUTED)); } catch { /* ignore */ }
}

type DocState = { status: "pending" | "ready" | "error"; id: string | null; sizeBytes?: number; errorMessage?: string };

function GenerateDocumentsRenderer({
  parsed,
  agentId,
  messageKey,
}: {
  parsed: ParsedGenerateDocument[];
  agentId?: string;
  messageKey: string;
}) {
  const { generate } = useGenerateDocumentParser();
  const [states, setStates] = useState<DocState[]>(() =>
    parsed.map(() => ({ status: "pending", id: null }))
  );
  const ranRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (parsed.length === 0) return;
    parsed.forEach((p, idx) => {
      const sig = `${messageKey.length}:${idx}:${p.type}:${p.title}:${p.raw.length}`;
      if (ranRef.current.has(sig)) return;
      ranRef.current.add(sig);

      const applyReady = (rec: DocsRecord) => {
        setStates((prev) => {
          const next = [...prev];
          next[idx] = { status: "ready", id: rec.id, sizeBytes: rec.size_bytes };
          return next;
        });
      };
      const applyError = (msg: string) => {
        setStates((prev) => {
          const next = [...prev];
          next[idx] = { status: "error", id: null, errorMessage: msg };
          return next;
        });
      };

      const cached = DOCS_EXECUTED[sig];
      if (cached) { applyReady(cached); return; }

      const inflight = DOCS_INFLIGHT.get(sig);
      if (inflight) {
        inflight.then((doc) => doc ? applyReady({ id: doc.id, size_bytes: doc.size_bytes }) : applyError("Falha ao gerar"));
        return;
      }

      const task = (async () => {
        try {
          const doc = await generate(p, agentId);
          if (doc) {
            DOCS_EXECUTED[sig] = { id: doc.id, size_bytes: doc.size_bytes };
            persistDocsExecuted();
          }
          return doc;
        } finally {
          DOCS_INFLIGHT.delete(sig);
        }
      })();
      DOCS_INFLIGHT.set(sig, task);
      task.then((doc) => doc ? applyReady({ id: doc.id, size_bytes: doc.size_bytes }) : applyError("Falha ao gerar"));
    });
  }, [parsed, messageKey, generate, agentId]);

  if (parsed.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {parsed.map((p, idx) => {
        const st = states[idx] ?? { status: "pending" as const, id: null };
        return (
          <GeneratedDocumentCard
            key={`${idx}:${p.title}`}
            documentId={st.id}
            title={p.title}
            docType={p.type}
            sizeBytes={st.sizeBytes}
            status={st.status}
            errorMessage={st.errorMessage}
          />
        );
      })}
    </div>
  );
}
