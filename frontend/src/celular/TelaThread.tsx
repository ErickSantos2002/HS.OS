/**
 * Thread em tela cheia — spec 2026-11-03, item 5. A mensagem-mãe fica no
 * topo e o composer responde na thread. Respostas: `useThreadMessages`;
 * envio: `publicarNaThread`/`enviarAudioNoCanal` (os mesmos do desktop);
 * ações da resposta: `acoesDaRespostaNaThread` + Copiar.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MarkdownMessageContent } from "@/components/chat/MessageContent";
import { useAuthContext } from "@/contexts/auth-context";
import { markThreadViewed, useThreadCounts, useThreadMessages } from "@/hooks/use-channel-threads";
import { useChannelMembers, useChannelMessages, useChannels, type ChannelMessage } from "@/hooks/use-channels";
import { useChatMedia } from "@/hooks/use-chat-media";
import { useMessageReactions } from "@/hooks/use-message-reactions";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePeople } from "@/hooks/use-people";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { useRecibos } from "@/hooks/use-recibos";
import { useConversaAtivaNasNotificacoes } from "@/hooks/use-conversa-ativa";
import { acoesDaRespostaNaThread } from "@/lib/acoes-da-mensagem";
import { acoesDoToque } from "@/lib/acoes-do-toque";
import { normalizeAgentId } from "@/lib/active-agents";
import { api } from "@/lib/api";
import { idDoAnexoDeAudio } from "@/lib/audio-de-mensagem";
import { fraseDeQuemEscreve, podeEscreverNoCanal } from "@/lib/canal-avisos";
import { getAgentDisplayName } from "@/lib/channel-agents";
import { copyToClipboard } from "@/lib/clipboard";
import { anexosDoCanal, apagarNoCanal, editarNoCanal, enviarAudioNoCanal, publicarNaThread, type ContextoDeEnvio } from "@/lib/envio-no-canal";
import { estadoNoCanal } from "@/lib/vistos";
import { AudioDoAnexo, Bolha, type ReacaoNaBolha } from "./Bolha";
import { Cabecalho } from "./Cabecalho";
import { montarResposta, separarCitacao, trechoParaCitar, type Citacao } from "./citacao";
import { Composer } from "./Composer";
import { FolhaDeAcoes, FolhaDeEmoji } from "./Folhas";
import { Ampliada, MidiaDoCanal } from "./Midia";
import { Avatar } from "./ui";
import { useMapaDmDoAgente } from "./use-lista";
import { corDoNome, horaCurta, mesmoDia, rotuloDoDia } from "./formato";

export function TelaThread({ canalId, raizId, ativa, aoVoltar }: { canalId: string; raizId: string; ativa: boolean; aoVoltar: () => void }) {
  const { user, profile, role } = useAuthContext();
  const { channels } = useChannels();
  const canal = channels.find((c) => c.id === canalId) ?? null;
  const { messages: doCanal, sendMessage } = useChannelMessages(canalId);
  const { messages: respostas } = useThreadMessages(canalId, raizId);
  const [raizBuscada, setRaizBuscada] = useState<ChannelMessage | null>(null);
  const raiz = doCanal.find((m) => m.id === raizId) ?? raizBuscada;
  const membros = useChannelMembers(canalId);
  // Thread aberta é o canal dela na tela: marca lido, cala som e push dele.
  const mapaDm = useMapaDmDoAgente();
  useConversaAtivaNasNotificacoes({ agentId: null, canalId, agentDmChannelMap: mapaDm, ativa });
  const { people } = usePeople();
  const { reactions, toggleReaction } = useMessageReactions(canalId);
  const { recibos, marcarLido } = useRecibos(canalId, respostas.length);
  const threadCounts = useThreadCounts(canalId);
  const pessoaPorId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const media = useChatMedia();
  const { value: rascunho, setValue: setRascunho, clear: limparRascunho } = usePersistentDraft(`thread:${canalId}:${raizId}`);
  const [resposta, setResposta] = useState<Citacao | null>(null);
  const [editando, setEditando] = useState<ChannelMessage | null>(null);
  const [acoesDe, setAcoesDe] = useState<ChannelMessage | null>(null);
  const [emojiPara, setEmojiPara] = useState<"composer" | ChannelMessage | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fundoRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const { bottomOffset } = useMobileChatViewport();

  // Link de push para uma thread antiga: a mãe pode não estar na página carregada.
  useEffect(() => {
    if (doCanal.some((m) => m.id === raizId) || raizBuscada) return;
    void api<ChannelMessage>(`/channels/${encodeURIComponent(canalId)}/messages/${encodeURIComponent(raizId)}`)
      .then(setRaizBuscada, () => { toast.error("Essa thread não está mais disponível."); aoVoltar(); });
  }, [canalId, raizId, doCanal, raizBuscada, aoVoltar]);

  // Aberta = vista: nem a bolinha de "nova" nem o recibo ficam para trás.
  const ultima = threadCounts[raizId]?.lastReplyAt;
  useEffect(() => { if (ativa) markThreadViewed(raizId, ultima); }, [ativa, raizId, ultima]);
  useEffect(() => { if (ativa && document.visibilityState === "visible") marcarLido(raizId); }, [ativa, raizId, respostas.length, marcarLido]);

  useLayoutEffect(() => {
    const f = fundoRef.current;
    if (f) f.scrollTop = f.scrollHeight;
  }, [respostas.length, bottomOffset]);

  const ctxEnvio = useMemo<ContextoDeEnvio | null>(
    () => (user && canal ? { canal, user, profile, sendMessage, agentMembers: [] } : null),
    [user, canal, profile, sendMessage],
  );
  const podeEscrever = podeEscreverNoCanal({
    soAlgunsEscrevem: canal?.so_alguns_escrevem,
    souAdmin: role === "administrador",
    meuPodeEscrever: membros.find((m) => m.user_id === user?.id)?.pode_escrever,
  });
  const avisoEscrita = fraseDeQuemEscreve(
    membros.filter((m) => m.pode_escrever && pessoaPorId.has(m.user_id)).map((m) => pessoaPorId.get(m.user_id)!.full_name || "?"),
  );

  const nomeDoAutor = (m: ChannelMessage) => (m.author_type === "agent"
    ? getAgentDisplayName(normalizeAgentId(m.author_id || ""))
    : pessoaPorId.get(m.author_id)?.full_name || m.author_name || "Alguém");
  const reacoesDe = (m: ChannelMessage): ReacaoNaBolha[] =>
    (reactions[m.id] ?? []).map((r) => ({ emoji: r.emoji, quantos: r.count, minha: !!user && r.user_ids.includes(user.id) }));
  const reagir = (m: ChannelMessage, e: string) => { if (user) void toggleReaction(m.id, e, user.id); };
  const responder = (m: ChannelMessage) => {
    setEditando(null);
    setResposta({ autor: m.author_id === user?.id ? "Você" : nomeDoAutor(m), texto: trechoParaCitar(m.content || "") || "📎 anexo" });
    requestAnimationFrame(() => campoRef.current?.focus());
  };

  const enviar = async () => {
    if (!ctxEnvio || enviando) return;
    if (editando) {
      const novo = rascunho.trim();
      if (novo && novo !== editando.content) await editarNoCanal(canalId, editando.id, novo);
      setEditando(null);
      limparRascunho();
      return;
    }
    const texto = montarResposta(resposta, rascunho.trim());
    if (!texto.trim() && media.staged.length === 0) return;
    setEnviando(true);
    try {
      const anexos = media.staged.length ? anexosDoCanal(await media.finalizeStaged({ contexto: "canal", channelId: canalId })) : null;
      media.clearStaged();
      limparRascunho();
      setResposta(null);
      await publicarNaThread(ctxEnvio, texto, raizId, anexos);
    } catch {
      toast.error("Não consegui enviar a resposta.");
    } finally {
      setEnviando(false);
    }
  };

  const bolha = (m: ChannelMessage, i: number, lista: ChannelMessage[], ehRaiz = false) => {
    const ant = lista[i - 1];
    const novoDia = !ehRaiz && (!ant || !mesmoDia(m.created_at, ant.created_at));
    const eu = m.author_id === user?.id;
    const inicio = ehRaiz || novoDia || !ant || ant.author_id !== m.author_id;
    const ehAgente = m.author_type === "agent";
    const nome = nomeDoAutor(m);
    const { citacao, resto } = separarCitacao(m.content || "");
    const audioId = idDoAnexoDeAudio(m.audio_url);
    const apagada = !!m.deleted_at;
    return (
      <Fragment key={m.id}>
        {novoDia && <div className="cel-dia">{rotuloDoDia(m.created_at)}</div>}
        <Bolha
          id={m.id}
          eu={eu}
          inicio={inicio}
          grupo
          avatar={ehAgente
            ? <Avatar tipo="agente" nome={nome} chave={normalizeAgentId(m.author_id || "")} tam="xs" />
            : <Avatar tipo="pessoa" nome={nome} chave={m.author_id} foto={pessoaPorId.get(m.author_id)?.avatar_url ?? m.author_avatar} tam="xs" />}
          autor={!eu && inicio ? { nome: `${nome}${ehAgente ? " ✦" : ""}`, cor: corDoNome(m.author_id) } : null}
          hora={horaCurta(m.created_at)}
          visto={eu && !ehRaiz ? estadoNoCanal(m.id, recibos) : null}
          editada={!!m.edited_at && !apagada}
          reacoes={reacoesDe(m)}
          aoReagir={(e) => reagir(m, e)}
          aoSegurar={apagada || m.id.startsWith("optimistic-") ? undefined : () => setAcoesDe(m)}
          aoResponder={apagada || !podeEscrever ? undefined : () => responder(m)}
          destaque={acoesDe?.id === m.id}
        >
          {apagada ? <p style={{ margin: 0, color: "var(--muted)", fontStyle: "italic" }}>Mensagem apagada</p> : (
            <>
              {citacao && <span className="cel-cit"><b>{citacao.autor}</b><span>{citacao.texto}</span></span>}
              {m.audio_url && !ehAgente && <AudioDoAnexo id={audioId ?? undefined} url={audioId ? undefined : m.audio_url} semente={m.id} rotulo="voz" />}
              {(m.attachments ?? []).map((a, k) => <MidiaDoCanal key={k} att={a} aoAmpliar={setAmpliada} />)}
              {resto && <div className="cel-texto"><MarkdownMessageContent text={resto} highlightMentions className="text-[16px] leading-[1.38]" /></div>}
            </>
          )}
        </Bolha>
      </Fragment>
    );
  };

  const acoesDe_ = acoesDe
    ? (acoesDe.id === raizId
      ? acoesDoToque([], { texto: acoesDe.content ?? "", copiar: () => void copyToClipboard(acoesDe.content).then((ok) => (ok ? toast.success("Mensagem copiada") : toast.error("Não consegui copiar"))) })
      : acoesDoToque(
        acoesDaRespostaNaThread({
          souAutor: acoesDe.author_id === user?.id,
          aoEditar: () => { setResposta(null); setEditando(acoesDe); setRascunho(acoesDe.content); },
          aoApagar: () => void apagarNoCanal(canalId, acoesDe.id),
        }),
        { texto: acoesDe.content ?? "", copiar: () => void copyToClipboard(acoesDe.content).then((ok) => (ok ? toast.success("Mensagem copiada") : toast.error("Não consegui copiar"))) },
      ))
    : [];

  return (
    <>
      <Cabecalho aoVoltar={aoVoltar} titulo="Thread" sub={canal ? (canal.type === "dm" ? "Conversa" : `#${canal.name}`) : ""} />
      <div ref={fundoRef} className="cel-fundo">
        {raiz && <div style={{ padding: "4px 0 10px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>{bolha(raiz, 0, [raiz], true)}</div>}
        {respostas.length === 0 && raiz && <div className="cel-vazio" style={{ padding: 24 }}>Nenhuma resposta ainda.</div>}
        {respostas.map((m, i) => bolha(m, i, respostas))}
      </div>
      <div style={{ paddingBottom: bottomOffset }}>
        {podeEscrever === false ? (
          <div className="cel-aviso-escrita">{avisoEscrita}</div>
        ) : (
          <Composer
            campoRef={campoRef}
            placeholder="Responder na thread"
            valor={rascunho}
            aoMudar={setRascunho}
            aoEnviar={() => void enviar()}
            aoGravar={editando ? undefined : async (blob) => { if (ctxEnvio) await enviarAudioNoCanal(ctxEnvio, blob, raizId); }}
            aoAbrirAnexo={editando ? undefined : media.pickFile}
            aoAbrirEmoji={() => setEmojiPara("composer")}
            anexos={media.staged}
            aoRemoverAnexo={media.removeStaged}
            resposta={editando ? { autor: "Editando a mensagem", texto: editando.content } : resposta}
            aoCancelarResposta={() => { if (editando) { setEditando(null); limparRascunho(); } else setResposta(null); }}
            ocupado={enviando}
          />
        )}
      </div>
      <FolhaDeAcoes
        aberta={!!acoesDe}
        aoFechar={() => setAcoesDe(null)}
        acoes={acoesDe_}
        aoReagir={acoesDe ? (e) => reagir(acoesDe, e) : undefined}
        aoResponder={acoesDe && podeEscrever ? () => responder(acoesDe) : undefined}
        aoMaisEmojis={acoesDe ? () => setEmojiPara(acoesDe) : undefined}
      />
      <FolhaDeEmoji
        aberta={emojiPara !== null}
        aoFechar={() => setEmojiPara(null)}
        aoEscolher={(e) => { if (emojiPara === "composer") setRascunho(rascunho + e); else if (emojiPara) reagir(emojiPara, e); }}
      />
      <Ampliada src={ampliada} aoFechar={() => setAmpliada(null)} />
    </>
  );
}
