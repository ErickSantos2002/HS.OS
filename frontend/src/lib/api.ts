/**
 * Cliente HTTP da API do HS.OS.
 *
 * Substitui o `supabase` como caminho para o servidor. O token JWT fica em
 * localStorage e é anexado automaticamente; um 401 limpa a sessão e avisa a
 * aplicação por evento, para que o `useAuth` derrube o usuário para o login
 * sem que cada chamada precise tratar isso.
 */

const BASE = import.meta.env.VITE_API_URL || "/api";

const CHAVE_TOKEN = "hsos.token";

/** Emitido quando o token é rejeitado pelo servidor ou removido localmente. */
export const EVENTO_SESSAO_ENCERRADA = "hsos:sessao-encerrada";

export function lerToken(): string | null {
  try {
    return localStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}

export function gravarToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(CHAVE_TOKEN, token);
    else localStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* modo privado do navegador pode bloquear — não é motivo para quebrar */
  }
}

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly corpo?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroApi";
  }

  /** Falha de rede/servidor fora do ar, em oposição a erro de regra de negócio. */
  get indisponivel(): boolean {
    return this.status === 0 || this.status >= 502;
  }
}

/** O FastAPI devolve `detail` como string OU como lista de erros de validação. */
function extrairMensagem(corpo: unknown, status: number): string {
  const detail = (corpo as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const primeiro = detail[0] as { msg?: string; loc?: unknown[] };
    if (primeiro?.msg) {
      const campo = Array.isArray(primeiro.loc) ? primeiro.loc.at(-1) : undefined;
      return campo ? `${campo}: ${primeiro.msg}` : primeiro.msg;
    }
  }
  return `Erro ${status}`;
}

interface Opcoes extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Por padrão manda o token quando existe. `false` força chamada anônima. */
  autenticar?: boolean;
}

export async function api<T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const { body, autenticar = true, headers, ...resto } = opcoes;

  const cabecalhos = new Headers(headers);
  if (body !== undefined && !cabecalhos.has("Content-Type")) {
    cabecalhos.set("Content-Type", "application/json");
  }
  const token = autenticar ? lerToken() : null;
  if (token) cabecalhos.set("Authorization", `Bearer ${token}`);

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      ...resto,
      headers: cabecalhos,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // fetch só rejeita por falha de rede; erro HTTP vem como resposta normal.
    throw new ErroApi(0, "Não foi possível falar com o servidor.", err);
  }

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  let corpo: unknown = undefined;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = texto;
    }
  }

  if (!resposta.ok) {
    if (resposta.status === 401) {
      gravarToken(null);
      window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_ENCERRADA));
    }
    throw new ErroApi(resposta.status, extrairMensagem(corpo, resposta.status), corpo);
  }

  return corpo as T;
}
