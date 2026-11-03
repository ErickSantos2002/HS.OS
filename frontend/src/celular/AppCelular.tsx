/**
 * O HS.OS no celular — spec `2026-11-03-app-celular-design.md`.
 *
 * Interface própria, com a sensação do WhatsApp, para `/` e `/chat` em tela
 * estreita. Telas empilhadas que espelham a URL (`pilha.ts`): o voltar do
 * Android e do navegador desempilha, e os links do push abrem a tela certa em
 * cima da lista. Fora do `AppLayout`; o resto do sistema segue como está.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAgents } from "@/hooks/use-agents";
import { useCanaisSilenciados } from "@/hooks/use-canais-silenciados";
import { useChannels } from "@/hooks/use-channels";
import { useDmPeers } from "@/hooks/use-dm-members";
import { useAuthContext } from "@/contexts/auth-context";
import { getAgentIdAliases } from "@/lib/agent-id";
import "./celular.css";
import { Cabecalho } from "./Cabecalho";
import { pilhaDaUrl, urlAoAbrir, urlDaAba, urlDaPilha, urlDoPai, type Aba, type Painel, type Tela } from "./pilha";
import { TelaConversaAgente } from "./TelaConversaAgente";
import { TelaConversaCanal } from "./TelaConversaCanal";
import { TelaInicio } from "./TelaInicio";
import { TelaThread } from "./TelaThread";
import { Avatar } from "./ui";
import { useMapaDmDoAgente } from "./use-lista";

const DURACAO_SAIDA_MS = 280;

function chaveDa(t: Tela): string {
  switch (t.tipo) {
    case "inicio": return "inicio";
    case "agente": return `agente:${t.id}`;
    case "canal": return `canal:${t.id}`;
    case "thread": return `thread:${t.canal}:${t.raiz}`;
    case "painel": return `painel:${t.painel}`;
  }
}

export default function AppCelular() {
  const location = useLocation();
  const navigate = useNavigate();
  const { agents } = useAgents();
  const mapaDm = useMapaDmDoAgente();

  // `?channel=` de DM de agente abre a conversa com o agente, como no desktop.
  const agenteDoCanal = useCallback((canalId: string) => {
    for (const a of agents) {
      if (getAgentIdAliases(a.id).some((al) => mapaDm[al] === canalId)) return a.id;
    }
    return null;
  }, [agents, mapaDm]);
  const telas = useMemo(() => pilhaDaUrl(location.search, agenteDoCanal), [location.search, agenteDoCanal]);

  // `/` vira `/chat`, e `?channel=` de DM de agente vira `?agent=` — sem
  // criar um passo a mais no voltar.
  useEffect(() => {
    const temCanalDeAgente = telas.some((t) => t.tipo === "agente") && new URLSearchParams(location.search).has("channel");
    if (location.pathname === "/" || temCanalDeAgente) navigate(urlDaPilha(telas), { replace: true });
  }, [telas, location.pathname, location.search, navigate]);

  const voltar = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    // Aberto por push ou link: não há passo anterior dentro do app, e o
    // voltar fecharia o app. Desempilha pela URL.
    if (idx > 0) navigate(-1);
    else navigate(urlDoPai(location.search), { replace: true });
  }, [navigate, location.search]);
  const abrir = useCallback((t: Tela) => navigate(urlAoAbrir(location.search, t)), [navigate, location.search]);
  const trocarAba = useCallback((a: Aba) => navigate(urlDaAba(a), { replace: true }), [navigate]);

  // Clique no aviso (toast) de mensagem nova — os mesmos eventos do desktop.
  useEffect(() => {
    const aoCanal = (e: Event) => {
      const { channelId, threadRootId } = (e as CustomEvent<{ channelId?: string; threadRootId?: string | null }>).detail ?? {};
      if (!channelId) return;
      const telasAlvo: Tela[] = [{ tipo: "inicio", aba: "conversas" }, { tipo: "canal", id: channelId }];
      if (threadRootId) telasAlvo.push({ tipo: "thread", canal: channelId, raiz: threadRootId });
      navigate(urlDaPilha(telasAlvo));
    };
    const aoAgente = (e: Event) => {
      const { agentId } = (e as CustomEvent<{ agentId?: string }>).detail ?? {};
      if (agentId) navigate(urlDaPilha([{ tipo: "inicio", aba: "conversas" }, { tipo: "agente", id: agentId }]));
    };
    window.addEventListener("navigate-to-channel", aoCanal);
    window.addEventListener("navigate-to-agent", aoAgente);
    return () => {
      window.removeEventListener("navigate-to-channel", aoCanal);
      window.removeEventListener("navigate-to-agent", aoAgente);
    };
  }, [navigate]);

  // O painel do ⋮ é desenhado pela própria conversa (ela tem o estado: o
  // rascunho, a citação). Só o das silenciadas, que sai do Eu, é tela daqui.
  const visiveis = telas.filter((t, i) => !(t.tipo === "painel" && i > 0 && telas[i - 1].tipo !== "inicio"));
  const painelDoTopo = telas.at(-1)?.tipo === "painel" ? (telas.at(-1) as { painel: Painel }).painel : null;

  // Saída animada: a tela que sai da pilha fica 280 ms deslizando para a direita.
  const anteriores = useRef<Tela[]>(visiveis);
  const [saindo, setSaindo] = useState<Tela[]>([]);
  useEffect(() => {
    const agora = new Set(visiveis.map(chaveDa));
    const sairam = anteriores.current.filter((t) => !agora.has(chaveDa(t)) && t.tipo !== "inicio");
    anteriores.current = visiveis;
    if (sairam.length === 0) return;
    setSaindo((s) => [...s, ...sairam]);
    const timer = window.setTimeout(() => setSaindo((s) => s.filter((t) => !sairam.includes(t))), DURACAO_SAIDA_MS);
    return () => window.clearTimeout(timer);
  }, [visiveis]);

  const topo = visiveis.length - 1;
  const render = (t: Tela, i: number, sai: boolean) => {
    const ativa = !sai && i === topo;
    const painel = !sai && i === topo ? painelDoTopo : null;
    let classe = "cel-tela";
    if (sai) classe += " saindo";
    else {
      if (t.tipo !== "inicio") classe += " entrando";
      if (i < topo - 1) classe += " escondida";
      else if (i === topo - 1) classe += " atras";
    }
    return (
      <section key={chaveDa(t)} className={classe} aria-hidden={!ativa || undefined} style={{ zIndex: sai ? 30 : i }}>
        {t.tipo === "inicio" && <TelaInicio aba={t.aba} aoTrocarAba={trocarAba} aoAbrir={abrir} />}
        {t.tipo === "agente" && <TelaConversaAgente agentId={t.id} ativa={ativa} painel={painel} aoVoltar={voltar} aoAbrir={abrir} />}
        {t.tipo === "canal" && <TelaConversaCanal canalId={t.id} ativa={ativa} painel={painel} aoVoltar={voltar} aoAbrir={abrir} />}
        {t.tipo === "thread" && <TelaThread canalId={t.canal} raizId={t.raiz} ativa={ativa} aoVoltar={voltar} />}
        {t.tipo === "painel" && t.painel === "silenciados" && <TelaSilenciadas aoVoltar={voltar} aoAbrir={abrir} />}
      </section>
    );
  };

  return (
    <div className="app-celular">
      {visiveis.map((t, i) => render(t, i, false))}
      {saindo.map((t) => render(t, topo + 1, true))}
    </div>
  );
}

function TelaSilenciadas({ aoVoltar, aoAbrir }: { aoVoltar: () => void; aoAbrir: (t: Tela) => void }) {
  const { user } = useAuthContext();
  const { channels } = useChannels();
  const { peers } = useDmPeers(channels, user?.id);
  const { estaSilenciado, alternar } = useCanaisSilenciados();
  const lista = channels.filter((c) => estaSilenciado(c.id));
  return (
    <>
      <Cabecalho aoVoltar={aoVoltar} titulo="Conversas silenciadas" />
      <div className="cel-rolar">
        {lista.length === 0 && <div className="cel-vazio">Nenhuma conversa silenciada. Silencie pelo ⋮ da conversa.</div>}
        {lista.map((c) => {
          const nome = c.type === "dm" ? peers[c.id]?.peerName ?? "Conversa" : `#${c.name}`;
          return (
            <div key={c.id} className="cel-item">
              <button type="button" style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }} onClick={() => aoAbrir({ tipo: "canal", id: c.id })}>
                <Avatar tipo={c.type === "dm" ? "pessoa" : "canal"} nome={nome} chave={c.id} tam="sm" />
                <span className="cel-nome" style={{ fontSize: 16, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</span>
              </button>
              <button type="button" className="cel-chip" onClick={() => void alternar(c.id, false)}>
                <BellOff className="cel-mini" style={{ display: "inline", verticalAlign: "-3px", marginRight: 4 }} />Reativar
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
