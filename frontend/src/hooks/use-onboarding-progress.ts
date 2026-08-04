import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";

export type OnboardingStepData = Record<string, unknown>;

interface Progress {
  currentStep: number;
  stepData: OnboardingStepData;
  completedAt: string | null;
}

const DEFAULT: Progress = { currentStep: 1, stepData: {}, completedAt: null };

/**
 * Loads and persists the wizard progress in `onboarding_progress`
 * (one row per user). Debounced writes on save so rapid step changes
 * don't hammer the DB.
 */
export function useOnboardingProgress() {
  const { user } = useAuthContext();
  const [progress, setProgress] = useState<Progress>(DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("onboarding_progress")
        .select("current_step, step_data, completed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setProgress({
          currentStep: data.current_step ?? 1,
          stepData: (data.step_data as OnboardingStepData) ?? {},
          completedAt: data.completed_at ?? null,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const save = useCallback(
    async (next: Partial<Progress>) => {
      if (!user) return;
      const merged: Progress = {
        currentStep: next.currentStep ?? progress.currentStep,
        stepData: { ...progress.stepData, ...(next.stepData ?? {}) },
        completedAt: next.completedAt ?? progress.completedAt,
      };
      setProgress(merged);
      await supabase.from("onboarding_progress").upsert(
        {
          user_id: user.id,
          current_step: merged.currentStep,
          step_data: merged.stepData as never,
          completed_at: merged.completedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    },
    [user, progress],
  );

  return { progress, loading, save };
}
