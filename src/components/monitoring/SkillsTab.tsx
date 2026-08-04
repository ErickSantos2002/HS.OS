import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkills, type Skill } from "@/hooks/use-skills";
import { Zap, AlertCircle, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";

export function SkillsTab() {
  const { skills, loading, error } = useSkills();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q)
    );
  }, [skills, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Skill[]>();
    for (const skill of filtered) {
      const cat = skill.category || "Outros";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(skill);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-4">
            <Skeleton className="h-5 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !skills.length) {
    return (
      <div className="glass-card rounded-2xl py-12 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{error || "Nenhuma skill encontrada."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 rounded-full text-xs bg-secondary/30 border-border/40"
          />
        </div>
        <Badge variant="secondary" className="rounded-full text-[10px]">
          {filtered.length} de {skills.length} skills
        </Badge>
      </div>

      {/* Grouped by category */}
      {grouped.map(([category, catSkills]) => (
        <div key={category}>
          <h3 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            {category} <span className="text-[10px] font-normal">({catSkills.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {catSkills.map((skill) => (
              <div key={skill.name} className="glass-card rounded-xl p-3 hover:bg-secondary/20 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs font-display font-semibold text-foreground truncate">{skill.name}</span>
                  <Badge
                    variant={skill.type === "custom" ? "default" : "secondary"}
                    className="ml-auto text-[9px] rounded-full shrink-0"
                  >
                    {skill.type}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 ml-5.5">{skill.description}</p>
                {skill.requiresCredentials && (
                  <div className="mt-1.5 ml-5.5">
                    <Badge variant="outline" className="text-[9px] text-warning rounded-full">🔑 {skill.requiresCredentials}</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="glass-card rounded-2xl py-8 text-center">
          <p className="text-xs text-muted-foreground">Nenhuma skill corresponde à busca.</p>
        </div>
      )}
    </div>
  );
}
