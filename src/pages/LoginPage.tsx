import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, AlertTriangle, Eye, EyeOff, Zap, Mail, Lock, RefreshCw, WifiOff, User } from "lucide-react";
import { useBranding, useThemedLogo } from "@/hooks/use-branding";
import { isTransientError } from "@/hooks/use-auth";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms = LOGIN_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
}

export default function LoginPage() {
  const { user, loading: authLoading, isServiceUnavailable, authError, retryAuth } = useAuthContext();
  const { branding, loaded: brandingLoaded } = useBranding();
  const themedLogo = useThemedLogo();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serviceDown, setServiceDown] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [mode, setMode] = useState<"login" | "forgot" | "bootstrap">("login");
  const [forgotSent, setForgotSent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [fullName, setFullName] = useState("");
  const [checkingBootstrap, setCheckingBootstrap] = useState(true);
  const [installIncomplete, setInstallIncomplete] = useState(false);

  // Instância zerada (remix novo): detecta ausência de admin e mostra a tela de
  // "criar conta de admin" no lugar do login. Auto-fechável no backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Timeout curto: a checagem NUNCA deve bloquear o login (página crítica).
        const { data, error } = await withTimeout(
          supabase.functions.invoke("bootstrap-first-admin", { body: { action: "check" } }),
          4000,
        );

        // 404 é o sintoma de instalação incompleta: o Lovable sincroniza o
        // código das edge functions pelo GitHub mas NÃO faz o deploy delas.
        // Sem este aviso, o remix novo caía no login comum, a pessoa criava
        // conta pelo cadastro normal e virava 'user' em vez de 'super_admin' —
        // e só descobria depois, item por item, que não tinha permissão para
        // nada. O erro precisa aparecer aqui, ligado à causa.
        if (!cancelled && (error as { context?: Response })?.context?.status === 404) {
          setInstallIncomplete(true);
          return;
        }

        if (!cancelled && data?.needsBootstrap) setMode("bootstrap");
      } catch {
        /* fail-safe: timeout ou rede → mostra o login normal, sem acusar deploy */
      } finally {
        if (!cancelled) setCheckingBootstrap(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (authLoading || checkingBootstrap) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/chat" replace />;

  const isLocked = lockedUntil && Date.now() < lockedUntil;
  const showServiceError = serviceDown || isServiceUnavailable;

  const handleRetry = async () => {
    setRetrying(true);
    setServiceDown(false);
    setError("");
    try {
      await retryAuth();
    } finally {
      setRetrying(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setServiceDown(false);

    if (isLocked) {
      const mins = Math.ceil(((lockedUntil ?? 0) - Date.now()) / 60000);
      setError(`Conta bloqueada. Tente novamente em ${mins} minutos.`);
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      );

      if (signInError) {
        if (isTransientError(signInError)) {
          setServiceDown(true);
          setError("Serviço temporariamente indisponível. Tente novamente em instantes.");
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          if (newAttempts >= MAX_ATTEMPTS) {
            setLockedUntil(Date.now() + LOCKOUT_MS);
            setError("Muitas tentativas. Conta bloqueada por 15 minutos.");
          } else {
            setError("Email ou senha incorretos.");
          }
        }
      }
    } catch (err) {
      if (isTransientError(err)) {
        setServiceDown(true);
        setError("Serviço temporariamente indisponível. Tente novamente em instantes.");
      } else {
        setError("Erro inesperado. Tente novamente.");
      }
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setServiceDown(false);
    setLoading(true);
    try {
      const { error: resetError } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
      );
      if (resetError) {
        if (isTransientError(resetError)) {
          setServiceDown(true);
          setError("Serviço temporariamente indisponível.");
        } else {
          setError(resetError.message);
        }
      } else {
        setForgotSent(true);
      }
    } catch (err) {
      if (isTransientError(err)) {
        setServiceDown(true);
        setError("Serviço temporariamente indisponível.");
      } else {
        setError("Erro inesperado. Tente novamente.");
      }
    }
    setLoading(false);
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setServiceDown(false);
    if (password.length < 8) {
      setError("A senha deve ter ao menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: bootError } = await supabase.functions.invoke("bootstrap-first-admin", {
        body: { action: "create", email, password, full_name: fullName },
      });
      if (bootError || data?.error) {
        setError(data?.error ?? "Não foi possível criar a conta. Tente novamente.");
        setLoading(false);
        return;
      }
      // Loga com as credenciais recém-criadas; o OnboardingGate leva ao /setup.
      const { error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      );
      if (signInError) {
        setError("Conta criada, mas o login falhou. Tente entrar manualmente.");
        setMode("login");
      }
    } catch {
      setError("Erro inesperado ao criar a conta. Tente novamente.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card/80 backdrop-blur-xl p-8 shadow-2xl shadow-primary/5">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            {mode === "bootstrap" ? (
              // Passa por useThemedLogo em vez de fixar o arquivo: o wordmark é
              // branco e sumiria no tema claro, onde o hook devolve a versão com
              // fundo próprio. O fallback só entra se a marca não carregar.
              <img
                src={themedLogo || "/dnia-wordmark.png"}
                alt={branding.companyName || "dn.ia"}
                className="w-[220px] h-auto object-contain"
              />
            ) : !brandingLoaded ? (
              <div className="h-20 w-[235px] rounded-xl bg-muted animate-pulse" />
            ) : (
              <img
                src={themedLogo || "/dnia-logo.png"}
                alt={branding.companyName || "dn.os"}
                className="w-[235px] h-auto object-contain"
              />
            )}
          </div>

          {mode === "forgot" && (
            <h1 className="text-xl font-display font-semibold text-foreground">
              Recuperar Senha
            </h1>
          )}
          {mode === "bootstrap" && (
            <>
              <h1 className="text-xl font-display font-semibold text-foreground">
                Criar conta de administrador
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Esta instância ainda não tem ninguém. Crie a conta do dono para começar.
              </p>
            </>
          )}
        </div>

        {/* Instalação incompleta: código sincronizado, funções não publicadas.
            Não bloqueia o login — quem já tem conta continua entrando. */}
        {installIncomplete && (
          <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-sm font-medium">Instalação incompleta</p>
            </div>
            <p className="text-xs text-muted-foreground">
              As funções desta instalação ainda não foram publicadas. O código chega pelo
              GitHub, mas o deploy precisa ser pedido no Lovable — abra o projeto e peça o
              deploy das edge functions.
            </p>
            <p className="text-xs text-muted-foreground">
              Enquanto isso, <strong>não crie a conta pelo cadastro comum</strong>: ela
              nasceria sem permissão de administrador.
            </p>
          </div>
        )}

        {/* Service Unavailable Banner */}
        {showServiceError && (
          <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center space-y-3">
            <WifiOff className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm font-medium text-destructive">
              Serviço temporariamente indisponível
            </p>
            <p className="text-xs text-muted-foreground">
              O servidor está demorando para responder. Isso geralmente se resolve em alguns minutos.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="gap-2"
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Tentar novamente
            </Button>
          </div>
        )}

        {mode === "bootstrap" ? (
          <form onSubmit={handleBootstrap} className="space-y-5">
            {/* Nome */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Seu nome</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && !showServiceError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 rounded-full text-sm font-semibold uppercase tracking-wider"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar conta e continuar"}
            </Button>
          </form>
        ) : mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                  disabled={!!isLocked}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                  disabled={!!isLocked}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <Switch checked={remember} onCheckedChange={setRemember} />
              <span className="text-sm text-muted-foreground">Lembrar de mim</span>
            </div>

            {/* Error (non-service) */}
            {error && !showServiceError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-12 rounded-full text-sm font-semibold uppercase tracking-wider"
              disabled={loading || !!isLocked}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </Button>

            {/* Forgot */}
            <button
              type="button"
              onClick={() => { setMode("forgot"); setError(""); setServiceDown(false); }}
              className="text-xs text-muted-foreground hover:text-primary w-full text-center transition-colors"
            >
              Esqueci minha senha
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword} className="space-y-5">
            {forgotSent ? (
              <div className="text-center space-y-3 py-4">
                <Mail className="h-10 w-10 text-primary mx-auto" />
                <p className="text-sm text-foreground">
                  Email de recuperação enviado para <strong>{email}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Verifique sua caixa de entrada.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  Digite seu email para receber um link de recuperação.
                </p>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    required
                  />
                </div>

                {error && !showServiceError && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 rounded-full text-sm font-semibold uppercase tracking-wider"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar Link"}
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); setForgotSent(false); setServiceDown(false); }}
              className="text-xs text-muted-foreground hover:text-primary w-full text-center transition-colors"
            >
              Voltar ao login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
