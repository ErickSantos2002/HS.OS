import { api } from "@/lib/api";
import { useState } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { Badge } from "@/components/ui/badge";
import { Loader2, User, Lock, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { AppRole } from "@/hooks/use-auth";

// ⚠️ Este arquivo NÃO está roteado — a aba "Meu Perfil" da SettingsPage é que
// serve `/profile`. Mantido em dia porque compila, e porque em 07/08/2026
// alguém o religou por engano e a tela viva ficou com "trocar senha" quebrado.
const roleLabels: Record<AppRole, string> = {
  administrador: "Administrador",
  colaborador: "Colaborador",
  sem_papel: "Sem papel",
};

export default function ProfilePage() {
  const { user, role, profile } = useAuthContext();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const handleSaveName = async () => {
    if (!user) return;
    setSaving(true);
    await api("/profiles/me", { method: "PATCH", body: { full_name: fullName } });
    toast({ title: "Nome atualizado" });
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (newPassword.length < 8) {
      setPasswordError("Mínimo de 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("As senhas não coincidem.");
      return;
    }

    setPasswordSaving(true);
    // A senha atual é exigida pelo backend: sem ela, quem sentasse numa
    // máquina destravada trocaria a senha e tomaria a conta.
    let error: Error | null = null;
    try {
      await api("/auth/trocar-senha", {
        method: "POST",
        body: { senha_atual: currentPassword, senha_nova: newPassword },
      });
    } catch (e) {
      error = e as Error;
    }
    if (error) {
      setPasswordError(error.message);
    } else {
      toast({ title: "Senha atualizada" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setPasswordSaving(false);
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      {/* Aurora header */}
      <div className="aurora-glow rounded-2xl px-5 py-4">
        <div className="relative z-10">
          <h1 className="text-lg font-display font-bold text-foreground flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center">
              <User className="h-4 w-4 text-foreground" />
            </div>
            Meu Perfil
          </h1>
          <p className="text-xs text-muted-foreground mt-1 ml-10">Suas informações pessoais e segurança</p>
        </div>
      </div>

      {/* Info card */}
      <div className="glass-card-glow glow-accent">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5 space-y-4">
          <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
            <User className="h-4 w-4 text-primary" /> Informações
          </h3>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
            <div className="glass-input px-3 py-0">
              <input
                value={user?.email ?? ""}
                disabled
                className="w-full bg-transparent py-2.5 text-sm font-mono text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome</label>
            <div className="glass-input px-3 py-0">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Seu nome"
                className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perfil de acesso</label>
            <div>
              <Badge variant="outline" className="rounded-full">{roleLabels[role ?? "user"]}</Badge>
            </div>
          </div>

          <button
            onClick={handleSaveName}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </div>

      {/* Password card */}
      <div className="glass-card-glow glow-accent">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5 space-y-4">
          <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Alterar Senha
          </h3>

          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha atual</label>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nova senha</label>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confirmar nova senha</label>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={passwordSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
            >
              {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {passwordSaving ? "Atualizando..." : "Atualizar senha"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
