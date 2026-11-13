/**
 * Conversa com agente no celular — spec 2026-11-03, item 2.
 *
 * Envio, fila, espera da resposta, voz e "Nova conversa" são os do desktop
 * (`useConversaAgente`); a marcação de lido é a mesma (`useConversaAtiva…`).
 * Aqui só mora a tela.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrainCircuit, History, Paperclip, RotateCcw } from "lucide-react";

import ArtifactPanel from "@/components/chat/ArtifactPanel";
import ChannelFilesPanel from "@/components/chat/ChannelFilesPanel";
import { ContextWindowIndicator } from "@/components/chat/ContextWindowIndicator";
import ConversasAnteriores from "@/components/chat/ConversasAnteriores";
import { SeloDoModelo } from "@/components/chat/SeloDoModelo";
import { PainelEmbutido } from "@/components/chat/painel-embutido";
import LiveArtifactViewer from "@/components/LiveArtifactViewer";
import { useAgents } from "@/hooks/use-agents";
import { useAuthContext } from "@/contexts/auth-context";
import { useChatMedia } from "@/hooks/use-chat-media";
import { LIMITE_TEXTO_COMO_ANEXO, useConversaAgente } from "@/hooks/use-conversa-agente";
import { useAcoesEstaveis } from "@/hooks/use-acoes-estaveis";
import { useHoje } from "@/hooks/use-hoje";
import { useConversaAtivaNasNotificacoes } from "@/hooks/use-conversa-ativa";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { acoesDaMensagemDoAgente } from "@/lib/acoes-da-mensagem";
import { toCanonicalAgentId } from "@/lib/agent-id";
import type { ArtifactType } from "@/lib/artifact-extractor";
import { acrescentarCitacao } from "@/lib/conversas-anteriores";
import type { ChatMessage } from "@/lib/mock-data";
import { Cabecalho, Sobreposta } from "./Cabecalho";
import { autorDaCitacao, montarResposta, trechoParaCitar, type Citacao } from "@/lib/citacao";
import { Composer } from "./Composer";
import { FolhaDeAcoes, FolhaDeAnexo, FolhaDeEmoji } from "./Folhas";
import { BolhaPensandoDoAgente, ListaDoAgente, type AcoesDoAgente } from "./ListaDoAgente";
import { Ampliada, MidiaDoAgente } from "./Midia";
import type { Painel, Tela } from "./pilha";
import { Avatar, Folha, MenuSuspenso } from "./ui";
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
  const { profile, user } = useAuthContext();
  const meuNome = (profile?.full_name && profile.full_name.trim()) || user?.email?.split("@")[0] || "Eu";
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
    setResposta({ autor: autorDaCitacao(m.role === "user", meuNome, nome), texto: trechoParaCitar(m.content || "") || "📎 anexo" });
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [nome, meuNome]);

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

  // Ações das bolhas num objeto estável: sem isso cada tecla no composer
  // redesenhava todas as bolhas (ver `ListaDoAgente`).
  const hoje = useHoje();
  const acoesDaLista = useAcoesEstaveis<AcoesDoAgente>({
    segurar: setAcoesDe,
    responder,
    tentarNovamente: (id) => conversa.handleRetry(id),
    abrirArtefato: (a) => { setArtefato(a); setVivo(null); },
    abrirVivo: (id) => { setVivo(id); setArtefato(null); },
    ampliar: setAmpliada,
  });

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
        <ListaDoAgente mensagens={mensagens} isAgentWorking={isAgentWorking} destaqueId={acoesDe?.id ?? null} hoje={hoje} acoes={acoesDaLista} />
        {isAgentWorking && <BolhaPensandoDoAgente nome={nome} parcial={parcial} inicio={mensagens.at(-1)?.role !== "agent"} />}
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
            <ContextWindowIndicator agentId={agentId} actions={<SeloDoModelo />} />
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
