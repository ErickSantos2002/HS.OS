/**
 * Quem está no escritório virtual agora (EscritorioHS B, 15/10/2026).
 *
 * O backend mantém a presença em memória, ouvindo o WebSocket de administração
 * do WorkAdventure, e avisa mudança por `tabela:escritorio_presenca`. O tempo
 * real só acelera: a consulta se refaz a cada 60 s de todo jeito, porque o
 * evento sai do worker que tem a conexão e pode não alcançar esta aba.
 *
 * Erro da API não vira toast: a presença fica indefinida e o bloco some. É um
 * acessório da tela do chat, não algo que valha interromper quem está nela.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { emailsNoEscritorio, type PresencaEscritorio } from "@/lib/escritorio";
import { assinarTabela } from "@/lib/realtime";

const CHAVE = ["escritorio", "presenca"];

export function useEscritorioPresenca() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CHAVE,
    queryFn: () => api<PresencaEscritorio>("/escritorio/presenca"),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(
    () => assinarTabela("escritorio_presenca", () => qc.invalidateQueries({ queryKey: CHAVE })),
    [qc],
  );

  const emails = useMemo(() => emailsNoEscritorio(data), [data]);
  const estaNoEscritorio = useCallback(
    (email?: string | null) => (email ? emails.has(email.trim().toLowerCase()) : false),
    [emails],
  );

  return { presenca: data, carregando: isLoading, estaNoEscritorio };
}
