import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ArrowRight, Loader2, Server, Users, Building2, Plug, Rocket, BookOpen, ListChecks, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { setSetting } from "@/lib/app-settings";
import { useOnboardingProgress } from "./use-onboarding-progress";
import { useBranding, useThemedLogo } from "@/hooks/use-branding";
import { Step0PrepGateway } from "./components/Step0PrepGateway";
import { Step1Gateway } from "./components/Step1Gateway";
import { Step2Team } from "./components/Step2Team";
import { Step3Company, persistCompanyProfile, type CompanyFormValues } from "./components/Step3Company";
import { Step4Platforms } from "./components/Step4Platforms";
import { Step5Activate } from "./components/Step5Activate";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Preparação", icon: BookOpen },
  { id: 2, label: "Gateway", icon: Server },
  { id: 3, label: "Time", icon: Users },
  { id: 4, label: "Empresa", icon: Building2 },
  { id: 5, label: "Plataformas", icon: Plug },
  { id: 6, label: "Ativar", icon: Rocket },
] as const;

const TOTAL_STEPS = STEPS.length;

export default function SetupPage() {
  const navigate = useNavigate();
  const { branding } = useBranding();
  const themedLogo = useThemedLogo();
  const { progress, loading, save } = useOnboardingProgress();
  const [advancing, setAdvancing] = useState(false);

  // Auto-configura os secrets do Vault (project_url / service_role_key) a partir
  // das env vars do próprio projeto, para push/e-mail/crons funcionarem num remix
  // sem passo manual. Idempotente e best-effort — não bloqueia o setup se falhar.
  const vaultConfigured = useRef(false);
  useEffect(() => {
    if (vaultConfigured.current) return;
    vaultConfigured.current = true;
    supabase.functions.invoke("configure-instance-vault").then(({ error }) => {
      if (error) console.warn("[setup] configure-instance-vault falhou:", error.message);
    });
  }, []);

  const currentStep = progress.currentStep || 1;
  const percent = useMemo(() => (currentStep / TOTAL_STEPS) * 100, [currentStep]);

  const selectedAgentIds = useMemo(
    () => (Array.isArray(progress.stepData.selectedAgentIds)
      ? (progress.stepData.selectedAgentIds as string[])
      : []),
    [progress.stepData],
  );

  const companyValues = useMemo<Partial<CompanyFormValues>>(
    () => (progress.stepData.companyValues as Partial<CompanyFormValues>) ?? {},
    [progress.stepData],
  );

  const connectedPlatformIds = useMemo(
    () => (Array.isArray(progress.stepData.connectedPlatformIds)
      ? (progress.stepData.connectedPlatformIds as string[])
      : []),
    [progress.stepData],
  );

  const onboardingTaskId = useMemo(
    () => (typeof progress.stepData.onboardingTaskId === "string"
      ? (progress.stepData.onboardingTaskId as string)
      : null),
    [progress.stepData],
  );

  const gatewayValidated = progress.stepData.gatewayValidated === true;

  const canAdvance =
    currentStep === 1 ? true : // preparation — always advance
    currentStep === 2 ? gatewayValidated :
    currentStep === 3 ? selectedAgentIds.length > 0 :
    currentStep === 4 ? true : // optional step (company)
    currentStep === 5 ? true : // optional step (platforms)
    currentStep === 6 ? false : // step 6 completes via its own button
    false;

  const goBack = () => {
    if (currentStep <= 1) return;
    void save({ currentStep: currentStep - 1 });
  };

  const goNext = async () => {
    if (currentStep >= TOTAL_STEPS) return;
    if (advancing) return;
    setAdvancing(true);
    try {
      if (currentStep === 4) {
        const { saved, error } = await persistCompanyProfile(companyValues);
        if (error) {
          toast.error("Não foi possível salvar o contexto da empresa", { description: error });
          return;
        }
        await save({
          currentStep: currentStep + 1,
          stepData: { shared_brain_skipped: !saved },
        });
        return;
      }
      await save({ currentStep: currentStep + 1 });
    } finally {
      setAdvancing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/30 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {themedLogo ? (
              <img src={themedLogo} alt={branding.companyName || "Logo"} className="h-7 w-auto" />
            ) : (
              <span className="font-display font-bold text-lg tracking-tight">
                {branding.companyName || "dn.os"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <ListChecks className="h-3.5 w-3.5" />
                  Etapas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover z-50">
                <DropdownMenuLabel className="text-xs">Ir para a etapa</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {STEPS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <DropdownMenuItem
                      key={s.id}
                      onSelect={() => void save({ currentStep: s.id })}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex-1">
                        {s.id}. {s.label}
                      </span>
                      {currentStep === s.id ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-xs text-muted-foreground tabular-nums">
              Passo {currentStep} de {TOTAL_STEPS}
            </span>
          </div>

        </div>
        <div className="mx-auto max-w-4xl px-6 pb-4">
          <Progress value={percent} className="h-1.5" />
          <div className="mt-3 hidden md:flex items-center justify-between">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const done = currentStep > s.id;
              const active = currentStep === s.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    active && "text-primary",
                    done && "text-foreground",
                    !active && !done && "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                      active && "border-primary bg-primary/10",
                      done && "border-primary/60 bg-primary/20",
                      !active && !done && "border-border",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {s.label}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-10">
          {currentStep === 1 ? (
            <Step0PrepGateway onComplete={() => void goNext()} />
          ) : currentStep === 2 ? (
            <Step1Gateway
              onValidated={(valid) => void save({ stepData: { gatewayValidated: valid } })}
            />
          ) : currentStep === 3 ? (
            <Step2Team
              selectedAgentIds={selectedAgentIds}
              onChange={(ids) => void save({ stepData: { selectedAgentIds: ids } })}
            />
          ) : currentStep === 4 ? (
            <Step3Company
              values={companyValues}
              onChange={(patch) =>
                void save({
                  stepData: { companyValues: { ...companyValues, ...patch } },
                })
              }
            />
          ) : currentStep === 5 ? (
            <Step4Platforms
              connectedIds={connectedPlatformIds}
              onChange={(ids) => void save({ stepData: { connectedPlatformIds: ids } })}
              onSkip={() => void save({ currentStep: 6 })}
            />
          ) : currentStep === 6 ? (
            <Step5Activate
              selectedAgentIds={selectedAgentIds}
              taskId={onboardingTaskId}
              onTaskCreated={(id) => void save({ stepData: { onboardingTaskId: id } })}
              onDone={async () => {
                await save({ completedAt: new Date().toISOString() });
                await setSetting("onboarding_skipped", true);
                navigate("/chat", { replace: true });
              }}
            />
          ) : (
            <StepPlaceholder step={currentStep} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 backdrop-blur-sm">
        {/* Sem atalho para pular: entrar sem gateway configurado leva a uma dn.os
            que não responde, e o suporte vira "por que meus agentes estão mudos".
            O caminho é concluir a configuração. */}
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={goBack} disabled={currentStep <= 1}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Voltar
            </Button>
            {currentStep < TOTAL_STEPS ? (
              <Button onClick={goNext} disabled={!canAdvance || advancing}>
                {advancing ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : null}
                Avançar
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            ) : null}
          </div>
        </div>
      </footer>

    </div>
  );
}

function StepPlaceholder({ step }: { step: number }) {
  const meta = STEPS.find((s) => s.id === step);
  const Icon = meta?.icon ?? Server;
  return (
    <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-display font-semibold">Passo {step} — {meta?.label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Conteúdo em construção. Este passo será implementado no próximo PR desta task.
      </p>
    </div>
  );
}
