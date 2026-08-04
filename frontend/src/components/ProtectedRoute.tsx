import { Navigate } from "react-router-dom";
import { useAuthContext } from "@/contexts/auth-context";
import type { AppRole } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, role, loading, needsPasswordSetup, isServiceUnavailable } = useAuthContext();

  // Spinner de tela cheia SÓ na entrada (ainda não há usuário). Com sessão
  // já estabelecida, `loading` nunca mais pode apagar a árvore: qualquer
  // revalidação de sessão desmontava a página inteira e remontava — scroll
  // pulava pro topo, toasts morriam no berço e todas as queries recarregavam.
  // Parecia um "refresh fantasma" (caçado 29/07); o console provou que a
  // página nunca recarregava — era esta troca por spinner.
  if (loading && !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // If service is down and no user session, redirect to login which shows the error UI
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (needsPasswordSetup) {
    return <Navigate to="/reset-password" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}
