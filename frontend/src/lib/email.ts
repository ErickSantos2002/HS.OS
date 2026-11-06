/**
 * E-mail dos bots pessoais (spec 2026-11-05-bot-email-piloto): chamadas à API
 * e os rótulos do cartão de aprovação.
 *
 * ⚠️ O cartão é a ÚNICA porta de saída para terceiros. "Enviar" manda o `hash`
 * que o cartão exibiu; o servidor relê o rascunho e recusa (409) se mudou.
 */
import { api } from "@/lib/api";

export interface EstadoEmail {
  liberado: boolean;
  bot: string | null;
  conectado: boolean;
  conta: string | null;
  caixas: string[];
}

export interface Pendente {
  id: string;
  status: "pendente" | "enviado" | "descartado" | "vencido" | "erro" | string;
  erro?: string | null;
  de: string;
  para?: string[];
  cc?: string[];
  cco?: string[];
  responder_para?: string[];
  tem_anexo?: boolean;
  anexos?: string[];
  assunto?: string;
  corpo?: string;
  hash?: string;
  assinatura?: boolean;
}

export interface Assinatura {
  texto_antes: string;
  texto_depois: string;
  imagens: { ordem: number; mime: string; nome: string; tamanho: number }[];
}

export const estadoEmail = () => api<EstadoEmail>("/email/estado");
export const conectarEmail = () => api<{ url: string }>("/email/conectar", { method: "POST" });
export const desconectarEmail = () => api("/email/conexao", { method: "DELETE" });
export const verPendente = (id: string) => api<Pendente>(`/email/pendentes/${encodeURIComponent(id)}`);
export const enviarPendente = (id: string, hash: string) =>
  api<{ status: string }>(`/email/pendentes/${encodeURIComponent(id)}/enviar`, { method: "POST", body: { hash } });
export const verAssinatura = () => api<Assinatura>("/email/assinatura");
export const salvarTextoAssinatura = (texto_antes: string, texto_depois: string) =>
  api("/email/assinatura", { method: "PUT", body: { texto_antes, texto_depois } });
export const enviarImagemAssinatura = (ordem: number, arquivo: File) => {
  const f = new FormData();
  f.append("arquivo", arquivo);
  return api(`/email/assinatura/imagem/${ordem}`, { method: "POST", body: f });
};
export const apagarImagemAssinatura = (ordem: number) =>
  api(`/email/assinatura/imagem/${ordem}`, { method: "DELETE" });
export const descartarPendente = (id: string) =>
  api<{ status: string }>(`/email/pendentes/${encodeURIComponent(id)}/descartar`, { method: "POST" });

const STATUS: Record<string, string> = {
  pendente: "Aguardando sua aprovação",
  enviado: "✓ Enviado",
  descartado: "Descartado",
  vencido: "Vencido — o rascunho ficou no Outlook",
  erro: "Não foi enviado",
};

export function rotuloStatus(status: string): string {
  return STATUS[status] ?? status;
}

type Cabecalho = Pick<Pendente, "de" | "para" | "cc" | "cco" | "responder_para" | "tem_anexo" | "anexos" | "assinatura">;

/** As linhas de cabeçalho do cartão. Cco, Responder-para e Anexo só aparecem
 *  quando existem — e TÊM que aparecer: o hash do servidor os cobre. */
export function linhasDoCartao(p: Cabecalho): { rotulo: string; valor: string; destaque?: boolean }[] {
  const l: { rotulo: string; valor: string; destaque?: boolean }[] = [
    { rotulo: "De", valor: p.de, destaque: true },
    { rotulo: "Para", valor: (p.para ?? []).join(", ") },
  ];
  if (p.cc?.length) l.push({ rotulo: "Cc", valor: p.cc.join(", ") });
  if (p.cco?.length) l.push({ rotulo: "Cco", valor: p.cco.join(", "), destaque: true });
  if (p.responder_para?.length) l.push({ rotulo: "Responder para", valor: p.responder_para.join(", "), destaque: true });
  // O servidor já separa as imagens da assinatura: o que chega aqui é anexo de verdade.
  if (p.tem_anexo) l.push({ rotulo: "Anexo", valor: (p.anexos?.length ? p.anexos.join(", ") : "este e-mail tem anexo") + " (veja no Outlook)", destaque: true });
  l.push({ rotulo: "Assinatura", valor: p.assinatura ? "sim, a do seu Perfil" : "não (cadastre no Perfil)" });
  return l;
}

export function mensagemDaConexao(codigo: string | null): { tipo: "ok" | "erro"; texto: string } | null {
  if (!codigo) return null;
  if (codigo === "conectado") return { tipo: "ok", texto: "E-mail conectado." };
  if (codigo === "cancelado") return { tipo: "erro", texto: "Conexão cancelada." };
  if (codigo === "erro_conta")
    return { tipo: "erro", texto: "Entre com a mesma conta Microsoft do seu login no HS.OS." };
  if (codigo === "erro_estado") return { tipo: "erro", texto: "O link expirou. Tente conectar de novo." };
  return { tipo: "erro", texto: "A Microsoft não concluiu a conexão. Tente de novo." };
}
