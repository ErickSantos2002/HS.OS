import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Crash captured:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-background p-6">
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-foreground">Algo deu errado</h2>
            <p className="text-sm text-muted-foreground">
              Ocorreu um erro inesperado. Tente recarregar a página.
            </p>
            <Button onClick={() => window.location.reload()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Recarregar
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
