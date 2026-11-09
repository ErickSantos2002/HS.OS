/**
 * A pessoa tem Guardi (bot pessoal)? Decide se o item "Agenda" aparece no
 * menu. `GET /bots/meu` responde 200 só para quem tem e 404 para quem não tem.
 *
 * Só o 404 vira `false` (e fica em cache longo: ter Guardi não muda durante a
 * sessão). Qualquer outra falha, como um soluço de rede, LANÇA: erro não fica em
 * cache, o React Query tenta de novo e na próxima montagem pergunta outra vez.
 * Antes toda falha virava `false` por 30 min e o menu da Agenda sumia de quem tem
 * Guardi.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ErroApi } from "@/lib/api";
import { useAuthContext } from "@/contexts/auth-context";

export async function existeGuardi(): Promise<boolean> {
  try {
    await api("/bots/meu");
    return true;
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) return false;
    throw e;
  }
}

export function useTemGuardi(): boolean {
  const { user } = useAuthContext();
  const { data } = useQuery({
    queryKey: ["bots", "meu", "existe", user?.id],
    queryFn: existeGuardi,
    enabled: !!user,
    staleTime: 30 * 60_000,
    retry: 2,
  });
  return data === true;
}
