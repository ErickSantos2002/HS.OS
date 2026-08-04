import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSetting } from "@/lib/app-settings";

export interface FirstAccessState {
  loading: boolean;
  isFirstAccess: boolean;
  /** True when the user explicitly chose "Skip setup and enter dnOS". */
  skipped: boolean;
  /** True when the user completed the wizard. */
  completed: boolean;
}

/**
 * Detects whether this install is on its first access:
 * - No row in `agent_profiles`, AND
 * - No `gateway_url` configured in `vps_config`, AND
 * - The user has not set the `onboarding_skipped` or `onboarding_completed`
 *   flags in `app_settings`.
 *
 * Order matches Task #30 brief. This hook does NOT redirect on its own —
 * callers (e.g. an OnboardingGate) decide what to do.
 */
export function useFirstAccess(enabled: boolean = true): FirstAccessState {
  const [state, setState] = useState<FirstAccessState>({
    loading: true,
    isFirstAccess: false,
    skipped: false,
    completed: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, isFirstAccess: false, skipped: false, completed: false });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // Explicit user-level flags first — a completed or skipped wizard
        // is authoritative regardless of what the tables look like now.
        const [skippedFlag, completedFlag] = await Promise.all([
          getSetting<boolean>("onboarding_skipped"),
          getSetting<boolean>("onboarding_completed"),
        ]);
        if (skippedFlag === true || completedFlag === true) {
          if (!cancelled) {
            setState({
              loading: false,
              isFirstAccess: false,
              skipped: skippedFlag === true,
              completed: completedFlag === true,
            });
          }
          return;
        }

        const [{ data: agents }, { data: vps }] = await Promise.all([
          supabase.from("agent_profiles").select("id").limit(1),
          supabase.from("vps_config").select("gateway_url").limit(1).maybeSingle(),
        ]);

        const hasAgents = Array.isArray(agents) && agents.length > 0;
        const hasGateway = Boolean(vps?.gateway_url && String(vps.gateway_url).trim());

        if (!cancelled) {
          setState({
            loading: false,
            isFirstAccess: !hasAgents && !hasGateway,
            skipped: false,
            completed: false,
          });
        }
      } catch {
        // Fail open — never trap the user in the wizard because of a
        // transient network error.
        if (!cancelled) {
          setState({ loading: false, isFirstAccess: false, skipped: false, completed: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
