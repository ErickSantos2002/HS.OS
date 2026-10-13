// frontend/src/components/settings/PreferenciaResumoEmAudio.tsx
import { Switch } from "@/components/ui/switch";
import { useResumoEmAudio } from "@/hooks/use-resumo-em-audio";

export default function PreferenciaResumoEmAudio() {
  const { ligado, alterar } = useResumoEmAudio();
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      <div>
        <h3 className="text-sm font-display font-semibold text-foreground">Resumo em áudio</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cada resposta dos agentes vem com um áudio curto do agente resumindo o que escreveu.
        </p>
      </div>
      <Switch checked={ligado} onCheckedChange={(v) => void alterar(v)} aria-label="Receber resumo em áudio" />
    </div>
  );
}
