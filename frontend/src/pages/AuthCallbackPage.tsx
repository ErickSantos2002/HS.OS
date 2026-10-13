import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/auth-context";
import { consumirNonceSso, trocarTicket } from "@/lib/sso";

const TICKET_INVALIDO = "Link de acesso inválido ou expirado.";

/**
 * Volta do login com Microsoft: `/auth/callback?ticket=…`.
 *
 * O ticket sai da barra na hora (não fica no histórico) e é trocado UMA vez —
 * o `StrictMode` monta duas vezes em dev, e a segunda troca do mesmo ticket
 * falharia, mostrando erro para um login que deu certo. Daí o `useRef`.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { user, retryAuth } = useAuthContext();
  const [erro, setErro] = useState<string | null>(null);
  const jaTrocou = useRef(false);

  useEffect(() => {
    if (jaTrocou.current) return;
    jaTrocou.current = true;

    const ticket = new URLSearchParams(window.location.search).get("ticket");
    window.history.replaceState(null, "", window.location.pathname);

    // Sem o nonce que o botão grava, o ticket não é desta aba: pode ser um
    // link com o ticket de outra pessoa. Recusa sem chamar a troca.
    if (!ticket || !consumirNonceSso()) {
      setErro(TICKET_INVALIDO);
      return;
    }
    (async () => {
      try {
        await trocarTicket(ticket);
        await retryAuth();
        navigate("/chat", { replace: true });
      } catch (err) {
        setErro(err instanceof Error && err.message ? err.message : TICKET_INVALIDO);
      }
    })();
  }, [navigate, retryAuth]);

  if (user && !erro) return <Navigate to="/chat" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card/80 p-8 text-center space-y-4">
        {erro ? (
          <>
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm text-foreground">{erro}</p>
            <Button className="rounded-full" onClick={() => navigate("/login", { replace: true })}>
              Voltar para o login
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Entrando com a Microsoft…</p>
          </>
        )}
      </div>
    </div>
  );
}
