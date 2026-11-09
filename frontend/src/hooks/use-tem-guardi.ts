/**
 * A pessoa tem Guardi (bot pessoal)? Decide se o item "Agenda" aparece no
 * menu. `GET /bots/meu` responde 200 só para quem tem; qualquer outra
 * resposta esconde. `staleTime` longo: o menu re-renderiza a cada navegação
 * e ter Guardi não muda durante a sessão.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthContext } from "@/contexts/auth-context";

export function useTemGuardi(): boolean {
  const { user } = useAuthContext();
  const { data } = useQuery({
    queryKey: ["bots", "meu", "existe", user?.id],
    queryFn: () => api("/bots/meu").then(() => true, () => false),
    enabled: !!user,
    staleTime: 30 * 60_000,
    retry: false,
  });
  return data === true;
}
