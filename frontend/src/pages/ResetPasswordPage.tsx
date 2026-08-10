import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Lock, AlertTriangle, CheckCircle2, Eye, EyeOff, Zap } from "lucide-react";
import { useBranding, useThemedLogo } from "@/hooks/use-branding";

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 20, label: "Fraca", color: "bg-destructive" };
  if (score <= 2) return { score: 40, label: "Fraca", color: "bg-destructive" };
  if (score <= 3) return { score: 60, label: "Média", color: "bg-yellow-500" };
  if (score <= 4) return { score: 80, label: "Forte", color: "bg-green-500" };
  return { score: 100, label: "Muito forte", color: "bg-green-500" };
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { branding } = useBranding();
  const themedLogo = useThemedLogo();

  const [senhaAtual, setSenhaAtual] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // ⚠️ **Os links de e-mail não existem mais.** `type=invite` e
  // `type=recovery` no hash eram os magic links do Supabase Auth, que saiu.
  // O hash continua sendo lido só para o texto da tela ("Bem-vindo" no
  // convite), porque quem chega por ele hoje chega logado — o
  // `ProtectedRoute` manda para cá quem tem `profiles.status = 'pending'`.
  //
  // Um fluxo de "esqueci minha senha" de verdade precisa de envio de e-mail,
  // que esta instalação ainda não tem. Hoje, quem esqueceu a senha pede ao
  // administrador uma temporária e a troca aqui.
  const hash = window.location.hash;
  const isInvite = hash.includes("type=invite");
  const isRecovery = hash.includes("type=recovery");

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    // Só quem está logado define senha aqui — sem sessão não há como provar
    // quem é. Antes o `getUser()` do Supabase fazia esta checagem.
    api("/auth/me").catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      // A senha atual é exigida aqui pelo mesmo motivo de Configurações → Perfil:
      // o token vive no navegador, e sem a conferência quem sentasse numa
      // máquina destravada trocaria a senha e tomaria a conta. Quem chega por
      // convite tem a senha temporária que o administrador passou.
      //
      // O `profiles.status` vira 'active' do lado do servidor, na mesma
      // transação — antes eram duas escritas separadas e dava para sair daqui
      // com a senha nova e o perfil ainda pendente.
      await api("/auth/trocar-senha", {
        method: "POST",
        body: { senha_atual: senhaAtual, senha_nova: password },
      });
      setSuccess(true);
      setTimeout(() => navigate("/", { replace: true }), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível trocar a senha.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card/80 backdrop-blur-xl p-8 shadow-2xl shadow-primary/5">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            {themedLogo ? (
              <img
                src={themedLogo}
                alt={branding.companyName}
                className="h-14 w-14 rounded-xl object-contain"

              />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary-foreground" />
              </div>
            )}
          </div>
          <h1 className="text-xl font-display font-semibold text-foreground">
            {isInvite ? "Bem-vindo!" : "Redefinir Senha"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isInvite
              ? "Crie sua senha para acessar a plataforma."
              : "Digite sua nova senha abaixo."}
          </p>
        </div>

        {success ? (
          <div className="text-center space-y-3 py-4">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-sm text-foreground font-medium">
              {isInvite ? "Conta ativada com sucesso!" : "Senha atualizada com sucesso!"}
            </p>
            <p className="text-xs text-muted-foreground">Redirecionando...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Senha atual — a temporária, para quem chega por convite */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                {isInvite ? "Senha temporária" : "Senha atual"}
              </Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  placeholder={isInvite ? "A que o administrador passou" : "Sua senha de hoje"}
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Nova senha</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Strength indicator */}
              {password.length > 0 && (
                <div className="space-y-1.5 px-1">
                  <Progress
                    value={strength.score}
                    className="h-1.5 bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">
                    Força: <span className={strength.score >= 60 ? "text-green-500" : "text-destructive"}>{strength.label}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Confirm */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Confirmar senha</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Digite novamente"
                  className="w-full h-12 rounded-full border border-border bg-secondary/50 pl-11 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirm.length > 0 && password !== confirm && (
                <p className="text-xs text-destructive px-1">As senhas não coincidem.</p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-12 rounded-full text-sm font-semibold uppercase tracking-wider"
              disabled={loading || password.length < 8 || password !== confirm}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isInvite ? (
                "Acessar a plataforma"
              ) : (
                "Salvar nova senha"
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
