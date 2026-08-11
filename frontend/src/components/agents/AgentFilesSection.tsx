import { api } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeAgentId } from "@/lib/active-agents";
import { useNomeDoLider } from "@/hooks/use-agente-lider";

interface AgentFileRow {
  agent_id: string;
  file_name: string;
  content: string;
  synced_at: string;
}

function formatSize(bytes: number) {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + " MB";
  if (bytes >= 1_000) return (bytes / 1_000).toFixed(0) + " KB";
  return bytes + " B";
}

interface Props {
  agentId: string;
}

export default function AgentFilesSection({ agentId }: Props) {
  const lider = useNomeDoLider();
  const shortId = normalizeAgentId(agentId);
  const [rows, setRows] = useState<AgentFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<AgentFileRow | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // O backend já aceita o id curto e o `openclaw:<id>` na mesma consulta.
      const data = await api<AgentFileRow[]>(
        `/agents/${encodeURIComponent(shortId)}/arquivos-espelhados`,
      );
      setRows(data ?? []);
    } catch (e: any) {
      setError(e.message || "Falha ao carregar arquivos");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [shortId, agentId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const sorted = useMemo(() => rows, [rows]);

  useEffect(() => {
    if (selectedFile && !sorted.find((r) => r.file_name === selectedFile.file_name)) {
      setSelectedFile(sorted[0] ?? null);
    } else if (!selectedFile && sorted.length > 0) {
      setSelectedFile(sorted[0]);
    }
  }, [sorted, selectedFile]);

  return (
    <section id="agent-files" className="glass-card-glow rounded-2xl overflow-hidden">
      <div className="glass-card-glow-effect" />
      <div className="relative z-10">
        <div className="aurora-glow px-5 py-3 border-b border-border/40 flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-display font-bold text-foreground">Arquivos</h2>
            <p className="text-[10px] text-muted-foreground">Workspace do agente — somente leitura · quem sincroniza: {lider}</p>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{sorted.length}</span>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-full glass-card hover:border-primary/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : loading && sorted.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-10 text-center">
            <FolderOpen className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum arquivo sincronizado</p>
            <p className="text-xs text-muted-foreground mt-1">Peça o sync para {lider}.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr]">
            {/* List */}
            <div className="border-r border-border/40">
              <ScrollArea className="h-[60vh]">
                <div className="divide-y divide-border/30">
                  {sorted.map((f) => {
                    const isSel = selectedFile?.file_name === f.file_name;
                    return (
                      <button
                        key={f.file_name}
                        onClick={() => setSelectedFile(f)}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${
                          isSel ? "bg-primary/10" : "hover:bg-primary/5"
                        }`}
                      >
                        <div className="font-mono text-xs text-foreground truncate">{f.file_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {formatSize(new TextEncoder().encode(f.content || "").length)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Content */}
            <div>
              <div className="px-5 py-2.5 border-b border-border/40 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-mono font-semibold truncate">{selectedFile?.file_name ?? "—"}</h3>
                {selectedFile && (
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    {new Date(selectedFile.synced_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
              <ScrollArea className="h-[calc(60vh-41px)]">
                {selectedFile ? (
                  selectedFile.content ? (
                    <pre className="text-xs font-mono text-foreground whitespace-pre-wrap p-5">
                      {selectedFile.content}
                    </pre>
                  ) : (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Arquivo sincronizado, mas conteúdo está vazio.
                    </div>
                  )
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground">Selecione um arquivo</div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
