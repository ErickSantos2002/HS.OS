/**
 * Agenda — os lembretes do Guardi e os eventos do Outlook (spec
 * 2026-11-09-agenda-lembretes, "Página Agenda").
 *
 * Desktop: lista agrupada à esquerda, calendário do mês à direita (ponto de
 * lembrete e de evento); clicar num dia filtra a lista. Celular (< 768px):
 * só a lista. Evento do Outlook é só leitura e nunca é gravado — vem do Graph
 * a cada abertura.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { CalendarClock, Loader2, MapPin, MoreVertical, Pause, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import FormLembrete from "@/components/agenda/FormLembrete";
import { useIsMobile } from "@/hooks/use-mobile";
import { ErroApi } from "@/lib/api";
import {
  agruparPorPeriodo, apagarLembrete, descreverRegra, diaEmBrasilia, diasComLembrete, diasDoEvento,
  editarLembrete, eventosOutlook, lembreteNoDia, listarLembretes, periodoDoDia, quandoLegivel,
  descreverResposta, rotuloStatus, somarDias, type EventoOutlook, type Lembrete,
} from "@/lib/agenda";
import { cn } from "@/lib/utils";

const CHAVE = ["agenda", "lembretes"];
const mensagem = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao);
/** Célula do calendário é meia-noite LOCAL: formatar pelo local, não por Brasília. */
const diaDaCelula = (d: Date) => format(d, "yyyy-MM-dd");
const diaLegivel = (dia: string) => format(new Date(`${dia}T12:00:00`), "EEEE, dd/MM", { locale: ptBR });

const AVISO_OUTLOOK: Record<string, string> = {
  sem_conta: "Conecte o e-mail em Configurações → Perfil para ver a agenda do Outlook aqui.",
  sem_permissao: "Reconecte o e-mail em Configurações → Perfil para ver a agenda do Outlook aqui.",
  erro: "Não consegui ler o Outlook agora. Os lembretes continuam valendo.",
};

export default function AgendaPage() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const hoje = useMemo(() => new Date(), []);
  const diaHoje = diaEmBrasilia(hoje);

  const [mes, setMes] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [diaFiltro, setDiaFiltro] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Lembrete | null>(null);
  const [apagando, setApagando] = useState<Lembrete | null>(null);

  const lembretes = useQuery({ queryKey: CHAVE, queryFn: () => listarLembretes(), retry: false });

  const inicioMes = diaDaCelula(mes);
  const fimMes = diaDaCelula(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));
  const temGuardi = lembretes.isSuccess;
  const outlookMes = useQuery({
    queryKey: ["agenda", "outlook", inicioMes, fimMes],
    queryFn: () => eventosOutlook(inicioMes, fimMes),
    enabled: temGuardi && !isMobile,
    staleTime: 5 * 60_000,
  });
  const fimProximos = somarDias(diaHoje, 6);
  const outlookProximos = useQuery({
    queryKey: ["agenda", "outlook", diaHoje, fimProximos],
    queryFn: () => eventosOutlook(diaHoje, fimProximos),
    enabled: temGuardi,
    staleTime: 5 * 60_000,
  });

  const recarregar = () => void qc.invalidateQueries({ queryKey: CHAVE });
  const pausar = useMutation({
    mutationFn: (l: Lembrete) => editarLembrete(l.id, { pausado: l.ativo }),
    onSuccess: (_r, l) => { toast.success(l.ativo ? "Lembrete pausado." : "Lembrete retomado."); recarregar(); },
    onError: (e) => toast.error(mensagem(e, "Não consegui mudar o lembrete.")),
  });
  const apagar = useMutation({
    mutationFn: (l: Lembrete) => apagarLembrete(l.id),
    onSuccess: () => { toast.success("Lembrete apagado."); recarregar(); },
    onError: (e) => toast.error(mensagem(e, "Não consegui apagar o lembrete.")),
    onSettled: () => setApagando(null),
  });

  const lista = useMemo(() => lembretes.data ?? [], [lembretes.data]);
  const grupos = useMemo(() => agruparPorPeriodo(lista, hoje), [lista, hoje]);
  const eventosProximos = useMemo(() => outlookProximos.data?.eventos ?? [], [outlookProximos.data]);
  const eventosPorPeriodo = useMemo(() => {
    const por: Record<string, EventoOutlook[]> = { hoje: [], amanha: [], semana: [], depois: [] };
    for (const e of eventosProximos) {
      const p = periodoDoDia(e.inicio.slice(0, 10), hoje);
      // Evento que começou antes e ainda está em curso conta como de hoje.
      (por[p === "passado" ? "hoje" : p] ??= []).push(e);
    }
    return por;
  }, [eventosProximos, hoje]);

  const diasLembrete = useMemo(() => diasComLembrete(lista, inicioMes, fimMes), [lista, inicioMes, fimMes]);
  const diasEvento = useMemo(() => new Set((outlookMes.data?.eventos ?? []).flatMap(diasDoEvento)), [outlookMes.data]);

  const abrirNovo = () => { setEditando(null); setFormAberto(true); };
  const abrirEdicao = (l: Lembrete) => { setEditando(l); setFormAberto(true); };

  const erroLista = lembretes.error;
  const semGuardi = erroLista instanceof ErroApi && erroLista.status === 404;
  const estadoOutlook = (isMobile ? outlookProximos : outlookMes).data?.estado;

  const item = (l: Lembrete) => (
    <ItemLembrete key={l.id} l={l} aoEditar={() => abrirEdicao(l)} aoPausar={() => pausar.mutate(l)} aoApagar={() => setApagando(l)} />
  );
  const evento = (e: EventoOutlook, i: number) => <ItemEvento key={`${e.inicio}-${i}`} e={e} />;

  const secao = (titulo: string, itens: Lembrete[], eventos: EventoOutlook[] = []) =>
    itens.length + eventos.length === 0 ? null : (
      <section key={titulo} className="space-y-2">
        <h2 className="text-xs font-display uppercase tracking-wider text-muted-foreground">{titulo}</h2>
        <div className="space-y-2">{eventos.map(evento)}{itens.map(item)}</div>
      </section>
    );

  const conteudoLista = () => {
    if (lembretes.isLoading) return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    if (erroLista) {
      return <p className="py-12 text-center text-sm text-muted-foreground">{mensagem(erroLista, "Não consegui carregar a agenda.")}</p>;
    }
    if (diaFiltro) {
      const doDia = lista.filter((l) => lembreteNoDia(l, diaFiltro));
      const eventosDoDia = (outlookMes.data?.eventos ?? []).filter((e) => diasDoEvento(e).includes(diaFiltro));
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-display font-semibold capitalize">{diaLegivel(diaFiltro)}</h2>
            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setDiaFiltro(null)}>
              <X className="h-3.5 w-3.5" /> Ver tudo
            </Button>
          </div>
          {doDia.length + eventosDoDia.length === 0
            ? <p className="text-sm text-muted-foreground">Nada marcado neste dia.</p>
            : <div className="space-y-2">{eventosDoDia.map(evento)}{doDia.map(item)}</div>}
        </div>
      );
    }
    const vazia = lista.length === 0 && eventosProximos.length === 0;
    if (vazia) {
      return (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Nenhum lembrete ainda. Crie um aqui ou peça ao seu Guardi na conversa — "me lembra amanhã às 9h de ligar para o cliente".
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {secao("Hoje", grupos.hoje, eventosPorPeriodo.hoje)}
        {secao("Amanhã", grupos.amanha, eventosPorPeriodo.amanha)}
        {secao("Esta semana", grupos.semana, eventosPorPeriodo.semana)}
        {secao("Depois", grupos.depois, eventosPorPeriodo.depois)}
        {secao("Recorrentes", grupos.recorrentes)}
        {secao("Já passaram", grupos.passados)}
        {secao("Pausados", grupos.pausados)}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/50 px-4 py-5 md:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-display font-semibold">
            <CalendarClock className="h-5 w-5 text-primary" /> Agenda
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Lembretes do seu Guardi e a sua agenda do Outlook</p>
        </div>
        {!semGuardi && !erroLista && (
          <Button onClick={abrirNovo} className="gap-2"><Plus className="h-4 w-4" /> Novo lembrete</Button>
        )}
      </div>

      <div className="flex-1 p-4 md:p-6">
        {estadoOutlook && estadoOutlook !== "ok" && (
          <p className="mb-4 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">{AVISO_OUTLOOK[estadoOutlook]}</p>
        )}
        <div className={cn("grid gap-6", !isMobile && "md:grid-cols-[minmax(0,1fr)_auto]")}>
          <div className="min-w-0">{conteudoLista()}</div>
          {!isMobile && temGuardi && (
            <aside className="h-fit rounded-xl border border-border/40 bg-card/60">
              <Calendar
                mode="single"
                locale={ptBR}
                weekStartsOn={1}
                month={mes}
                onMonthChange={(m) => { setMes(m); setDiaFiltro(null); }}
                selected={diaFiltro ? new Date(`${diaFiltro}T12:00:00`) : undefined}
                onSelect={(d) => setDiaFiltro(d ? diaDaCelula(d) : null)}
                modifiers={{
                  lembrete: (d) => diasLembrete.has(diaDaCelula(d)),
                  evento: (d) => diasEvento.has(diaDaCelula(d)),
                }}
                modifiersClassNames={{
                  lembrete: "relative after:absolute after:bottom-1 after:left-[calc(50%-5px)] after:h-1 after:w-1 after:rounded-full after:bg-primary aria-selected:after:bg-primary-foreground",
                  evento: "relative before:absolute before:bottom-1 before:left-[calc(50%+1px)] before:h-1 before:w-1 before:rounded-full before:bg-sky-500",
                }}
              />
              <div className="flex gap-4 border-t border-border/30 px-4 py-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Lembrete</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Outlook</span>
              </div>
            </aside>
          )}
        </div>
      </div>

      <FormLembrete open={formAberto} onOpenChange={setFormAberto} editando={editando} aoSalvar={recarregar} />

      <AlertDialog open={!!apagando} onOpenChange={(v) => !v && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar lembrete?</AlertDialogTitle>
            <AlertDialogDescription>"{apagando?.titulo}" deixa de existir. Para só parar por um tempo, use Pausar.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => apagando && apagar.mutate(apagando)}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemLembrete({ l, aoEditar, aoPausar, aoApagar }: { l: Lembrete; aoEditar: () => void; aoPausar: () => void; aoApagar: () => void }) {
  const recorrente = l.regra.tipo !== "unico";
  const falhou = l.ultimo_status === "perdido" || l.ultimo_status === "erro";
  // O que a pessoa fez com o aviso (spec 2026-11-13). Falha continua mostrando o status.
  const resposta = falhou ? null : descreverResposta(l);
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border bg-card/60 px-3 py-2.5", l.ativo ? "border-border/40" : "border-border/20 opacity-70")}>
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words text-sm font-medium text-foreground">{l.titulo}</span>
          {l.criado_por === "guardi" && (
            <Badge variant="outline" className="gap-1 border-primary/30 px-1.5 py-0 text-[10px] text-primary">
              <Sparkles className="h-2.5 w-2.5" /> criado pelo Guardi
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {descreverRegra(l.regra)}
          {recorrente && l.ativo && l.proximo_em && <> · próximo {quandoLegivel(l.proximo_em)}</>}
        </p>
        {l.instrucao && <p className="line-clamp-2 break-words text-xs text-muted-foreground/80">Guardi: {l.instrucao}</p>}
        {l.ultimo_disparo_em || l.ultimo_status ? (
          <p className={cn("text-[11px]", falhou ? "text-destructive" : "text-muted-foreground")}>
            Último disparo{l.ultimo_disparo_em && <> {quandoLegivel(l.ultimo_disparo_em)}</>}
            {resposta ? <> · {resposta}</> : l.ultimo_status && <> · {rotuloStatus(l.ultimo_status)}</>}
          </p>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Ações do lembrete"><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={aoEditar}><Pencil className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
          <DropdownMenuItem onClick={aoPausar}>
            {l.ativo ? <><Pause className="mr-2 h-4 w-4" /> Pausar</> : <><Play className="mr-2 h-4 w-4" /> Retomar</>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={aoApagar} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Apagar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ItemEvento({ e }: { e: EventoOutlook }) {
  const hora = e.dia_inteiro ? "Dia inteiro" : `${e.inicio.slice(11, 16)}–${e.fim.slice(11, 16)}`;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2.5">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-foreground">{e.titulo || "(sem assunto)"}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>Outlook · {e.inicio.slice(8, 10)}/{e.inicio.slice(5, 7)} {hora}</span>
          {e.local && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {e.local}</span>}
        </p>
      </div>
    </div>
  );
}
