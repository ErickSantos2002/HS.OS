/**
 * A janela de lembrete (spec 2026-11-13, "Camada 2"): cartão no centro da
 * tela, com som, que só sai com "Adiar 10 min" ou "Feito" — o padrão do Teams.
 * Montada uma vez na `CascaDoApp`, vale para o desktop e para o app do celular.
 *
 * Em 13/11/2026 a Sandra não viu o lembrete das 14:00: o push apareceu e
 * sumiu. Notificação que some serve para mensagem, não para lembrete.
 *
 * "Abrir conversa" leva à conversa do Guardi e RECOLHE o cartão numa barra no
 * rodapé — a decisão continua pendente e à vista, sem tapar a conversa.
 *
 * A lista vem do servidor (`lib/janela-de-lembrete.ts`): o tempo real só pede
 * para buscar de novo. Responder fecha a notificação do sistema deste
 * aparelho; nas outras abas e aparelhos a janela fecha pelo evento do banco.
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock, BellOff, Check, MessageCircle, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/auth-context";
import { lembretesPendentes, responderLembrete, type LembretePendente } from "@/lib/agenda";
import {
  chaveDoAviso,
  ALARME_INTERVALO_MS,
  alarmeTocando,
  compararAvisos,
  fecharNotificacaoDoLembrete,
  mudaAJanela,
  tituloDaAba,
} from "@/lib/janela-de-lembrete";
import { assinar } from "@/lib/realtime";
import { prepararSom, tocarAlarme } from "@/lib/som-de-lembrete";

const hora = (iso: string) => iso.slice(11, 16);

export function JanelaDeLembrete() {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pendentes, setPendentes] = useState<LembretePendente[]>([]);
  const [recolhida, setRecolhida] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [silenciado, setSilenciado] = useState(false);
  const [alarmeDesde, setAlarmeDesde] = useState<number | null>(null);
  const vistos = useRef(new Set<string>());
  const anteriores = useRef<LembretePendente[]>([]);

  const carregar = useCallback(async () => {
    let lista: LembretePendente[];
    try {
      lista = await lembretesPendentes();
    } catch {
      return; // fora do ar ou sem Guardi: nada a mostrar, o push segue valendo
    }
    const { novos, sumiram } = compararAvisos(vistos.current, anteriores.current, lista);
    for (const p of novos) vistos.current.add(chaveDoAviso(p));
    for (const id of sumiram) void fecharNotificacaoDoLembrete(id);
    anteriores.current = lista;
    setPendentes(lista);
    if (novos.length > 0) {
      setRecolhida(false);
      setSilenciado(false);
      setAlarmeDesde(Date.now());
    }
    if (lista.length === 0) setAlarmeDesde(null);
  }, []);

  useEffect(() => prepararSom(), []);

  // O alarme: toca já e repete enquanto pendente, também com a aba oculta.
  const haPendente = pendentes.length > 0;
  useEffect(() => {
    const tocando = () =>
      alarmeTocando({ pendente: haPendente, recolhida, silenciado, desde: alarmeDesde, agora: Date.now() });
    if (!tocando()) return;
    void tocarAlarme();
    const id = window.setInterval(() => {
      if (tocando()) void tocarAlarme();
      else window.clearInterval(id);
    }, ALARME_INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [haPendente, recolhida, silenciado, alarmeDesde]);

  // O título da aba pisca enquanto houver lembrete esperando resposta.
  const tituloPendente = pendentes[0]?.titulo;
  useEffect(() => {
    if (!tituloPendente) return;
    const base = document.title;
    let aceso = false;
    const id = window.setInterval(() => {
      aceso = !aceso;
      document.title = tituloDaAba(base, tituloPendente, aceso);
    }, 1_000);
    return () => {
      window.clearInterval(id);
      document.title = base;
    };
  }, [tituloPendente]);

  useEffect(() => {
    if (!user?.id) return;
    void carregar();
    // Rajadas de evento (a resposta do Guardi chega aos pedaços): uma busca só.
    let espera: number | null = null;
    const cancelar = assinar(`usuario:${user.id}`, (_tipo, dados) => {
      if (!mudaAJanela(dados)) return;
      if (espera !== null) window.clearTimeout(espera);
      espera = window.setTimeout(() => {
        espera = null;
        void carregar();
      }, 400);
    });
    // Voltou para a aba depois de horas: pode haver aviso que o tempo real perdeu.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      cancelar();
      if (espera !== null) window.clearTimeout(espera);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [user?.id, carregar]);

  const atual = pendentes[0];
  if (!atual) return null;

  const responder = async (acao: "adiar" | "feito") => {
    setEnviando(true);
    try {
      await responderLembrete(atual.id, acao, atual.aviso_em);
      void fecharNotificacaoDoLembrete(atual.id);
      const resto = pendentes.filter((p) => p.id !== atual.id);
      anteriores.current = resto;
      setPendentes(resto);
      void qc.invalidateQueries({ queryKey: ["agenda", "lembretes"] });
      if (acao === "adiar") toast.success("Lembrete adiado por 10 minutos.");
    } catch {
      toast.error("Não consegui registrar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const abrirConversa = () => {
    setRecolhida(true);
    navigate(`/chat?agent=${encodeURIComponent(atual.agent_id)}`);
  };

  const outros = pendentes.length - 1;
  const botoes = (
    <>
      <Button variant="outline" disabled={enviando} onClick={() => void responder("adiar")}>
        <BellOff className="mr-1.5 h-4 w-4" /> Adiar 10 min
      </Button>
      <Button disabled={enviando} onClick={() => void responder("feito")}>
        <Check className="mr-1.5 h-4 w-4" /> Feito
      </Button>
    </>
  );

  if (recolhida) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 bottom-4 z-[100] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-2xl border border-primary/40 bg-card px-3 py-2 shadow-2xl"
      >
        <AlarmClock className="h-4 w-4 shrink-0 text-primary" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium"
          onClick={() => setRecolhida(false)}
          title="Abrir o lembrete"
        >
          {atual.titulo}
        </button>
        <div className="flex shrink-0 gap-1.5 [&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs">{botoes}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="janela-lembrete-titulo"
        className="w-full max-w-sm space-y-4 rounded-2xl border border-primary/40 bg-card p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <AlarmClock className="h-4 w-4" />
          Lembrete · {hora(atual.aviso_em)}
          {atual.reavisos > 0 && <span className="rounded bg-primary/15 px-1.5 py-0.5 normal-case">de novo</span>}
        </div>
        <div className="space-y-1.5">
          <h2 id="janela-lembrete-titulo" className="break-words text-lg font-semibold text-foreground">
            {atual.titulo}
          </h2>
          {atual.instrucao && (
            <p className="line-clamp-4 break-words text-sm text-muted-foreground">{atual.instrucao}</p>
          )}
          <p className="text-xs text-muted-foreground/80">do seu {atual.agente_nome}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">{botoes}</div>
        {!silenciado && alarmeDesde !== null && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setSilenciado(true)}>
            <VolumeX className="mr-1.5 h-4 w-4" /> Silenciar alarme
          </Button>
        )}
        <Button variant="ghost" size="sm" className="w-full" onClick={abrirConversa}>
          <MessageCircle className="mr-1.5 h-4 w-4" /> Abrir conversa
        </Button>
        {outros > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            + {outros} {outros === 1 ? "outro lembrete" : "outros lembretes"} esperando
          </p>
        )}
      </div>
    </div>
  );
}
