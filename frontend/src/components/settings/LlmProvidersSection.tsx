import { api } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CONNECTOR_CATALOG, connectorLogoUrl } from "@/lib/connector-templates";

/**
 * Provedores de LLM — o estado e o formulário (task #20).
 *
 * Este arquivo NÃO desenha seção própria: os cards de LLM vivem na lista
 * única de Conexões (task #27), ao lado de APIs e MCPs, porque a pergunta de
 * quem abre a tela é uma só — "o que existe, o que está ligado, como ligo o
 * que falta" — e ela não muda por o serviço ser um modelo ou um CRM.
 *
 * O que mora aqui é o que só vale para LLM: o fluxo de credencial com
 * descoberta de modelos na API do provedor, e o estado lido do gateway.
 */

export interface ModeloProvedor { id: string; name: string; contextWindow: number | null; cost: unknown }
export interface Provedor {
  api: string | null; baseUrl: string | null; auth: string | null;
  temChave: boolean; modelos: ModeloProvedor[];
}
export interface OpPendente { id: string; op: string; provider_id: string; status: string; error: string | null }
export interface EstadoLlm {
  /** O gateway não respondeu. Normal e temporário durante a instalação de um
   *  provedor (que o reinicia); problema de verdade só quando não há op em voo. */
  indisponivel?: boolean;
  motivo?: string;
  ops?: OpPendente[];
  provedores: Record<string, Provedor>;
  catalogo: string[];
  /** Os perfis de auth do gateway, chaveados por `<provedor>:<perfil>`. É o
   *  que diz a verdade sobre a credencial: ela não vive em `provedores`, vive
   *  no SQLite de cada agente, e isto é o que o gateway declara ter. */
  perfis: Record<string, { provider?: string; mode?: string }>;
  /** Ordem de tentativa por provedor — o primeiro que funciona é o usado. */
  ordem_perfis?: Record<string, string[]>;
  /** Saúde por perfil, do `models.authStatus`. Só perfil com validade (OAuth)
   *  aparece; ausência não é problema, é ausência de prazo para vencer. */
  saude_auth?: Record<string, { tipo?: string; status?: string; expira_em?: number | null }>;
  agentes: Array<{ id: string; model: string | null }>;
  padrao: { primary?: string; fallbacks?: string[] } | null;
}

/** Provedores que o gateway fala nativamente. */
export const TIPOS_LLM = [
  { valor: "anthropic", rotulo: "Anthropic (Claude)" },
  { valor: "openai", rotulo: "OpenAI (GPT)" },
  { valor: "deepseek", rotulo: "DeepSeek" },
  { valor: "gemini", rotulo: "Google (Gemini)" },
] as const;

/**
 * IAs que falam a mesma API da OpenAI.
 *
 * O endereço da API é obrigatório — é ele que diz para onde mandar a
 * requisição, e sem isso o gateway recusa o provedor. Mas é um valor fixo e
 * público de cada serviço, então não é você que tem que saber: escolhendo da
 * lista, o endereço vai junto. Digitar à mão fica só para quem não está aqui.
 */
export const COMPATIVEIS_OPENAI = [
  { valor: "groq", rotulo: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { valor: "openrouter", rotulo: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { valor: "together", rotulo: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { valor: "mistral", rotulo: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { valor: "xai", rotulo: "xAI (Grok)", baseUrl: "https://api.x.ai/v1" },
  { valor: "perplexity", rotulo: "Perplexity", baseUrl: "https://api.perplexity.ai" },
  { valor: "fireworks", rotulo: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1" },
] as const;

const NATIVOS = new Set(["anthropic", "openai", "deepseek", "gemini"]);
export const ehProvedorNativo = (id: string) => NATIVOS.has(id);

/** O gateway identifica cada provedor por um apelido curto — sem espaço, sem
 *  acento, minúsculo. Quem digita "Meu Groq" quer dizer "meu-groq"; converter
 *  em silêncio evita um erro de formato por algo que é detalhe de máquina. */
export function apelidoDeProvedor(nome: string): string {
  return nome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Logo e nome no mesmo padrão dos conectores — o catálogo de templates já
 *  tem os quatro provedores com logo local. */
export function visualDoProvedor(id: string): { nome: string; logo: string | null } {
  const t = CONNECTOR_CATALOG.find((c) => c.id === id);
  if (t) return { nome: t.name, logo: connectorLogoUrl(t) };
  // "OpenRouter", não "Openrouter": quem veio da lista tem nome próprio.
  const conhecido = COMPATIVEIS_OPENAI.find((c) => c.valor === id);
  if (conhecido) return { nome: conhecido.rotulo, logo: null };
  return { nome: id.charAt(0).toUpperCase() + id.slice(1), logo: null };
}

/** A edge recebia a ação no corpo; o backend expõe uma rota por ação. */
async function chamar(body: Record<string, unknown>) {
  const { action, ...resto } = body as any;
  const rota: Record<string, () => Promise<any>> = {
    list: () => api("/llm/provedores"),
    save: () => api("/llm/provedores", { method: "POST", body: resto }),
    remove: () => api("/llm/provedores/remover", { method: "POST", body: resto }),
    discover: () => api("/llm/descobrir", { method: "POST", body: resto }),
    discover_status: () => api(`/llm/descobrir/${encodeURIComponent(resto.op_id)}`),
  };
  if (!rota[action]) throw new Error(`Ação desconhecida: ${action}`);
  const data: any = await rota[action]();
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Estado dos provedores + ações. A tela de Conexões consome isto para montar
 *  os cards de LLM na mesma lista dos demais serviços. */
export function useLlmProviders() {
  const [estado, setEstado] = useState<EstadoLlm | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const novo = await chamar({ action: "list" }) as EstadoLlm;
      // Último estado bom: com o gateway reiniciando, a resposta vem sem
      // provedores. Adotá-la faria TODOS os cards piscarem "desconectado" no
      // meio de uma instalação bem-sucedida — o oposto do que aconteceu.
      setEstado((anterior) =>
        novo.indisponivel && anterior
          ? { ...anterior, indisponivel: true, motivo: novo.motivo, ops: novo.ops }
          : novo);
      // Gateway fora do ar COM operação em voo é o reinício da instalação —
      // quem narra isso é o banner de operação, não uma tarja vermelha.
      const emInstalacao = !!novo.indisponivel && (novo.ops ?? []).some((o) => o.status === "pending");
      setErro(novo.indisponivel && !emInstalacao ? (novo.motivo ?? "Gateway indisponível") : null);
      return novo;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar o gateway");
      return null;
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void recarregar(); }, [recarregar]);

  // Acompanha até o gateway voltar a responder. Desde 13/08 nada mais entra na
  // fila `llm_provider_ops` — instalar credencial não é possível por aqui —, mas
  // a vigilância continua útil: alterar o catálogo faz o gateway recarregar, e
  // durante esse instante ele não responde. O teto é rede de segurança.
  const vigiar = useCallback(() => {
    let vezes = 0;
    const id = setInterval(async () => {
      vezes += 1;
      const novo = await recarregar();
      const acabou = !!novo && !novo.indisponivel && !(novo.ops ?? []).some((o) => o.status === "pending");
      if (acabou || vezes >= 20) clearInterval(id);
    }, 4000);
  }, [recarregar]);

  /** Quem depende de cada provedor: o padrão da instância e os agentes. */
  const usoPorProvedor = useMemo(() => {
    const uso = new Map<string, string[]>();
    if (!estado) return uso;
    const anota = (prefixado: string | null | undefined, quem: string) => {
      const p = String(prefixado ?? "").split("/")[0];
      if (!p) return;
      uso.set(p, [...new Set([...(uso.get(p) ?? []), quem])]);
    };
    anota(estado.padrao?.primary, "padrão");
    for (const a of estado.agentes) anota(a.model, a.id);
    return uso;
  }, [estado]);

  const remover = useCallback(async (provedorId: string) => {
    setRemovendo(provedorId);
    try {
      const r = await chamar({
        action: "remove",
        provider_type: ehProvedorNativo(provedorId) ? provedorId : "custom",
        provider_id: provedorId,
      });
      if (r.queued) {
        toast({ title: `Removendo ${provedorId}…`, description: "Confirma em instantes — o card volta para disponível." });
        vigiar();
      } else {
        toast({ title: `Provedor ${provedorId} removido`, description: "Os modelos dele saíram do seletor." });
      }
      await recarregar();
    } catch (e) {
      toast({
        title: "Não removi",
        description: e instanceof Error ? e.message : "Falha ao falar com o gateway",
        variant: "destructive",
      });
    } finally {
      setRemovendo(null);
    }
  }, [recarregar, vigiar]);

  /** A chave pode estar no perfil nativo do gateway (funciona, mas não é
   *  gerenciada por aqui) — a tela precisa dizer isso em vez de mostrar
   *  "não conectado" sobre algo que responde. Vale para QUALQUER provedor
   *  com perfil `<id>:default`: na VPS real existem anthropic E gemini
   *  assim, e só a Anthropic ganhava o aviso. */
  const nativas = useMemo(() => {
    const s = new Set<string>();
    for (const chave of Object.keys(estado?.perfis ?? {})) {
      const id = chave.split(":")[0];
      if (chave.endsWith(":default") && !estado?.provedores?.[id]) s.add(id);
    }
    return s;
  }, [estado]);

  return { estado, carregando, erro, recarregar, vigiar, usoPorProvedor, remover, removendo, nativas };
}

export function DialogoProvedor({ tipoInicial, provedorId, modelosAtuais, aoFechar }: {
  tipoInicial: string;
  provedorId?: string;
  modelosAtuais: ModeloProvedor[];
  aoFechar: (mudou: boolean) => void;
}) {
  const editando = !!provedorId;
  const [tipo, setTipo] = useState(tipoInicial);
  const [chave, setChave] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [idCustom, setIdCustom] = useState(provedorId ?? "");

  // Escolha da lista de compatíveis: o endereço vem junto e some do formulário.
  const daLista = COMPATIVEIS_OPENAI.find((c) => c.valor === tipo);
  const digitando = tipo === "custom";
  const tipoParaEnvio = ehProvedorNativo(tipo) ? tipo : "custom";
  const idParaEnvio = provedorId ?? (daLista ? daLista.valor : apelidoDeProvedor(idCustom));
  const urlParaEnvio = daLista ? daLista.baseUrl : baseUrl;
  // Sem apelido e sem endereço o gateway recusa o provedor — melhor travar o
  // botão do que deixar a pessoa descobrir isso num erro depois de colar a chave.
  const faltaIdentidade = !editando && !ehProvedorNativo(tipo) && (!idParaEnvio || !urlParaEnvio);
  const [descobertos, setDescobertos] = useState<Array<{ id: string; name: string }> | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set(modelosAtuais.map((m) => m.id)));
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Editando sem trocar a chave: a lista de partida são os modelos já gravados.
  const lista = descobertos ?? (editando ? modelosAtuais.map((m) => ({ id: m.id, name: m.name })) : null);

  async function buscar() {
    setBuscando(true); setErro(null);
    try {
      let r = await chamar({
        action: "discover", provider_type: tipoParaEnvio,
        ...(chave ? { api_key: chave } : {}),
        ...(tipoParaEnvio === "custom" ? { provider_id: idParaEnvio, base_url: urlParaEnvio } : {}),
      });
      if (r.queued && r.op_id) {
        // Sem chave, a descoberta roda na VPS (a credencial já mora lá e
        // nunca viaja). Acompanha até o resultado chegar — segundos.
        for (let i = 0; i < 15; i++) {
          await new Promise((res) => setTimeout(res, 2500));
          const st = await chamar({ action: "discover_status", op_id: r.op_id });
          if (st.done) { r = st; break; }
        }
        if (r.queued) { setErro("a descoberta demorou demais — tente de novo"); return; }
      }
      if (r.error) { setErro(r.error); return; }
      if (!r.models) { setErro("não consegui listar os modelos"); return; }
      setDescobertos(r.models);
      // Mantém marcado o que já estava gravado e ainda existe na conta.
      setMarcados(new Set(modelosAtuais.map((m) => m.id).filter((id) => r.models.some((x: { id: string }) => x.id === id))));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha na descoberta");
    } finally {
      setBuscando(false);
    }
  }

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      const selecionados = (lista ?? []).filter((m) => marcados.has(m.id));
      // ⚠️ **A chave NÃO vai no salvar.** Ela serviu só para a busca de modelos
      // acima. O backend recusa `api_key` com 501, de propósito: ele não tem
      // como gravá-la, e aceitar em silêncio faria a tela dizer que mudou algo
      // que continuaria igual. O que este salvar faz é o catálogo — quais
      // modelos ficam no seletor.
      const r = await chamar({
        action: "save", provider_type: tipoParaEnvio,
        ...(tipoParaEnvio === "custom" ? { provider_id: idParaEnvio, base_url: urlParaEnvio } : {}),
        models: selecionados,
      });
      // ⚠️ Modelo que o gateway não resolve é recolhido pelo backend, e a
      // pessoa **precisa** saber: o id veio da API do provedor e parecia
      // legítimo. Calar aqui deixaria a tela mostrando uma seleção que não é
      // a que ficou gravada.
      const naoSuportados: string[] = r.nao_suportados ?? [];
      if (naoSuportados.length) {
        toast({
          variant: "destructive",
          title: `${naoSuportados.length} modelo(s) não suportado(s) pelo gateway`,
          description:
            `${naoSuportados.join(", ")} — a API do provedor oferece, mas este ` +
            "gateway não sabe executar, então foram retirados. Os demais ficaram.",
        });
      } else {
        toast({
          title: "Modelos atualizados",
          description:
            `${r.modelos ?? selecionados.length} modelo(s) no seletor` +
            (r.removidos ? `, ${r.removidos} removido(s).` : "."),
        });
      }
      aoFechar(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const visual = provedorId ? visualDoProvedor(provedorId) : null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) aoFechar(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {visual?.logo && (
              <img src={visual.logo} alt="" className="h-6 w-6 rounded-md object-cover" />
            )}
            {editando ? `${visual?.nome ?? provedorId}` : "Conectar uma IA"}
          </DialogTitle>
          {/* Uma linha. A explicação longa empurrava o formulário para baixo e
              encostava no primeiro campo — quem abre isto quer preencher. */}
          <DialogDescription>
            {editando
              ? "Escolha quais modelos ficam disponíveis no seletor."
              : "Liste os modelos do provedor e escolha quais ficam no seletor. A credencial em si é gravada no gateway, não aqui."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!editando && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">IA</Label>
              {/* Uma lista só, com as compatíveis nomeadas. "Outra" existe,
                  mas deixa de ser a porta de entrada de todo mundo que não é
                  nativo — e com ela some a pergunta "qual é a URL?". */}
              <Select value={tipo} onValueChange={(v) => { setTipo(v); setDescobertos(null); setErro(null); }}>
                <SelectTrigger><SelectValue placeholder="Escolha a IA" /></SelectTrigger>
                <SelectContent>
                  {TIPOS_LLM.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                  {COMPATIVEIS_OPENAI.map((c) => <SelectItem key={c.valor} value={c.valor}>{c.rotulo}</SelectItem>)}
                  <SelectItem value="custom">Outra IA…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {digitando && !editando && (
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nome da IA</Label>
                <Input placeholder="Groq" value={idCustom}
                  onChange={(e) => setIdCustom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Endereço da API</Label>
                <Input placeholder="https://api.groq.com/openai/v1" value={baseUrl} className="font-mono text-sm"
                  onChange={(e) => setBaseUrl(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">
                  Está na documentação da IA, como <span className="font-mono">base URL</span>.
                </p>
              </div>
            </div>
          )}

          {/* ⚠️ A chave aqui serve SÓ para perguntar ao provedor quais modelos
              existem. Ela não é gravada em lugar nenhum — nem aqui, nem no
              gateway, que não expõe método para isso (17 sondados em 13/08,
              todos `unknown method`). Quem grava é o CLI da VPS. Antes este
              campo dizia "Chave de API" e sugeria que salvar a instalaria. */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Chave de API — só para listar os modelos
            </Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={editando ? "vazio usa a chave já gravada no gateway" : "cole para listar os modelos"}
                value={chave}
                className="font-mono text-sm"
                onChange={(e) => setChave(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => void buscar()}
                disabled={buscando || (!chave && !editando) || faltaIdentidade}
                className="shrink-0 gap-1.5"
                title={editando && !chave ? "Busca com a chave já gravada" : undefined}
              >
                {buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Buscar modelos
              </Button>
            </div>
            {/* A pergunta que a tela precisa responder é "então onde eu ponho a
                chave?". Sem isto, quem chega aqui cola no único campo que
                existe e acha que instalou. */}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Esta chave não é gravada — serve só para perguntar ao provedor
              quais modelos existem. A credencial que os agentes usam fica no
              gateway, e quem a escreve é o CLI da VPS:{" "}
              <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
                openclaw models auth paste-api-key --agent &lt;id&gt;
              </code>
            </p>
          </div>

          {erro && (
            <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-lg px-3 py-2">{erro}</p>
          )}

          {lista && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Modelos disponíveis na sua conta
                </Label>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {marcados.size} de {lista.length} selecionado{marcados.size === 1 ? "" : "s"}
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border/40 divide-y divide-border/30">
                {lista.map((m) => (
                  <label key={m.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                    <Checkbox checked={marcados.has(m.id)} onCheckedChange={() => alternar(m.id)} />
                    <span className="font-mono text-xs">{m.id}</span>
                    {m.name && m.name !== m.id && <span className="text-[11px] text-muted-foreground truncate">{m.name}</span>}
                  </label>
                ))}
                {lista.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">nenhum modelo devolvido pela API</p>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => aoFechar(false)}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || marcados.size === 0 || faltaIdentidade}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Salvar {marcados.size > 0 ? `(${marcados.size} modelo${marcados.size > 1 ? "s" : ""})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
