/**
 * Assinatura de e-mail (modelo do HSGrowth): texto antes, até 2 imagens (GIF
 * animado incluso) e texto depois (ex. aviso LGPD). Sai no fim de todo e-mail
 * que o bot pessoal prepara, com as imagens embutidas.
 *
 * Desde 06/11/2026 os textos vêm preenchidos com o padrão da empresa (campo
 * vazio vale o padrão no servidor) e o "Salvar" avisa quando há edição não
 * salva — duas pessoas tinham saído sem assinatura por esquecer de salvar.
 */
import { useEffect, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErroApi, lerToken } from "@/lib/api";
import { apagarImagemAssinatura, enviarImagemAssinatura, salvarTextoAssinatura, verAssinatura, type Assinatura } from "@/lib/email";

async function urlDaImagem(ordem: number): Promise<string | null> {
  try {
    // <img> não manda o Bearer: busca como blob com o token e mostra por URL local.
    const r = await fetch(`${import.meta.env.VITE_API_URL || "/api"}/email/assinatura/imagem/${ordem}`, {
      headers: { Authorization: `Bearer ${lerToken() ?? ""}` },
    });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  } catch { return null; }
}

export default function AssinaturaEmail() {
  const [ass, setAss] = useState<Assinatura | null>(null);
  const [antes, setAntes] = useState("");
  const [depois, setDepois] = useState("");
  const [urls, setUrls] = useState<Record<number, string | null>>({});
  const [ocupado, setOcupado] = useState(false);
  const [salvos, setSalvos] = useState({ antes: "", depois: "" });

  const carregar = async () => {
    const a = await verAssinatura();
    setAss(a); setAntes(a.texto_antes); setDepois(a.texto_depois);
    setSalvos({ antes: a.texto_antes, depois: a.texto_depois });
    const u: Record<number, string | null> = {};
    for (const i of a.imagens) u[i.ordem] = await urlDaImagem(i.ordem);
    setUrls(u);
  };
  useEffect(() => { void carregar().catch(() => setAss(null)); }, []);
  if (!ass) return null;
  const alterado = antes !== salvos.antes || depois !== salvos.depois;

  const salvar = async () => {
    setOcupado(true);
    try { await salvarTextoAssinatura(antes, depois); await carregar(); toast.success("Assinatura salva."); }
    catch (e) { toast.error(e instanceof ErroApi ? e.message : "Não consegui salvar."); }
    finally { setOcupado(false); }
  };
  const enviar = async (ordem: number, f: File | undefined) => {
    if (!f) return;
    setOcupado(true);
    try { await enviarImagemAssinatura(ordem, f); await carregar(); toast.success("Imagem salva."); }
    catch (e) { toast.error(e instanceof ErroApi ? e.message : "Não consegui enviar a imagem."); }
    finally { setOcupado(false); }
  };
  const apagar = async (ordem: number) => {
    await apagarImagemAssinatura(ordem); await carregar();
  };

  return (
    <div className="rounded-xl border border-border/30 bg-secondary/20 px-4 py-3 space-y-3">
      <div>
        <h3 className="text-sm font-display font-semibold text-foreground">Assinatura de e-mail</h3>
        <p className="text-xs text-muted-foreground mt-1">Vai no fim de todo e-mail que o seu Guardi preparar. Imagens: PNG, JPG, WEBP ou GIF animado, até 2 MB cada.</p>
      </div>
      <label className="block text-xs text-muted-foreground">Texto antes (já vem com o padrão da empresa; edite se precisar)
        <textarea value={antes} onChange={(e) => setAntes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-border/40 bg-background p-2 text-sm text-foreground" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {[1, 2].map((o) => {
          const tem = ass.imagens.some((i) => i.ordem === o);
          return (
            <div key={o} className="rounded-md border border-dashed border-border/40 p-2 text-xs">
              <div className="mb-1 text-muted-foreground">Imagem {o}</div>
              {tem && urls[o] && <img src={urls[o]!} alt="" className="mb-2 max-h-28 max-w-full" />}
              <div className="flex gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/40 px-2 py-1 hover:bg-secondary/50">
                  <Upload className="h-3 w-3" /> {tem ? "Trocar" : "Enviar imagem"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={ocupado} onChange={(e) => void enviar(o, e.target.files?.[0])} />
                </label>
                {tem && <button onClick={() => void apagar(o)} className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-1 hover:text-destructive"><Trash2 className="h-3 w-3" /> Remover</button>}
              </div>
            </div>
          );
        })}
      </div>
      <label className="block text-xs text-muted-foreground">Texto depois (aviso LGPD padrão da empresa; edite se precisar — vazio volta ao padrão)
        <textarea value={depois} onChange={(e) => setDepois(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border/40 bg-background p-2 text-sm text-foreground" />
      </label>
      <div className="flex items-center justify-end gap-3">
        {alterado && <span className="text-xs text-amber-500">Alterações não salvas — o e-mail sai com o texto anterior até você salvar.</span>}
        <button disabled={ocupado || !alterado} onClick={() => void salvar()} className="rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">Salvar texto</button>
      </div>
    </div>
  );
}
