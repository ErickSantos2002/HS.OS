import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthContext } from "@/contexts/auth-context";
import { criarPrimeiroAdmin, entrar, precisaBootstrap } from "@/hooks/use-auth";
import { ErroApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, AlertTriangle, Eye, EyeOff, Mail, Lock, RefreshCw, WifiOff, User } from "lucide-react";
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
  const { user, loading: authLoading, isServiceUnavailable, authError, retryAuth } =
    useAuthContext();
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
  // Sem "esqueci minha senha": o HS.OS é interno e as senhas são definidas
  // pelo setor de TI. Recuperação por e-mail seria um caminho de acesso a mais
  // para manter seguro, sem resolver um problema que a gente tenha.
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
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
        const precisa = await withTimeout(precisaBootstrap(), 4000);
        if (!cancelled && precisa) setMode("bootstrap");
      } catch (err) {
        // A API não respondeu. Antes isto detectava um 404 das edge functions
        // (o Lovable sincronizava o código mas não fazia o deploy); agora o
        // sintoma equivalente é o backend fora do ar. Sem o aviso, a pessoa cai
        // no login comum e não entende por que nenhuma senha funciona.
        if (!cancelled && err instanceof ErroApi && err.indisponivel) {
          setInstallIncomplete(true);
          return;
        }
        /* fail-safe: timeout ou rede → mostra o login normal */
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
      await withTimeout(entrar(email, password));
      // O token está guardado; revalida para o contexto enxergar a sessão. Sem
      // isto a tela ficaria parada, porque não há mais o onAuthStateChange do
      // Supabase avisando a aplicação.
      await retryAuth();
    } catch (err) {
      if (isTransientError(err)) {
        setServiceDown(true);
        setError("Serviço temporariamente indisponível. Tente novamente em instantes.");
      } else if (err instanceof ErroApi && (err.status === 401 || err.status === 403)) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_MS);
          setError("Muitas tentativas. Conta bloqueada por 15 minutos.");
        } else {
          setError(err.status === 403 ? err.message : "Email ou senha incorretos.");
        }
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
      // O bootstrap já devolve o token autenticado — não precisa de um login
      // logo em seguida. O OnboardingGate leva ao /setup.
      await withTimeout(criarPrimeiroAdmin(email, password, fullName));
      await retryAuth();
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setError("Esta instalação já tem um administrador. Entre com sua conta.");
        setMode("login");
      } else if (err instanceof ErroApi && !err.indisponivel) {
        setError(err.message);
      } else {
        setError("Erro inesperado ao criar a conta. Tente novamente.");
      }
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
                src={themedLogo || "/HS-OS-logo.png"}
                alt={branding.companyName || "HS.OS"}
                className="w-[220px] h-auto object-contain"
              />
            ) : !brandingLoaded ? (
              <div className="h-20 w-[235px] rounded-xl bg-muted animate-pulse" />
            ) : (
              <img
                src={themedLogo || "/HS-OS-logo.png"}
                alt={branding.companyName || "HS.OS"}
                className="w-[235px] h-auto object-contain"
              />
            )}
          </div>

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
        ) : (
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

            <p className="text-xs text-muted-foreground w-full text-center">
              Esqueceu a senha? Fale com o setor de TI.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
