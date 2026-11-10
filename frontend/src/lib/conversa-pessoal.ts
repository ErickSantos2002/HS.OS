/**
 * Conversa consigo mesmo (10/11/2026) — o "chat comigo mesmo" do Teams.
 * Spec: docs/superpowers/specs/2026-11-10-conversa-consigo-mesmo-design.md.
 *
 * É um canal do tipo `pessoal`, um por pessoa, criado pelo banco na primeira
 * vez que a tela pede (`GET /channels/pessoal`). O `name` gravado é
 * "Anotações" e **nunca** vai para a tela: todo título passa por
 * `nomeDaConversaPessoal`, senão a pessoa veria "#Anotações", um canal de
 * grupo que não existe.
 */

export const PLACEHOLDER_PESSOAL = "Anote algo para você…";

export function ehPessoal(c: { type: string } | null | undefined): boolean {
  return c?.type === "pessoal";
}

/** "Erick Santos (você)", como no Teams. Sem nome, o começo do e-mail. */
export function nomeDaConversaPessoal(fullName: string | null | undefined, email: string | null | undefined): string {
  const nome = (fullName ?? "").trim() || (email ?? "").split("@")[0].trim();
  return nome ? `${nome} (você)` : "Você";
}
