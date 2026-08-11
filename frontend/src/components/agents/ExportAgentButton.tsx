import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  agentId: string;
  agentName?: string;
  variant?: "icon" | "button";
  className?: string;
}

function triggerDownload(fileName: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportAgentButton({ agentId, agentName, variant = "icon", className = "" }: Props) {
  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Contador simples de segundos enquanto processa — só pra deixar claro que
  // está trabalhando, não travado (a leitura real de arquivo pelo agente
  // ainda leva alguns segundos, mesmo mais rápida com o Flash).
  useEffect(() => {
    if (!busy) { setElapsedSec(0); return; }
    const start = Date.now();
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Chamada única e síncrona: o export-agent pede pro orquestrador ler os
  // arquivos AO VIVO na VPS (com as próprias ferramentas dele — não depende
  // do Gateway expor endpoint HTTP de leitura, que falha pra agentes sem
  // template público) e devolve o .hsos pronto na mesma resposta. Sem Loop
  // Architecture: exportação é só leitura, sem efeito colateral, então um
  // retry simples em caso de falha é seguro — não precisa de todo o controle
  // de estado (task/checkpoint/polling) que existe pra proteger contra
  // duplicar TRABALHO. Leva de dezenas de segundos a poucos minutos (leitura
  // real de múltiplos arquivos pelo agente).
  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<any>(`/agents/${encodeURIComponent(agentId)}/export`);
      if (!data || typeof data !== "object" || !((data as any).hsos_version ?? (data as any).dnos_version) || !(data as any).agent?.agent_id) {
        throw new Error((data as any)?.error || "Resposta inválida do servidor");
      }
      triggerDownload(`${agentId}.hsos`, JSON.stringify(data, null, 2));
      toast.success(`${agentName ?? agentId} exportado como ${agentId}.hsos`);
    } catch (err) {
      toast.error((err as Error).message || "Não foi possível exportar o agente.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "button") {
    return (
      <button
        onClick={handleExport}
        disabled={busy}
        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-full glass-card hover:border-primary/30 transition-colors disabled:opacity-50 ${className}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        <span className="font-display">{busy ? `Exportando... (${elapsedSec}s)` : "Exportar"}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      title={busy ? `Exportando... (${elapsedSec}s)` : "Exportar como .hsos"}
      className={`inline-flex items-center justify-center h-7 w-7 rounded-lg glass-card hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}
