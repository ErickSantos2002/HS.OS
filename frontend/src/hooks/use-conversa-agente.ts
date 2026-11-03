/**
 * A conversa com um agente: histórico, envio, espera da resposta e tempo real.
 *
 * ⚠️ **Movido, não reescrito.** Até 03/11/2026 tudo isto morava dentro do
 * `ChatPage` (o caminho mais delicado do sistema — ver a auditoria de
 * 16/07). O app do celular precisava do mesmo comportamento, e uma segunda
 * cópia divergiria na primeira correção. O texto dos blocos é o do
 * `ChatPage`, com três costuras:
 *
 * - `carregarAnteriores` recebe o contêiner de rolagem (era um ref do
 *   componente) para manter a posição ao inserir as antigas no topo;
 * - `novaConversa` não fecha diálogo nem limpa artefato — isso é tela;
 * - a lista lateral (`lastMessages`) é avisada por `aoGravarPergunta` e
 *   `aoSincronizar`, em vez de o hook conhecer o estado dela.
 *
 * O estado continua POR AGENTE (`messagesByAgent`), como antes: trocar de
 * conversa e voltar não recarrega do zero.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuthContext } from "@/contexts/auth-context";
import { assinar } from "@/lib/realtime";
import {
  appendMessageToHistoryCache,
  appendToConversations,
  clearConversationHistory,
  getCachedHistory,
  loadOlderMessages,
  loadPersistedHistory,
  removeMessageFromHistoryCache,
  replaceMessageInHistoryCache,
} from "@/lib/chat-persistence";
import {
  CHAT_PENDING_EVENT,
  CHAT_STREAM_EVENT,
  CHAT_UPDATE_EVENT,
  getPendingAgentIds,
  isAgentPending,
  sendMessageInBackground,
  stopAgentResponse,
  wasAgentResponseStopped,
  type ChatStreamDetail,
  type ChatUpdateDetail,
} from "@/lib/chat-sender";
import { hasActiveTextSelection } from "@/lib/clipboard";
import { conteudoDeVoz } from "@/lib/mensagem-de-voz";
import { transcreverAudio } from "@/lib/transcrever-audio";
import type { ChatMessage, MediaAttachment } from "@/lib/mock-data";

/** Texto maior que isto vira anexo `.txt` antes de ir ao agente. */
export const LIMITE_TEXTO_COMO_ANEXO = 10000;

const VAZIO: ChatMessage[] = [];

export interface OpcoesDaConversaAgente {
  /** A pergunta foi gravada — a lista atualiza a prévia daquele agente. */
  aoGravarPergunta?: (agentId: string, gravada: ChatMessage) => void;
  /** Chegou mudança pelo tempo real ou a aba voltou ao foco. */
  aoSincronizar?: () => void;
}

export function useConversaAgente(agentId: string, opcoes: OpcoesDaConversaAgente = {}) {
  const { user } = useAuthContext();
  const effectiveAgentId = agentId;
  const aoGravarPerguntaRef = useRef(opcoes.aoGravarPergunta);
  aoGravarPerguntaRef.current = opcoes.aoGravarPergunta;
  const aoSincronizarRef = useRef(opcoes.aoSincronizar);
  aoSincronizarRef.current = opcoes.aoSincronizar;

  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [hasMoreByAgent, setHasMoreByAgent] = useState<Record<string, boolean>>({});
  const [realtimePendingByAgent, setRealtimePendingByAgent] = useState<Record<string, boolean>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "reconnecting">("connected");
  // Debounced flag: only true after the socket stays down for >5s, so brief
  // SUBSCRIBED/CLOSED blips don't make the badge flash every second.
  const [showReconnecting, setShowReconnecting] = useState(false);
  useEffect(() => {
    if (realtimeStatus === "connected") {
      setShowReconnecting(false);
      return;
    }
    const t = window.setTimeout(() => setShowReconnecting(true), 5000);
    return () => window.clearTimeout(t);
  }, [realtimeStatus]);
  const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set(getPendingAgentIds()));
  useEffect(() => {
    const handler = () => setPendingAgentIds(new Set(getPendingAgentIds()));
    window.addEventListener(CHAT_PENDING_EVENT, handler);
    return () => window.removeEventListener(CHAT_PENDING_EVENT, handler);
  }, []);

  const setRealtimePending = useCallback((agentId: string, pending: boolean) => {
    setRealtimePendingByAgent((prev) => {
      const current = Boolean(prev[agentId]);
      if (current === pending) return prev;

      if (pending) return { ...prev, [agentId]: true };

      if (!(agentId in prev)) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  const syncRealtimePendingFromMessages = useCallback((agentId: string, messages: ChatMessage[]) => {
    // Only clear "pending" if the most recent message is an agent reply (i.e. the
    // user's last turn has been answered). Otherwise we may be in a long-running
    // task whose response has not yet been persisted — keep the indicator on.
    let lastUserIdx = -1;
    let lastAgentIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = messages[i]?.role;
      if (lastAgentIdx === -1 && role === "agent") lastAgentIdx = i;
      if (lastUserIdx === -1 && role === "user") lastUserIdx = i;
      if (lastUserIdx !== -1 && lastAgentIdx !== -1) break;
    }
    const answered = lastAgentIdx > lastUserIdx;
    const stillPendingLocal = isAgentPending(agentId);
    if (answered && !stillPendingLocal) {
      setRealtimePending(agentId, false);
    }
  }, [setRealtimePending]);

  // Load persisted history — cache-first with background revalidation
  useEffect(() => {
    if (!effectiveAgentId || !user?.id) return;

    // Instant hydration from cache
    const cached = getCachedHistory(user.id, effectiveAgentId);
    if (cached) {
      setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: cached.messages }));
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: cached.hasMore }));
      syncRealtimePendingFromMessages(effectiveAgentId, cached.messages);
    }

    // Background revalidation
    let cancelled = false;
    void (async () => {
      const result = await loadPersistedHistory(user.id, effectiveAgentId);
      if (cancelled) return;
      setMessagesByAgent((prev) => {
        const existing = prev[effectiveAgentId] ?? [];
        const byId = new Map(existing.map(m => [m.id, m]));
        for (const m of result.messages) byId.set(m.id, m);
        const merged = [...byId.values()].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        return { ...prev, [effectiveAgentId]: merged };
      });
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
      syncRealtimePendingFromMessages(effectiveAgentId, result.messages);
    })();
    return () => { cancelled = true; };
  }, [effectiveAgentId, syncRealtimePendingFromMessages, user?.id]);

  const [loadingMore, setLoadingMore] = useState(false);
  const handleLoadMore = useCallback(async (container?: HTMLDivElement | null) => {
    if (!effectiveAgentId || loadingMore || !user?.id) return;
    const currentMsgs = messagesByAgent[effectiveAgentId] ?? [];
    if (currentMsgs.length === 0) return;
    const oldestTimestamp = currentMsgs[0].timestamp;
    setLoadingMore(true);
    try {
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const result = await loadOlderMessages(user.id, effectiveAgentId, oldestTimestamp);
      setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: [...result.messages, ...(prev[effectiveAgentId] ?? [])] }));
      setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
      requestAnimationFrame(() => { if (container) container.scrollTop = container.scrollHeight - prevScrollHeight; });
    } finally { setLoadingMore(false); }
  }, [effectiveAgentId, loadingMore, messagesByAgent, user?.id]);

  const updateAgentHistory = useCallback(
    (agentId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByAgent((prev) => ({ ...prev, [agentId]: updater(prev[agentId] ?? []) }));
    }, []
  );

  const upsertAgentMessage = useCallback(
    (agentId: string, message: ChatMessage, replaceMessageId?: string) => {
      updateAgentHistory(agentId, (current) => {
        const nextBase = replaceMessageId
          ? current.filter((item) => item.id !== replaceMessageId && item.id !== message.id)
          : current.filter((item) => item.id !== message.id);

        return [...nextBase, message].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });
    },
    [updateAgentHistory]
  );

  const appendAgentMessage = useCallback(
    (agentId: string, message: ChatMessage) => upsertAgentMessage(agentId, message),
    [upsertAgentMessage]
  );

  const handleConfirmClearConversation = useCallback(async () => {
    if (!effectiveAgentId || !user?.id) return;
    setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: [] }));
    try {
      const r = await clearConversationHistory(user.id, effectiveAgentId);
      // ⚠️ O aviso distingue os dois casos. Se a sessão do gateway não caiu, o
      // agente continua lembrando da conversa mesmo com a tela vazia — e dizer
      // "pronto!" nessa hora é o que transformaria isso em mistério depois.
      if (r.sessao_zerada) {
        toast.success("Nova conversa iniciada", {
          description: `O agente começa do zero. ${r.mensagens_arquivadas} mensagem(ns) continuam guardadas para consulta.`,
        });
      } else {
        toast.warning("Tela limpa, mas o agente ainda lembra", {
          description: r.detalhe ?? "Não foi possível encerrar a sessão no gateway.",
        });
      }
    } catch (e) {
      toast.error("Não consegui iniciar uma nova conversa", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [effectiveAgentId, user?.id]);

  const [bgPending, setBgPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const isAgentWorking = effectiveAgentId ? bgPending || Boolean(realtimePendingByAgent[effectiveAgentId]) : false;

  const handleStopAgentResponse = useCallback(() => {
    if (!effectiveAgentId) return;
    setRealtimePending(effectiveAgentId, false);
    setStreamingText("");
    stopAgentResponse(effectiveAgentId);
  }, [effectiveAgentId, setRealtimePending]);

  // Use ref to read messagesByAgent inside handleRetry without recreating the callback
  const messagesByAgentRef = useRef(messagesByAgent);
  messagesByAgentRef.current = messagesByAgent;

  const handleRetry = useCallback((errorMsgId: string) => {
    if (!effectiveAgentId || isAgentWorking) return;
    const currentMsgs = messagesByAgentRef.current[effectiveAgentId] ?? [];
    const withoutError = currentMsgs.filter((m) => m.id !== errorMsgId);
    setMessagesByAgent((prev) => ({ ...prev, [effectiveAgentId]: withoutError }));
    sendMessageInBackground(effectiveAgentId, withoutError);
  }, [effectiveAgentId, isAgentWorking]);

  useEffect(() => {
    const findStreamPlaceholderId = (agentId: string, message: ChatMessage): string | undefined => {
      if (message.role !== "agent") return undefined;
      if (message.id.startsWith("stream-")) return undefined;
      const existing = messagesByAgentRef.current[agentId] ?? [];
      const incomingTs = new Date(message.timestamp).getTime();
      // Widened to 16 minutes to cover extended-poll background replies
      const placeholder = existing.find(
        (m) =>
          m.role === "agent" &&
          typeof m.id === "string" &&
          m.id.startsWith("stream-") &&
          Math.abs(new Date(m.timestamp).getTime() - incomingTs) < 16 * 60_000
      );
      return placeholder?.id;
    };


    const onUpdate = (e: Event) => {
      const { agentId, message } = (e as CustomEvent<ChatUpdateDetail>).detail;
      if (user?.id) appendMessageToHistoryCache(user.id, agentId, message);
      setRealtimePending(agentId, message.role === "user");
      const replaceId = findStreamPlaceholderId(agentId, message);
      upsertAgentMessage(agentId, message, replaceId);
      if (agentId === effectiveAgentId) setStreamingText("");
    };
    const onPending = () => {
      const pending = effectiveAgentId ? isAgentPending(effectiveAgentId) : false;
      setBgPending(pending);
      if (!effectiveAgentId || !pending) {
        setStreamingText("");
      }
      if (effectiveAgentId && !isAgentPending(effectiveAgentId)) {
        setRealtimePending(effectiveAgentId, false);
      }
      if (effectiveAgentId && wasAgentResponseStopped(effectiveAgentId) && !isAgentPending(effectiveAgentId)) {
        setRealtimePending(effectiveAgentId, false);
      }
    };
    let streamRafId: number | null = null;
    let latestPartial = "";
    const onStream = (e: Event) => {
      const { agentId, partialText } = (e as CustomEvent<ChatStreamDetail>).detail;
      if (agentId !== effectiveAgentId || hasActiveTextSelection()) return;
      latestPartial = partialText;
      if (streamRafId === null) {
        streamRafId = requestAnimationFrame(() => {
          streamRafId = null;
          setStreamingText(latestPartial);
        });
      }
    };
    window.addEventListener(CHAT_UPDATE_EVENT, onUpdate);
    window.addEventListener(CHAT_PENDING_EVENT, onPending);
    window.addEventListener(CHAT_STREAM_EVENT, onStream);
    onPending();
    return () => {
      window.removeEventListener(CHAT_UPDATE_EVENT, onUpdate);
      window.removeEventListener(CHAT_PENDING_EVENT, onPending);
      window.removeEventListener(CHAT_STREAM_EVENT, onStream);
      if (streamRafId !== null) cancelAnimationFrame(streamRafId);
    };
  }, [effectiveAgentId, setRealtimePending, upsertAgentMessage, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const syncConversationRequest = () => {
      if (document.visibilityState !== "visible") return;

      if (effectiveAgentId) {
        void (async () => {
          const result = await loadPersistedHistory(user.id, effectiveAgentId);
          // Protect: don't replace existing history with empty revalidation
          if (result.messages.length === 0) {
            setMessagesByAgent((prev) => {
              const existing = prev[effectiveAgentId];
              if (existing?.length) return prev; // keep existing
              return { ...prev, [effectiveAgentId]: [] };
            });
            return;
          }
          setMessagesByAgent((prev) => {
            const existing = prev[effectiveAgentId] ?? [];
            const byId = new Map(existing.map(m => [m.id, m]));
            for (const m of result.messages) byId.set(m.id, m);
            const merged = [...byId.values()].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            return { ...prev, [effectiveAgentId]: merged };
          });
          setHasMoreByAgent((prev) => ({ ...prev, [effectiveAgentId]: result.hasMore }));
          syncRealtimePendingFromMessages(effectiveAgentId, result.messages);
        })();
      }

      // A lista lateral do desktop (e a do celular) atualiza a prévia aqui.
      aoSincronizarRef.current?.();
    };

    // Tópico da pessoa: o backend roteia `conversations` por `user_id`, então
    // chega só o que é dela — era o que o `filter: user_id=eq.…` fazia.
    //
    // ⚠️ **O evento dispara a reconciliação, não substitui a mensagem.** Ele não
    // carrega a linha (ver `docs/PLANO-REALTIME.md`), e o `syncConversationRequest`
    // já existia como rede de segurança para o bug "gravado no banco e nunca
    // renderizado". Ele passa a ser o caminho principal, o que é uma
    // simplificação real: antes havia dois caminhos para a mesma mensagem
    // aparecer — o payload do realtime e a reconciliação — e eles podiam
    // divergir. Agora há um.
    //
    // A reconexão e a espera crescente saíram daqui: vivem no `lib/realtime.ts`,
    // que mantém **uma** conexão para a aba inteira. O controle por hook
    // duplicava isso e era a origem do laço CLOSED → retry.
    const cancelarRealtime = assinar(`usuario:${user.id}`, (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela !== "conversations") return;
      syncConversationRequest();
    });
    setRealtimeStatus("connected");

    window.addEventListener("visibilitychange", syncConversationRequest);
    window.addEventListener("focus", syncConversationRequest);

    return () => {
      window.removeEventListener("visibilitychange", syncConversationRequest);
      window.removeEventListener("focus", syncConversationRequest);
      cancelarRealtime();
    };
  }, [effectiveAgentId, setRealtimePending, syncRealtimePendingFromMessages, upsertAgentMessage, user?.id]);

  // Active reconciliation: while an agent reply is expected (pending) or the chat
  // is open, poll persisted history and merge any new agent messages that the
  // realtime subscription may have missed. Safety net against the "saved in DB
  // but never rendered" bug.
  useEffect(() => {
    if (!effectiveAgentId || !user?.id) return;
    const agentId = effectiveAgentId;
    const userId = user.id;
    let cancelled = false;

    const reconcile = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      try {
        const result = await loadPersistedHistory(userId, agentId);
        if (cancelled) return;
        let appliedAny = false;
        setMessagesByAgent((prev) => {
          const existing = prev[agentId] ?? [];
          const byId = new Map(existing.map((m) => [m.id, m]));
          let changed = false;
          for (const m of result.messages) {
            if (!byId.has(m.id)) changed = true;
            byId.set(m.id, m);
          }
          if (!changed) return prev;
          appliedAny = true;
          const merged = [...byId.values()].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          return { ...prev, [agentId]: merged };
        });
        if (appliedAny) {
          setHasMoreByAgent((prev) => ({ ...prev, [agentId]: result.hasMore }));
        }
        syncRealtimePendingFromMessages(agentId, result.messages);
      } catch {
        // swallow — next tick will retry
      }
    };

    // Fast cadence while we are waiting for a reply; slower safety-net otherwise.
    const fastMs = 3500;
    const slowMs = 20000;
    const tick = () => {
      const pending =
        isAgentPending(agentId) ||
        Boolean(realtimePendingByAgent[agentId]) ||
        pendingAgentIds.has(agentId);
      void reconcile();
      return pending ? fastMs : slowMs;
    };

    let timer: number | null = null;
    const schedule = () => {
      const delay = tick();
      timer = window.setTimeout(schedule, delay);
    };
    timer = window.setTimeout(schedule, 1500);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    effectiveAgentId,
    user?.id,
    realtimePendingByAgent,
    pendingAgentIds,
    syncRealtimePendingFromMessages,
  ]);



  /** Mostra, grava e dispara o agente. Comum ao texto digitado e à voz. */
  const despacharAoAgente = useCallback(async (sendingAgentId: string, userMsg: ChatMessage): Promise<boolean> => {
    appendAgentMessage(sendingAgentId, userMsg);
    let gravada: ChatMessage;
    try {
      const persistedMessage = await appendToConversations(user!.id, sendingAgentId, userMsg);
      gravada = persistedMessage;
      replaceMessageInHistoryCache(user!.id, sendingAgentId, userMsg.id, persistedMessage);
      upsertAgentMessage(sendingAgentId, persistedMessage, userMsg.id);
      aoGravarPerguntaRef.current?.(sendingAgentId, persistedMessage);
    } catch {
      removeMessageFromHistoryCache(user!.id, sendingAgentId, userMsg.id);
      updateAgentHistory(sendingAgentId, (c) => c.filter((m) => m.id !== userMsg.id));
      toast.error("Não consegui salvar essa mensagem no histórico. Tente novamente.");
      return false;
    }
    // Vai a mensagem GRAVADA, não a otimista: é o id dela que liga o run à
    // pergunta para o visto (spec 2026-10-14).
    sendMessageInBackground(sendingAgentId, [...(messagesByAgent[sendingAgentId] ?? []), gravada]);
    return true;
  }, [messagesByAgent, appendAgentMessage, updateAgentHistory, upsertAgentMessage, user]);


  /**
   * Pergunta digitada (com ou sem anexos): para a resposta em curso, sobe os
   * anexos, monta a mensagem e despacha. Era o miolo do `handleSend` do
   * `ChatPage`. `finalizarAnexos` é o `finalizeStaged` do `useChatMedia` de
   * quem chama. Devolve `true` se a pergunta foi gravada e enviada.
   */
  const enviarPergunta = useCallback(async (
    texto: string,
    finalizarAnexos: (contexto: { contexto: "conversa_agente"; agentId: string }) => Promise<MediaAttachment[]>,
    antesDeEnviar?: () => void,
  ): Promise<boolean> => {
    if (!effectiveAgentId) return false;
    const sendingAgentId = effectiveAgentId;
    if (isAgentWorking) {
      setRealtimePending(sendingAgentId, false);
      setStreamingText("");
      stopAgentResponse(sendingAgentId);
    }
    antesDeEnviar?.();
    const outgoingMedia = await finalizarAnexos({ contexto: "conversa_agente", agentId: sendingAgentId });
    const hasImages = outgoingMedia.some((m) => m.type === "image");
    const hasDocs = outgoingMedia.some((m) => m.type === "file");
    let displayContent = texto.trim();
    if (!displayContent && outgoingMedia.length > 0) {
      if (hasImages) displayContent = "[imagem anexada]";
      else if (hasDocs) displayContent = "[documento anexado]";
      else displayContent = "[mídia anexada]";
    }
    const userMsg: ChatMessage = {
      id: `m${Date.now()}`, agentId: sendingAgentId, role: "user",
      content: displayContent, timestamp: new Date().toISOString(), channel: "web",
      media: outgoingMedia.length > 0 ? outgoingMedia : undefined,
    };
    return despacharAoAgente(sendingAgentId, userMsg);
  }, [effectiveAgentId, isAgentWorking, setRealtimePending, despacharAoAgente]);

  /**
   * Voz para o agente: transcreve e manda como se fosse digitado, com a marca
   * 🎤 (`conteudoDeVoz`). O áudio não é guardado — o agente não ouve. Era o
   * miolo do `handleAudioSend` do `ChatPage`. Devolve `false` se nada foi.
   */
  const enviarVoz = useCallback(async (blob: Blob, antesDeEnviar?: () => void): Promise<boolean> => {
    if (!user || !effectiveAgentId) return false;
    const sendingAgentId = effectiveAgentId;
    let transcricao: string | undefined;
    try {
      transcricao = await transcreverAudio(blob);
    } catch {
      // Sem transcrição não há o que mandar: o agente não ouve áudio.
      toast.error("Não consegui transcrever o áudio, então ele não foi enviado. Tente de novo ou digite.");
      return false;
    }
    const conteudo = conteudoDeVoz(transcricao);
    if (!conteudo) {
      toast.info("Nenhuma fala detectada no áudio — nada foi enviado.");
      return false;
    }
    if (isAgentWorking) {
      setRealtimePending(sendingAgentId, false);
      setStreamingText("");
      stopAgentResponse(sendingAgentId);
    }
    antesDeEnviar?.();
    return despacharAoAgente(sendingAgentId, {
      id: `m${Date.now()}`, agentId: sendingAgentId, role: "user",
      content: conteudo, timestamp: new Date().toISOString(), channel: "web",
    });
  }, [user, effectiveAgentId, isAgentWorking, despacharAoAgente, setRealtimePending]);

  return {
    messagesByAgent,
    setMessagesByAgent,
    messagesByAgentRef,
    hasMoreByAgent,
    mensagens: messagesByAgent[effectiveAgentId] ?? VAZIO,
    temMais: !!hasMoreByAgent[effectiveAgentId],
    loadingMore,
    isAgentWorking,
    bgPending,
    streamingText,
    setStreamingText,
    realtimePendingByAgent,
    pendingAgentIds,
    showReconnecting,
    setRealtimePending,
    updateAgentHistory,
    upsertAgentMessage,
    appendAgentMessage,
    handleLoadMore,
    handleConfirmClearConversation,
    handleStopAgentResponse,
    handleRetry,
    despacharAoAgente,
    enviarPergunta,
    enviarVoz,
  };
}
