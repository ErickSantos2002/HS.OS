/**
 * Thread em tela cheia — spec 2026-11-03, item 5. A mensagem-mãe fica no
 * topo e o composer responde na thread. Respostas: `useThreadMessages`;
 * envio: `publicarNaThread`/`enviarAudioNoCanal` (os mesmos do desktop);
 * ações da resposta: `acoesDaRespostaNaThread` + Copiar.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ehPessoal } from "@/lib/conversa-pessoal";

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
import { useAcoesEstaveis } from "@/hooks/use-acoes-estaveis";
import { useCatalogoDeAgentes } from "@/hooks/use-catalogo-de-agentes";
import { useHoje } from "@/hooks/use-hoje";
import { acoesDaRespostaNaThread } from "@/lib/acoes-da-mensagem";
import { acoesDoToque } from "@/lib/acoes-do-toque";
import { api } from "@/lib/api";
import { fraseDeQuemEscreve, podeEscreverNoCanal } from "@/lib/canal-avisos";
import { copyToClipboard } from "@/lib/clipboard";
import { anexosDoCanal, nomeDeQuemEscreve, apagarNoCanal, editarNoCanal, enviarAudioNoCanal, publicarNaThread, type ContextoDeEnvio } from "@/lib/envio-no-canal";
import { Cabecalho } from "./Cabecalho";
import { autorDaCitacao, montarResposta, trechoParaCitar, type Citacao } from "@/lib/citacao";
import { Composer } from "./Composer";
import { FolhaDeAcoes, FolhaDeEmoji } from "./Folhas";
import { ListaDoCanal, type AcoesDoCanal } from "./ListaDoCanal";
import { nomeDoAutorNoCanal } from "./formato";
import { Ampliada } from "./Midia";
import { useMapaDmDoAgente } from "./use-lista";
import { usePedidoDaUrl } from "./use-pedido-da-url";

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

  // Resposta rápida do push a uma thread, com o app fechado: responde NELA.
  usePedidoDaUrl(`thread:${canalId}:${raizId}`, !!ctxEnvio, false, { canal: canalId, thread: raizId }, {
    rascunho: setRascunho,
    enviar: (texto) => { if (ctxEnvio) void publicarNaThread(ctxEnvio, texto, raizId); },
    focar: () => requestAnimationFrame(() => campoRef.current?.focus()),
  });

  const nomeDoAutor = (m: ChannelMessage) => nomeDoAutorNoCanal(m, pessoaPorId);
  const reagir = (m: ChannelMessage, e: string) => { if (user) void toggleReaction(m.id, e, user.id); };
  const responder = (m: ChannelMessage) => {
    setEditando(null);
    setResposta({ autor: autorDaCitacao(m.author_id === user?.id, nomeDeQuemEscreve({ profile, user: user! }), nomeDoAutor(m)), texto: trechoParaCitar(m.content || "") || "📎 anexo" });
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
    const rascunhoEnviado = rascunho.trim();
    const texto = montarResposta(resposta, rascunhoEnviado);
    if (!texto.trim() && media.staged.length === 0) return;
    setEnviando(true);
    try {
      const anexos = media.staged.length ? anexosDoCanal(await media.finalizeStaged({ contexto: "canal", channelId: canalId })) : null;
      media.clearStaged();
      limparRascunho();
      setResposta(null);
      await publicarNaThread(ctxEnvio, texto, raizId, anexos, { textoNovo: rascunhoEnviado });
    } catch {
      toast.error("Não consegui enviar a resposta.");
    } finally {
      setEnviando(false);
    }
  };

  // Ações das bolhas num objeto estável: sem isso cada tecla no composer
  // redesenhava todas as bolhas (ver `ListaDoCanal`).
  const catalogo = useCatalogoDeAgentes();
  const hoje = useHoje();
  const acoesDaLista = useAcoesEstaveis<AcoesDoCanal>({
    reagir,
    segurar: setAcoesDe,
    responder,
    abrirThread: () => {},
    ampliar: setAmpliada,
  });
  const listaDaRaiz = useMemo(() => (raiz ? [raiz] : []), [raiz]);
  const comuns = {
    meuId: user?.id,
    isDm: false,
    isPessoal: false,
    recibos,
    reactions,
    pessoaPorId,
    resumoLigado: false,
    podeEscrever,
    destaqueId: acoesDe?.id ?? null,
    catalogo,
    hoje,
    acoes: acoesDaLista,
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
      <Cabecalho aoVoltar={aoVoltar} titulo="Thread" sub={canal ? (ehPessoal(canal) ? "Suas anotações" : canal.type === "dm" ? "Conversa" : `#${canal.name}`) : ""} />
      <div ref={fundoRef} className="cel-fundo">
        {raiz && (
          <div style={{ padding: "4px 0 10px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>
            <ListaDoCanal modo="raiz" mensagens={listaDaRaiz} {...comuns} />
          </div>
        )}
        {respostas.length === 0 && raiz && <div className="cel-vazio" style={{ padding: 24 }}>Nenhuma resposta ainda.</div>}
        <ListaDoCanal modo="thread" mensagens={respostas} {...comuns} />
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
