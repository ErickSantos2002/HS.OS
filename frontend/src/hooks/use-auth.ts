import { useState, useEffect, useCallback, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "super_admin" | "member" | "user";

interface AuthState {
  session: Session | null;
  user: User | null;
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
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
}

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = String((err as any)?.message ?? err).toLowerCase();
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

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    role: null,
    profile: null,
    loading: true,
    needsPasswordSetup: false,
    authError: null,
    isServiceUnavailable: false,
  });

  const retryCountRef = useRef(0);

  const fetchRoleAndProfile = useCallback(async (userId: string) => {
    const [roleRes, profileRes] = await withTimeout(
      Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .order("role")
          .limit(1)
          .maybeSingle(),
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      ])
    );

    const role = (roleRes.data?.role as AppRole) ?? "user";
    const profile = profileRes.data
      ? {
          full_name: profileRes.data.full_name ?? "",
          email: profileRes.data.email ?? "",
          status: profileRes.data.status ?? "active",
          avatar_url: (profileRes.data as any).avatar_url ?? null,
        }
      : null;

    return { role, profile };
  }, []);

  const initAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, authError: null, isServiceUnavailable: false }));

    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession());

      if (session?.user) {
        try {
          const { role, profile } = await fetchRoleAndProfile(session.user.id);
          const needsPw = profile?.status === "pending" || window.location.hash.includes("type=invite");
          setState({
            session,
            user: session.user,
            role,
            profile,
            loading: false,
            needsPasswordSetup: needsPw,
            authError: null,
            isServiceUnavailable: false,
          });
        } catch (profileErr) {
          console.warn("[auth] Profile fetch failed, using fallback:", profileErr);
          const unavailable = isTransientError(profileErr);
          const needsPw = window.location.hash.includes("type=invite");
          setState({
            session,
            user: session.user,
            role: "user",
            profile: null,
            loading: false,
            needsPasswordSetup: needsPw,
            authError: unavailable ? "Serviço temporariamente indisponível" : null,
            isServiceUnavailable: unavailable,
          });
        }
      } else {
        setState({
          session: null,
          user: null,
          role: null,
          profile: null,
          loading: false,
          needsPasswordSetup: false,
          authError: null,
          isServiceUnavailable: false,
        });
      }
    } catch (err) {
      console.warn("[auth] getSession failed:", err);
      const unavailable = isTransientError(err);
      setState({
        session: null,
        user: null,
        role: null,
        profile: null,
        loading: false,
        needsPasswordSetup: false,
        authError: unavailable ? "Serviço temporariamente indisponível" : String((err as any)?.message ?? "Erro desconhecido"),
        isServiceUnavailable: unavailable,
      });
    }
  }, [fetchRoleAndProfile]);

  useEffect(() => {
    // Auth state change listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setState((prev) => ({
          ...prev,
          session,
          user: session.user,
          // loading:true só quando o USUÁRIO muda de verdade. TOKEN_REFRESHED
          // (renovação silenciosa, disparada por qualquer chamada com sessão
          // envelhecida) virava tela de loading do app inteiro — parecia um
          // F5 fantasma e engolia o resultado do que o usuário tinha clicado
          // (flagrado no Testar de conexões, 29/07).
          loading: prev.user?.id === session.user.id ? prev.loading : true,
          authError: null,
          isServiceUnavailable: false,
        }));

        // Defer to avoid auth lock deadlock
        setTimeout(async () => {
          try {
            const { role, profile } = await withTimeout(fetchRoleAndProfile(session.user.id));
            const needsPw = profile?.status === "pending" || window.location.hash.includes("type=invite");
            setState({
              session,
              user: session.user,
              role,
              profile,
              loading: false,
              needsPasswordSetup: needsPw,
              authError: null,
              isServiceUnavailable: false,
            });
          } catch (error) {
            console.warn("[auth] Failed to fetch role/profile after auth change:", error);
            const unavailable = isTransientError(error);
            const needsPw = window.location.hash.includes("type=invite");
            setState({
              session,
              user: session.user,
              role: "user",
              profile: null,
              loading: false,
              needsPasswordSetup: needsPw,
              authError: unavailable ? "Serviço temporariamente indisponível" : null,
              isServiceUnavailable: unavailable,
            });
          }

          if (event === "SIGNED_IN") {
            supabase.from("access_logs").insert({
              user_id: session.user.id,
              action: "login",
              metadata: {},
            }).then(() => {}, () => {});
          }
        }, 0);
      } else {
        setState({
          session: null,
          user: null,
          role: null,
          profile: null,
          loading: false,
          needsPasswordSetup: false,
          authError: null,
          isServiceUnavailable: false,
        });
      }
    });

    // Initial session restore
    initAuth();

    // Hard cap: never loading for more than 8s
    const maxLoadingTimer = setTimeout(() => {
      setState((prev) => {
        if (prev.loading) {
          console.warn("[auth] Max loading timeout reached (8s)");
          return {
            ...prev,
            loading: false,
            authError: prev.authError || "Serviço temporariamente indisponível",
            isServiceUnavailable: true,
          };
        }
        return prev;
      });
    }, MAX_LOADING_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(maxLoadingTimer);
    };
  }, [fetchRoleAndProfile, initAuth]);

  const retryAuth = useCallback(async () => {
    retryCountRef.current += 1;
    await initAuth();
  }, [initAuth]);

  const signOut = useCallback(async () => {
    if (state.user) {
      await supabase.from("access_logs").insert({
        user_id: state.user.id,
        action: "logout",
        metadata: {},
      }).then(() => {}, () => {});
    }
    await supabase.auth.signOut().catch(() => {});
  }, [state.user]);

  const hasAccess = useCallback(
    (allowedRoles: AppRole[]) => {
      if (!state.role) return false;
      return allowedRoles.includes(state.role);
    },
    [state.role]
  );

  return { ...state, signOut, hasAccess, retryAuth };
}

export { isTransientError, withTimeout };
