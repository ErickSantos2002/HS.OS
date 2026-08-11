import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeAgentId } from "@/lib/active-agents";

/**
 * Os arquivos do workspace do agente, lidos **do gateway**.
 *
 * ⚠️ **Antes isto lia a tabela `agent_files`, e ela está vazia.** A tabela é
 * espelhada pela ponte `dnos-files-bridge`, um timer de 60s na VPS que, como o
 * coletor de métricas, continua apontando para o Supabase. O painel mostrava
 * "Nenhum arquivo sincronizado" para agentes com sete arquivos no disco.
 *
 * A correção não foi consertar a ponte, e sim tirá-la do caminho. Ela nasceu
 * em julho porque o gateway **não expunha leitura de arquivo** — a tabela era
 * a única forma de ver o `SOUL.md` de alguém. Isso mudou: `agents.files.list`
 * e `agents.files.get` funcionam, são determinísticos e estão sempre atuais.
 * Manter a cópia significaria duas fontes para o mesmo conteúdo, uma delas
 * até 60s velha, e a chance de a tela mostrar uma versão que já não existe.
 *
 * O conteúdo vem **sob demanda**, um arquivo por vez, ao clicar. A listagem
 * traz só nome e tamanho, então abrir o painel custa uma chamada, não sete.
 */

interface ArquivoDoWorkspace {
  name: string;
  path?: string | null;
  size?: number | null;
  missing?: boolean;
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
  const shortId = normalizeAgentId(agentId);
  const [arquivos, setArquivos] = useState<ArquivoDoWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [carregandoConteudo, setCarregandoConteudo] = useState(false);
  const [erroConteudo, setErroConteudo] = useState<string | null>(null);

  const buscarLista = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<ArquivoDoWorkspace[]>(
        `/agents/${encodeURIComponent(shortId)}/arquivos`,
      );
      // `missing: true` é arquivo que o gateway conhece pelo nome mas não
      // existe no disco. Listar significaria oferecer um clique que só
      // resulta em erro.
      setArquivos((data ?? []).filter((f) => f.name && !f.missing));
    } catch (e: any) {
      setError(e.message || "Falha ao listar os arquivos");
      setArquivos([]);
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    void buscarLista();
  }, [buscarLista]);

  // Seleciona o primeiro assim que a lista chega, e larga a seleção que
  // deixou de existir depois de um recarregar.
  useEffect(() => {
    if (arquivos.length === 0) {
      setSelecionado(null);
      return;
    }
    if (!selecionado || !arquivos.some((f) => f.name === selecionado)) {
      setSelecionado(arquivos[0].name);
    }
  }, [arquivos, selecionado]);

  useEffect(() => {
    if (!selecionado) {
      setConteudo(null);
      return;
    }
    let cancelado = false;
    setCarregandoConteudo(true);
    setErroConteudo(null);
    api<{ name: string; content: string; size?: number | null }>(
      `/agents/${encodeURIComponent(shortId)}/arquivos/${encodeURIComponent(selecionado)}`,
    )
      .then((r) => {
        if (cancelado) return;
        setConteudo(r?.content ?? "");
      })
      .catch((e: any) => {
        if (cancelado) return;
        setErroConteudo(e?.message || "Falha ao ler o arquivo");
        setConteudo(null);
      })
      .finally(() => {
        if (!cancelado) setCarregandoConteudo(false);
      });
    return () => {
      cancelado = true;
    };
  }, [shortId, selecionado]);

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
            <p className="text-[10px] text-muted-foreground">
              Workspace do agente, lido do gateway — somente leitura
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{arquivos.length}</span>
          <button
            onClick={buscarLista}
            disabled={loading}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-full glass-card hover:border-primary/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : loading && arquivos.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : arquivos.length === 0 ? (
          <div className="p-10 text-center">
            <FolderOpen className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum arquivo no workspace</p>
            <p className="text-xs text-muted-foreground mt-1">
              O agente ainda não passou pelo onboarding, ou o gateway está fora do ar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr]">
            <div className="border-r border-border/40">
              <ScrollArea className="h-[60vh]">
                <div className="divide-y divide-border/30">
                  {arquivos.map((f) => {
                    const isSel = selecionado === f.name;
                    return (
                      <button
                        key={f.name}
                        onClick={() => setSelecionado(f.name)}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${
                          isSel ? "bg-primary/10" : "hover:bg-primary/5"
                        }`}
                      >
                        <div className="font-mono text-xs text-foreground truncate">{f.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {typeof f.size === "number" ? formatSize(f.size) : "—"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div>
              <div className="px-5 py-2.5 border-b border-border/40 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-mono font-semibold truncate">{selecionado ?? "—"}</h3>
                {/* Não há mais `synced_at` para mostrar, e é a melhoria: o que
                    está na tela é o que está no disco agora, não uma cópia
                    de até um minuto atrás. */}
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">ao vivo</span>
              </div>
              <ScrollArea className="h-[calc(60vh-41px)]">
                {carregandoConteudo ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                ) : erroConteudo ? (
                  <div className="p-8 text-center text-sm text-destructive">{erroConteudo}</div>
                ) : conteudo ? (
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap p-5">
                    {conteudo}
                  </pre>
                ) : selecionado ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    O arquivo existe, mas está vazio.
                  </div>
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Selecione um arquivo
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
