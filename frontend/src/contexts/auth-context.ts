import { createContext, useContext } from "react";
import type { AppRole } from "@/hooks/use-auth";

/**
 * Tipos próprios, no lugar dos do `@supabase/supabase-js`.
 *
 * O formato é deliberadamente o mesmo que o app já consumia — em todo o código
 * só se usa `user.id`, `user.email` e `session.access_token`. Manter o contrato
 * significa que as 35 telas que dependem do contexto de auth não precisam mudar.
 */
export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  access_token: string;
  user: AuthUser;
}

export interface AuthContextValue {
  session: AuthSession | null;
  user: AuthUser | null;
  role: AppRole | null;
  profile: { full_name: string; email: string; status: string; avatar_url: string | null } | null;
  loading: boolean;
  needsPasswordSetup: boolean;
  authError: string | null;
  isServiceUnavailable: boolean;
  signOut: () => Promise<void>;
  hasAccess: (roles: AppRole[]) => boolean;
  retryAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
