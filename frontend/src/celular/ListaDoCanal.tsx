/**
 * Lista de mensagens do canal, da DM e da thread no celular — 13/11/2026.
 *
 * Existe para digitar não redesenhar as bolhas: o rascunho mora na tela
 * (`TelaConversaCanal`, `TelaThread`), e enquanto o conteúdo da bolha era
 * montado lá, cada letra criava `children`, reações e closures novos para
 * TODAS as bolhas, e o `memo` da `Bolha` nunca segurava. Aqui a lista (memo)
 * só recebe dado estável e um objeto de ações estável (`useAcoesEstaveis`);
 * cada item (memo) recebe primitivos e monta o próprio conteúdo.
 *
 * ⚠️ Ao acrescentar prop: tem que ter identidade estável entre teclas (estado,
 * `useMemo`, primitivo ou função de `acoes`). Função inline ou `?? []` aqui
 * devolve o defeito sem quebrar nada visível — só o teste
 * `ListaDoCanal.digitacao.test.tsx`.
 */
import { Fragment, memo, useCallback, useMemo } from "react";

import { MarkdownMessageContent } from "@/components/chat/MessageContent";
import type { ThreadMeta } from "@/hooks/use-channel-threads";
import type { ChannelMessage } from "@/hooks/use-channels";
import { agoraDoDia } from "@/hooks/use-hoje";
import type { Reaction } from "@/hooks/use-message-reactions";
import type { Person } from "@/hooks/use-people";
import { normalizeAgentId } from "@/lib/active-agents";
import { idDoAnexoDeAudio } from "@/lib/audio-de-mensagem";
import { getAgentDisplayName } from "@/lib/channel-agents";
import { separarCitacao } from "@/lib/citacao";
import { estadoNoCanal, type EstadoDoVisto } from "@/lib/vistos";
import { AudioDoAnexo, Bolha, Pensando, type ReacaoNaBolha } from "./Bolha";
import { corDoNome, horaCurta, mesmoDia, nomeDoAutorNoCanal, rotuloDoDia } from "./formato";
import { MidiaDoCanal } from "./Midia";
import { Avatar } from "./ui";

/** Até onde o canal agrupa bolhas do mesmo autor (5 min, como no desktop). */
const AGRUPA_MS = 5 * 60_000;
const SEM_REACOES: Reaction[] = [];
const SEM_THREADS: Record<string, ThreadMeta> = {};
const NINGUEM: string[] = [];

/** Ações da bolha; cada uma recebe a mensagem. O objeto vem de `useAcoesEstaveis`. */
export interface AcoesDoCanal {
  reagir: (m: ChannelMessage, emoji: string) => void;
  segurar: (m: ChannelMessage) => void;
  responder: (m: ChannelMessage) => void;
  abrirThread: (m: ChannelMessage) => void;
  ampliar: (src: string) => void;
}

/**
 * `canal`: canal/DM. `thread`: respostas de uma thread (sem agrupar por tempo,
 * sem link de thread nem resumo em áudio). `raiz`: a mensagem-mãe no topo da
 * thread (sempre início, sem dia nem visto).
 */
export type ModoDaLista = "canal" | "thread" | "raiz";

export const ListaDoCanal = memo(function ListaDoCanal({
  modo, mensagens, meuId, isDm, isPessoal, recibos, reactions, threadCounts = SEM_THREADS, pessoaPorId,
  resumoLigado, podeEscrever, destaqueId, agentesPensando = NINGUEM, catalogo, hoje, acoes,
}: {
  modo: ModoDaLista;
  mensagens: ChannelMessage[];
  meuId: string | undefined;
  isDm: boolean;
  isPessoal: boolean;
  recibos: Record<string, string>;
  reactions: Record<string, Reaction[]>;
  threadCounts?: Record<string, ThreadMeta>;
  pessoaPorId: Map<string, Person>;
  resumoLigado: boolean;
  podeEscrever: boolean;
  destaqueId: string | null;
  agentesPensando?: string[];
  /**
   * `useCatalogoDeAgentes()`. Não é lido aqui: o nome do agente sai do cache
   * de módulo (`getAgentDisplayName`), e a prop só existe para a lista memo
   * redesenhar quando o catálogo chega ou um Guardi é renomeado.
   */
  catalogo: unknown;
  /** `useHoje()`: o "Hoje"/"Ontem" muda à meia-noite mesmo sem render. */
  hoje: string;
  acoes: AcoesDoCanal;
}) {
  const agora = agoraDoDia(hoje);
  const noCanal = modo === "canal";
  const grupo = noCanal ? !isDm && !isPessoal : true;
  return (
    <>
      {mensagens.map((m, i) => {
        const ant = mensagens[i - 1];
        const eu = m.author_id === meuId;
        const novoDia = modo !== "raiz" && (!ant || !mesmoDia(m.created_at, ant.created_at));
        const inicio = modo === "raiz" || novoDia || !ant || ant.author_id !== m.author_id
          || (noCanal && new Date(m.created_at).getTime() - new Date(ant.created_at).getTime() > AGRUPA_MS);
        const visto: EstadoDoVisto | null = modo === "raiz" || !eu || (noCanal && isPessoal) ? null : estadoNoCanal(m.id, recibos);
        return (
          <ItemDoCanal
            key={m.id}
            m={m}
            rotuloDia={novoDia ? rotuloDoDia(m.created_at, agora) : null}
            inicio={inicio}
            eu={eu}
            grupo={grupo}
            mostrarAutor={(noCanal ? !isDm : true) && !eu && inicio}
            nomeAutor={nomeDoAutorNoCanal(m, pessoaPorId)}
            fotoAutor={pessoaPorId.get(m.author_id)?.avatar_url ?? m.author_avatar ?? null}
            visto={visto}
            reacoes={reactions[m.id] ?? SEM_REACOES}
            meuId={meuId}
            thread={noCanal ? threadCounts[m.id] : undefined}
            mostrarResumo={noCanal && resumoLigado}
            podeResponder={podeEscrever}
            destaque={destaqueId === m.id}
            naThread={!noCanal}
            acoes={acoes}
          />
        );
      })}
      {agentesPensando.map((a) => <BolhaPensandoNoCanal key={`pensando-${a}`} agente={a} nome={getAgentDisplayName(a)} isDm={isDm} />)}
    </>
  );
});

const BolhaPensandoNoCanal = memo(function BolhaPensandoNoCanal({ agente, nome, isDm }: { agente: string; nome: string; isDm: boolean }) {
  return (
    <Bolha id={`pensando-${agente}`} eu={false} inicio grupo={!isDm} hora=""
      avatar={<Avatar tipo="agente" nome={nome} chave={agente} tam="xs" />}
      autor={!isDm ? { nome: `${nome} ✦`, cor: corDoNome(agente) } : null}>
      <Pensando nome={nome} />
    </Bolha>
  );
});

const ItemDoCanal = memo(function ItemDoCanal({
  m, rotuloDia, inicio, eu, grupo, mostrarAutor, nomeAutor, fotoAutor, visto, reacoes, meuId, thread,
  mostrarResumo, podeResponder, destaque, naThread, acoes,
}: {
  m: ChannelMessage;
  /** Separador de dia acima da bolha, já calculado contra `hoje`; `null` = sem. */
  rotuloDia: string | null;
  inicio: boolean;
  eu: boolean;
  grupo: boolean;
  mostrarAutor: boolean;
  nomeAutor: string;
  fotoAutor: string | null;
  visto: EstadoDoVisto | null;
  reacoes: Reaction[];
  meuId: string | undefined;
  thread: ThreadMeta | undefined;
  mostrarResumo: boolean;
  podeResponder: boolean;
  destaque: boolean;
  naThread: boolean;
  acoes: AcoesDoCanal;
}) {
  const apagada = !!m.deleted_at;
  const ehAgente = m.author_type === "agent";
  const reacoesNaBolha = useMemo<ReacaoNaBolha[]>(
    () => reacoes.map((r) => ({ emoji: r.emoji, quantos: r.count, minha: !!meuId && r.user_ids.includes(meuId) })),
    [reacoes, meuId],
  );
  const aoReagir = useCallback((e: string) => acoes.reagir(m, e), [acoes, m]);
  const aoSegurar = useCallback(() => acoes.segurar(m), [acoes, m]);
  const aoResponder = useCallback(() => acoes.responder(m), [acoes, m]);
  const threadNaBolha = useMemo(() => (thread ? {
    quantos: thread.count,
    avatares: <Avatar tipo="pessoa" nome={thread.lastAuthorName || "?"} chave={thread.lastAuthorName || "?"} foto={thread.lastAuthorAvatar} tam="xs" />,
    aoAbrir: () => acoes.abrirThread(m),
  } : null), [thread, acoes, m]);

  const { citacao, resto } = separarCitacao(m.content || "");
  const audioId = idDoAnexoDeAudio(m.audio_url);
  const audioDePessoa = !!m.audio_url && !ehAgente;
  const avatar = ehAgente
    ? <Avatar tipo="agente" nome={nomeAutor} chave={normalizeAgentId(m.author_id || "")} tam="xs" />
    : <Avatar tipo="pessoa" nome={nomeAutor} chave={m.author_id} foto={fotoAutor} tam="xs" />;
  // No canal, a legenda automática "📎 arquivo" some quando o anexo já aparece.
  const mostrarTexto = !!resto && (naThread || !(resto.startsWith("📎") && (m.attachments?.length ?? 0) > 0));

  return (
    <Fragment>
      {rotuloDia && <div className="cel-dia">{rotuloDia}</div>}
      <Bolha
        id={m.id}
        eu={eu}
        inicio={inicio}
        grupo={grupo}
        avatar={avatar}
        autor={mostrarAutor ? { nome: `${nomeAutor}${ehAgente ? " ✦" : ""}`, cor: corDoNome(m.author_id) } : null}
        hora={horaCurta(m.created_at)}
        visto={visto}
        editada={!!m.edited_at && !apagada}
        reacoes={reacoesNaBolha}
        aoReagir={aoReagir}
        thread={threadNaBolha}
        aoSegurar={apagada || m.id.startsWith("optimistic-") ? undefined : aoSegurar}
        aoResponder={apagada || !podeResponder ? undefined : aoResponder}
        destaque={destaque}
      >
        {apagada ? (
          <p style={{ margin: 0, color: "var(--muted)", fontStyle: "italic" }}>Mensagem apagada</p>
        ) : (
          <>
            {citacao && <span className="cel-cit"><b>{citacao.autor}</b><span>{citacao.texto}</span></span>}
            {audioDePessoa && <AudioDoAnexo id={audioId ?? undefined} url={audioId ? undefined : m.audio_url ?? undefined} semente={m.id} rotulo="voz" />}
            {(m.attachments ?? []).map((a, k) => <MidiaDoCanal key={k} att={a} aoAmpliar={acoes.ampliar} />)}
            {mostrarTexto && (
              <div className="cel-texto" style={audioDePessoa && !naThread ? { color: "var(--muted)", fontSize: 14, marginTop: 4 } : undefined}>
                <MarkdownMessageContent text={resto} highlightMentions className="text-[16px] leading-[1.38]" />
              </div>
            )}
            {mostrarResumo && ehAgente && m.audio_url && (
              <AudioDoAnexo id={audioId ?? undefined} url={audioId ? undefined : m.audio_url} semente={m.id} rotulo="resumo" />
            )}
          </>
        )}
      </Bolha>
    </Fragment>
  );
});
