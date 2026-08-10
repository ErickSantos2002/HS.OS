import { useState } from "react";
import { Shield, Eye, EyeOff, Copy, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

// A URL que a VPS deve chamar para gravar guardrails. É **texto mostrado**, não
// uma chamada daqui — quem chama é o serviço lá. Aponta para a nossa API, não
// mais para a edge function.
const ENDPOINT_URL = `${
  import.meta.env.VITE_API_URL || window.location.origin + "/api"
}/integracoes/guardrails`;

export default function GuardrailsTokenCard() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  async function reveal() {
    setLoading(true);
    try {
      const body = await api<{ token?: string }>("/integracoes/guardrails/token");
      if (!body.token) throw new Error("Token não configurado no backend");
      setToken(body.token);
      setVisible(true);
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast({ title: `${label} copiado` });
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-display font-bold">Guardrails API</h3>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          super_admin
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Endpoint dedicado para o agente orquestrador (Lia) cadastrar guardrails de cada agente
        diretamente via API. O token só permite escrever no campo <code className="font-mono">guardrails</code> de <code className="font-mono">agent_profiles</code>.
      </p>

      <div className="space-y-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Endpoint
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono bg-muted/40 rounded-md px-2 py-1.5 truncate">
              {ENDPOINT_URL}
            </code>
            <Button size="sm" variant="ghost" onClick={() => copy(ENDPOINT_URL, "Endpoint")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            GUARDRAILS_API_TOKEN
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono bg-muted/40 rounded-md px-2 py-1.5 truncate">
              {token ? (visible ? token : "•".repeat(64)) : "— oculto —"}
            </code>
            {token && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setVisible((v) => !v)}>
                  {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => copy(token, "Token")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            {!token && (
              <Button size="sm" onClick={reveal} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Revelar"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border/40">
        No VPS, salve em <code className="font-mono">/root/.openclaw/.env</code> como{" "}
        <code className="font-mono">GUARDRAILS_API_TOKEN=…</code> e referencie no <code className="font-mono">TOOLS.md</code>.
        Para rotacionar, gere um novo valor pelo painel de Secrets do Lovable Cloud.
      </p>
    </div>
  );
}
