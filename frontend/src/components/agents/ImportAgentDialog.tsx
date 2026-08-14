import { api } from "@/lib/api";
import { useCallback, useMemo, useRef, useState } from "react";
import { Upload, X, Bot, CheckCircle2, AlertTriangle, Loader2, FileUp, Info } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KNOWN_CONNECTORS, validarArquivo, fillPlaceholders, type HsosFile } from "@/lib/hsos-file";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: (agentId: string) => void;
}

interface ConnectorStatus {
  id: string;
  label: string;
  connected: boolean;
}

const DEFAULT_MODEL = "openclaw:agent";
// A convenção de TODA a plataforma (instalador, skill de onboarding,
// exportação, ponte de arquivos) é /root/.openclaw/workspace-{id}. O valor
// antigo (workspace/agents/{id}) criava o agente num layout que nada mais lia.
const workspaceFor = (agentId: string) => `/root/.openclaw/workspace-${agentId}`;

export default function ImportAgentDialog({ open, onOpenChange, onImported }: Props) {
  const [arquivo, setArquivo] = useState<HsosFile | null>(null);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setArquivo(null);
    setConnectorStatus([]);
    setImporting(false);
    setDragOver(false);
    setConfirmOverwrite(false);
  }, []);

  const closeAll = useCallback(() => {
    onOpenChange(false);
    setTimeout(reset, 200);
  }, [onOpenChange, reset]);

  const parseAndPreview = useCallback(async (file: File) => {
    // Aceita a extensão antiga: um agente exportado antes do rebrand precisa
    // continuar entrando, e quem tem o arquivo não sabe que o nome mudou.
    if (!/\.(hsos|arquivo)$/i.test(file.name)) {
      toast.error("Arquivo inválido ou corrompido.");
      return;
    }
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      toast.error("Arquivo inválido ou corrompido.");
      return;
    }
    const validation = validarArquivo(parsed);
    if (validation) {
      toast.error(`Arquivo inválido ou corrompido. ${validation}`);
      return;
    }
    const d = parsed as HsosFile;
    setArquivo(d);

    // Cross-check required_connectors with integrations table
    const required = d.required_connectors ?? [];
    if (required.length === 0) {
      setConnectorStatus([]);
      return;
    }
    const catalog = KNOWN_CONNECTORS.filter((c) => required.includes(c.id));
    const allKeyNames = catalog.flatMap((c) => c.keyNames ?? []);
    // Filtrar pelos key_names aqui em vez de na consulta: são poucos conectores
    // por instalação, e evita um endpoint com filtro por lista.
    const todosConectores = await api<any[]>("/integracoes/conectores").catch(() => []);
    const integ = todosConectores.filter((r) => allKeyNames.includes(r.key_name));
    const configuredKeys = new Set(
      (integ ?? [])
        .filter((r: { key_name: string; is_configured: boolean }) => r.is_configured)
        .map((r: { key_name: string }) => r.key_name),
    );
    setConnectorStatus(
      required.map((id) => {
        const meta = KNOWN_CONNECTORS.find((c) => c.id === id);
        const label = meta?.label ?? id;
        const keys = meta?.keyNames ?? [];
        const connected = keys.some((k) => configuredKeys.has(k));
        return { id, label, connected };
      }),
    );
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseAndPreview(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) parseAndPreview(f);
  };

  const runImport = useCallback(async (force = false) => {
    if (!arquivo) return;
    setImporting(true);
    try {
      const agentId = arquivo.agent.agent_id;

      if (!force) {
        const existing = await api<any>(
          `/agents/${encodeURIComponent(agentId)}`,
        ).then(() => true, () => false);

        if (existing) {
          setImporting(false);
          setConfirmOverwrite(true);
          return;
        }
      }

      // 2. Cria o agente no OpenClaw + agent_profiles
      const createRes = await api<any>("/agents", {
        method: "POST",
        body: {
          openclaw_id: agentId,
          name: arquivo.agent.name,
          emoji: arquivo.agent.emoji || "🤖",
          specialty: arquivo.agent.role || arquivo.agent.description || "Agente importado do HS.OS",
          description: arquivo.agent.description || "",
          model: DEFAULT_MODEL,
          workspace: workspaceFor(agentId),
          channels: ["webchat"],
          skills_description: arquivo.capabilities.join(", "),
          skills_tags: arquivo.capabilities.slice(0, 12),
          integrations_used: arquivo.required_connectors,
          persona_description: arquivo.agent.description || "",
          lia_onboarding: false,
        },
      });
      if (createRes && createRes.success === false) {
        throw new Error(createRes.error || "Falha ao criar agente");
      }

      // 3. Persist files via sync-agent-files (administrador JWT). Antes disso,
      // preenche os {{PLACEHOLDER}} com os dados reais da empresa que está
      // importando — sem isso o agente nascia com o SOUL.md/IDENTITY.md cheio
      // de placeholder cru (a exportação só faz o caminho contrário, nunca
      // existiu o inverso na importação).
      const companyProfile = await api<any>("/integracoes/empresa/perfil").catch(() => null);
      const filesPayload = Object.entries(arquivo.files)
        .filter(([, content]) => typeof content === "string" && content)
        .map(([file_name, content]) => ({
          file_name,
          content: fillPlaceholders(content as string, companyProfile),
        }));

      // ⚠️ **Escreve no gateway, não na tabela.** Isto gravava em `agent_files`
      // com `pending_write: true`, esperando que a ponte `dnos-files-bridge`
      // levasse os arquivos ao disco em ~60s. A ponte não roda nesta
      // instalação — a tabela está com zero linhas — então o agente importado
      // nascia sem SOUL.md nem IDENTITY.md no workspace, e nada avisava: a
      // gravação na tabela dava certo, e a importação terminava "com sucesso".
      //
      // `agents.files.set` escreve direto e confirma na hora. Um arquivo por
      // chamada, em série, porque a ordem importa menos que saber QUAL falhou:
      // com Promise.all, um erro no TOOLS.md apareceria como uma rejeição
      // anônima no meio de quatro.
      const falhas: string[] = [];
      for (const f of filesPayload) {
        try {
          await api(
            `/agents/${encodeURIComponent(agentId)}/arquivos/${encodeURIComponent(f.file_name)}`,
            { method: "PUT", body: { content: f.content } },
          );
        } catch (e) {
          falhas.push(`${f.file_name}: ${e instanceof Error ? e.message : "erro"}`);
        }
      }
      // SOUL.md e IDENTITY.md são o que define o agente; sem eles não há
      // agente, e seguir para as skills seria enfeitar uma casa sem parede.
      const essenciaisQuebrados = falhas.filter((m) => /^(SOUL|IDENTITY)\.md:/.test(m));
      if (essenciaisQuebrados.length) {
        throw new Error(`Falha ao gravar arquivos: ${essenciaisQuebrados.join(" · ")}`);
      }
      if (falhas.length) {
        // Os demais são complementares: avisa e segue, em vez de desfazer um
        // agente que já foi criado no gateway.
        toast.warning(`Agente criado, mas alguns arquivos falharam: ${falhas.join(" · ")}`);
      }

      // Skills reais do .hsos (v1.1): recria cada uma via skill-manage e
      // vincula ao agente importado. Best-effort por skill — uma falha não
      // derruba a importação inteira.
      const skillsDoArquivo = Array.isArray((arquivo as unknown as { skills?: unknown }).skills)
        ? ((arquivo as unknown as { skills: Array<{ slug?: string; name?: string; description?: string; content?: string }> }).skills)
        : [];
      for (const s of skillsDoArquivo) {
        if (!s?.slug || !s?.content) continue;
        try {
          await api(`/skills/por-slug/${encodeURIComponent(s.slug)}`, {
            method: "PUT",
            body: {
              slug: s.slug,
              name: s.name || s.slug,
              description: s.description || "",
              content: fillPlaceholders(s.content, companyProfile),
              agent_ids: [agentId],
            },
          });
        } catch (e) {
          console.warn(`[import] skill ${s.slug} falhou:`, e instanceof Error ? e.message : e);
        }
      }

      // 4. Patch profile with role/department/color (create-agent doesn't set these)
      await api(`/agents/${encodeURIComponent(agentId)}`, {
        method: "PATCH",
        body: {
          role: arquivo.agent.role ?? null,
          department: arquivo.agent.department ?? null,
          color: arquivo.agent.color ?? null,
        },
      }).catch(() => { /* o agente já foi criado; o cargo é acabamento */ });

      toast.success(`${arquivo.agent.name} importado com sucesso.`);
      onImported?.(agentId);
      closeAll();
    } catch (err) {
      toast.error((err as Error).message || "Falha ao importar agente");
      setImporting(false);
    }
  }, [arquivo, onImported, closeAll]);

  const avatarStyle = useMemo(() => ({
    background: arquivo?.agent.color
      ? `linear-gradient(135deg, ${arquivo.agent.color}, ${arquivo.agent.color}80)`
      : undefined,
  }), [arquivo]);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) closeAll(); else onOpenChange(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-primary" />
              Importar agente
            </DialogTitle>
            <DialogDescription>
              Arquivo .hsos gerado no HS.OS — o agente é criado com as habilidades e configurações originais.
            </DialogDescription>
          </DialogHeader>

          {!arquivo && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-2xl border-2 border-dashed transition-colors py-10 px-6 text-center ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-card/40"
              }`}
            >
              <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-display font-bold text-foreground">
                Arraste um arquivo .hsos aqui
              </p>
              <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar</p>
              <input
                ref={inputRef}
                type="file"
                accept=".hsos,.arquivo,application/json"
                onChange={onFileInput}
                className="hidden"
              />
            </div>
          )}

          {arquivo && (
            <div className="space-y-4">
              {/* Preview card */}
              <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center border border-border bg-gradient-to-br from-card to-secondary"
                  style={avatarStyle}
                >
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-display font-bold text-foreground truncate">
                    {arquivo.agent.name}
                  </div>
                  {arquivo.agent.role && (
                    <div className="text-[11px] text-muted-foreground truncate">{arquivo.agent.role}</div>
                  )}
                  <div className="flex gap-2 mt-0.5 text-[10px] font-mono text-muted-foreground">
                    {arquivo.agent.department && <span>{arquivo.agent.department}</span>}
                    <span>por {arquivo.agent.author || "HS.OS"}</span>
                  </div>
                </div>
              </div>

              {/* Connector status */}
              {connectorStatus.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">
                    Conectores necessários
                  </p>
                  <div className="space-y-1">
                    {connectorStatus.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        {c.connected ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                        )}
                        <span className="text-foreground">{c.label}</span>
                        <span className={`ml-auto text-[10px] font-mono ${c.connected ? "text-success" : "text-warning"}`}>
                          {c.connected ? "conectado" : "não conectado"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {connectorStatus.some((c) => !c.connected) && (
                    <div className="flex gap-2 text-[11px] text-muted-foreground bg-card/60 rounded-xl px-3 py-2 mt-2">
                      <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span>
                        Os conectores não conectados podem ser configurados depois em
                        {" "}Configurações → Conectores. O agente funcionará normalmente, mas sem acesso a essas plataformas.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={closeAll}
              disabled={importing}
              className="px-4 py-2 text-xs rounded-full glass-card hover:border-border/60 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            {arquivo && (
              <button
                onClick={() => runImport()}
                disabled={importing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 font-display font-bold"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing ? "Importando..." : "Importar agente"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agente já existe</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe um agente com o id <span className="font-mono">{arquivo?.agent.agent_id}</span>.
              Deseja sobrescrever o perfil e os arquivos do agente atual?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOverwrite(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOverwrite(false);
                runImport(true);
              }}
            >
              Sobrescrever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
