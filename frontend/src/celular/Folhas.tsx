/**
 * As folhas de baixo do app do celular: ações da mensagem (segurar), emoji e
 * anexar. As ações vêm de `lib/acoes-da-mensagem.ts` — a mesma fonte da seta
 * do desktop; aqui só se acrescenta "Responder" (citar, o mesmo que deslizar).
 */
import { lazy, Suspense } from "react";
import { Camera, FileText, Image as ImageIcon, Library, Reply, Smile } from "lucide-react";

import type { AcaoDaMensagem } from "@/components/chat/MenuDaMensagem";
import { REACOES_RAPIDAS } from "@/lib/acoes-do-toque";
import { Folha } from "./ui";

const EmojiPickerLargo = lazy(() => import("@/components/chat/EmojiPickerLargo"));

export function FolhaDeAcoes({
  aberta, aoFechar, acoes, aoReagir, aoResponder, aoMaisEmojis,
}: {
  aberta: boolean;
  aoFechar: () => void;
  acoes: AcaoDaMensagem[];
  aoReagir?: (emoji: string) => void;
  aoResponder?: () => void;
  aoMaisEmojis?: () => void;
}) {
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} rotulo="Ações da mensagem">
      {aoReagir && (
        <div className="cel-emojis">
          {REACOES_RAPIDAS.map((e) => (
            <button key={e} type="button" aria-label={`Reagir ${e}`} onClick={() => { aoFechar(); aoReagir(e); }}>{e}</button>
          ))}
          {aoMaisEmojis && (
            <button type="button" aria-label="Mais emojis" style={{ color: "var(--muted)" }} onClick={() => { aoFechar(); aoMaisEmojis(); }}>
              <Smile />
            </button>
          )}
        </div>
      )}
      {aoResponder && (
        <button type="button" className="cel-acao" onClick={() => { aoFechar(); aoResponder(); }}>
          <Reply />Responder
        </button>
      )}
      {acoes.map((a) => {
        const Icone = a.icone;
        return (
          <button key={a.rotulo} type="button" className={`cel-acao${a.perigo ? " perigo" : ""}`} onClick={() => { aoFechar(); a.aoEscolher(); }}>
            {Icone ? <Icone /> : <span style={{ width: 24 }} />}{a.rotulo}
          </button>
        );
      })}
    </Folha>
  );
}

export function FolhaDeEmoji({ aberta, aoFechar, aoEscolher }: { aberta: boolean; aoFechar: () => void; aoEscolher: (emoji: string) => void }) {
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} rotulo="Emojis">
      <h3>Emojis</h3>
      <div style={{ padding: "0 8px" }} data-sem-arrasto>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <EmojiPickerLargo onSelect={(e) => { aoEscolher(e); aoFechar(); }} altura={320} />
        </Suspense>
      </div>
    </Folha>
  );
}

export function FolhaDeAnexo({
  aberta, aoFechar, aoDocumento, aoCamera, aoGaleria, aoDocumentosHs,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoDocumento: () => void;
  aoCamera: () => void;
  aoGaleria: () => void;
  aoDocumentosHs: () => void;
}) {
  const itens = [
    { rotulo: "Documento", icone: <FileText />, cor: "#6b5bd2", fazer: aoDocumento },
    { rotulo: "Câmera", icone: <Camera />, cor: "#d0453a", fazer: aoCamera },
    { rotulo: "Galeria", icone: <ImageIcon />, cor: "#2f8fd8", fazer: aoGaleria },
    { rotulo: "Documentos HS", icone: <Library />, cor: "#1885c8", fazer: aoDocumentosHs },
  ];
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} rotulo="Enviar">
      <h3>Enviar</h3>
      <div className="cel-grade">
        {itens.map((i) => (
          <button key={i.rotulo} type="button" onClick={() => { aoFechar(); i.fazer(); }}>
            <span className="cel-bola" style={{ background: i.cor }}>{i.icone}</span>
            {i.rotulo}
          </button>
        ))}
      </div>
    </Folha>
  );
}
