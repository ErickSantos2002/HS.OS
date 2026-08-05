import { WifiOff } from "lucide-react";

interface WelcomeCardProps {
  connected: boolean;
  error: string | null;
  onlineCount: number;
  totalCount: number;
}

export default function WelcomeCard({ connected, error, onlineCount, totalCount }: WelcomeCardProps) {
  return (
    <div className="glass-card-glow p-6 flex flex-col justify-between min-h-[200px] relative overflow-hidden rounded-2xl">
      <div className="glass-card-glow-effect" style={{ width: 160, height: 160, top: -60, right: -60, opacity: 0.2 }} />

      {/* Gradient decorative orb */}
      <div
        className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, hsl(231 100% 62% / 0.15) 0%, transparent 70%)"
        }} />
      

      <div className="relative z-10 space-y-3">
        <p className="text-xs text-muted-foreground">HS.OS</p>
        <h2 className="text-2xl font-display font-bold text-foreground leading-tight">
          Centro de Comando
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs">Monitoramento e acompanhamento dos agentes

        </p>
      </div>

      <div className="relative z-10 flex items-center gap-3 mt-4">
        {error ?
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass-card">
            <WifiOff className="h-3 w-3 text-destructive" />
            <span className="text-xs font-mono text-destructive">Desconectado</span>
          </div> :
        connected ?
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass-card">
            <div className="relative">
              <div className="h-2 w-2 rounded-full bg-success" />
              <div className="absolute inset-0 h-2 w-2 rounded-full bg-success animate-ping opacity-40" />
            </div>
            <span className="text-xs font-mono text-muted-foreground">Gateway Live</span>
          </div> :

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass-card">
            <div className="h-2 w-2 rounded-full bg-warning" />
            <span className="text-xs font-mono text-warning">Reconectando...</span>
          </div>
        }
        <span className="text-xs font-mono text-muted-foreground">
          {onlineCount}/{totalCount} agentes ativos
        </span>
      </div>
    </div>);

}