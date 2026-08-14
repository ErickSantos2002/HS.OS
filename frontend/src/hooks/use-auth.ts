import { useCallback, useEffect, useRef, useState } from "react";

import { api, ErroApi, EVENTO_SESSAO_ENCERRADA, gravarToken, lerToken } from "@/lib/api";
import type { AuthSession, AuthUser } from "@/contexts/auth-context";

/** Dois papéis, e só. O `sem_papel` não é um deles: é o que o backend
 *  devolve para quem não tem linha em `user_roles`, e existe para essa pessoa
 *  falhar nas checagens em vez de virar colaborador por omissão.
 *
 *  ⚠️ Antes havia `member` E `user`, e o segundo nunca foi papel — era o
 *  `COALESCE(role, 'user')` do backend, ou seja, "sem papel" com nome de papel.
 *  Ter os dois fazia parecer que existiam três níveis quando sempre houve dois. */
export type AppRole = "administrador" | "colaborador" | "sem_papel";

interface RespostaMe {
  id: string;
  email: string;
  nome: string | null;
  papel: AppRole;
  avatar_url: string | null;
}

interface AuthState {
  session: AuthSession | null;
  user: AuthUser | null;
  role: AppRole | null;
  profile: { full_name: string; email: string; status: string; avatar_url: string | null } | null;
  loading: boolean;
  needsPasswordSetup: boolean;
  authError: string | null;
  isServiceUnavailable: boolean;
}

const MAX_LOADING_MS = 8000;
const CALL_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
  ]);
}

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ErroApi) return err.indisponivel;
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("504") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("gateway") ||
    msg.includes("network")
  );
}

const DESLOGADO: AuthState = {
  session: null,
  user: null,
  role: null,
  profile: null,
  loading: false,
  needsPasswordSetup: false,
  authError: null,
  isServiceUnavailable: false,
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({ ...DESLOGADO, loading: true });
  const retryCountRef = useRef(0);

  /** Restaura a sessão a partir do token guardado, validando-o contra a API. */
  const initAuth = useCallback(async () => {
    const token = lerToken();
    if (!token) {
      setState({ ...DESLOGADO });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, authError: null, isServiceUnavailable: false }));

    try {
      const eu = await withTimeout(api<RespostaMe>("/auth/me"));
      const user: AuthUser = { id: eu.id, email: eu.email };
      setState({
        session: { access_token: token, user },
        user,
        role: eu.papel,
        profile: {
          full_name: eu.nome ?? "",
          email: eu.email,
          status: "active",
          avatar_url: eu.avatar_url,
        },
        loading: false,
        needsPasswordSetup: false,
        authError: null,
        isServiceUnavailable: false,
      });
    } catch (err) {
      // Um 401 já limpou o token dentro do cliente HTTP; aqui só decidimos a
      // mensagem. Falha transitória preserva o token, para o retry funcionar.
      const indisponivel = isTransientError(err);
      if (!indisponivel) gravarToken(null);
      setState({
        ...DESLOGADO,
        authError: indisponivel ? "Serviço temporariamente indisponível" : null,
        isServiceUnavailable: indisponivel,
      });
    }
  }, []);

  useEffect(() => {
    initAuth();

    // O cliente HTTP avisa quando o servidor rejeita o token (expirado ou
    // revogado). Sem isto, o usuário ficaria numa tela que falha em silêncio.
    const aoEncerrar = () => setState({ ...DESLOGADO });
    window.addEventListener(EVENTO_SESSAO_ENCERRADA, aoEncerrar);

    // Teto rígido: nunca ficar carregando por mais de 8s.
    const timer = setTimeout(() => {
      setState((prev) =>
        prev.loading
          ? {
              ...prev,
              loading: false,
              authError: prev.authError || "Serviço temporariamente indisponível",
              isServiceUnavailable: true,
            }
          : prev,
      );
    }, MAX_LOADING_MS);

    return () => {
      window.removeEventListener(EVENTO_SESSAO_ENCERRADA, aoEncerrar);
      clearTimeout(timer);
    };
  }, [initAuth]);

  const retryAuth = useCallback(async () => {
    retryCountRef.current += 1;
    await initAuth();
  }, [initAuth]);

  const signOut = useCallback(async () => {
    gravarToken(null);
    setState({ ...DESLOGADO });
  }, []);

  const hasAccess = useCallback(
    (allowedRoles: AppRole[]) => (state.role ? allowedRoles.includes(state.role) : false),
    [state.role],
  );

  return { ...state, signOut, hasAccess, retryAuth };
}

export { isTransientError, withTimeout };

/**
 * Autentica e guarda o token. A tela de login chama isto e em seguida recarrega
 * a rota, o que faz o `useAuth` remontar já com sessão.
 */
export async function entrar(email: string, senha: string): Promise<void> {
  const r = await api<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: { email, senha },
    autenticar: false,
  });
  gravarToken(r.access_token);
}

/** Cria o primeiro administrador de uma instalação zerada e já autentica. */
export async function criarPrimeiroAdmin(
  email: string,
  senha: string,
  nome: string,
): Promise<void> {
  const r = await api<{ access_token: string }>("/auth/bootstrap-admin", {
    method: "POST",
    body: { email, senha, nome },
    autenticar: false,
  });
  gravarToken(r.access_token);
}

/** Diz se a instalação ainda não tem nenhum usuário. */
export async function precisaBootstrap(): Promise<boolean> {
  const r = await api<{ precisa_bootstrap: boolean }>("/auth/status", { autenticar: false });
  return r.precisa_bootstrap;
}
