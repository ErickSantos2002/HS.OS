import React, { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AuthContext, useAuthContext } from "@/contexts/auth-context";
import { loadGatewayConfig, podeCarregarConfigGateway } from "@/lib/gateway";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  // Pedido único por sessão, aqui e só aqui — este era o `if (lerToken())
  // loadGatewayConfig()` de `main.tsx`, que disparava para qualquer sessão
  // com token porque o boot roda antes do React e não tinha como ler o
  // papel. Movido para cá, que já produz o `role` que o resto da tela usa:
  // `GET /gateway/config` é `exige_papel("administrador")`, e sem esse
  // guard toda sessão de colaborador tomava 403 na primeira tela.
  useEffect(() => {
    if (podeCarregarConfigGateway(auth.role)) loadGatewayConfig();
  }, [auth.role]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// Re-export for backwards compat (consumers should migrate to @/contexts/auth-context)
export { useAuthContext };
