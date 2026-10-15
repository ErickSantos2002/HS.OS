/**
 * EscritorioHS — o escritório virtual (WorkAdventure) visto do HS.OS.
 * Spec: docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md
 *
 * A identidade que liga os dois lados é o e-mail em minúsculas: a Admin API
 * devolve `userUuid = email.lower()` ao WA, e o vigia de presença do backend
 * relata quem está lá por esse mesmo id. Por isso toda comparação daqui
 * normaliza — o perfil do HS.OS pode ter o e-mail grafado com maiúscula.
 */

/** Endereço público do escritório. Não é segredo. */
export const ESCRITORIO_URL = "https://escritoriohs.healthsafetytech.com";

/** Uma pessoa no escritório agora — contrato de `GET /escritorio/presenca`. */
export interface PessoaNoEscritorio {
  email: string;
  nome: string;
  /** `null` para quem entra no escritório e não tem conta no HS.OS. */
  user_id: string | null;
  avatar_url: string | null;
  /** ISO-8601. */
  desde: string;
}

/**
 * `conectado: false` quer dizer que o backend não está ouvindo o escritório
 * (sem token configurado ou conexão caída) — não que está vazio.
 */
export interface PresencaEscritorio {
  conectado: boolean;
  pessoas: PessoaNoEscritorio[];
}

/** Os e-mails de quem está no escritório, em minúsculas. */
export function emailsNoEscritorio(p: PresencaEscritorio | undefined): Set<string> {
  return new Set((p?.pessoas ?? []).map((pessoa) => pessoa.email.trim().toLowerCase()));
}
