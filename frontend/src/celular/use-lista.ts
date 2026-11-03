/**
 * Os dados da lista do Início, montados das mesmas fontes da lateral do
 * desktop: agentes (`useAgents` + `/conversations/ultimas/por-agente`),
 * pessoas e DMs (`usePeople` + `useDmPeers`), canais (`useChannels`), não
 * lidas do sininho (`useNotificationsContext`) e silenciados.
 *
 * A única fonte nova é `GET /channels/previas` — a última mensagem de cada DM
 * e canal, que a lateral do desktop nunca mostrou.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useNotificationsContext } from "@/components/NotificationsProvider";
import { useAuthContext } from "@/contexts/auth-context";
import { useAgents } from "@/hooks/use-agents";
import { useCanaisSilenciados } from "@/hooks/use-canais-silenciados";
import { useChannels } from "@/hooks/use-channels";
import { useDmPeers } from "@/hooks/use-dm-members";
import { usePeople } from "@/hooks/use-people";
import { api } from "@/lib/api";
import { getAgentIdAliases } from "@/lib/agent-id";
import { loadLastMessagesPerAgent } from "@/lib/chat-persistence";
import {
  AGENT_UNREAD_EVENT, CHAT_PENDING_EVENT, CHAT_UPDATE_EVENT, getPendingAgentIds, getUnreadAgentIds,
} from "@/lib/chat-sender";
import { naoLidasDoAgente } from "@/lib/nao-lidas-do-agente";
import { semMarkdown } from "@/lib/previa-da-mensagem";
import { assinar } from "@/lib/realtime";
import type { ItemCelular } from "./lista";

export interface PreviaDoCanal {
  channel_id: string;
  texto: string;
  autor_id: string;
  autor_nome: string;
  autor_tipo: string;
  created_at: string;
}

export const CHAVE_PREVIAS = ["celular", "previas"] as const;

/** Mapa agente → canal de DM dele (para as não lidas), igual ao `ChatPage`. */
export function useMapaDmDoAgente(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["celular", "dms-agentes"],
    queryFn: () => api<{ channel_id: string; agent_id: string }[]>("/channels/dms/agentes"),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const mapa: Record<string, string> = {};
    for (const p of data ?? []) for (const alias of getAgentIdAliases(p.agent_id)) mapa[alias] = p.channel_id;
    return mapa;
  }, [data]);
}

export function useListaDoCelular() {
  const { user } = useAuthContext();
  const { agents } = useAgents();
  const { channels, refetch: recarregarCanais } = useChannels();
  const { people } = usePeople();
  const { peerIdToChannelId } = useDmPeers(channels, user?.id);
  const { notifications, unreadByChannel, unreadByAgentOnly } = useNotificationsContext();
  const { estaSilenciado, versao: silenciadosVersao } = useCanaisSilenciados();
  const mapaDm = useMapaDmDoAgente();
  const qc = useQueryClient();

  const previas = useQuery({
    queryKey: CHAVE_PREVIAS,
    queryFn: () => api<PreviaDoCanal[]>("/channels/previas"),
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });
  const membros = useQuery({
    queryKey: ["celular", "membros"],
    queryFn: () => api<{ channel_id: string; agents: string[]; humans: string[] }[]>("/channels/membros"),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Mensagem nova em qualquer conversa minha → a prévia anda. Agrupado em
  // 400 ms: uma rajada de mensagens vira uma busca só.
  const idsDosCanais = useMemo(() => channels.map((c) => c.id).sort().join(","), [channels]);
  useEffect(() => {
    if (!idsDosCanais) return;
    let t: number | null = null;
    const recarregar = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => void qc.invalidateQueries({ queryKey: CHAVE_PREVIAS }), 400);
    };
    const cancelar = idsDosCanais.split(",").map((id) => assinar(`canal:${id}`, (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela === "channel_messages") recarregar();
    }));
    return () => { if (t) window.clearTimeout(t); cancelar.forEach((c) => c()); };
  }, [idsDosCanais, qc]);
  // A notificação nova também pode ser de DM recém-criada que a lista não tem.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: CHAVE_PREVIAS });
  }, [notifications.length, qc]);

  // Última mensagem com cada agente.
  const agentIdsKey = useMemo(() => agents.map((a) => a.id).sort().join(","), [agents]);
  const [ultimasDoAgente, setUltimas] = useState<Record<string, { content: string; created_at: string }>>({});
  const recarregarAgentes = useRef<() => void>(() => {});
  recarregarAgentes.current = () => {
    if (!agentIdsKey || !user?.id) return;
    void loadLastMessagesPerAgent(user.id, agentIdsKey.split(",")).then(setUltimas);
  };
  useEffect(() => { recarregarAgentes.current(); }, [agentIdsKey, user?.id]);
  useEffect(() => {
    if (!user?.id) return;
    const cancelar = assinar(`usuario:${user.id}`, (_t, dados) => {
      if ((dados as { tabela?: string })?.tabela === "conversations") recarregarAgentes.current();
    });
    const aoAtualizar = () => recarregarAgentes.current();
    window.addEventListener(CHAT_UPDATE_EVENT, aoAtualizar);
    return () => { cancelar(); window.removeEventListener(CHAT_UPDATE_EVENT, aoAtualizar); };
  }, [user?.id]);

  // Quem está "pensando" (fila do chat-sender) e não lida local de agente.
  const [pendentes, setPendentes] = useState<string[]>(() => [...getPendingAgentIds()]);
  const [naoLidasLocais, setNaoLidasLocais] = useState<string[]>(() => getUnreadAgentIds());
  useEffect(() => {
    const p = () => setPendentes([...getPendingAgentIds()]);
    const u = () => setNaoLidasLocais(getUnreadAgentIds());
    window.addEventListener(CHAT_PENDING_EVENT, p);
    window.addEventListener(AGENT_UNREAD_EVENT, u);
    return () => { window.removeEventListener(CHAT_PENDING_EVENT, p); window.removeEventListener(AGENT_UNREAD_EVENT, u); };
  }, []);

  const itens = useMemo<ItemCelular[]>(() => {
    const porCanal = new Map((previas.data ?? []).map((p) => [p.channel_id, p]));
    const membrosPorCanal = new Map((membros.data ?? []).map((m) => [m.channel_id, m]));
    const previaDe = (canalId: string | null) => {
      const p = canalId ? porCanal.get(canalId) : undefined;
      if (!p) return null;
      return {
        texto: p.texto,
        quando: new Date(p.created_at).getTime(),
        minha: p.autor_id === user?.id,
        autor: p.autor_nome,
      };
    };
    const lista: ItemCelular[] = [];
    for (const a of agents) {
      const ult = ultimasDoAgente[a.id];
      const aliases = getAgentIdAliases(a.id);
      lista.push({
        chave: `agente:${a.id}`, tipo: "agente", id: a.id, canalId: null, nome: a.name,
        subtitulo: a.specialty || a.department || "Agente",
        previa: ult ? { texto: semMarkdown(ult.content), quando: new Date(ult.created_at).getTime(), minha: false } : null,
        naoLidas: naoLidasDoAgente(a.id, mapaDm, unreadByChannel, unreadByAgentOnly) || (naoLidasLocais.some((id) => aliases.includes(id)) ? 1 : 0),
        silenciado: false,
        pensando: pendentes.some((id) => aliases.includes(id)),
      });
    }
    for (const p of people) {
      if (p.id === user?.id) continue;
      const canalId = peerIdToChannelId[p.id] ?? null;
      // Conta desativada só fica se já havia conversa — o histórico é de quem ficou.
      if (p.status === "inactive" && !canalId) continue;
      lista.push({
        chave: `pessoa:${p.id}`, tipo: "pessoa", id: p.id, canalId, nome: p.full_name || p.email,
        subtitulo: [p.cargo, p.departamento].filter(Boolean).join(" · "),
        previa: previaDe(canalId),
        naoLidas: canalId ? (unreadByChannel[canalId] || 0) : 0,
        silenciado: !!canalId && estaSilenciado(canalId),
        pensando: false,
      });
    }
    for (const c of channels) {
      if (c.type === "dm") continue;
      const m = membrosPorCanal.get(c.id);
      const n = m ? m.humans.length + m.agents.length : 0;
      lista.push({
        chave: `canal:${c.id}`, tipo: "canal", id: c.id, canalId: c.id, nome: c.name,
        subtitulo: n ? `${n} ${n === 1 ? "participante" : "participantes"}` : (c.description || ""),
        previa: previaDe(c.id),
        naoLidas: unreadByChannel[c.id] || 0,
        silenciado: estaSilenciado(c.id),
        pensando: false,
      });
    }
    return lista;
  }, [agents, people, channels, previas.data, membros.data, ultimasDoAgente, mapaDm, unreadByChannel, unreadByAgentOnly,
    naoLidasLocais, pendentes, peerIdToChannelId, estaSilenciado, silenciadosVersao, user?.id]);

  return { itens, mapaDm, recarregarCanais, carregando: previas.isLoading };
}
