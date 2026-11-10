/**
 * Canal e DM no celular — spec 2026-11-03, itens 2 a 7.
 *
 * Os dados e as regras são os do `ChannelChat`: mensagens e tempo real
 * (`useChannelMessages`), reações, recibos, threads, envio
 * (`lib/envio-no-canal.ts`), ações da mensagem (`acoesDaMensagemDoCanal`),
 * canal "só alguns escrevem" (`podeEscreverNoCanal`) e silenciar. A thread
 * é tela cheia empilhada (`TelaThread`), não drawer.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Paperclip, Search, Users, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import ChannelFilesPanel from "@/components/chat/ChannelFilesPanel";
import ChannelMembersPanel from "@/components/chat/ChannelMembersPanel";
import { MarkdownMessageContent } from "@/components/chat/MessageContent";
import { PainelEmbutido } from "@/components/chat/painel-embutido";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { useAuthContext } from "@/contexts/auth-context";
import { useCanaisSilenciados } from "@/hooks/use-canais-silenciados";
import { useChannelAgentActivity } from "@/hooks/use-channel-agent-activity";
import { useThreadCounts } from "@/hooks/use-channel-threads";
import { useChannelMembers, useChannelMessages, useChannels, type ChannelMessage } from "@/hooks/use-channels";
import { useChatMedia } from "@/hooks/use-chat-media";
import { useConversaAtivaNasNotificacoes } from "@/hooks/use-conversa-ativa";
import { useMessageReactions } from "@/hooks/use-message-reactions";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePeople } from "@/hooks/use-people";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { useRecibos } from "@/hooks/use-recibos";
import { useResumoEmAudio } from "@/hooks/use-resumo-em-audio";
import { formatTypingLabel, useTypingIndicator } from "@/hooks/use-typing-indicator";
import { acoesDaMensagemDoCanal } from "@/lib/acoes-da-mensagem";
import { normalizeAgentId } from "@/lib/active-agents";
import { idDoAnexoDeAudio } from "@/lib/audio-de-mensagem";
import { fraseDeQuemEscreve, podeEscreverNoCanal } from "@/lib/canal-avisos";
import { getAgentDisplayName } from "@/lib/channel-agents";
import { getPendingAgentsForChannel, subscribeToChannelAgentPending } from "@/lib/channel-agent-pending";
import {
  anexosDoCanal, apagarNoCanal, apagarParaMimNoCanal, editarNoCanal, enviarAudioNoCanal, publicarNoCanal,
  type ContextoDeEnvio,
} from "@/lib/envio-no-canal";
import { casaBusca } from "@/lib/lista-de-conversas";
import { canalNaoResolve } from "@/lib/tela-cheia";
import { estadoNoCanal } from "@/lib/vistos";
import { AudioDoAnexo, Bolha, Pensando, type ReacaoNaBolha } from "./Bolha";
import { Cabecalho, Sobreposta } from "./Cabecalho";
import { ehPessoal, nomeDaConversaPessoal, PLACEHOLDER_PESSOAL } from "@/lib/conversa-pessoal";
import { autorDaCitacao, montarResposta, separarCitacao, trechoParaCitar, type Citacao } from "@/lib/citacao";
import { Composer } from "./Composer";
import { FolhaDeAcoes, FolhaDeAnexo, FolhaDeEmoji } from "./Folhas";
import { Ampliada, MidiaDoCanal } from "./Midia";
import type { Painel, Tela } from "./pilha";
import { Avatar, Folha, MenuSuspenso } from "./ui";
import { corDoNome, horaCurta, mesmoDia, rotuloDoDia } from "./formato";
import { useMapaDmDoAgente } from "./use-lista";
import { usePedidoDaUrl } from "./use-pedido-da-url";

/** Até onde o canal agrupa bolhas do mesmo autor (5 min, como no desktop). */
const AGRUPA_MS = 5 * 60_000;

export function TelaConversaCanal({
  canalId, ativa, painel, aoVoltar, aoAbrir,
}: {
  canalId: string;
  ativa: boolean;
  painel: Painel | null;
  aoVoltar: () => void;
  aoAbrir: (t: Tela) => void;
}) {
  const navigate = useNavigate();
  const { user, profile, role } = useAuthContext();
  const { channels, loading: canaisCarregando, refetch, joinChannel } = useChannels();
  const canal = channels.find((c) => c.id === canalId) ?? null;

  // DM que a outra pessoa acabou de criar ainda não está na lista: recarrega
  // uma vez; se nem assim aparecer, volta (mesma regra do desktop).
  const recarregou = useRef(false);
  const [recarregadoPara, setRecarregadoPara] = useState<string | null>(null);
  useEffect(() => {
    if (canal || canaisCarregando || recarregou.current) return;
    recarregou.current = true;
    void Promise.resolve(refetch()).finally(() => setRecarregadoPara(canalId));
  }, [canal, canaisCarregando, canalId, refetch]);
  useEffect(() => {
    if (!canalNaoResolve({ channelParam: canalId, recarregadoPara, encontrado: !!canal })) return;
    toast.error("Essa conversa não está mais disponível.");
    aoVoltar();
  }, [canalId, recarregadoPara, canal, aoVoltar]);
  // Entrar no canal ao abrir, como o `ChatPage` (o PUT é idempotente).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void joinChannel(canalId); }, [canalId]);

  const mapaDm = useMapaDmDoAgente();
  // A thread por cima também é "esta conversa": quem informa é a `TelaThread`.
  useConversaAtivaNasNotificacoes({ agentId: null, canalId, agentDmChannelMap: mapaDm, ativa });

  const { messages, sendMessage, esconder, reexibir } = useChannelMessages(canalId);
  const [versaoMembros, setVersaoMembros] = useState(0);
  const membros = useChannelMembers(canalId, versaoMembros);
  const { people } = usePeople();
  const { reactions, toggleReaction } = useMessageReactions(canalId);
  const { recibos, marcarLido } = useRecibos(canalId, messages.length);
  const threadCounts = useThreadCounts(canalId);
  const { ligado: resumoLigado } = useResumoEmAudio();
  const { estaSilenciado, alternar: alternarSilencio } = useCanaisSilenciados();
  const { markMessageAsUnread } = useNotificationsContext();
  const nomeProprio = (profile?.full_name && profile.full_name.trim()) || user?.email?.split("@")[0] || "Alguém";
  const { typingUsers, notifyTyping } = useTypingIndicator(canalId, user?.id ?? null, nomeProprio);

  const isDm = canal?.type === "dm";
  // Conversa consigo mesmo (10/11/2026): sem vistos, "digitando", membros nem silenciar.
  const isPessoal = ehPessoal(canal);
  const pessoaPorId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const outra = isDm ? membros.find((m) => m.member_type !== "agent" && m.user_id !== user?.id) : undefined;
  const pessoaDaDm = outra ? pessoaPorId.get(outra.user_id) : undefined;
  const titulo = isPessoal ? nomeDaConversaPessoal(profile?.full_name, user?.email) : isDm ? (pessoaDaDm?.full_name || pessoaDaDm?.email || "Conversa") : `#${canal?.name ?? ""}`;
  const agentMembers = useMemo(() => membros.filter((m) => m.member_type === "agent").map((m) => m.user_id), [membros]);

  // Agentes trabalhando: o local responde no envio, o do servidor é a verdade.
  const [pendentesLocais, setPendentesLocais] = useState<string[]>(() => getPendingAgentsForChannel(canalId));
  useEffect(() => subscribeToChannelAgentPending(canalId, setPendentesLocais), [canalId]);
  const doServidor = useChannelAgentActivity(canalId);
  const agentesPensando = useMemo(() => [...new Set([...pendentesLocais, ...Object.keys(doServidor)])], [pendentesLocais, doServidor]);

  // Ler o canal quando a tela está à vista — os mesmos gatilhos do desktop.
  useEffect(() => {
    if (!ativa || document.visibilityState !== "visible") return;
    marcarLido();
  }, [ativa, messages.length, marcarLido]);
  useEffect(() => {
    if (!ativa) return;
    const aoVoltarPraAba = () => { if (document.visibilityState === "visible") marcarLido(); };
    document.addEventListener("visibilitychange", aoVoltarPraAba);
    return () => document.removeEventListener("visibilitychange", aoVoltarPraAba);
  }, [ativa, marcarLido]);

  const podeEscrever = podeEscreverNoCanal({
    soAlgunsEscrevem: canal?.so_alguns_escrevem,
    souAdmin: role === "administrador",
    meuPodeEscrever: membros.find((m) => m.user_id === user?.id)?.pode_escrever,
  });
  const avisoEscrita = useMemo(() => fraseDeQuemEscreve(
    membros.filter((m) => m.pode_escrever && pessoaPorId.has(m.user_id))
      .map((m) => pessoaPorId.get(m.user_id)!.full_name || "?")
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
  ), [membros, pessoaPorId]);

  const ctxEnvio = useMemo<ContextoDeEnvio | null>(
    () => (user && canal ? { canal, user, profile, sendMessage, agentMembers } : null),
    [user, canal, profile, sendMessage, agentMembers],
  );

  const media = useChatMedia();
  const { value: rascunho, setValue: setRascunho, clear: limparRascunho } = usePersistentDraft(`channel:${canalId}`);
  const [resposta, setResposta] = useState<Citacao | null>(null);
  const [editando, setEditando] = useState<ChannelMessage | null>(null);
  const [apagar, setApagar] = useState<ChannelMessage | null>(null);
  const [acoesDe, setAcoesDe] = useState<ChannelMessage | null>(null);
  const [emojiPara, setEmojiPara] = useState<"composer" | ChannelMessage | null>(null);
  const [folhaAnexo, setFolhaAnexo] = useState(false);
  const [menu, setMenu] = useState(false);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const fundoRef = useRef<HTMLDivElement>(null);
  const colado = useRef(true);
  const { bottomOffset } = useMobileChatViewport();

  useLayoutEffect(() => {
    const f = fundoRef.current;
    if (f && colado.current) f.scrollTop = f.scrollHeight;
  }, [messages.length, agentesPensando.length, bottomOffset]);
  useEffect(() => {
    const f = fundoRef.current;
    if (!f) return;
    const ro = new ResizeObserver(() => { if (colado.current) f.scrollTop = f.scrollHeight; });
    ro.observe(f);
    Array.from(f.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [messages.length]);

  const nomeDoAutor = useCallback((m: ChannelMessage) => {
    if (m.author_type === "agent") return getAgentDisplayName(normalizeAgentId(m.author_id || ""));
    return pessoaPorId.get(m.author_id)?.full_name || m.author_name || "Alguém";
  }, [pessoaPorId]);

  const responder = useCallback((m: ChannelMessage) => {
    setEditando(null);
    setResposta({ autor: autorDaCitacao(m.author_id === user?.id, nomeProprio, nomeDoAutor(m)), texto: trechoParaCitar(m.content || "") || "📎 anexo" });
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [nomeDoAutor, nomeProprio, user?.id]);

  const enviar = async () => {
    if (!ctxEnvio || enviandoRef.current) return;
    if (editando) {
      const novo = rascunho.trim();
      if (novo && novo !== editando.content) await editarNoCanal(canalId, editando.id, novo);
      setEditando(null);
      limparRascunho();
      return;
    }
    const texto = montarResposta(resposta, rascunho.trim());
    if (!texto.trim() && media.staged.length === 0) return;
    enviandoRef.current = true;
    setEnviando(true);
    colado.current = true;
    // Limpa antes de qualquer await: um segundo toque não reenvia o mesmo texto.
    const antes = rascunho;
    const respostaAntes = resposta;
    limparRascunho();
    setResposta(null);
    try {
      let anexos = null;
      if (media.staged.length > 0) {
        try {
          anexos = anexosDoCanal(await media.finalizeStaged({ contexto: "canal", channelId: canalId }));
          media.clearStaged();
        } catch {
          setRascunho(antes);
          setResposta(respostaAntes);
          toast.error("Não consegui enviar o anexo.");
          return;
        }
      }
      await publicarNoCanal(ctxEnvio, texto, anexos, { textoNovo: antes.trim() });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const acoesDaMensagem = (m: ChannelMessage) => acoesDaMensagemDoCanal(m, {
    souAutor: m.author_id === user?.id,
    aoResponder: podeEscrever ? () => responder(m) : undefined,
    aoMarcarNaoLida: () => markMessageAsUnread({ messageId: m.id, channelId: canalId, authorName: nomeDoAutor(m), contentPreview: (m.content || "").slice(0, 100) }),
    aoEditar: () => { setResposta(null); setEditando(m); setRascunho(m.content); requestAnimationFrame(() => campoRef.current?.focus()); },
    aoApagar: () => setApagar(m),
    aoApagarParaMim: () => void apagarParaMimNoCanal(canalId, m, { esconder, reexibir }),
  });

  // Resposta rápida do push com o app fechado (`?resposta=<id>`, conferido no
  // cache do SW). Com `thread` na URL quem responde é a `TelaThread`.
  const urlTemThread = new URLSearchParams(useLocation().search).has("thread");
  usePedidoDaUrl(`canal:${canalId}`, !!ctxEnvio, urlTemThread, { canal: canalId, thread: null }, {
    rascunho: setRascunho,
    enviar: (texto) => { if (ctxEnvio) void publicarNoCanal(ctxEnvio, texto, null); },
    focar: () => requestAnimationFrame(() => campoRef.current?.focus()),
  });

  const reacoesDe = (m: ChannelMessage): ReacaoNaBolha[] =>
    (reactions[m.id] ?? []).map((r) => ({ emoji: r.emoji, quantos: r.count, minha: !!user && r.user_ids.includes(user.id) }));
  const reagir = (m: ChannelMessage, emoji: string) => { if (user) void toggleReaction(m.id, emoji, user.id); };

  const visiveis = busca.trim()
    ? messages.filter((m) => casaBusca([m.content, m.author_name], busca))
    : messages;
  const digitando = formatTypingLabel(typingUsers);
  const sub = agentesPensando.length > 0
    ? `${agentesPensando.map((a) => getAgentDisplayName(a)).join(", ")} pensando…`
    : isPessoal ? "Suas anotações"
    : digitando || (isDm
      ? (pessoaDaDm?.presence === "online" ? "online" : [pessoaDaDm?.cargo, pessoaDaDm?.departamento].filter(Boolean).join(" · "))
      : `${membros.length} ${membros.length === 1 ? "participante" : "participantes"}`);
  const silenciado = estaSilenciado(canalId);

  return (
    <>
      <Cabecalho
        aoVoltar={aoVoltar}
        avatar={isPessoal
          ? <Avatar tipo="pessoa" nome={titulo} chave={user?.id ?? canalId} foto={profile?.avatar_url} tam="sm" />
          : isDm
          ? <Avatar tipo="pessoa" nome={titulo} chave={pessoaDaDm?.id ?? canalId} foto={pessoaDaDm?.avatar_url} tam="sm" />
          : <Avatar tipo="canal" nome={titulo} chave={canalId} tam="sm" />}
        titulo={titulo}
        sub={sub}
        subVivo={agentesPensando.length > 0 || !!digitando}
        aoTocarQuem={isPessoal ? undefined : () => aoAbrir({ tipo: "painel", painel: "participantes" })}
        aoMenu={() => setMenu(true)}
      />
      {painel === null && busca && (
        <div className="cel-busca" style={{ margin: "8px 12px" }}>
          <Search className="cel-i" /><span style={{ flex: 1, color: "var(--fg)" }}>“{busca}” · {visiveis.length}</span>
          <button type="button" className="cel-ib" onClick={() => setBusca("")} aria-label="Limpar busca"><X /></button>
        </div>
      )}
      <div
        ref={fundoRef}
        className="cel-fundo"
        onScroll={(e) => { const f = e.currentTarget; colado.current = f.scrollHeight - f.scrollTop - f.clientHeight < 96; }}
      >
        {visiveis.map((m, i) => {
          const ant = visiveis[i - 1];
          const novoDia = !ant || !mesmoDia(m.created_at, ant.created_at);
          const eu = m.author_id === user?.id;
          const inicio = novoDia || !ant || ant.author_id !== m.author_id
            || new Date(m.created_at).getTime() - new Date(ant.created_at).getTime() > AGRUPA_MS;
          const apagada = !!m.deleted_at;
          const ehAgente = m.author_type === "agent";
          const nomeAutor = nomeDoAutor(m);
          const { citacao, resto } = separarCitacao(m.content || "");
          const audioId = idDoAnexoDeAudio(m.audio_url);
          const audioDePessoa = !!m.audio_url && !ehAgente;
          const tc = threadCounts[m.id];
          const avatarAutor = ehAgente
            ? <Avatar tipo="agente" nome={nomeAutor} chave={normalizeAgentId(m.author_id || "")} tam="xs" />
            : <Avatar tipo="pessoa" nome={nomeAutor} chave={m.author_id} foto={pessoaPorId.get(m.author_id)?.avatar_url ?? m.author_avatar} tam="xs" />;
          return (
            <Fragment key={m.id}>
              {novoDia && <div className="cel-dia">{rotuloDoDia(m.created_at)}</div>}
              <Bolha
                id={m.id}
                eu={eu}
                inicio={inicio}
                grupo={!isDm && !isPessoal}
                avatar={avatarAutor}
                autor={!isDm && !eu && inicio ? { nome: `${nomeAutor}${ehAgente ? " ✦" : ""}`, cor: corDoNome(m.author_id) } : null}
                hora={horaCurta(m.created_at)}
                visto={eu && !isPessoal ? estadoNoCanal(m.id, recibos) : null}
                editada={!!m.edited_at && !apagada}
                reacoes={reacoesDe(m)}
                aoReagir={(e) => reagir(m, e)}
                thread={tc ? {
                  quantos: tc.count,
                  avatares: <Avatar tipo="pessoa" nome={tc.lastAuthorName || "?"} chave={tc.lastAuthorName || "?"} foto={tc.lastAuthorAvatar} tam="xs" />,
                  aoAbrir: () => aoAbrir({ tipo: "thread", canal: canalId, raiz: m.id }),
                } : null}
                aoSegurar={apagada || m.id.startsWith("optimistic-") ? undefined : () => setAcoesDe(m)}
                aoResponder={apagada || !podeEscrever ? undefined : () => responder(m)}
                destaque={acoesDe?.id === m.id}
              >
                {apagada ? (
                  <p style={{ margin: 0, color: "var(--muted)", fontStyle: "italic" }}>Mensagem apagada</p>
                ) : (
                  <>
                    {citacao && <span className="cel-cit"><b>{citacao.autor}</b><span>{citacao.texto}</span></span>}
                    {audioDePessoa && <AudioDoAnexo id={audioId ?? undefined} url={audioId ? undefined : m.audio_url ?? undefined} semente={m.id} rotulo="voz" />}
                    {(m.attachments ?? []).map((a, k) => <MidiaDoCanal key={k} att={a} aoAmpliar={setAmpliada} />)}
                    {resto && !(resto.startsWith("📎") && (m.attachments?.length ?? 0) > 0) && (
                      <div className="cel-texto" style={audioDePessoa ? { color: "var(--muted)", fontSize: 14, marginTop: 4 } : undefined}>
                        <MarkdownMessageContent text={resto} highlightMentions className="text-[16px] leading-[1.38]" />
                      </div>
                    )}
                    {ehAgente && m.audio_url && resumoLigado && (
                      <AudioDoAnexo id={audioId ?? undefined} url={audioId ? undefined : m.audio_url} semente={m.id} rotulo="resumo" />
                    )}
                  </>
                )}
              </Bolha>
            </Fragment>
          );
        })}
        {agentesPensando.map((a) => {
          const nome = getAgentDisplayName(a);
          return (
            <Bolha key={`pensando-${a}`} id={`pensando-${a}`} eu={false} inicio grupo={!isDm} hora=""
              avatar={<Avatar tipo="agente" nome={nome} chave={a} tam="xs" />}
              autor={!isDm ? { nome: `${nome} ✦`, cor: corDoNome(a) } : null}>
              <Pensando nome={nome} />
            </Bolha>
          );
        })}
      </div>
      <div style={{ paddingBottom: bottomOffset }}>
        {podeEscrever === false ? (
          <div className="cel-aviso-escrita">{avisoEscrita}</div>
        ) : (
          <Composer
            campoRef={campoRef}
            placeholder={isPessoal ? PLACEHOLDER_PESSOAL : "Mensagem"}
            valor={rascunho}
            aoMudar={(v) => { setRascunho(v); if (v.trim() && !isPessoal) notifyTyping(); }}
            aoEnviar={() => void enviar()}
            aoGravar={editando ? undefined : async (blob) => { if (ctxEnvio) { colado.current = true; await enviarAudioNoCanal(ctxEnvio, blob); } }}
            aoAbrirAnexo={editando ? undefined : () => setFolhaAnexo(true)}
            aoAbrirEmoji={() => setEmojiPara("composer")}
            anexos={media.staged}
            aoRemoverAnexo={media.removeStaged}
            resposta={editando ? { autor: "Editando a mensagem", texto: editando.content } : resposta}
            aoCancelarResposta={() => { if (editando) { setEditando(null); limparRascunho(); } else setResposta(null); }}
            ocupado={enviando}
          />
        )}
      </div>

      <MenuSuspenso
        aberto={menu}
        aoFechar={() => setMenu(false)}
        itens={[
          ...(isPessoal ? [] : [{ rotulo: isDm ? "Ver perfil" : "Participantes", icone: <Users />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "participantes" }) }]),
          { rotulo: "Arquivos", icone: <Paperclip />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "arquivos" }) },
          ...(isPessoal ? [] : [silenciado
            ? { rotulo: "Reativar notificações", icone: <Bell />, aoEscolher: () => { void alternarSilencio(canalId, false); toast("Notificações reativadas"); } }
            : { rotulo: "Silenciar", icone: <BellOff />, aoEscolher: () => { void alternarSilencio(canalId, true); toast("Silenciado: sem notificação, a não ser que mencionem você"); } }]),
          { rotulo: "Buscar na conversa", icone: <Search />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "busca" }) },
        ]}
      />
      <FolhaDeAcoes
        aberta={!!acoesDe}
        aoFechar={() => setAcoesDe(null)}
        acoes={acoesDe ? acoesDaMensagem(acoesDe) : []}
        aoReagir={acoesDe ? (e) => reagir(acoesDe, e) : undefined}
        aoResponder={acoesDe && podeEscrever ? () => responder(acoesDe) : undefined}
        aoMaisEmojis={acoesDe ? () => setEmojiPara(acoesDe) : undefined}
      />
      <FolhaDeEmoji
        aberta={emojiPara !== null}
        aoFechar={() => setEmojiPara(null)}
        aoEscolher={(e) => { if (emojiPara === "composer") setRascunho(rascunho + e); else if (emojiPara) reagir(emojiPara, e); }}
      />
      <FolhaDeAnexo
        aberta={folhaAnexo}
        aoFechar={() => setFolhaAnexo(false)}
        aoDocumento={media.pickFile}
        aoCamera={media.pickCamera}
        aoGaleria={media.pickImage}
        aoDocumentosHs={() => navigate("/base-de-conhecimento")}
      />
      <Folha aberta={!!apagar} aoFechar={() => setApagar(null)} rotulo="Apagar a mensagem?">
        <h3>Apagar para todos?</h3>
        <p style={{ margin: "0 22px 8px", color: "var(--muted)", fontSize: 15 }}>A mensagem some da conversa de todo mundo.</p>
        <button type="button" className="cel-acao perigo" onClick={async () => { const m = apagar; setApagar(null); if (m) await apagarNoCanal(canalId, m.id); }}>Apagar</button>
        <button type="button" className="cel-acao" onClick={() => setApagar(null)}>Cancelar</button>
      </Folha>

      {painel === "participantes" && canal && (
        <Sobreposta titulo={isDm ? "Perfil" : "Participantes"} aoVoltar={aoVoltar}>
          <PainelEmbutido>
            <ChannelMembersPanel
              channelId={canalId}
              channelCreatedBy={canal.created_by}
              isDm={isDm}
              open
              onClose={aoVoltar}
              onMembersChanged={() => setVersaoMembros((v) => v + 1)}
            />
          </PainelEmbutido>
        </Sobreposta>
      )}
      {painel === "arquivos" && (
        <Sobreposta titulo="Arquivos" aoVoltar={aoVoltar}>
          <PainelEmbutido>
            <ChannelFilesPanel endpoint={`/channels/${canalId}/arquivos`} open onClose={aoVoltar} />
          </PainelEmbutido>
        </Sobreposta>
      )}
      {painel === "busca" && (
        <Sobreposta titulo="Buscar na conversa" aoVoltar={aoVoltar}>
          <BuscaNaConversa
            inicial={busca}
            aoBuscar={(t) => { setBusca(t); aoVoltar(); }}
            total={(t) => messages.filter((m) => casaBusca([m.content, m.author_name], t)).length}
          />
        </Sobreposta>
      )}
      <Ampliada src={ampliada} aoFechar={() => setAmpliada(null)} />
    </>
  );
}

function BuscaNaConversa({ inicial, aoBuscar, total }: { inicial: string; aoBuscar: (t: string) => void; total: (t: string) => number }) {
  const [t, setT] = useState(inicial);
  return (
    <form className="cel-painel-conteudo" onSubmit={(e) => { e.preventDefault(); aoBuscar(t.trim()); }}>
      <label className="cel-busca" style={{ margin: 0 }}>
        <Search className="cel-i" />
        <input autoFocus type="search" placeholder="Palavra, nome ou trecho" value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "12px 4px" }}>
        {t.trim() ? `${total(t)} mensagem(ns) nas que estão carregadas nesta conversa.` : "A busca filtra as mensagens desta conversa."}
      </p>
      <button type="submit" className="cel-acao" style={{ color: "var(--accent)", fontWeight: 600, padding: "0 4px" }}>
        <Search />Mostrar na conversa
      </button>
    </form>
  );
}
