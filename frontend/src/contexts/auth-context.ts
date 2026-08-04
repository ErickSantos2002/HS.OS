import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "@/hooks/use-auth";

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
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
