/**
 * Carrega a "Capacidade" do Guardi quando o painel abre. `atualizar()` pede ao
 * backend que ignore o cache de 5 min (o botão da tela).
 */
import { useCallback, useEffect, useState } from "react";
import { api, ErroApi } from "@/lib/api";
import { urlDaCapacidade, type Capacidade } from "@/lib/capacidade";

export function useCapacidadeDoGuardi(agentId: string, aberto: boolean) {
  const [dados, setDados] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async (atualizar: boolean, cancelado: () => boolean = () => false) => {
    setCarregando(true);
    setErro(null);
    try {
      const d = await api<Capacidade>(urlDaCapacidade(agentId, atualizar));
      if (!cancelado()) setDados(d);
    } catch (e) {
      if (cancelado()) return;
      // 404 = não é o Guardi de quem pergunta (a rota é só do dono).
      setErro(e instanceof ErroApi && e.status === 404
        ? "Só o dono do Guardi vê o que ele alcança."
        : "Não consegui carregar agora. Tente atualizar.");
    } finally {
      if (!cancelado()) setCarregando(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!aberto || !agentId) return;
    let cancelado = false;
    setDados(null);
    void carregar(false, () => cancelado);
    return () => { cancelado = true; };
  }, [aberto, agentId, carregar]);

  return { dados, erro, carregando, atualizar: () => carregar(true) };
}
