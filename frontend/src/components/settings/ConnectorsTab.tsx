import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  useLlmProviders,
  DialogoProvedor,
  visualDoProvedor,
  ehProvedorNativo,
  type ModeloProvedor,
} from "@/components/settings/LlmProvidersSection";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Plug,
  Search,
  CheckCircle2,
  KeyRound,
  Zap,
  Wrench,
  Copy,
  Eye,
  EyeOff,
  Bot,
  X,
  Brain,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CONNECTOR_CATALOG,
  connectorLogoUrl,
  getConnectorTemplate,
  llmProviderFor,
  logoForName,
  type ConnectorField,
  type ConnectorTemplate,
} from "@/lib/connector-templates";
import GuardrailsTokenCard from "./GuardrailsTokenCard";
import { copyToClipboard } from "@/lib/clipboard";

type ConnectorKind = "api" | "mcp";

interface ConnectorRow {
  id: string;
  name: string;
  category: string | null;
  key_name: string;
  key_preview: string | null;
  is_configured: boolean;
  description: string | null;
  icon: string | null;
  updated_at: string;
  integration_type: string | null;
  credentials: any;
  type: ConnectorKind | null;
  template_id: string | null;
  agents_using: string[] | null;
  added_by_agent: string | null;
  last_validated_at: string | null;
  last_validation_ok: boolean | null;
  last_validation_error: string | null;
}

interface AgentOption {
  agent_id: string;
  name: string;
}

/** Table columns we read. */
// `credentials` NÃO é listado aqui de propósito: valores de segredo nunca vêm
// para o cliente na listagem. A edição hidrata via edge function
// `reveal-connector-credentials` (só super_admin). Ver migration de REVOKE.
const SELECT_COLS =
  "id, name, category, key_name, key_preview, is_configured, description, icon, updated_at, integration_type, type, template_id, agents_using, added_by_agent, last_validated_at, last_validation_ok, last_validation_error";



function toEnvKey(value: string): string {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "CONNECTOR"
  );
}

function maskValue(value: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 4) return "●".repeat(Math.max(v.length, 4));
  if (v.length <= 8) return `●●●●${v.slice(-4)}`;
  return `${v.slice(0, 4)}●●●●●●●●${v.slice(-4)}`;
}

/** Convert an array-of-credentials to a flat `{key: value}` map. */
function credentialsAsMap(creds: any): Record<string, string> {
  if (!creds) return {};
  if (Array.isArray(creds)) {
    const m: Record<string, string> = {};
    for (const c of creds) {
      const k = String(c?.key ?? c?.key_name ?? "").trim();
      if (k) m[k] = String(c?.value ?? "");
    }
    return m;
  }
  if (typeof creds === "object") {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(creds)) {
      if (k === "transport" || k === "url" || k === "token" || k === "config") continue;
      m[k] = typeof v === "string" ? v : "";
    }
    return m;
  }
  return {};
}

/** Encode a credential map back into the legacy array shape used by edge functions. */
function credentialsAsArray(map: Record<string, string>): { key_name: string; value: string }[] {
  return Object.entries(map).map(([key_name, value]) => ({ key_name, value }));
}

const DNIA_FALLBACK_LOGO = "https://www.google.com/s2/favicons?domain=dnia.ai&sz=128";

function ConnectorLogo({ template, name, size = 44 }: { template?: ConnectorTemplate | null; name?: string; size?: number }) {
  const url =
    (template ? connectorLogoUrl(template) : null) ??
    logoForName(name ?? template?.name) ??
    DNIA_FALLBACK_LOGO;
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-xl bg-secondary/40 shrink-0"
      style={{ width: size, height: size }}
    >
      <img src={url} alt={template?.name ?? name ?? ""} className="w-full h-full object-cover" loading="lazy" />
    </div>
  );
}

/* ----------------------------- Component ----------------------------- */

/** Um serviço na lista única — LLM, API ou MCP. O card é o mesmo; o que muda
 *  é o formulário que `abrir` chama. */
type Entrada = {
  chave: string;
  nome: string;
  subtitulo: string;
  logo: string | null;
  grupo: "llm" | "api" | "mcp";
  /** `atencao` é o meio-termo que faltava: existe, mas no lugar errado (a
   *  chave de LLM guardada no HS.OS em vez do gateway). */
  estado: "conectado" | "disponivel" | "atencao";
  detalhe: string | null;
  /** Itens curtos que cabem melhor como pílulas do que como frase — hoje os
   *  ids de modelo de um provedor. Uma lista de 8 modelos separada por vírgula
   *  vira um parágrafo ilegível no card. */
  pilulas?: string[];
  uso: string[];
  abrir: () => void;
  remover?: () => void;
  ocupado?: boolean;
  /** Ação que resolve o estado do card, quando existe uma (hoje: migrar a
   *  chave de um conector de LLM legado para o gateway). */
  acaoPrincipal?: { rotulo: string; executar: () => void };
};

const NATIVOS_LLM = ["anthropic", "openai", "deepseek", "gemini"] as const;

/** Os três grupos da lista. Não são abas — tudo continua na mesma rolagem —
 *  mas dão o mínimo de hierarquia que faltava: sem título, vinte cards iguais
 *  viram um tapete onde a LLM tem o mesmo peso visual de um webhook. É também
 *  onde mora cada "adicionar": o botão de criar tem que estar ao lado do que
 *  ele cria, não num rodapé genérico da tela. */
const GRUPOS = [
  { id: "llm", titulo: "Modelos de IA", legenda: "Quem responde pelos seus agentes" },
  { id: "api", titulo: "APIs e serviços", legenda: "Ferramentas que os agentes acessam" },
  { id: "mcp", titulo: "MCPs", legenda: "Servidores de ferramentas" },
] as const;

export default function ConnectorsTab() {
  const [rows, setRows] = useState<ConnectorRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Filtro no lugar das abas: "Meus conectores / Diretório" obrigava a pessoa
  // a saber ANTES se algo já estava ligado, para escolher a aba certa. A
  // pergunta real é uma só — o que existe, o que está ligado, como ligo o
  // que falta — e ela cabe numa lista com estado no card (task #27).
  // Dois eixos, dois controles: "que tipo" e "só o que está ligado" são
  // perguntas diferentes, e misturá-las na mesma fileira de chips obrigava a
  // escolher uma e perder a outra.
  const [filtro, setFiltro] = useState<"tudo" | "llm" | "api" | "mcp">("tudo");
  const [somenteConectados, setSomenteConectados] = useState(false);
  const [dialogoLlm, setDialogoLlm] = useState<null | { tipo: string; provedorId?: string }>(null);

  // Modal states
  const [templateModal, setTemplateModal] = useState<ConnectorTemplate | null>(null);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectorRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, agentsRes] = await Promise.all([
      supabase.from("integrations").select(SELECT_COLS).order("name", { ascending: true }),
      supabase.from("agent_profiles").select("agent_id, name").order("name", { ascending: true }),
    ]);
    if (error) {
      toast({ title: "Erro ao carregar conectores", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data as any) ?? []);
    }
    if (!agentsRes.error && agentsRes.data) {
      setAgents(agentsRes.data as AgentOption[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const llm = useLlmProviders();
  /** O gateway já disse o que existe. Antes disso a tela não sabe nada sobre
   *  LLM — e mostrar "Conectar" em tudo é afirmar o contrário. */
  const llmPronto = !!llm.estado;

  /** Migração de um conector de LLM legado: manda a chave guardada no HS.OS
   *  para o gateway pelo caminho oficial. Era o botão "Enviar chave ao
   *  Gateway" do card antigo — a ação some se o card sumir, e ela é
   *  justamente a que resolve o estado "Migrar". */
  const [migrando, setMigrando] = useState<string | null>(null);
  const migrarChave = useCallback(async (row: ConnectorRow) => {
    setMigrando(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("configure-llm-provider", {
        body: { integration_id: row.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: data?.verified ? "Chave enviada e confirmada no gateway" : "Chave enviada ao gateway",
        description: data?.verified
          ? "O provedor agora é gerenciado pela lista — pode excluir este card."
          : (data?.verification ?? "Confira o estado do provedor antes de excluir o card."),
      });
      await llm.recarregar();
    } catch (e) {
      toast({
        title: "Falha ao enviar a chave",
        description: e instanceof Error ? e.message : "erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setMigrando(null);
    }
  }, [llm]);

  /**
   * A lista única: cada serviço aparece UMA vez, com o estado no próprio card.
   *
   * Três origens compõem a mesma lista — provedores de LLM (estado vem do
   * gateway), APIs do catálogo mais as personalizadas já criadas, e MCPs.
   * O que muda entre elas é só o formulário que abre ao clicar; a leitura da
   * tela é idêntica, que é o ponto da #27.
   */
  const entradas = useMemo<Entrada[]>(() => {
    const lista: Entrada[] = [];
    const provedores = llm.estado?.provedores ?? {};

    // ── LLMs: os quatro nativos sempre aparecem (conectados ou não) mais os
    //    personalizados que existirem no gateway. Só depois que o gateway
    //    responde: antes disso "não conectado" não é um fato, é ignorância —
    //    e desenhá-la fazia a tela mostrar tudo desligado por alguns segundos
    //    antes de corrigir sozinha.
    const idsLlm = llmPronto
      ? new Set<string>([...NATIVOS_LLM, ...Object.keys(provedores)])
      : new Set<string>();
    for (const id of idsLlm) {
      const p = provedores[id];
      const visual = visualDoProvedor(id);
      const uso = llm.usoPorProvedor.get(id) ?? [];
      const nativa = llm.nativas.has(id);
      const conectado = !!p?.temChave || nativa;
      lista.push({
        chave: `llm:${id}`,
        nome: visual.nome,
        subtitulo: "Provedor de LLM",
        logo: visual.logo,
        grupo: "llm",
        estado: conectado ? "conectado" : "disponivel",
        detalhe: nativa
          ? "Conectada pelo perfil nativo do gateway — cole uma chave em Configurar para gerenciar por aqui"
          : conectado && !p?.modelos?.length
            ? "Nenhum modelo selecionado"
            : null,
        pilulas: p?.modelos?.map((m) => m.id),
        uso,
        abrir: () => setDialogoLlm({
          tipo: ehProvedorNativo(id) ? id : "custom",
          ...(p ? { provedorId: id } : {}),
        }),
        remover: p ? () => void llm.remover(id) : undefined,
        ocupado: llm.removendo === id,
      });
    }

    // ── APIs do catálogo (menos as de LLM, que já entraram acima).
    for (const t of CONNECTOR_CATALOG) {
      if (llmProviderFor(t.id, t.name)) continue;
      const linha = rows.find((r) => r.template_id === t.id);
      lista.push({
        chave: `api:${t.id}`,
        nome: t.name,
        subtitulo: linha
          ? `${(linha.agents_using ?? []).filter(Boolean).length} agente(s)`
          : `${t.fields.length} ${t.fields.length === 1 ? "campo" : "campos"}`,
        logo: connectorLogoUrl(t),
        grupo: "api",
        estado: linha ? "conectado" : "disponivel",
        detalhe: linha?.key_preview ?? null,
        uso: (linha?.agents_using ?? []).filter(Boolean),
        abrir: () => openTemplateModal(t, linha),
        remover: linha ? () => setDeleteTarget(linha) : undefined,
      });
    }

    // ── Conectores sem template: personalizados e MCPs criados à mão.
    for (const r of rows) {
      if (r.template_id && CONNECTOR_CATALOG.some((t) => t.id === r.template_id)) continue;
      // Conector de LLM legado (chave no HS.OS, não no gateway) — some da
      // lista quando o provedor já estiver conectado no gateway, senão o
      // mesmo serviço apareceria duas vezes. Enquanto o gateway não responde
      // não dá para saber se é duplicata nem se pede migração: espera.
      const provLegado = llmProviderFor(r.template_id, r.name);
      if (provLegado && (!llmPronto || provedores[provLegado]?.temChave)) continue;
      const ehMcp = r.type === "mcp";
      lista.push({
        chave: `linha:${r.id}`,
        nome: r.name,
        subtitulo: ehMcp ? "MCP" : provLegado ? "LLM — chave no HS.OS" : "Personalizado",
        logo: logoForName(r.name),
        grupo: ehMcp ? "mcp" : provLegado ? "llm" : "api",
        estado: provLegado ? "atencao" : "conectado",
        detalhe: provLegado
          ? "A chave está guardada no HS.OS, não no gateway."
          : r.key_preview ?? null,
        uso: (r.agents_using ?? []).filter(Boolean),
        abrir: () => editConnector(r),
        remover: () => setDeleteTarget(r),
        ocupado: migrando === r.id,
        acaoPrincipal: provLegado
          ? { rotulo: "Enviar chave ao gateway", executar: () => void migrarChave(r) }
          : undefined,
      });
    }

    return lista;
  }, [rows, llmPronto, llm.estado, llm.usoPorProvedor, llm.nativas, llm.removendo, llm.remover, migrando, migrarChave]);

  const entradasVisiveis = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entradas
      .filter((e) => {
        if (somenteConectados && e.estado === "disponivel") return false;
        if (filtro !== "tudo" && e.grupo !== filtro) return false;
        if (q && !e.nome.toLowerCase().includes(q) && !e.subtitulo.toLowerCase().includes(q)) return false;
        return true;
      })
      // Dentro do grupo: o que pede ação primeiro, depois o que está ligado,
      // por último o catálogo. Sem isto, o que está ligado se perde no meio.
      .sort((a, b) => {
        const peso = (e: Entrada) => (e.estado === "atencao" ? 0 : e.estado === "conectado" ? 1 : 2);
        return peso(a) - peso(b) || a.nome.localeCompare(b.nome);
      });
  }, [entradas, search, filtro, somenteConectados]);

  /** Contagem por grupo para os chips — o número diz o que existe antes de
   *  clicar, e some a surpresa de filtrar e cair numa lista vazia. */
  const contagem = useMemo(() => {
    const c = { tudo: entradas.length, llm: 0, api: 0, mcp: 0 };
    for (const e of entradas) c[e.grupo] += 1;
    return c;
  }, [entradas]);

  const nomeAgente = useCallback(
    (id: string) => agents.find((a) => a.agent_id === id)?.name ?? id,
    [agents],
  );

  const totalConectados = useMemo(
    () => entradas.filter((e) => e.estado !== "disponivel").length,
    [entradas],
  );

  function openTemplateModal(template: ConnectorTemplate, existing?: ConnectorRow) {
    setEditing(existing ?? null);
    setTemplateModal(template);
  }

  function editConnector(row: ConnectorRow) {
    if (row.type === "mcp") {
      setEditing(row);
      setMcpModalOpen(true);
      return;
    }
    const tmpl = getConnectorTemplate(row.template_id);
    if (tmpl) {
      openTemplateModal(tmpl, row);
      return;
    }
    // Legacy / custom connector
    setEditing(row);
    setCustomModalOpen(true);
  }

  async function persistConnector(payload: Partial<ConnectorRow> & { name: string; type: ConnectorKind }) {
    const key_name =
      payload.key_name ?? `${toEnvKey(payload.name)}_CONFIG`;
    const record = {
      name: payload.name,
      category: payload.category ?? (payload.type === "mcp" ? "MCPs" : "APIs"),
      key_name,
      key_preview: payload.key_preview ?? null,
      is_configured: payload.is_configured ?? true,
      description: payload.description ?? null,
      icon: payload.icon ?? "🔑",
      integration_type: payload.integration_type ?? (payload.type === "mcp" ? "mcp" : "api_key"),
      credentials: payload.credentials ?? [],
      type: payload.type,
      template_id: payload.template_id ?? null,
      agents_using: payload.agents_using ?? [],
      updated_at: new Date().toISOString(),
    };

    if (editing) {
      const { error } = await supabase.from("integrations").update(record as any).eq("id", editing.id);
      if (error) throw error;
    } else {
      // Aviso explícito em vez de erro críptico de constraint (nome e
      // key_name são únicos) — e nunca sobrescrever em silêncio: a conexão
      // existente pode ter credenciais e vínculos de agentes que uma criação
      // "por cima" apagaria.
      const { data: dup } = await supabase
        .from("integrations")
        .select("id, name, key_name")
        .or(`name.eq.${payload.name},key_name.eq.${key_name}`)
        .limit(1)
        .maybeSingle();
      if (dup) {
        throw new Error(
          `Já existe a conexão "${dup.name}" com esta chave (${dup.key_name}). ` +
          `Edite a existente em vez de criar outra — sobrescrever apagaria credenciais e vínculos.`,
        );
      }
      const { error } = await supabase.from("integrations").insert(record as any);
      if (error) throw error;
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("integrations").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Conector removido" });
    setDeleteTarget(null);
    load();
  }

  return (
    <div className="space-y-5">
      {/* Uma lista só: o diretório É a tela. O estado mora no card, então
          ninguém precisa decidir em qual aba procurar antes de procurar. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar serviço, LLM ou MCP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {([
            ["tudo", "Tudo", contagem.tudo],
            ["llm", "Modelos", contagem.llm],
            ["api", "APIs", contagem.api],
            ["mcp", "MCPs", contagem.mcp],
          ] as const).map(([valor, rotulo, n]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setFiltro(valor)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition",
                filtro === valor
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30",
              )}
            >
              {rotulo}
              {/* Sem o gateway, "Modelos 0" e o total são números errados. */}
              {llmPronto && (
                <span className={cn("ml-1.5 tabular-nums", filtro === valor ? "opacity-70" : "opacity-50")}>{n}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSomenteConectados((v) => !v)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition inline-flex items-center gap-1.5 ml-1",
              somenteConectados
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30",
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            Só conectados
            {llmPronto && <span className="tabular-nums opacity-60">{totalConectados}</span>}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 ml-1"
            title="Recarregar estado dos provedores"
            onClick={() => { void load(); void llm.recarregar(); }}
            disabled={loading || llm.carregando}
          >
            {loading || llm.carregando
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {llm.erro && (
        <div className="flex items-center gap-2 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Provedores de LLM: {llm.erro}
        </div>
      )}

      {/* Operações em voo na VPS (instalar/remover provedor). Sem isto, o
          card demora a mudar e parece que o clique não fez nada. */}
      {(llm.estado?.ops ?? []).map((op) => (
        <div
          key={op.id}
          className={cn(
            "text-xs rounded-lg px-3 py-2 border",
            op.status === "error"
              ? "text-destructive border-destructive/30 bg-destructive/10"
              : "text-muted-foreground border-border/40 bg-secondary/20",
          )}
        >
          {op.status === "error" ? (
            <>Falha ao {op.op === "remove_provider" ? "remover" : "conectar"} <b>{op.provider_id}</b>: {op.error}</>
          ) : (
            <>
              <Loader2 className="inline h-3 w-3 animate-spin mr-1.5" />
              {op.op === "remove_provider" ? "Removendo" : "Conectando"} <b>{op.provider_id}</b>… confirma em instantes.
            </>
          )}
        </div>
      ))}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {GRUPOS.map((g) => {
            const doGrupo = entradasVisiveis.filter((e) => e.grupo === g.id);
            // Esqueleto é promessa de resposta. Se a consulta já falhou, a
            // promessa não vem — some a seção e quem explica é a tarja de erro,
            // em vez de um esqueleto pulsando para sempre.
            const esperandoGateway = g.id === "llm" && !llmPronto && !llm.erro;
            if (g.id === "llm" && !llmPronto && llm.erro) return null;
            // O card de criar só faz sentido quando dá para criar: some na
            // busca (você está procurando, não criando) e em "só conectados".
            const podeCriar = !esperandoGateway && !search.trim() && !somenteConectados
              && (filtro === "tudo" || filtro === g.id);
            if (doGrupo.length === 0 && !podeCriar && !esperandoGateway) return null;
            const criar =
              g.id === "llm"
                // Abre com o seletor vazio: a escolha começa pela lista de IAs,
                // não por um formulário de URL.
                ? { rotulo: "Outra IA", legenda: "Groq, OpenRouter, Mistral, xAI e outras", icone: Brain, ao: () => setDialogoLlm({ tipo: "" }) }
                : g.id === "mcp"
                  ? { rotulo: "Novo MCP", legenda: "Servidor de ferramentas próprio", icone: Zap, ao: () => { setEditing(null); setMcpModalOpen(true); } }
                  : { rotulo: "Serviço personalizado", legenda: "Uma API que não está no catálogo", icone: Wrench, ao: () => { setEditing(null); setCustomModalOpen(true); } };
            const IconeCriar = criar.icone;
            return (
              <section key={g.id} className="space-y-2.5">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium">{g.titulo}</h3>
                  {!esperandoGateway && (
                    <span className="text-xs text-muted-foreground tabular-nums">{doGrupo.length}</span>
                  )}
                  <span className="text-xs text-muted-foreground/70 truncate">· {g.legenda}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {esperandoGateway
                    ? Array.from({ length: 4 }, (_, i) => <EsqueletoCard key={i} />)
                    : doGrupo.map((e) => (
                      <ServicoCard key={e.chave} entrada={e} nomeAgente={nomeAgente} />
                    ))}
                  {podeCriar && (
                    <button
                      onClick={criar.ao}
                      className="group flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-4 text-left transition hover:border-primary/50 hover:bg-secondary/30"
                    >
                      <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-secondary/40 text-muted-foreground group-hover:text-primary transition">
                        <IconeCriar className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{criar.rotulo}</div>
                        <div className="text-xs text-muted-foreground truncate">{criar.legenda}</div>
                      </div>
                      <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                    </button>
                  )}
                </div>
              </section>
            );
          })}

          {/* Só é "vazio" quando não sobrou NADA — com o card de criar na tela,
              dizer "nada encontrado" contradiz o que a pessoa está vendo. */}
          {entradasVisiveis.length === 0 && (!!search.trim() || somenteConectados) && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {search.trim()
                ? `Nada encontrado para "${search.trim()}".`
                : "Nada conectado por aqui ainda — tire o filtro para ver o que dá para ligar."}
            </p>
          )}
        </>
      )}

      {dialogoLlm && (
        <DialogoProvedor
          tipoInicial={dialogoLlm.tipo}
          provedorId={dialogoLlm.provedorId}
          modelosAtuais={
            (dialogoLlm.provedorId
              ? llm.estado?.provedores?.[dialogoLlm.provedorId]?.modelos ?? []
              : []) as ModeloProvedor[]
          }
          aoFechar={(mudou) => {
            setDialogoLlm(null);
            if (mudou) { void llm.recarregar(); llm.vigiar(); }
          }}
        />
      )}

      <GuardrailsTokenCard />

      {/* Template modal (known services) */}
      <TemplateModal
        template={templateModal}
        editing={editing}
        agents={agents}
        open={!!templateModal}
        onClose={() => {
          setTemplateModal(null);
          setEditing(null);
        }}
        onSaved={async () => {
          setTemplateModal(null);
          setEditing(null);
          await load();
        }}
        persist={persistConnector}
      />

      {/* MCP modal */}
      <McpModal
        open={mcpModalOpen}
        editing={editing}
        agents={agents}
        onClose={() => {
          setMcpModalOpen(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setMcpModalOpen(false);
          setEditing(null);
          await load();
        }}
        persist={persistConnector}
      />

      {/* Custom modal */}
      <CustomModal
        open={customModalOpen}
        editing={editing}
        agents={agents}
        onClose={() => {
          setCustomModalOpen(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setCustomModalOpen(false);
          setEditing(null);
          await load();
        }}
        persist={persistConnector}
      />


      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conector?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" será removido. Super agentes que dependem dele deixarão de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

/** Espera enquanto o gateway não diz quais IAs existem. Ocupa o mesmo lugar e
 *  a mesma altura do card real para a lista não pular quando a resposta chega. */
function EsqueletoCard() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-secondary/50 animate-pulse shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-2/5 rounded bg-secondary/50 animate-pulse" />
          <div className="h-2.5 w-3/5 rounded bg-secondary/40 animate-pulse" />
        </div>
      </div>
      <div className="h-3 w-1/4 rounded bg-secondary/40 animate-pulse mt-auto" />
    </div>
  );
}

/**
 * O card da lista única. Um serviço, um card — conectado ou não.
 *
 * O estado é a informação principal, então ele aparece como badge no topo e
 * decide a ação: conectado abre a edição, disponível abre a conexão. Antes,
 * "conectar" e "editar" moravam em abas diferentes da tela.
 */
function ServicoCard({ entrada: e, nomeAgente }: { entrada: Entrada; nomeAgente: (id: string) => string }) {
  const IconeGrupo = e.grupo === "llm" ? Brain : e.grupo === "mcp" ? Zap : KeyRound;
  const disponivel = e.estado === "disponivel";
  return (
    // O card inteiro é o alvo do clique. Antes, cada card carregava dois
    // botões preenchidos; com vinte cards na tela, a ação vira ruído e some
    // justamente o que importa — o nome e o estado.
    <div
      role="button"
      tabIndex={e.ocupado ? -1 : 0}
      onClick={() => { if (!e.ocupado) e.abrir(); }}
      onKeyDown={(ev) => {
        if (e.ocupado) return;
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); e.abrir(); }
      }}
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border p-4 text-left transition cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        e.estado === "conectado" && "bg-card border-primary/40 hover:border-primary/60",
        e.estado === "atencao" && "bg-card border-warning/50",
        disponivel && "bg-card/40 border-border hover:border-primary/40 hover:bg-card",
        e.ocupado && "opacity-60 cursor-wait",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex items-center justify-center overflow-hidden rounded-xl bg-secondary/40 shrink-0 h-11 w-11 transition",
          // Disponível é catálogo, não inventário: fica mais apagado para o
          // que está ligado saltar sem precisar de cor extra.
          disponivel && "opacity-60 group-hover:opacity-100",
        )}>
          {e.logo
            ? <img src={e.logo} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <IconeGrupo className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{e.nome}</div>
          <div className="text-xs text-muted-foreground truncate">{e.subtitulo}</div>
        </div>
        {e.estado === "conectado" && (
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-label="Conectado" />
        )}
        {e.estado === "atencao" && (
          <Badge variant="outline" className="text-warning border-warning/40 gap-1 shrink-0">
            <AlertCircle className="h-3 w-3" /> Migrar
          </Badge>
        )}
      </div>

      {e.detalhe && (
        <p className={cn(
          "text-[11px] leading-snug",
          e.estado === "atencao" ? "text-warning" : "text-muted-foreground",
        )}>
          {e.detalhe}
        </p>
      )}

      {!!e.pilulas?.length && (
        <div className="flex flex-wrap gap-1">
          {e.pilulas.slice(0, 3).map((m) => (
            <span key={m} className="rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {m}
            </span>
          ))}
          {e.pilulas.length > 3 && (
            <span className="text-[10px] text-muted-foreground self-center">+{e.pilulas.length - 3}</span>
          )}
        </div>
      )}

      {e.uso.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {e.uso.slice(0, 4).map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              <Bot className="h-2.5 w-2.5" />
              {e.grupo === "llm" ? id : nomeAgente(id)}
            </span>
          ))}
          {e.uso.length > 4 && <span className="text-[10px] text-muted-foreground self-center">+{e.uso.length - 4}</span>}
        </div>
      )}

      {e.acaoPrincipal && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full gap-1.5 border-warning/40 text-warning hover:text-warning"
          onClick={(ev) => { ev.stopPropagation(); e.acaoPrincipal!.executar(); }}
          disabled={e.ocupado}
        >
          {e.ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {e.acaoPrincipal.rotulo}
        </Button>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-0.5">
        <span className={cn(
          "inline-flex items-center gap-1.5 text-xs transition",
          disponivel ? "text-muted-foreground group-hover:text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
        )}>
          {e.ocupado
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguarde…</>
            : disponivel
              ? <><Plus className="h-3.5 w-3.5" /> Conectar</>
              : <><Pencil className="h-3.5 w-3.5" /> Configurar</>}
        </span>
        {/* Sempre visível: escondida atrás do hover, a exclusão virou "não é
            possível deletar" na prática — descoberta por acaso não é UX. */}
        {e.remover && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground/60 hover:text-destructive"
            onClick={(ev) => { ev.stopPropagation(); e.remover!(); }}
            disabled={e.ocupado}
            title="Remover"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}





/* Agent picker used by all modals */
function AgentPicker({
  agents,
  selected,
  onChange,
}: {
  agents: AgentOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }
  return (
    <div className="space-y-1.5 pt-2 border-t border-border">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" /> Super agentes com acesso
        </Label>
        <span className="text-[10px] text-muted-foreground">
          {selected.length}/{agents.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => {
          const active = selected.includes(a.agent_id);
          return (
            <button
              key={a.agent_id}
              type="button"
              onClick={() => toggle(a.agent_id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                active
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <Bot className="h-3 w-3" />
              {a.name}
              {active && <X className="h-3 w-3 ml-0.5 opacity-70" />}
            </button>
          );
        })}
        {agents.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhum agente cadastrado.</span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground pt-1">
        Só os agentes selecionados poderão usar este conector.
      </p>
    </div>
  );
}

/* ----------------------------- Modals ----------------------------- */

function TemplateModal({
  template,
  editing,
  agents,
  open,
  onClose,
  onSaved,
  persist,
}: {
  template: ConnectorTemplate | null;
  editing: ConnectorRow | null;
  agents: AgentOption[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  persist: (p: any) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  useEffect(() => {
    if (!template) return;
    const existing = editing ? credentialsAsMap(editing.credentials) : {};
    const seed: Record<string, string> = {};
    for (const f of template.fields) seed[f.key] = existing[f.key] ?? "";
    setValues(seed);
    setDisplayName(editing?.name ?? template.name);
    setRevealed({});
    setSelectedAgents(editing?.agents_using ?? []);

    // Hydrate missing values from stored env vars (admin-only reveal)
    if (editing?.id) {
      const missing = template.fields.some((f) => !seed[f.key]);
      if (missing) {
        supabase.functions
          .invoke("reveal-connector-credentials", { body: { integration_id: editing.id } })
          .then(({ data }) => {
            const byEnv: Record<string, string> = (data as any)?.credentials ?? {};
            if (!byEnv || Object.keys(byEnv).length === 0) return;
            const prefix = template.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
            setValues((prev) => {
              const next = { ...prev };
              for (const f of template.fields) {
                if (next[f.key]) continue;
                const envName = `${prefix}_${f.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
                if (byEnv[envName]) next[f.key] = byEnv[envName];
                else if (editing.key_name && byEnv[editing.key_name] && template.fields.length === 1) {
                  next[f.key] = byEnv[editing.key_name];
                }
              }
              return next;
            });
          })
          .catch(() => {});
      }
    }
  }, [template, editing]);

  if (!template) return null;

  async function save() {
    if (!template) return;
    for (const f of template.fields) {
      if (!values[f.key]?.trim()) {
        toast({ title: "Campo obrigatório", description: f.label, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const firstSecret = template.fields.find((f) => f.secret);
      const previewSource = firstSecret ? values[firstSecret.key] : Object.values(values)[0] ?? "";
      await persist({
        name: displayName.trim() || template.name,
        type: "api",
        template_id: template.id,
        category: "APIs",
        key_name: `${toEnvKey(template.id)}_CONFIG`,
        key_preview: previewSource ? maskValue(previewSource) : null,
        integration_type: template.fields.length > 1 ? "multi_key" : "api_key",
        credentials: credentialsAsArray(values),
        agents_using: selectedAgents,
        is_configured: true,
      });
      toast({ title: editing ? "Conector atualizado" : "Conector adicionado" });
      await onSaved();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ConnectorLogo template={template} size={40} />
            <div>
              <DialogTitle>{editing ? "Editar" : "Conectar"} {template.name}</DialogTitle>
              <DialogDescription>Preencha as credenciais fornecidas pelo provedor.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {template.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key] ?? ""}
              revealed={!!revealed[f.key]}
              onToggleReveal={() => setRevealed((r) => ({ ...r, [f.key]: !r[f.key] }))}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          ))}

          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label className="text-xs text-muted-foreground">Nome de exibição (opcional)</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={template.name}
              className="focus-visible:ring-1 focus-visible:ring-offset-0"
            />
          </div>

          <AgentPicker agents={agents} selected={selectedAgents} onChange={setSelectedAgents} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Salvar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  field,
  value,
  revealed,
  onToggleReveal,
  onChange,
}: {
  field: ConnectorField;
  value: string;
  revealed: boolean;
  onToggleReveal: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{field.label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type={field.secret && !revealed ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm flex-1 min-w-0 focus-visible:ring-1 focus-visible:ring-offset-0"
          autoComplete="off"
          spellCheck={false}
        />
        {field.secret && (
          <>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={onToggleReveal}
              title={revealed ? "Ocultar" : "Mostrar"}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={async () => {
                if (!value) return;
                const ok = await copyToClipboard(value);
                if (ok) toast({ title: "Copiado" });
              }}
              title="Copiar"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function McpModal({
  open,
  editing,
  agents,
  onClose,
  onSaved,
  persist,
}: {
  open: boolean;
  editing: ConnectorRow | null;
  agents: AgentOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  persist: (p: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const c = editing?.credentials ?? {};
    const obj = Array.isArray(c) ? {} : c;
    setName(editing?.name ?? "");
    setUrl(obj?.url ?? "");
    setToken(obj?.token ?? "");
    setConfigText(obj?.config ? JSON.stringify(obj.config, null, 2) : "{}");
    setSelectedAgents(editing?.agents_using ?? []);
  }, [open, editing]);

  async function save() {
    if (!name.trim() || !url.trim()) {
      toast({ title: "Nome e URL são obrigatórios", variant: "destructive" });
      return;
    }
    let config: any = {};
    try {
      config = configText.trim() ? JSON.parse(configText) : {};
    } catch {
      toast({ title: "Config JSON inválido", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await persist({
        name: name.trim(),
        type: "mcp",
        category: "MCPs",
        key_name: `${toEnvKey(name)}_MCP`,
        integration_type: "mcp",
        credentials: { transport: "http", url: url.trim(), token: token.trim(), config },
        agents_using: selectedAgents,
        key_preview: token ? maskValue(token) : null,
        is_configured: true,
      });
      toast({ title: editing ? "MCP atualizado" : "MCP conectado" });
      await onSaved();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar MCP" : "Adicionar MCP"}</DialogTitle>
          <DialogDescription>Servidor MCP remoto acessível via HTTP.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu MCP" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL do servidor</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Token (opcional)</Label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Config JSON</Label>
            <Textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              className="font-mono text-xs min-h-[100px]"
              spellCheck={false}
            />
          </div>
          <AgentPicker agents={agents} selected={selectedAgents} onChange={setSelectedAgents} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Salvar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomModal({
  open,
  editing,
  agents,
  onClose,
  onSaved,
  persist,
}: {
  open: boolean;
  editing: ConnectorRow | null;
  agents: AgentOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  persist: (p: any) => Promise<void>;
}) {
  const [kind, setKind] = useState<ConnectorKind>("api");
  const [name, setName] = useState("");
  const [pairs, setPairs] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [saving, setSaving] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setKind((editing?.type as ConnectorKind) ?? "api");
    setName(editing?.name ?? "");
    const map = credentialsAsMap(editing?.credentials);
    const entries = Object.entries(map);
    setPairs(entries.length ? entries.map(([k, v]) => ({ key: k, value: v })) : [{ key: "", value: "" }]);
    setSelectedAgents(editing?.agents_using ?? []);

    // Hydrate from env vars if nothing is stored in DB
    if (editing?.id && entries.length === 0) {
      supabase.functions
        .invoke("reveal-connector-credentials", { body: { integration_id: editing.id } })
        .then(({ data }) => {
          const byEnv: Record<string, string> = (data as any)?.credentials ?? {};
          const envEntries = Object.entries(byEnv);
          if (envEntries.length === 0) return;
          setPairs(envEntries.map(([k, v]) => ({ key: k, value: v })));
        })
        .catch(() => {});
    }
  }, [open, editing]);

  function updatePair(i: number, patch: Partial<{ key: string; value: string }>) {
    setPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Informe um nome", variant: "destructive" });
      return;
    }
    const cleanPairs = pairs.filter((p) => p.key.trim() && p.value.trim());
    if (!cleanPairs.length) {
      toast({ title: "Adicione ao menos um campo", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const map: Record<string, string> = {};
      for (const p of cleanPairs) map[p.key.trim()] = p.value;
      await persist({
        name: name.trim(),
        type: kind,
        category: kind === "mcp" ? "MCPs" : "APIs",
        key_name: `${toEnvKey(name)}_CONFIG`,
        integration_type: kind === "mcp" ? "mcp" : "multi_key",
        credentials: credentialsAsArray(map),
        agents_using: selectedAgents,
        key_preview: maskValue(cleanPairs[0].value),
        is_configured: true,
      });
      toast({ title: editing ? "Conector atualizado" : "Conector adicionado" });
      await onSaved();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar conector" : "Conector personalizado"}</DialogTitle>
          <DialogDescription>Para serviços que não estão no catálogo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("api")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-sm transition",
                  kind === "api" ? "border-primary/60 bg-primary/10 text-primary" : "border-border hover:bg-secondary/40",
                )}
              >
                <Plug className="h-4 w-4" /> API
              </button>
              <button
                type="button"
                onClick={() => setKind("mcp")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-sm transition",
                  kind === "mcp" ? "border-primary/60 bg-primary/10 text-primary" : "border-border hover:bg-secondary/40",
                )}
              >
                <Zap className="h-4 w-4" /> MCP
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu serviço" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Campos</Label>
            {pairs.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="chave"
                  value={p.key}
                  onChange={(e) => updatePair(i, { key: e.target.value })}
                  className="font-mono text-sm"
                />
                <Input
                  placeholder="valor"
                  value={p.value}
                  onChange={(e) => updatePair(i, { value: e.target.value })}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setPairs((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={pairs.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPairs((prev) => [...prev, { key: "", value: "" }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar campo
            </Button>
          </div>

          {/* A dica anterior mandava criar uma skill chamando get_connector('nome').
              Essa ferramenta NÃO EXISTE — nem no schema de tools do OpenClaw, nem
              em lugar nenhum deste repositório (confirmado 2026-07-24). Quem
              seguisse a instrução criava um conector que nenhum agente conseguia
              usar. O caminho real é a edge function fetch-agent-credentials. */}
          <div className="text-xs text-muted-foreground rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
            <p>
              Guardar a credencial não basta: crie uma <strong>skill</strong> ensinando o agente a
              usar esta API — qual endpoint chamar, em qual header ou parâmetro entra cada campo.
            </p>
            <p>
              Na skill, o agente busca as credenciais em{" "}
              <code className="font-mono text-[11px]">
                GET /functions/v1/fetch-agent-credentials?agent_id=&lt;id&gt;&amp;provider=
                {name ? name.toLowerCase().split(/\s+/)[0] : "nome"}
              </code>
              . O parâmetro <code className="font-mono text-[11px]">provider</code> limita a resposta
              a esta conexão — sem ele, o agente recebe todas as credenciais dele de uma vez.
            </p>
            <p>
              Para um uso pontual, você também pode mandar o link da documentação da API direto no
              chat do agente — ele lê e descobre sozinho, sem skill. A skill é o que torna isso
              permanente: sem ela, o aprendizado vale só naquela conversa.
            </p>
          </div>

          <AgentPicker agents={agents} selected={selectedAgents} onChange={setSelectedAgents} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Salvar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
