import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { AuthContext, useAuthContext } from "@/contexts/auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// Re-export for backwards compat (consumers should migrate to @/contexts/auth-context)
export { useAuthContext };
