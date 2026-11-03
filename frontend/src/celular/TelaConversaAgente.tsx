/**
 * Conversa com agente no celular — spec 2026-11-03, item 2.
 *
 * Envio, fila, espera da resposta, voz e "Nova conversa" são os do desktop
 * (`useConversaAgente`); a marcação de lido é a mesma (`useConversaAtiva…`).
 * Aqui só mora a tela.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrainCircuit, History, Paperclip, RotateCcw } from "lucide-react";

import ArtifactMessage from "@/components/chat/ArtifactMessage";
import ArtifactPanel from "@/components/chat/ArtifactPanel";
import ChannelFilesPanel from "@/components/chat/ChannelFilesPanel";
import { ContextWindowIndicator } from "@/components/chat/ContextWindowIndicator";
import ConversasAnteriores from "@/components/chat/ConversasAnteriores";
import { StreamingMarkdownContent } from "@/components/chat/MessageContent";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { PainelEmbutido } from "@/components/chat/painel-embutido";
import LiveArtifactViewer from "@/components/LiveArtifactViewer";
import { useAgents } from "@/hooks/use-agents";
import { useChatMedia } from "@/hooks/use-chat-media";
import { LIMITE_TEXTO_COMO_ANEXO, useConversaAgente } from "@/hooks/use-conversa-agente";
import { useConversaAtivaNasNotificacoes } from "@/hooks/use-conversa-ativa";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { acoesDaMensagemDoAgente } from "@/lib/acoes-da-mensagem";
import { toCanonicalAgentId } from "@/lib/agent-id";
import type { ArtifactType } from "@/lib/artifact-extractor";
import { acrescentarCitacao } from "@/lib/conversas-anteriores";
import type { ChatMessage } from "@/lib/mock-data";
import { estadoNoAgente } from "@/lib/vistos";
import { Bolha, Pensando } from "./Bolha";
import { Cabecalho, Sobreposta } from "./Cabecalho";
import { montarResposta, separarCitacao, trechoParaCitar, type Citacao } from "./citacao";
import { Composer } from "./Composer";
import { FolhaDeAcoes, FolhaDeAnexo, FolhaDeEmoji } from "./Folhas";
import { Ampliada, MidiaDoAgente } from "./Midia";
import type { Painel, Tela } from "./pilha";
import { Avatar, Folha, MenuSuspenso } from "./ui";
import { horaCurta, mesmoDia, rotuloDoDia } from "./formato";
import { useMapaDmDoAgente } from "./use-lista";
import { useLocation, useNavigate } from "react-router-dom";
import { anteriorDaUrl, semPedido } from "./pedido-da-url";

const PARCIAL_SEM_TEXTO = new Set(["", "[working]", "[retrying]"]);

export function TelaConversaAgente({
  agentId, ativa, painel, aoVoltar, aoAbrir,
}: {
  agentId: string;
  /** É a tela do topo? Só ela marca como lido. */
  ativa: boolean;
  painel: Painel | null;
  aoVoltar: () => void;
  aoAbrir: (t: Tela) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // Busca global numa conversa anterior: `?anterior=<reset>&message=<id>`.
  const anteriorDaBusca = ativa ? anteriorDaUrl(location.search) : null;
  const { agents } = useAgents();
  const agente = agents.find((a) => a.id === agentId);
  const nome = agente?.name ?? agentId;
  const mapaDm = useMapaDmDoAgente();
  useConversaAtivaNasNotificacoes({ agentId, canalId: null, agentDmChannelMap: mapaDm, ativa });

  const conversa = useConversaAgente(agentId);
  const { mensagens, temMais, loadingMore, isAgentWorking, streamingText } = conversa;
  const media = useChatMedia();
  const { value: rascunho, setValue: setRascunho, clear: limparRascunho } = usePersistentDraft(`agent:${agentId}`);
  const [resposta, setResposta] = useState<Citacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [folhaAnexo, setFolhaAnexo] = useState(false);
  const [folhaEmoji, setFolhaEmoji] = useState(false);
  const [confirmarNova, setConfirmarNova] = useState(false);
  const [acoesDe, setAcoesDe] = useState<ChatMessage | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [artefato, setArtefato] = useState<{ type: ArtifactType; code: string } | null>(null);
  const [vivo, setVivo] = useState<string | null>(null);
  const fundoRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const colado = useRef(true);
  const { bottomOffset } = useMobileChatViewport();

  // Rolagem: abre no fim e acompanha enquanto a pessoa está perto do fim.
  useLayoutEffect(() => {
    const f = fundoRef.current;
    if (f && colado.current) f.scrollTop = f.scrollHeight;
  }, [mensagens.length, isAgentWorking, streamingText, bottomOffset]);
  useEffect(() => {
    const f = fundoRef.current;
    if (!f) return;
    const ro = new ResizeObserver(() => { if (colado.current) f.scrollTop = f.scrollHeight; });
    ro.observe(f);
    Array.from(f.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [mensagens.length]);

  const responder = useCallback((m: ChatMessage) => {
    setResposta({ autor: m.role === "user" ? "Você" : nome, texto: trechoParaCitar(m.content || "") || "📎 anexo" });
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [nome]);

  const enviar = async () => {
    if (enviando) return;
    let texto = montarResposta(resposta, rascunho);
    if (!texto.trim() && media.staged.length === 0) return;
    // Texto enorme vira anexo .txt, como no desktop.
    if (texto.trim().length > LIMITE_TEXTO_COMO_ANEXO && media.stagePastedText(texto)) texto = "";
    setEnviando(true);
    colado.current = true;
    try {
      const ok = await conversa.enviarPergunta(texto, media.finalizeStaged);
      if (!ok) return;
      limparRascunho();
      setResposta(null);
      media.clearStaged();
    } finally {
      setEnviando(false);
    }
  };

  const voltarDoPainel = aoVoltar;
  const parcial = streamingText && !PARCIAL_SEM_TEXTO.has(streamingText) ? streamingText : "";
  const sub = isAgentWorking ? "pensando…" : `Agente · ${agente?.specialty || agente?.department || "HS.OS"}`;

  return (
    <>
      <Cabecalho
        aoVoltar={aoVoltar}
        avatar={<Avatar tipo="agente" nome={nome} chave={agentId} tam="sm" />}
        titulo={nome}
        sub={sub}
        subVivo={isAgentWorking}
        aoTocarQuem={() => aoAbrir({ tipo: "painel", painel: "contexto" })}
        aoMenu={() => setMenu(true)}
      />
      <div
        ref={fundoRef}
        className="cel-fundo"
        onScroll={(e) => { const f = e.currentTarget; colado.current = f.scrollHeight - f.scrollTop - f.clientHeight < 96; }}
      >
        {temMais && (
          <button type="button" className="cel-mais" disabled={loadingMore} onClick={() => { colado.current = false; void conversa.handleLoadMore(fundoRef.current); }}>
            {loadingMore ? "Carregando…" : "Carregar anteriores"}
          </button>
        )}
        {mensagens.length === 0 && !isAgentWorking && (
          <div className="cel-vazio">Mande uma mensagem para {nome}.</div>
        )}
        {mensagens.map((m, i) => {
          const ant = mensagens[i - 1];
          const novoDia = !ant || !mesmoDia(m.timestamp, ant.timestamp);
          const eu = m.role === "user";
          const inicio = novoDia || !ant || ant.role !== m.role;
          const erro = !!m.isError || (!!m.content && m.content.startsWith("[error]"));
          const { citacao, resto } = separarCitacao(m.content || "");
          return (
            <Fragment key={m.id}>
              {novoDia && <div className="cel-dia">{rotuloDoDia(m.timestamp)}</div>}
              <Bolha
                id={m.id}
                eu={eu}
                inicio={inicio}
                hora={horaCurta(m.timestamp)}
                visto={eu ? estadoNoAgente(mensagens, i, isAgentWorking) : null}
                erro={erro}
                aoSegurar={() => setAcoesDe(m)}
                aoResponder={erro ? undefined : () => responder(m)}
                destaque={acoesDe?.id === m.id}
              >
                {citacao && <span className="cel-cit"><b>{citacao.autor}</b><span>{citacao.texto}</span></span>}
                <div className="cel-texto">
                  {erro ? (
                    <p>{m.content.replace("[error] ", "").replace("[error]", "")}</p>
                  ) : eu ? (
                    resto && <p style={{ whiteSpace: "pre-wrap" }}>{resto}</p>
                  ) : (
                    <ArtifactMessage
                      content={resto}
                      agentId={m.agentId}
                      className="text-[16px] leading-[1.38]"
                      onArtifactClick={(a) => { setArtefato(a); setVivo(null); }}
                      onLiveArtifactClick={(id) => { setVivo(id); setArtefato(null); }}
                    />
                  )}
                </div>
                {Array.isArray(m.media) && m.media.map((att, k) => (
                  <MidiaDoAgente key={k} att={att} semente={`${m.id}:${k}`} aoAmpliar={setAmpliada} />
                ))}
                {erro && (
                  <button type="button" className="cel-tentar" disabled={isAgentWorking} onClick={() => conversa.handleRetry(m.id)}>
                    Tentar novamente
                  </button>
                )}
              </Bolha>
            </Fragment>
          );
        })}
        {isAgentWorking && (
          <Bolha id="pensando" eu={false} inicio={mensagens.at(-1)?.role !== "agent"} hora="">
            {parcial ? <div className="cel-texto"><StreamingMarkdownContent text={parcial} className="text-[16px] leading-[1.38]" /></div> : <Pensando nome={nome} />}
          </Bolha>
        )}
      </div>
      <div style={{ paddingBottom: bottomOffset }}>
        <Composer
          campoRef={campoRef}
          placeholder={`Mensagem para ${nome}`}
          valor={rascunho}
          aoMudar={setRascunho}
          aoEnviar={() => void enviar()}
          aoGravar={async (blob) => { colado.current = true; await conversa.enviarVoz(blob); }}
          aoAbrirAnexo={() => setFolhaAnexo(true)}
          aoAbrirEmoji={() => setFolhaEmoji(true)}
          anexos={media.staged}
          aoRemoverAnexo={media.removeStaged}
          resposta={resposta}
          aoCancelarResposta={() => setResposta(null)}
          ocupado={enviando}
          aoParar={isAgentWorking ? conversa.handleStopAgentResponse : null}
        />
      </div>

      <MenuSuspenso
        aberto={menu}
        aoFechar={() => setMenu(false)}
        itens={[
          { rotulo: "Arquivos da conversa", icone: <Paperclip />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "arquivos" }) },
          { rotulo: "Conversas anteriores", icone: <History />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "anteriores" }) },
          { rotulo: "Modelo e contexto", icone: <BrainCircuit />, aoEscolher: () => aoAbrir({ tipo: "painel", painel: "contexto" }) },
          { rotulo: "Nova conversa", icone: <RotateCcw />, aoEscolher: () => setConfirmarNova(true) },
        ]}
      />
      <FolhaDeAcoes
        aberta={!!acoesDe}
        aoFechar={() => setAcoesDe(null)}
        acoes={acoesDe ? acoesDaMensagemDoAgente(acoesDe, agentId) : []}
        aoResponder={acoesDe && !acoesDe.isError ? () => responder(acoesDe) : undefined}
      />
      <FolhaDeEmoji aberta={folhaEmoji} aoFechar={() => setFolhaEmoji(false)} aoEscolher={(e) => setRascunho(rascunho + e)} />
      <FolhaDeAnexo
        aberta={folhaAnexo}
        aoFechar={() => setFolhaAnexo(false)}
        aoDocumento={media.pickFile}
        aoCamera={media.pickCamera}
        aoGaleria={media.pickImage}
        aoDocumentosHs={() => navigate("/base-de-conhecimento")}
      />
      <Folha aberta={confirmarNova} aoFechar={() => setConfirmarNova(false)} rotulo="Começar uma nova conversa?">
        <h3>Começar uma nova conversa?</h3>
        <p style={{ margin: "0 22px 8px", color: "var(--muted)", fontSize: 15, lineHeight: 1.45 }}>
          {nome} <b>esquece o que foi conversado</b> e recomeça do zero. As mensagens <b>não são apagadas</b>: ficam em Conversas anteriores.
        </p>
        <button type="button" className="cel-acao" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => { setConfirmarNova(false); void conversa.handleConfirmClearConversation(); }}>
          <RotateCcw />Começar nova conversa
        </button>
        <button type="button" className="cel-acao" onClick={() => setConfirmarNova(false)}>Cancelar</button>
      </Folha>

      {painel === "arquivos" && (
        <Sobreposta titulo="Arquivos da conversa" aoVoltar={voltarDoPainel}>
          <PainelEmbutido>
            <ChannelFilesPanel endpoint={`/conversations/${agentId}/arquivos`} open onClose={voltarDoPainel} />
          </PainelEmbutido>
        </Sobreposta>
      )}
      {painel === "contexto" && (
        <Sobreposta titulo="Modelo e contexto" aoVoltar={voltarDoPainel}>
          <div className="cel-painel-conteudo">
            <ContextWindowIndicator agentId={agentId} actions={<ModelSelector agentId={toCanonicalAgentId(agentId)} />} />
          </div>
        </Sobreposta>
      )}
      <ConversasAnteriores
        agentId={agentId}
        open={painel === "anteriores" || !!anteriorDaBusca}
        onOpenChange={(aberto) => {
          if (aberto) return;
          // Veio da busca global: consome o pedido da URL em vez de voltar.
          if (anteriorDaBusca) navigate(`${location.pathname}${semPedido(location.search, ["anterior", "message"])}`, { replace: true });
          else voltarDoPainel();
        }}
        abrirConversa={anteriorDaBusca?.reset ?? null}
        destacarMensagem={anteriorDaBusca?.mensagem ?? null}
        renderMidia={(lista) => lista.map((att, k) => <MidiaDoAgente key={k} att={att} semente={`ant:${k}`} aoAmpliar={setAmpliada} />)}
        onCitar={(texto) => {
          setRascunho(acrescentarCitacao(rascunho, texto));
          if (anteriorDaBusca) navigate(`${location.pathname}${semPedido(location.search, ["anterior", "message"])}`, { replace: true });
          else voltarDoPainel();
        }}
      />

      {(artefato || vivo) && (
        <section className="cel-tela entrando" style={{ zIndex: 50 }} aria-label="Artefato">
          {artefato ? (
            <ArtifactPanel type={artefato.type} code={artefato.code} onClose={() => setArtefato(null)} />
          ) : vivo ? (
            <LiveArtifactViewer artifactId={vivo} onClose={() => setVivo(null)} />
          ) : null}
        </section>
      )}
      <Ampliada src={ampliada} aoFechar={() => setAmpliada(null)} />
    </>
  );
}
