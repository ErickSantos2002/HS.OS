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

/**
 * Id do usuário logado, lido do próprio JWT.
 *
 * Existe para o código que roda **fora** do React e não tem acesso ao
 * `AuthContext` — o `chat-sender`, que despacha de uma fila em nível de módulo.
 * Substitui o `supabase.auth.getSession()` que fazia esse papel.
 *
 * Não valida assinatura: quem valida é o servidor, a cada request. Aqui é só
 * para saber de quem é a fila; um token adulterado não abre porta nenhuma.
 */
export function lerUsuarioDoToken(): string | null {
  const token = lerToken();
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    // base64url → base64: o JWT troca +/ por -_ e dispensa o padding.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
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


/**
 * Baixa um arquivo de rota autenticada e dispara o "salvar como" do navegador.
 *
 * Precisa existir porque `<a href download>` **não manda cabeçalho**, e as
 * rotas privadas exigem o token. O caminho é: buscar o blob com o token, virar
 * um object URL e clicar nele. O `revokeObjectURL` no fim não é zelo — sem ele
 * o blob fica na memória da aba até recarregar.
 */
export async function baixarComToken(caminho: string, nomeDoArquivo: string): Promise<void> {
  const token = lerToken();
  const resposta = await fetch(`${BASE}${caminho}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resposta.ok) {
    throw new Error(`Não foi possível baixar o arquivo (HTTP ${resposta.status}).`);
  }
  const url = URL.createObjectURL(await resposta.blob());
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeDoArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
