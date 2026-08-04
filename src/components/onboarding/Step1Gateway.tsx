import { useEffect, useState } from "react";
import {
  Server,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Eye,
  EyeOff,
  ClipboardPaste,
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { loadGatewayConfig, saveGatewayConfig, testConnection } from "@/lib/gateway";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; version?: string | null }
  | { kind: "error"; message: string };

type ApplyState =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "done"; saved: string[]; missing: string[] }
  | { kind: "error"; message: string };

interface Step1GatewayProps {
  onValidated: (valid: boolean) => void;
}

/**
 * Lê a mensagem de erro que a edge function devolveu no corpo.
 *
 * `functions.invoke` não expõe o corpo em `error.message` quando o status não é
 * 2xx — ele vem em `error.context`, que é a Response crua. Sem isto o usuário vê
 * "Edge Function returned a non-2xx status code", que não diz o que corrigir.
 */
async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* corpo não era JSON — cai no genérico abaixo */
    }
  }
  return (error as { message?: string })?.message || "Falha ao aplicar o bloco.";
}

export function Step1Gateway({ onValidated }: Step1GatewayProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const [block, setBlock] = useState("");
  const [apply, setApply] = useState<ApplyState>({ kind: "idle" });

  useEffect(() => {
    void loadGatewayConfig().then((cfg) => {
      if (cfg.url) setUrl(cfg.url);
      if (cfg.token) setToken(cfg.token);
    });
  }, []);

  // Any edit invalidates a previous test.
  useEffect(() => {
    if (test.kind === "success" || test.kind === "error") {
      setTest({ kind: "idle" });
      onValidated(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token]);

  const canTest = url.trim().length > 0 && token.trim().length > 0 && test.kind !== "testing";

  const runTest = async (override?: { url: string; token: string }) => {
    const target = {
      url: (override?.url ?? url).trim(),
      token: (override?.token ?? token).trim(),
    };
    setTest({ kind: "testing" });
    onValidated(false);
    const result = await testConnection(target);
    if (result.success) {
      setSaving(true);
      const { error } = await saveGatewayConfig(target);
      setSaving(false);
      if (error) {
        setTest({ kind: "error", message: "Conexão OK, mas falhou ao salvar a configuração." });
        onValidated(false);
        return;
      }
      setTest({ kind: "success", version: result.version });
      onValidated(true);
    } else {
      setTest({
        kind: "error",
        message: result.error || "Não foi possível conectar. Verifique a URL.",
      });
      onValidated(false);
    }
  };

  /**
   * Envia o bloco inteiro para a edge function, que distribui os valores:
   * endereço e token vão para `vps_config`, os oito segredos de integração vão
   * para `integration_secrets`. O navegador nunca decide onde cada chave mora —
   * a allowlist fica no servidor.
   */
  const applyBlock = async () => {
    setApply({ kind: "applying" });
    const { data, error } = await supabase.functions.invoke("save-install-block", {
      body: { block },
    });

    if (error) {
      setApply({ kind: "error", message: await readFunctionError(error) });
      return;
    }

    setApply({
      kind: "done",
      saved: data?.secretsSaved ?? [],
      missing: data?.secretsMissing ?? [],
    });

    // Relê do banco em vez de confiar no que foi colado: o que vale é o que
    // ficou gravado. Já testa a conexão em seguida — o usuário colou o bloco
    // justamente para não ter de apertar mais nada.
    const cfg = await loadGatewayConfig();
    setUrl(cfg.url);
    setToken(cfg.token);
    if (cfg.url && cfg.token) {
      await runTest({ url: cfg.url, token: cfg.token });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-6 md:p-8">
      <div className="flex items-start gap-3 mb-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Server className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold">Conectar ao Gateway</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cole aqui o bloco que o instalador imprimiu no final da instalação.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Label htmlFor="install-block">Bloco do instalador</Label>
        <Textarea
          id="install-block"
          value={block}
          onChange={(e) => {
            setBlock(e.target.value);
            if (apply.kind !== "applying") setApply({ kind: "idle" });
          }}
          spellCheck={false}
          rows={7}
          placeholder={"GATEWAY_URL=http://…\nOPENCLAW_ADMIN_TOKEN=…\nBROADCAST_API_KEY=…\n…"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Copie tudo, da primeira à última linha. As linhas com <code>#</code> e as bordas da
          caixa são ignoradas.
        </p>

        <Button
          type="button"
          onClick={applyBlock}
          disabled={block.trim().length === 0 || apply.kind === "applying"}
        >
          {apply.kind === "applying" ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Aplicando…
            </>
          ) : (
            <>
              <ClipboardPaste className="h-4 w-4 mr-1.5" />
              Aplicar bloco
            </>
          )}
        </Button>

        {apply.kind === "error" ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{apply.message}</span>
          </div>
        ) : null}

        {apply.kind === "done" ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Bloco aplicado — {apply.saved.length}{" "}
                {apply.saved.length === 1 ? "chave salva" : "chaves salvas"}.
              </span>
            </div>
            {apply.missing.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p>
                    Não vieram no bloco:{" "}
                    <span className="font-mono">{apply.missing.join(", ")}</span>
                  </p>
                  <p className="mt-1 opacity-80">
                    A plataforma funciona sem elas, mas as integrações que dependem dessas
                    chaves vão recusar as chamadas. Rode o instalador de novo para gerá-las.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-8 pt-6 border-t border-border/60 space-y-4">
        <p className="text-sm text-muted-foreground">
          Não tem o bloco? Preencha manualmente:
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="gateway-url">URL do Gateway</Label>
          <Input
            id="gateway-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="http://IP:18789"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gateway-token">Admin Token</Label>
          <div className="relative">
            <Input
              id="gateway-token"
              type={showToken ? "text" : "password"}
              autoComplete="off"
              placeholder="••••••••"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "Ocultar token" : "Mostrar token"}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="button"
            onClick={() => void runTest()}
            disabled={!canTest || saving}
            variant={test.kind === "success" ? "outline" : "default"}
          >
            {test.kind === "testing" || saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Testando…
              </>
            ) : (
              "Testar conexão"
            )}
          </Button>
        </div>

        {test.kind === "success" ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Gateway respondendo{test.version ? ` (v${test.version})` : ""}.</span>
          </div>
        ) : null}

        {test.kind === "error" ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{test.message}</span>
          </div>
        ) : null}
      </div>

      <div className={cn("mt-6 pt-4 border-t border-border/60 text-xs text-muted-foreground")}>
        Ainda não tem um VPS?{" "}
        <a
          href="https://docs.dnia.ai/vps-setup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Acesse nosso guia
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
