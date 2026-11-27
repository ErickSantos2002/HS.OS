/**
 * Seletor do "Encaminhar" — estilo WhatsApp (spec 2026-11-27-encaminhar-mensagem).
 *
 * Montado UMA vez no `App.tsx`: serve o desktop e o app do celular (que vive
 * fora do `AppLayout`). Abre quando a ação da mensagem chama `abrirEncaminhar`;
 * a lista só é buscada ao abrir — nada a mais no carregamento do app.
 *
 * O Guardi não recebe envio: o servidor copia os anexos para a conversa com
 * ele e a tela abre essa conversa com tudo no campo, esperando a pessoa dizer
 * o que quer (decisão do Erick, 27/11/2026).
 */
import { Forward, Hash, Loader2, Search, ShieldCheck, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  carregarDestinos, encaminhar, fecharEncaminhar, guardarParaOGuardi, LIMITE_DESTINOS,
  useOrigemEncaminhar, type DestinosEncaminhar,
} from "@/lib/encaminhar";

type Chave = `p:${string}` | `c:${string}` | "guardi";

interface Linha { chave: Chave; nome: string; icone?: React.ReactNode; nota?: string; avatar?: string | null }

function semAcento(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Iniciais({ nome, avatar }: { nome: string; avatar?: string | null }) {
  if (avatar) return <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />;
  const ini = nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">{ini}</span>;
}

export default function EncaminharDialog() {
  const origem = useOrigemEncaminhar();
  const navigate = useNavigate();
  const [destinos, setDestinos] = useState<DestinosEncaminhar | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<Chave>>(new Set());
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!origem) return;
    setBusca("");
    setMarcados(new Set());
    setErro(null);
    let vivo = true;
    carregarDestinos()
      .then((d) => { if (vivo) setDestinos(d); })
      .catch(() => { if (vivo) setErro("Não consegui carregar a lista. Tente de novo."); });
    return () => { vivo = false; };
  }, [origem]);

  const secoes = useMemo(() => {
    if (!destinos) return [];
    const q = semAcento(busca.trim());
    const casa = (l: Linha) => !q || semAcento(l.nome).includes(q);
    const topo: Linha[] = [
      ...(destinos.guardi ? [{ chave: "guardi" as Chave, nome: destinos.guardi.nome, nota: "vira rascunho",
        icone: <ShieldCheck className="h-4 w-4 text-primary" /> }] : []),
      ...(destinos.pessoal ? [{ chave: `c:${destinos.pessoal}` as Chave, nome: "Você (anotações)",
        icone: <StickyNote className="h-4 w-4" /> }] : []),
    ];
    const grupos: Linha[] = destinos.grupos.map((g) => ({ chave: `c:${g.id}` as Chave, nome: g.nome, icone: <Hash className="h-4 w-4" /> }));
    const pessoas: Linha[] = destinos.pessoas.map((p) => ({ chave: `p:${p.id}` as Chave, nome: p.nome, avatar: p.avatar_url }));
    return [
      { titulo: null, linhas: topo.filter(casa) },
      { titulo: "Grupos", linhas: grupos.filter(casa) },
      { titulo: "Pessoas", linhas: pessoas.filter(casa) },
    ].filter((s) => s.linhas.length > 0);
  }, [destinos, busca]);

  const alternar = (c: Chave) => setMarcados((atual) => {
    const novo = new Set(atual);
    if (novo.has(c)) novo.delete(c);
    else if (novo.size < LIMITE_DESTINOS) novo.add(c);
    return novo;
  });

  const nomeDe = (destino: string) => {
    if (destino === "guardi") return destinos?.guardi?.nome ?? "Guardi";
    if (destino === destinos?.pessoal) return "suas anotações";
    return destinos?.pessoas.find((p) => p.id === destino)?.nome
      ?? destinos?.grupos.find((g) => g.id === destino)?.nome ?? destino;
  };

  const enviar = async () => {
    if (!origem || marcados.size === 0) return;
    setEnviando(true);
    try {
      const lista = [...marcados];
      const r = await encaminhar(origem, {
        pessoas: lista.filter((c) => c.startsWith("p:")).map((c) => c.slice(2)),
        canais: lista.filter((c) => c.startsWith("c:")).map((c) => c.slice(2)),
        guardi: marcados.has("guardi"),
      });
      if (r.enviados.length > 0) {
        toast.success(r.enviados.length === 1
          ? `Encaminhada para ${nomeDe(r.enviados[0].destino)}`
          : `Encaminhada para ${r.enviados.length} conversas`);
      }
      if (r.falhas.length > 0) {
        toast.error(`Não foi para: ${r.falhas.map((f) => `${nomeDe(f.destino)} (${f.motivo})`).join("; ")}`);
      }
      fecharEncaminhar();
      if (r.guardi) {
        // O texto é montado ao abrir a conversa, junto do rascunho que já houver.
        guardarParaOGuardi({ agentId: r.guardi.agent_id, autor: r.guardi.autor,
          texto: r.guardi.texto, anexos: r.guardi.anexos });
        navigate(`/chat?agent=${encodeURIComponent(r.guardi.agent_id)}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui encaminhar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={!!origem} onOpenChange={(aberto) => { if (!aberto && !enviando) fecharEncaminhar(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-4 sm:max-w-md max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Encaminhar para…</DialogTitle>
        </DialogHeader>
        {origem?.previa && (
          <p className="truncate rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">↪ {origem.previa}</p>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="pl-8" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {erro && <p className="py-6 text-center text-sm text-destructive">{erro}</p>}
          {!erro && !destinos && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />}
          {destinos && secoes.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Ninguém com esse nome.</p>}
          {secoes.map((s) => (
            <div key={s.titulo ?? "topo"} className="mb-2">
              {s.titulo && <p className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.titulo}</p>}
              {s.linhas.map((l) => {
                const marcado = marcados.has(l.chave);
                const cheio = !marcado && marcados.size >= LIMITE_DESTINOS;
                return (
                  <label key={l.chave} className={`flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted ${cheio ? "opacity-50" : ""}`}>
                    <Checkbox checked={marcado} disabled={cheio} onCheckedChange={() => alternar(l.chave)} />
                    {l.icone ? <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">{l.icone}</span> : <Iniciais nome={l.nome} avatar={l.avatar} />}
                    <span className="min-w-0 flex-1 truncate text-sm">{l.nome}</span>
                    {l.nota && <span className="text-[11px] text-muted-foreground">{l.nota}</span>}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">{marcados.size} de {LIMITE_DESTINOS}</span>
          <Button onClick={() => void enviar()} disabled={marcados.size === 0 || enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Forward className="mr-2 h-4 w-4" />}
            Encaminhar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
