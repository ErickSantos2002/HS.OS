export function stripAgentPrefix(agentId: string): string {
  if (!agentId) return "";
  return agentId.includes(":") ? agentId.split(":").pop() ?? agentId : agentId;
}

export function toCanonicalAgentId(agentId: string): string {
  return stripAgentPrefix(agentId.trim());
}

export function getAgentIdAliases(agentId: string): string[] {
  const raw = agentId.trim();
  if (!raw) return [];

  const stripped = stripAgentPrefix(raw);
  const aliases = new Set<string>([raw, stripped]);
  const compact = stripped.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (compact === "rodrigo" || compact === "rodrigoia") {
    aliases.add("rodrigo");
    aliases.add("rodrigo-ia");
    aliases.add("rodrigoia");
    aliases.add("openclaw:rodrigo");
    aliases.add("openclaw:rodrigo-ia");
  }

  if (!raw.includes(":")) {
    aliases.add(`openclaw:${raw}`);
  }

  return Array.from(aliases).filter(Boolean);
}
