import { api } from "@/lib/api";
import { useState, useCallback, useEffect } from "react";

export interface Team {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  agentIds: string[];
  createdAt: string;
}

interface DbTeamRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  emoji: string | null;
  created_at: string;
  agent_ids: string[];
}

function rowToTeam(row: DbTeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    color: row.color ?? "",
    emoji: row.emoji ?? "",
    // O elenco vem agregado do servidor. Era o join embutido do PostgREST
    // (`*, team_agents(agent_id)`), sintaxe que só existe lá.
    agentIds: row.agent_ids ?? [],
    createdAt: row.created_at,
  };
}

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);

  const fetchTeams = useCallback(async () => {
    const data = await api<DbTeamRow[]>("/times").catch(() => null);
    if (data) setTeams(data.map(rowToTeam));
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const createTeam = useCallback(async (data: { name: string; description: string; color: string; emoji: string }) => {
    const inserted = await api<DbTeamRow>("/times", {
      method: "POST",
      body: { name: data.name, description: data.description, color: data.color, emoji: data.emoji },
    }).catch(() => null);
    if (inserted) {
      const team = rowToTeam(inserted);
      setTeams((prev) => [...prev, team]);
      return team;
    }
    return null;
  }, []);

  const updateTeam = useCallback(async (id: string, data: Partial<Omit<Team, "id" | "createdAt" | "agentIds">>) => {
    await api(`/times/${id}`, { method: "PATCH", body: data });
    setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
  }, []);

  const deleteTeam = useCallback(async (id: string) => {
    await api(`/times/${id}`, { method: "DELETE" });
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addAgentToTeam = useCallback(async (teamId: string, agentId: string) => {
    await api(`/times/${teamId}/agentes/${encodeURIComponent(agentId)}`, { method: "PUT" });
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId && !t.agentIds.includes(agentId)
          ? { ...t, agentIds: [...t.agentIds, agentId] }
          : t
      )
    );
  }, []);

  const removeAgentFromTeam = useCallback(async (teamId: string, agentId: string) => {
    await api(`/times/${teamId}/agentes/${encodeURIComponent(agentId)}`, { method: "DELETE" });
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId ? { ...t, agentIds: t.agentIds.filter((id) => id !== agentId) } : t
      )
    );
  }, []);

  const getTeamsForAgent = useCallback(
    (agentId: string) => teams.filter((t) => t.agentIds.includes(agentId)),
    [teams]
  );

  return { teams, createTeam, updateTeam, deleteTeam, addAgentToTeam, removeAgentFromTeam, getTeamsForAgent };
}
