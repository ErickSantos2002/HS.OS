import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const hash = window.location.hash;
  const isInvite = hash.includes("type=invite");
  const isRecovery = hash.includes("type=recovery");

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    if (!isRecovery && !isInvite) {
      // Check if user has a pending profile (redirected by ProtectedRoute)
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) {
          navigate("/login", { replace: true });
        }
        // If user exists but no hash, they were redirected because profile is pending — allow
      });
    }
  }, [navigate, isRecovery, isInvite]);

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
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
    } else {
      // Mark profile as active now that password is set
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", user.id);
      }
      setSuccess(true);
      setTimeout(() => navigate("/", { replace: true }), 2000);
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
