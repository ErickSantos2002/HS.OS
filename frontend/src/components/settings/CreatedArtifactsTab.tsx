import { api } from "@/lib/api";
import { useState, useEffect, useMemo } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { extractAllArtifacts, buildArtifactHtml } from "@/lib/artifact-extractor";
import { getAgentDisplayNameById } from "@/lib/active-agents";
import { Code2, Eye, Loader2, Filter } from "lucide-react";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

interface CreatedArtifact {
  type: string;
  code: string;
  title: string;
  agentId: string;
  agentName: string;
  createdAt: string;
}

export default function CreatedArtifactsTab() {
  const { user } = useAuthContext();
  const [artifacts, setArtifacts] = useState<CreatedArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);

      // Fetch all agent messages for this user that likely contain code blocks
      const rows = await api<any[]>("/conversations/minhas/respostas").catch(() => null);

      if (!rows || rows.length === 0) {
        setArtifacts([]);
        setLoading(false);
        return;
      }

      // Group by agent and extract artifacts
      const results: CreatedArtifact[] = [];
      const messages = rows.map((r) => ({
        role: "agent" as const,
        content: r.content ?? "",
        timestamp: r.created_at,
        id: r.id,
        agent_id: r.agent_id,
      }));

      for (const msg of messages) {
        const extracted = extractAllArtifacts([
          { role: msg.role, content: msg.content, timestamp: msg.timestamp, id: msg.id },
        ]);
        for (const art of extracted) {
          results.push({
            type: art.type,
            code: art.code,
            title: art.title,
            agentId: msg.agent_id,
            agentName: getAgentDisplayNameById(msg.agent_id),
            createdAt: msg.timestamp,
          });
        }
      }

      setArtifacts(results);
      setLoading(false);
    };

    load();
  }, [user]);

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of artifacts) {
      if (!map.has(a.agentId)) map.set(a.agentId, a.agentName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [artifacts]);

  const filtered = selectedAgent === "all"
    ? artifacts
    : artifacts.filter((a) => a.agentId === selectedAgent);

  const typeBadge: Record<string, string> = {
    html: "HTML",
    svg: "SVG",
    jsx: "React",
    react: "React",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <Code2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>Nenhum artefato criado ainda.</p>
        <p className="text-xs mt-1">Artefatos gerados pelos agentes no chat aparecerão aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Agent filter */}
      {agentOptions.length > 1 && (
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={selectedAgent} onValueChange={setSelectedAgent}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Filtrar por agente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os agentes</SelectItem>
              {agentOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{filtered.length} artefato(s)</span>
        </div>
      )}

      {/* List */}
      {filtered.map((a, i) => (
        <div
          key={`${a.createdAt}-${i}`}
          className="flex items-center justify-between rounded-xl border border-border/30 bg-card/60 px-4 py-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Code2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-sm font-medium truncate">{a.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
                {typeBadge[a.type] || a.type.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{format(new Date(a.createdAt), "dd/MM/yyyy HH:mm")}</span>
              <span className="truncate max-w-[140px]">{a.agentName}</span>
            </div>
          </div>
          <button
            onClick={() => setPreviewHtml(buildArtifactHtml(a.type as any, a.code))}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Visualizar"
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
      ))}

      {/* Preview dialog */}
      <Dialog open={!!previewHtml} onOpenChange={() => setPreviewHtml(null)}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 overflow-hidden">
          {previewHtml && (
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-downloads"
              title="Artifact Preview"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
