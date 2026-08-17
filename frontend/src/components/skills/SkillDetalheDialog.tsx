import { useEffect, useState } from "react";
import { Loader2, FileText, Bot, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useManagedSkills, type ManagedSkill } from "@/hooks/use-managed-skills";
import { useAgents } from "@/hooks/use-agents";

/**
 * A skill por inteiro: o que é, quem pode usar, e o markdown completo.
 *
 * ⚠️ **O conteúdo só existe para as skills do repositório.** O gateway não tem
 * método de leitura de skill, então as embutidas do OpenClaw aparecem com os
 * metadados e uma explicação no lugar do texto — em vez de um vazio que parece
 * defeito.
 */
export default function SkillDetalheDialog({
  skill,
  onOpenChange,
}: {
  skill: ManagedSkill | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { lerConteudo, definirAgentes } = useManagedSkills();
  const { agents } = useAgents();
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [semConteudo, setSemConteudo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const slug = skill?.slug ?? null;

  useEffect(() => {
    if (!slug) return;
    let cancelado = false;
    setConteudo(null);
    setSemConteudo(null);
    setCarregando(true);
    lerConteudo(slug)
      .then((d) => { if (!cancelado) setConteudo(d.conteudo); })
      .catch((e: Error) => { if (!cancelado) setSemConteudo(e.message); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [slug, lerConteudo]);

  if (!skill) return null;

  const liberados = new Set(skill.agent_skills.map((a) => a.agent_id));

  async function alternar(agentId: string, ligado: boolean) {
    if (!skill) return;
    // ⚠️ Manda a lista COMPLETA de quem pode. O backend converte para a
    // allowlist por agente do gateway, onde lista explícita substitui tudo —
    // mandar só o que mudou deixaria o agente com uma skill só.
    const nova = new Set(liberados);
    if (ligado) nova.add(agentId); else nova.delete(agentId);
    setSalvando(agentId);
    try {
      await definirAgentes(skill.slug, [...nova]);
      toast({
        title: ligado ? "Skill liberada" : "Skill retirada",
        description: `${skill.name} · ${agents.find((a) => a.id === agentId)?.name ?? agentId}`,
      });
    } catch (e) {
      toast({
        title: "Não deu para salvar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.emoji && <span>{skill.emoji}</span>}
            {skill.name}
            {skill.is_default && (
              <Badge variant="outline" className="text-[10px] rounded-full">
                sempre no contexto
              </Badge>
            )}
          </DialogTitle>
          {skill.description && (
            <DialogDescription className="text-left">{skill.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-5">
          {skill.arquivo && (
            <p className="text-[11px] font-mono text-muted-foreground break-all flex items-start gap-1.5">
              <FileText className="h-3 w-3 mt-0.5 shrink-0" />
              {skill.arquivo}
            </p>
          )}

          <section className="space-y-2">
            <h4 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em]">
              Quem pode usar
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Desligar em todos desativa a skill. Um agente com alguma skill desligada
              passa a ter lista fixa — skill nova do OpenClaw não chega nele até você
              religar tudo.
            </p>
            <div className="space-y-1.5 pt-1">
              {agents.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhum agente.</p>
              )}
              {agents.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 text-sm">
                  <Switch
                    checked={liberados.has(a.id)}
                    disabled={salvando !== null}
                    onCheckedChange={(v) => alternar(a.id, v)}
                  />
                  <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{a.name}</span>
                  {salvando === a.id && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em]">
              Conteúdo
            </h4>
            {carregando ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo o arquivo…
              </div>
            ) : conteudo ? (
              <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap bg-secondary/30 border border-border/40 rounded-xl p-4 max-h-[45vh] overflow-y-auto text-foreground/90">
                {conteudo}
              </pre>
            ) : (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/20 border border-border/40 rounded-xl p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{semConteudo ?? "Sem conteúdo disponível."}</span>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
