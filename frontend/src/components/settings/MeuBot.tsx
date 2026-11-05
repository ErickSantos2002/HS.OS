/**
 * "Meu bot": a pessoa escolhe o nome de exibição e a foto do bot pessoal
 * (05/11/2026). O id interno (`gustavo-bot`) não muda — é a chave da sessão.
 * A foto vai para `agent-files/avatars/<id>.<ext>`, onde o resto do sistema já
 * procura o avatar dos agentes.
 */
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ErroApi } from "@/lib/api";
import { enviarArquivo, urlPublica } from "@/lib/storage";

interface MeuBotDados { agent_id: string; nome: string; prefixo: string; sufixo: string; avatar_url: string | null }

export default function MeuBot() {
  const [b, setB] = useState<MeuBotDados | null>(null);
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);   // força recarregar a foto depois de trocar

  useEffect(() => {
    api<MeuBotDados>("/bots/meu").then((d) => { setB(d); setNome(d.prefixo); }).catch(() => setB(null));
  }, []);
  if (!b) return null;

  const salvar = async (corpo: { prefixo?: string; avatar_url?: string }) => {
    setOcupado(true);
    try {
      const d = await api<MeuBotDados>("/bots/meu", { method: "PATCH", body: corpo });
      setB(d); setNome(d.prefixo); toast.success("Seu bot foi atualizado.");
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : "Não consegui salvar.");
    } finally {
      setOcupado(false);
    }
  };

  const foto = async (f: File | undefined) => {
    if (!f) return;
    const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    if (!["png", "jpg", "webp", "gif"].includes(ext) || f.size > 1_000_000) {
      toast.error("Use PNG, JPG, WEBP ou GIF de até 1 MB.");
      return;
    }
    setOcupado(true);
    try {
      await enviarArquivo("agent-files", `avatars/${b.agent_id}.${ext}`, f);
      await salvar({ avatar_url: urlPublica("agent-files", `avatars/${b.agent_id}.${ext}`) });
      setVersao(Date.now());
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : "Não consegui enviar a foto.");
      setOcupado(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      <label className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border/40 bg-background">
        {b.avatar_url ? <img src={versao ? `${b.avatar_url}?v=${versao}` : b.avatar_url} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-xl">🤖</span>}
        <span className="absolute inset-x-0 bottom-0 flex justify-center bg-black/50 py-0.5"><Upload className="h-3 w-3 text-white" /></span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={ocupado} onChange={(e) => void foto(e.target.files?.[0])} />
      </label>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-display font-semibold text-foreground">Meu bot</h3>
        <div className="mt-1 flex gap-2">
          {/* Só o prefixo é da pessoa; o sufixo é da empresa e fica fixo ao lado. */}
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-border/40 bg-background">
            <input value={nome} maxLength={20} onChange={(e) => setNome(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-foreground outline-none" />
            <span className="shrink-0 select-none pr-2 text-sm text-muted-foreground">{b.sufixo}</span>
          </div>
          <button disabled={ocupado || nome.trim() === b.prefixo} onClick={() => void salvar({ prefixo: nome })} className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">Salvar nome</button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Clique na foto para trocar. O time e os outros agentes passam a conhecê-lo por esse nome.</p>
      </div>
    </div>
  );
}
