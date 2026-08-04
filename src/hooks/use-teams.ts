import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  team_agents: { agent_id: string }[];
}

function rowToTeam(row: DbTeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    color: row.color ?? "",
    emoji: row.emoji ?? "",
    agentIds: row.team_agents.map((ta) => ta.agent_id),
    createdAt: row.created_at,
  };
}

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);

  const fetchTeams = useCallback(async () => {
    const { data } = await supabase
      .from("teams")
      .select("*, team_agents(agent_id)")
      .order("created_at", { ascending: true });
    if (data) setTeams((data as unknown as DbTeamRow[]).map(rowToTeam));
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const createTeam = useCallback(async (data: { name: string; description: string; color: string; emoji: string }) => {
    const { data: inserted } = await supabase
      .from("teams")
      .insert({ name: data.name, description: data.description, color: data.color, emoji: data.emoji })
      .select("*, team_agents(agent_id)")
      .single();
    if (inserted) {
      const team = rowToTeam(inserted as unknown as DbTeamRow);
      setTeams((prev) => [...prev, team]);
      return team;
    }
    return null;
  }, []);

  const updateTeam = useCallback(async (id: string, data: Partial<Omit<Team, "id" | "createdAt" | "agentIds">>) => {
    await supabase.from("teams").update(data).eq("id", id);
    setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
  }, []);

  const deleteTeam = useCallback(async (id: string) => {
    await supabase.from("teams").delete().eq("id", id);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addAgentToTeam = useCallback(async (teamId: string, agentId: string) => {
    await supabase.from("team_agents").insert({ team_id: teamId, agent_id: agentId });
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId && !t.agentIds.includes(agentId)
          ? { ...t, agentIds: [...t.agentIds, agentId] }
          : t
      )
    );
  }, []);

  const removeAgentFromTeam = useCallback(async (teamId: string, agentId: string) => {
    await supabase.from("team_agents").delete().eq("team_id", teamId).eq("agent_id", agentId);
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
