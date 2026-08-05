import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/auth-context";
import { useFirstAccess } from "./use-first-access";

/**
 * Redirects the authenticated user to `/setup` on first access.
 * Only super_admins can complete the wizard — regular members follow
 * through the app normally (the wizard configures instance-wide infra).
 *
 * Runs INSIDE ProtectedRoute so we already know we have a user.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { role } = useAuthContext();
  const location = useLocation();
  const isSuperAdmin = role === "super_admin";

  // Only super_admins are gated. Also disable when already on /setup itself.
  const onSetup = location.pathname === "/setup";
  const { loading, isFirstAccess } = useFirstAccess(isSuperAdmin && !onSetup);

  if (isSuperAdmin && !onSetup && loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isSuperAdmin && !onSetup && isFirstAccess) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
