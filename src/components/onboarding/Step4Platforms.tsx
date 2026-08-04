import { Plug, ArrowRight } from "lucide-react";

interface Step4PlatformsProps {
  /** Kept for API compatibility with SetupPage — unused in the informational version. */
  connectedIds?: string[];
  onChange?: (ids: string[]) => void;
  onSkip?: () => void;
}

export function Step4Platforms(_props: Step4PlatformsProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <Plug className="h-5 w-5" />
          <h1 className="text-2xl font-display font-semibold text-foreground">
            Plataformas
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Seus agentes podem se conectar a modelos de IA, redes sociais, ferramentas
          de design e muito mais.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Plug className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">
                Conectores ficam na área dedicada
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Para manter o onboarding curto, deixamos as integrações fora deste
                passo. Você configura tudo depois — com credenciais, escopos e
                permissões — em{" "}
                <span className="text-foreground font-medium">
                  Configurações → Conectores
                </span>
                .
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              <span>Nada aqui é obrigatório para ativar seus agentes.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
