/**
 * Lista de mensagens da conversa com agente no celular — 13/11/2026.
 *
 * Mesma razão da `ListaDoCanal`: o rascunho mora na `TelaConversaAgente`, e
 * enquanto o conteúdo da bolha (o markdown do `ArtifactMessage`, a mídia) era
 * montado lá, cada letra redesenhava todas as bolhas. Aqui a lista (memo) só
 * recebe dado estável e um objeto de ações estável (`useAcoesEstaveis`); cada
 * item (memo) recebe primitivos e monta o próprio conteúdo.
 *
 * ⚠️ Prop nova tem que ter identidade estável entre teclas — ver
 * `ListaDoAgente.digitacao.test.tsx`.
 */
import { Fragment, memo, useCallback } from "react";

import ArtifactMessage from "@/components/chat/ArtifactMessage";
import { StreamingMarkdownContent } from "@/components/chat/MessageContent";
import { agoraDoDia } from "@/hooks/use-hoje";
import type { ArtifactType } from "@/lib/artifact-extractor";
import { separarCitacao } from "@/lib/citacao";
import type { ChatMessage } from "@/lib/mock-data";
import { estadoNoAgente, type EstadoDoVisto } from "@/lib/vistos";
import { Bolha, Pensando } from "./Bolha";
import { horaCurta, mesmoDia, rotuloDoDia } from "./formato";
import { MidiaDoAgente } from "./Midia";

/** Ações da bolha; o objeto vem de `useAcoesEstaveis`. */
export interface AcoesDoAgente {
  segurar: (m: ChatMessage) => void;
  responder: (m: ChatMessage) => void;
  tentarNovamente: (id: string) => void;
  abrirArtefato: (a: { type: ArtifactType; code: string }) => void;
  abrirVivo: (id: string) => void;
  ampliar: (src: string) => void;
}

export const ListaDoAgente = memo(function ListaDoAgente({
  mensagens, isAgentWorking, destaqueId, hoje, acoes,
}: {
  mensagens: ChatMessage[];
  isAgentWorking: boolean;
  destaqueId: string | null;
  /** `useHoje()`: o "Hoje"/"Ontem" muda à meia-noite mesmo sem render. */
  hoje: string;
  acoes: AcoesDoAgente;
}) {
  const agora = agoraDoDia(hoje);
  return (
    <>
      {mensagens.map((m, i) => {
        const ant = mensagens[i - 1];
        const novoDia = !ant || !mesmoDia(m.timestamp, ant.timestamp);
        const eu = m.role === "user";
        const erro = !!m.isError || (!!m.content && m.content.startsWith("[error]"));
        return (
          <ItemDoAgente
            key={m.id}
            m={m}
            rotuloDia={novoDia ? rotuloDoDia(m.timestamp, agora) : null}
            inicio={novoDia || !ant || ant.role !== m.role}
            eu={eu}
            erro={erro}
            visto={eu ? estadoNoAgente(mensagens, i, isAgentWorking) : null}
            // Só a bolha de erro usa (desabilita o "Tentar novamente"); passar
            // para todas redesenharia a conversa inteira quando o agente começa.
            trabalhando={erro && isAgentWorking}
            destaque={destaqueId === m.id}
            acoes={acoes}
          />
        );
      })}
    </>
  );
});

const ItemDoAgente = memo(function ItemDoAgente({
  m, rotuloDia, inicio, eu, erro, visto, trabalhando, destaque, acoes,
}: {
  m: ChatMessage;
  /** Separador de dia acima da bolha, já calculado contra `hoje`; `null` = sem. */
  rotuloDia: string | null;
  inicio: boolean;
  eu: boolean;
  erro: boolean;
  visto: EstadoDoVisto | null;
  trabalhando: boolean;
  destaque: boolean;
  acoes: AcoesDoAgente;
}) {
  const aoSegurar = useCallback(() => acoes.segurar(m), [acoes, m]);
  const aoResponder = useCallback(() => acoes.responder(m), [acoes, m]);
  const { citacao, resto } = separarCitacao(m.content || "");
  return (
    <Fragment>
      {rotuloDia && <div className="cel-dia">{rotuloDia}</div>}
      <Bolha
        id={m.id}
        eu={eu}
        inicio={inicio}
        hora={horaCurta(m.timestamp)}
        visto={visto}
        erro={erro}
        aoSegurar={aoSegurar}
        aoResponder={erro ? undefined : aoResponder}
        destaque={destaque}
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
              onArtifactClick={acoes.abrirArtefato}
              onLiveArtifactClick={acoes.abrirVivo}
            />
          )}
        </div>
        {Array.isArray(m.media) && m.media.map((att, k) => (
          <MidiaDoAgente key={k} att={att} semente={`${m.id}:${k}`} aoAmpliar={acoes.ampliar} />
        ))}
        {erro && (
          <button type="button" className="cel-tentar" disabled={trabalhando} onClick={() => acoes.tentarNovamente(m.id)}>
            Tentar novamente
          </button>
        )}
      </Bolha>
    </Fragment>
  );
});

/** A bolha de "pensando"/texto parcial: memo para a tecla não redesenhá-la. */
export const BolhaPensandoDoAgente = memo(function BolhaPensandoDoAgente({
  nome, parcial, inicio,
}: {
  nome: string;
  parcial: string;
  inicio: boolean;
}) {
  return (
    <Bolha id="pensando" eu={false} inicio={inicio} hora="">
      {parcial ? <div className="cel-texto"><StreamingMarkdownContent text={parcial} className="text-[16px] leading-[1.38]" /></div> : <Pensando nome={nome} />}
    </Bolha>
  );
});
