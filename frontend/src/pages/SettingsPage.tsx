import { api } from "@/lib/api";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { enviarArquivo, urlPublica } from "@/lib/storage";
import { useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { getGatewayConfig, loadGatewayConfig, saveGatewayConfig, testConnection } from "@/lib/gateway";
import { useBranding } from "@/hooks/use-branding";
import { useAuthContext } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { Settings, Wifi, WifiOff, Loader2, Save, Upload, RotateCcw, Paintbrush, Image, Building2, User, Lock, AlertTriangle, Link2, FileText, UserCog, BookOpen, Bell, Download, Palette, KeyRound, Activity, Zap, DollarSign, Server, Clock, CheckCircle, XCircle, Timer } from "lucide-react";
import { generateDesignSystemYaml } from "@/lib/dnos-design-system-yaml";
import { getPricingFor } from "@/lib/model-pricing";
import { useGatewayStatus } from "@/hooks/useGatewayStatus";

import PublishedArtifactsTab from "@/components/settings/PublishedArtifactsTab";
import CreatedArtifactsTab from "@/components/settings/CreatedArtifactsTab";
import ConnectorsTab from "@/components/settings/ConnectorsTab";
import EmpresaTab from "@/components/settings/EmpresaTab";
import { Switch } from "@/components/ui/switch";
import MissionControlDossierPage from "@/pages/MissionControlDossierPage";
import UsersPage from "@/pages/UsersPage";
import DocumentationPage from "@/pages/DocumentationPage";
import { APP_VERSION, formatBuildDate } from "@/lib/app-version";
import {
  isSupported as isBrowserNotifSupported,
  isEnabled as isBrowserNotifEnabled,
  setEnabled as setBrowserNotifEnabled,
  getPermission as getBrowserNotifPermission,
  requestPermission as requestBrowserNotifPermission,
} from "@/lib/browser-notifications";

export default function SettingsPage() {
  // Gateway state
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [hasSavedToken, setHasSavedToken] = useState(false);

  const [testing, setTesting] = useState(false);
  // Guarda o resultado inteiro, não só o veredito. O motivo da falha é o que
  // resolve o problema — ver `handleTest`.
  const [testResult, setTestResult] = useState<
    { success: boolean; version?: string | null; error?: string } | null
  >(null);
  const [saved, setSaved] = useState(false);
  const { data: gatewayStatus, refetch: refetchGatewayStatus } = useGatewayStatus();

  // Branding state
  const { branding, setBranding, resetBranding, DEFAULT_BRANDING } = useBranding();
  const [companyName, setCompanyName] = useState(branding.companyName);
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor);
  const [brandSaved, setBrandSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoLightInputRef = useRef<HTMLInputElement>(null);
  const logoDarkInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const pwaIconInputRef = useRef<HTMLInputElement>(null);
  const markLightInputRef = useRef<HTMLInputElement>(null);
  const markDarkInputRef = useRef<HTMLInputElement>(null);


  // Profile state
  const { user, profile, role } = useAuthContext();
  const { resolvedTheme, setTheme } = useTheme();
  const isAdmin = role === "super_admin";
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Browser notifications state
  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => isBrowserNotifEnabled());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(() => getBrowserNotifPermission());
  const handleToggleBrowserNotif = async (checked: boolean) => {
    if (!checked) {
      setBrowserNotifEnabled(false);
      setNotifEnabled(false);
      return;
    }
    // Turning ON: ensure permission is actually granted before persisting
    let perm = notifPermission;
    if (perm === "default") {
      const result = await requestBrowserNotifPermission();
      if (result !== "unsupported") {
        perm = result;
        setNotifPermission(result);
      }
    }
    if (perm === "granted") {
      setBrowserNotifEnabled(true);
      setNotifEnabled(true);
    } else {
      // permission denied or unsupported — do NOT persist true
      setBrowserNotifEnabled(false);
      setNotifEnabled(false);
    }
  };
  const handleRequestNotifPermission = async () => {
    const result = await requestBrowserNotifPermission();
    if (result !== "unsupported") setNotifPermission(result);
  };
  const handleTestNotification = async () => {
    const { showNotification } = await import("@/lib/browser-notifications");
    const hasSW = "serviceWorker" in navigator;
    const reg = hasSW ? await navigator.serviceWorker.getRegistration() : null;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;

    const result = await showNotification({
      title: "Teste HS.OS 🔔",
      body: "Se você está vendo isso, as notificações nativas estão funcionando!",
      tag: `dnos-test-${Date.now()}`,
    });

    const resultLine = result.ok
      ? `via ${(result as { via: string }).via}`
      : `falhou (${(result as { reason: string }).reason})`;
    const diag = [
      `PWA standalone: ${isStandalone ? "sim" : "não"}`,
      `SW: ${reg ? `sim (${reg.active?.state ?? "?"})` : "não"}`,
      `Resultado: ${resultLine}`,
    ].join(" | ");
    console.log("[test-notification]", diag);

    toast({
      title: result.ok ? `Notificação disparada via ${result.via}` : "Falha ao disparar notificação",
      description: diag,
      variant: result.ok ? "default" : "destructive",
    });
  };

  const handleTestWebPush = async () => {
    try {
      if (!user?.id) {
        toast({ title: "Faça login primeiro", variant: "destructive" });
        return;
      }
      const { subscribeToPushNotifications } = await import("@/lib/push-notifications");
      const sub = await subscribeToPushNotifications(user.id);
      if (!sub) {
        toast({
          title: "Falha ao inscrever Web Push",
          description: "Veja o console (filtro [push]) para detalhes do erro.",
          variant: "destructive",
        });
        return;
      }
      // Confirma se a row foi salva
      const { count } = await api<{ count: number }>("/push/inscricoes/contagem")
        .catch(() => ({ count: 0 }));

      const json = await api<any>("/push/enviar", {
        method: "POST",
        body: {
          user_id: user.id,
          title: "Teste Web Push 🚀",
          body: "Se você está vendo isso fora do app, está tudo OK!",
          tag: `webpush-test-${Date.now()}`,
        },
      }).catch((e: Error) => ({ erro: e.message, sent: 0 }));

      const enviados = json?.sent ?? 0;
      toast({
        title: enviados > 0 ? `Push enviado (${enviados} dispositivo(s))` : "Push não chegou a ninguém",
        description: `Inscrições no banco: ${count} | resposta: ${JSON.stringify(json)}`,
        variant: enviados > 0 ? "default" : "destructive",
      });
    } catch (e: any) {
      toast({
        title: "Erro inesperado",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    }
  };

  const [searchParams] = useSearchParams();
  type TabId = "profile" | "identity" | "gateway" | "artifacts" | "dnos" | "users" | "documentation" | "integrations" | "empresa";
  const initialTab = (searchParams.get("tab") as TabId) || "profile";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  useEffect(() => {
    const t = searchParams.get("tab") as TabId | null;
    if (t) setActiveTab(t);
  }, [searchParams]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await loadGatewayConfig();
      if (cancelled) return;
      setUrl(config.url);
      // O campo de token nunca é preenchido: o valor não chega mais ao
      // navegador. `temToken` só diz que existe um gravado no servidor.
      setToken("");
      setHasSavedToken(config.temToken);
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  useEffect(() => {
    setCompanyName(branding.companyName);
    setPrimaryColor(branding.primaryColor);
  }, [branding]);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setAvatarUrl(profile?.avatar_url ?? "");
  }, [profile]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    // O backend testa com a configuração já gravada — abre o WebSocket com o
    // gateway e faz uma chamada real, não um ping.
    const result = await testConnection();
    // ⚠️ **O motivo vinha e era jogado fora.** O backend responde `erro` com o
    // que de fato aconteceu — "Connection refused" (túnel fechado), "missing
    // scope" (identidade do cliente errada), timeout de handshake — e a tela
    // imprimia um texto fixo: "Verifique URL e token". Isso é um palpite, e
    // quase sempre o palpite errado: das três causas comuns, só uma tem a ver
    // com URL ou token. Em 10/08/2026 mandou o Erick conferir credencial num
    // caso que era outra coisa.
    setTestResult(result);
    setTesting(false);
  };


  const handleSaveGateway = async () => {
    // Campo de token vazio = manter o que já está gravado. O navegador não tem
    // como reenviar um segredo que nunca recebeu.
    const { error } = await saveGatewayConfig({
      url,
      token: token.trim() ? token.trim() : undefined,
    });
    if (error) {
      setSaved(false);
      return;
    }
    if (token.trim()) setHasSavedToken(true);
    setToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };


  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: "logo" | "logoLight" | "logoDark" | "faviconUrl") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setBranding({ [field]: result });
    };
    reader.readAsDataURL(file);
  };


  const processSquareIconFile = async (
    file: File,
    field: "pwaIconUrl" | "markLight" | "markDark",
  ) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = new window.Image();
    img.onload = () => {
      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const out = canvas.toDataURL("image/png");
      setBranding({ [field]: out });
      toast({
        title:
          field === "pwaIconUrl" ? "Ícone do app atualizado" : "Marca atualizada",
        description:
          field === "pwaIconUrl"
            ? "Novas instalações do PWA usarão este ícone."
            : field === "markLight"
              ? "Marca do menu reduzido (tema claro) atualizada."
              : "Marca do menu reduzido (tema escuro) atualizada.",
      });
    };
    img.src = dataUrl;
  };

  const handlePwaIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSquareIconFile(file, "pwaIconUrl");
  };

  const handleMarkLightUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSquareIconFile(file, "markLight");
  };

  const handleMarkDarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSquareIconFile(file, "markDark");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const ext = file.name.split(".").pop() || "png";
    const filePath = `avatars/${user.id}/${Date.now()}.${ext}`;
    try {
      await enviarArquivo("agent-files", filePath, file, file.name);
    } catch {
      toast({ title: "Erro ao enviar foto", variant: "destructive" });
      return;
    }
    setAvatarUrl(urlPublica("agent-files", filePath));
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileSaving(true);
    await api("/profiles/me", {
      method: "PATCH",
      body: { full_name: fullName, avatar_url: avatarUrl || null },
    }).catch(() => toast({ title: "Não foi possível salvar o perfil", variant: "destructive" }));
    toast({ title: "Perfil atualizado" });
    setProfileSaving(false);
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 8) { setPasswordError("Mínimo de 8 caracteres."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("As senhas não coincidem."); return; }
    setPasswordSaving(true);
    // A senha atual é exigida: o token fica no navegador, e sem essa
    // conferência quem sentasse numa máquina destravada tomaria a conta.
    let error: Error | null = null;
    try {
      await api("/auth/trocar-senha", {
        method: "POST",
        body: { senha_atual: currentPassword, senha_nova: newPassword },
      });
    } catch (e) {
      error = e as Error;
    }
    if (error) { setPasswordError(error.message); } else {
      toast({ title: "Senha atualizada" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    }
    setPasswordSaving(false);
  };

  const hslToHex = (hsl: string): string => {
    const parts = hsl.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return "#3D61FF";
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const hexToHsl = (hex: string): string => {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        case b: h = ((r - g) / d + 4) * 60; break;
      }
    }
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  const handleSaveBranding = () => {
    setBranding({ companyName, primaryColor });
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 2000);
  };

  const handleReset = () => {
    resetBranding();
    setCompanyName(DEFAULT_BRANDING.companyName);
    setPrimaryColor(DEFAULT_BRANDING.primaryColor);
  };

  const isMemberOrAdmin = role === "super_admin" || role === "member";

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "profile", label: "Meu Perfil", icon: User },
    ...(isAdmin ? [{ id: "empresa" as TabId, label: "Empresa", icon: Building2 }] : []),
    ...(isAdmin ? [{ id: "identity" as TabId, label: "Personalização", icon: Palette }] : []),
    ...(isAdmin ? [{ id: "users" as TabId, label: "Usuários", icon: UserCog }] : []),
    ...(isAdmin ? [{ id: "integrations" as TabId, label: "Conectores", icon: KeyRound }] : []),
    { id: "artifacts", label: "Artefatos", icon: Link2 },
    ...(isMemberOrAdmin ? [{ id: "documentation" as TabId, label: "Documentação", icon: BookOpen }] : []),
    ...(isAdmin ? [{ id: "gateway" as TabId, label: "Gateway", icon: Wifi }] : []),
    { id: "dnos", label: "HS.OS", icon: FileText },
  ];


  const [artifactSubTab, setArtifactSubTab] = useState<"published" | "created">("published");

  const ArtifactsSection = () => (
    <div className="aurora-glow rounded-2xl p-5">
      <div className="relative z-10">
        <h2 className="text-base font-display font-bold text-foreground mb-4 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Artefatos
        </h2>
        <div className="flex gap-1 mb-4 p-1 rounded-full bg-secondary/30 w-fit">
          <button
            onClick={() => setArtifactSubTab("published")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              artifactSubTab === "published"
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Publicados
          </button>
          <button
            onClick={() => setArtifactSubTab("created")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              artifactSubTab === "created"
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Criados
          </button>
        </div>
        {artifactSubTab === "published" ? <PublishedArtifactsTab /> : <CreatedArtifactsTab />}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="aurora-glow rounded-2xl px-5 py-4">
        <div className="relative z-10">
          <h1 className="text-lg font-display font-bold text-foreground flex items-center gap-2 flex-wrap">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center">
              <Settings className="h-4 w-4 text-foreground" />
            </div>
            Configurações
            <span
              className="ml-1 text-[10px] font-mono font-normal text-muted-foreground/80 px-2 py-0.5 rounded-md bg-muted/40 border border-border/50"
              title={`Último deploy: ${formatBuildDate()}`}
            >
              {APP_VERSION} · {formatBuildDate()}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1 ml-10">Perfil, identidade visual e conexão do gateway</p>

        </div>
      </div>

      {/* Tabs */}
      <nav className="flex flex-wrap items-center gap-1.5 p-1.5 bg-background/60 backdrop-blur-2xl border border-white/10 rounded-[20px] shadow-2xl">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative group flex items-center gap-2 px-3.5 py-2 rounded-[14px] whitespace-nowrap transition-all duration-300 ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/30 shadow-[0_0_20px_-5px_hsl(var(--primary)/0.35)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
              }`}
            >
              <tab.icon className={`h-4 w-4 ${isActive ? "opacity-90" : "opacity-60"}`} />
              <span className="text-[13px] font-medium tracking-tight">{tab.label}</span>
              {isActive && (
                <span className="pointer-events-none absolute -bottom-px left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Artifacts Tab */}
      {activeTab === "artifacts" && (
        <ArtifactsSection />
      )}

      {/* Empresa Tab */}
      {activeTab === "empresa" && isAdmin && (
        <EmpresaTab />
      )}

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="space-y-5">
          {/* Avatar */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
                <div>
                  <h3 className="text-sm font-display font-semibold text-foreground">Tema da interface</h3>
                  <p className="text-xs text-muted-foreground mt-1">Alterna entre modo claro e escuro em todo o app.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{resolvedTheme === "light" ? "Claro" : "Escuro"}</span>
                  <Switch
                    checked={resolvedTheme !== "light"}
                    onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                    aria-label="Alternar tema claro e escuro"
                  />
                </div>
              </div>

              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Foto de Perfil
              </h3>
              <div className="flex items-center gap-4">
                <div
                  className="h-16 w-16 rounded-full border border-border bg-secondary/50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs text-muted-foreground">Sua foto aparecerá nas mensagens do chat.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors"
                    >
                      Upload
                    </button>
                    {avatarUrl && (
                      <button
                        onClick={() => setAvatarUrl("")}
                        className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Nome no Chat
              </h3>
              <div className="glass-input px-3 py-0">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">Este nome será exibido nas suas mensagens dos canais.</p>
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                Email
              </h3>
              <div className="glass-input px-3 py-0">
                <input
                  value={user?.email ?? ""}
                  disabled
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-muted-foreground"
                />
              </div>
            </div>
          </div>

          {/* Password */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" /> Alterar Senha
              </h3>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Senha atual"
                  autoComplete="current-password"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nova senha"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmar nova senha"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              {passwordError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}
              <button
                onClick={handleChangePassword}
                disabled={passwordSaving || !currentPassword || !newPassword}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
              >
                {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {passwordSaving ? "Atualizando..." : "Atualizar Senha"}
              </button>
            </div>
          </div>

          {/* Browser Notifications */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" /> Notificações do navegador
              </h3>
              {notifPermission === "unsupported" ? (
                <p className="text-xs text-muted-foreground">
                  Seu navegador não suporta notificações nativas. Em iOS, instale o app como PWA para habilitar.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
                    <div>
                      <p className="text-sm text-foreground">Mostrar alertas do sistema</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Recebe notificações nativas quando o app está em segundo plano ou outra aba.
                      </p>
                    </div>
                    <Switch
                      checked={notifEnabled && notifPermission === "granted"}
                      onCheckedChange={handleToggleBrowserNotif}
                      disabled={notifPermission === "denied"}
                      aria-label="Ativar notificações do navegador"
                    />
                  </div>
                  {notifPermission === "default" && (
                    <button
                      onClick={handleRequestNotifPermission}
                      className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors"
                    >
                      Permitir notificações
                    </button>
                  )}
                  {notifPermission === "denied" && (
                    <p className="text-xs text-destructive">
                      Permissão bloqueada. Habilite manualmente nas configurações do navegador para este site.
                    </p>
                  )}
                  {notifPermission === "granted" && (
                    <>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-muted-foreground">✓ Permissão concedida.</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleTestNotification}
                            className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                          >
                            🔔 Testar notificação
                          </button>
                          <button
                            onClick={handleTestWebPush}
                            className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                          >
                            🚀 Testar Web Push
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border/30 bg-secondary/20 px-3 py-2">
                        💡 <strong>Usando como app instalado (PWA) no Windows?</strong> Verifique também:{" "}
                        <em>Configurações do Windows → Sistema → Notificações</em> e ative a entrada do HS.OS / HS.OS na lista de apps.
                        Sem isso, o Windows bloqueia silenciosamente as notificações da PWA mesmo com permissão concedida no app.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Save Profile */}
          <button
            onClick={handleSaveProfile}
            disabled={profileSaving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
          >
            {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {profileSaving ? "Salvando..." : "Salvar Perfil"}
          </button>
        </div>
      )}

      {/* Identity Tab */}
      {activeTab === "identity" && (
        <div className="space-y-5">
          {/* Logo Upload */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-4">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Image className="h-4 w-4 text-primary" /> Logo da Empresa
              </h3>
              <p className="text-xs text-muted-foreground">
                Faça upload de versões específicas para cada tema. Se um dos temas ficar vazio, usamos o logo padrão como fallback.
              </p>

              {/* Slot: default logo (fallback) */}
              <div className="flex items-center gap-4">
                <div
                  className="h-16 w-16 rounded-lg border border-border bg-secondary/50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {branding.logo ? (
                    <img src={branding.logo} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Logo padrão (fallback)</p>
                  <p className="text-[11px] text-muted-foreground">Usado quando não há variante para o tema atual.</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => logoInputRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors">Upload</button>
                    {branding.logo && (
                      <button onClick={() => setBranding({ logo: "" })} className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors">Remover</button>
                    )}
                  </div>
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "logo")} />
              </div>

              {/* Slot: light theme */}
              <div className="flex items-center gap-4 border-t border-border/40 pt-4">
                <div
                  className="h-16 w-16 rounded-lg border border-border bg-white flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => logoLightInputRef.current?.click()}
                >
                  {(branding.logoLight || branding.logo) ? (
                    <img src={branding.logoLight || branding.logo} alt="Logo tema claro" className="h-full w-full object-contain" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Logo — tema claro ☀️</p>
                  <p className="text-[11px] text-muted-foreground">Ideal: versão escura sobre fundo claro.</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => logoLightInputRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors">Upload</button>
                    {branding.logoLight && (
                      <button onClick={() => setBranding({ logoLight: "" })} className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors">Remover</button>
                    )}
                  </div>
                </div>
                <input ref={logoLightInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "logoLight")} />
              </div>

              {/* Slot: dark theme */}
              <div className="flex items-center gap-4 border-t border-border/40 pt-4">
                <div
                  className="h-16 w-16 rounded-lg border border-border bg-[#0A0A0A] flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => logoDarkInputRef.current?.click()}
                >
                  {(branding.logoDark || branding.logo) ? (
                    <img src={branding.logoDark || branding.logo} alt="Logo tema escuro" className="h-full w-full object-contain" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Logo — tema escuro 🌙</p>
                  <p className="text-[11px] text-muted-foreground">Ideal: versão clara sobre fundo escuro.</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => logoDarkInputRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors">Upload</button>
                    {branding.logoDark && (
                      <button onClick={() => setBranding({ logoDark: "" })} className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors">Remover</button>
                    )}
                  </div>
                </div>
                <input ref={logoDarkInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "logoDark")} />
              </div>

              {/* Section: brand mark (compact icon used in collapsed sidebar) */}
              <div className="border-t border-border/40 pt-4 space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-display">
                  Marca da empresa (ícone)
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Usada no menu lateral quando ele está reduzido. Envie versões quadradas — redimensionamos para 512×512.
                  Se ficar em branco, o menu reduzido usa o logo do tema correspondente.
                </p>
              </div>

              {/* Slot: mark light */}
              <div className="flex items-center gap-4">
                <div
                  className="h-16 w-16 rounded-2xl border border-border bg-white flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => markLightInputRef.current?.click()}
                >
                  {branding.markLight ? (
                    <img src={branding.markLight} alt="Marca tema claro" className="h-full w-full object-cover" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Marca — tema claro ☀️</p>
                  <p className="text-[11px] text-muted-foreground">Ícone quadrado sobre fundo claro.</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => markLightInputRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors">Upload</button>
                    {branding.markLight && (
                      <button onClick={() => setBranding({ markLight: "" })} className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors">Remover</button>
                    )}
                  </div>
                </div>
                <input ref={markLightInputRef} type="file" accept="image/*" className="hidden" onChange={handleMarkLightUpload} />
              </div>

              {/* Slot: mark dark */}
              <div className="flex items-center gap-4 border-t border-border/40 pt-4">
                <div
                  className="h-16 w-16 rounded-2xl border border-border bg-[#0A0A0A] flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => markDarkInputRef.current?.click()}
                >
                  {branding.markDark ? (
                    <img src={branding.markDark} alt="Marca tema escuro" className="h-full w-full object-cover" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-foreground">Marca — tema escuro 🌙</p>
                  <p className="text-[11px] text-muted-foreground">Ícone quadrado sobre fundo escuro.</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => markDarkInputRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-muted transition-colors">Upload</button>
                    {branding.markDark && (
                      <button onClick={() => setBranding({ markDark: "" })} className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors">Remover</button>
                    )}
                  </div>
                </div>
                <input ref={markDarkInputRef} type="file" accept="image/*" className="hidden" onChange={handleMarkDarkUpload} />
              </div>
            </div>
          </div>



          {/* Company Name */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Nome do Workspace
              </h3>
              <div className="glass-input px-3 py-0">
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="OpenClaw"
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Primary Color */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Paintbrush className="h-4 w-4 text-primary" /> Cor Primária
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="color"
                    value={hslToHex(primaryColor)}
                    onChange={(e) => setPrimaryColor(hexToHsl(e.target.value))}
                    className="h-10 w-10 rounded-full border border-border/40 cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
                  />
                </div>
                <div className="flex-1">
                  <div className="glass-input px-3 py-0">
                    <input
                      value={hslToHex(primaryColor)}
                      onChange={(e) => {
                        if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                          setPrimaryColor(hexToHsl(e.target.value));
                        }
                      }}
                      placeholder="#3D61FF"
                      className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>
                <div className="h-10 w-24 rounded-full" style={{ background: `hsl(${primaryColor})` }} />
              </div>
            </div>
          </div>

          {/* Favicon */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Image className="h-4 w-4 text-primary" /> Favicon (opcional)
              </h3>
              <div className="flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-md border border-border bg-secondary/50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => faviconInputRef.current?.click()}
                >
                  {branding.faviconUrl ? (
                    <img src={branding.faviconUrl} alt="Favicon" className="h-full w-full object-contain" />
                  ) : (
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => faviconInputRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-full bg-secondary/30 text-foreground border border-border/40 hover:bg-secondary/50 transition-colors"
                  >
                    Upload
                  </button>
                  {branding.faviconUrl && (
                    <button
                      onClick={() => setBranding({ faviconUrl: "" })}
                      className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      Remover
                    </button>
                  )}
                </div>
                <input ref={faviconInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "faviconUrl")} />
              </div>
            </div>
          </div>

          {/* PWA Icon */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Image className="h-4 w-4 text-primary" /> Ícone do App (PWA)
              </h3>
              <p className="text-xs text-muted-foreground">
                Aparece quando o app é instalado no celular (tela inicial) ou no desktop (dock/menu iniciar).
                Envie uma imagem quadrada — redimensionamos automaticamente para 512×512.
              </p>
              <div className="flex items-center gap-4">
                <div
                  className="h-16 w-16 rounded-2xl border border-border bg-secondary/50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => pwaIconInputRef.current?.click()}
                >
                  {branding.pwaIconUrl ? (
                    <img src={branding.pwaIconUrl} alt="Ícone PWA" className="h-full w-full object-cover" />
                  ) : (
                    <img src="/icons/icon-512.png" alt="Ícone PWA padrão" className="h-full w-full object-cover opacity-80" />
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => pwaIconInputRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-full bg-secondary/30 text-foreground border border-border/40 hover:bg-secondary/50 transition-colors"
                  >
                    Upload
                  </button>
                  {branding.pwaIconUrl && (
                    <button
                      onClick={() => setBranding({ pwaIconUrl: "" })}
                      className="text-xs px-3 py-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      Remover
                    </button>
                  )}
                </div>
                <input ref={pwaIconInputRef} type="file" accept="image/*" className="hidden" onChange={handlePwaIconUpload} />
              </div>
              <p className="text-[11px] text-muted-foreground/80">
                {branding.pwaIconUrl
                  ? "Nota: em apps já instalados, o ícone só troca após reinstalar. Novas instalações usam o ícone atual."
                  : "Nenhum ícone personalizado — usando o ícone padrão do HS.OS. Faça upload para substituir."}
              </p>
            </div>
          </div>





          {/* Design System Export */}
          <div className="glass-card-glow glow-accent">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" /> Design System (YAML)
              </h3>
              <p className="text-xs text-muted-foreground">
                Exporte o Design System completo "Glass Aurora" da HS.OS em YAML — cores, tipografia,
                tokens, variantes de botão, regras de chat, artifacts e mais. Ideal para colar como
                contexto em LLMs (Claude, GPT, Gemini) ao gerar telas que respeitem a identidade.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const yaml = generateDesignSystemYaml();
                    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `dnos-design-system-${new Date().toISOString().slice(0, 10)}.yaml`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast({ title: "Design System exportado", description: "Arquivo YAML baixado com sucesso." });
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs rounded-full bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Baixar YAML
                </button>
                <button
                  onClick={async () => {
                    const yaml = generateDesignSystemYaml();
                    let ok = false;
                    try {
                      if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(yaml);
                        ok = true;
                      }
                    } catch {}
                    if (!ok) {
                      try {
                        const ta = document.createElement("textarea");
                        ta.value = yaml;
                        ta.style.position = "fixed";
                        ta.style.opacity = "0";
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        ok = document.execCommand("copy");
                        document.body.removeChild(ta);
                      } catch {}
                    }
                    toast(
                      ok
                        ? { title: "Copiado!", description: "Design System YAML na área de transferência." }
                        : { title: "Falha ao copiar", description: "Use 'Baixar YAML' como alternativa.", variant: "destructive" }
                    );
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-xs rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" /> Copiar para área de transferência
                </button>

              </div>
            </div>
          </div>


          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSaveBranding}
              className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
            >
              <Save className="h-4 w-4" /> {brandSaved ? "Salvo!" : "Salvar Identidade"}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
            >
              <RotateCcw className="h-4 w-4" /> Restaurar Padrão
            </button>
          </div>
        </div>
      )}

      {/* Gateway Tab */}
      {activeTab === "gateway" && (() => {
        const status = gatewayStatus?.connection_status ?? "unknown";
        const minutesAgo = gatewayStatus?.minutes_since_heartbeat ?? null;
        const latest = gatewayStatus?.latest_metrics as Record<string, any> | null;
        const m = (gatewayStatus as any)?.metrics ?? null;
        const recentHistory = gatewayStatus?.recent_history ?? [];
        const statusDot =
          status === "online" ? "bg-success" :
          status === "slow" ? "bg-warning" :
          status === "offline" ? "bg-destructive" : "bg-muted-foreground/40";
        const statusLabel =
          status === "online" ? "Online" :
          status === "slow" ? "Lento" :
          status === "offline" ? "Offline" : "Desconhecido";

        const activeSessions: number | null = m?.total_sessions ?? null;
        const tokensToday: number = m?.total_tokens_today ?? 0;
        const modelUsage: Record<string, { input: number; output: number }> = m?.model_usage ?? {};
        const costToday = Object.entries(modelUsage).reduce((sum, [model, u]) => {
          const p = getPricingFor(model === "unknown" ? null : model);
          return sum + u.input * p.input + u.output * p.output;
        }, 0);
        const gwVersion: string | null = m?.gateway_version ?? latest?.gateway_version ?? latest?.version ?? null;
        const gwLatency: number | null = m?.latency_ms ?? latest?.latency_ms ?? null;

        const fmtTokens = (n: number) =>
          n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
          : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
          : String(n);

        const metrics = [
          { label: "Sessões ativas", value: activeSessions != null ? activeSessions.toLocaleString("pt-BR") : "—", icon: Activity },
          { label: "Tokens hoje", value: tokensToday > 0 ? fmtTokens(tokensToday) : "—", icon: Zap },
          { label: "Custo estimado", value: costToday > 0 ? `$ ${costToday.toFixed(4)}` : "—", icon: DollarSign },
          { label: "Versão do gateway", value: gwVersion ? gwVersion.replace(/^OpenClaw\s+/i, "") : "—", icon: Server },
          { label: "Latência", value: typeof gwLatency === "number" ? `${gwLatency} ms` : "—", icon: Timer },
          { label: "Uptime", value: typeof latest?.uptime_seconds === "number" ? `${Math.floor(latest.uptime_seconds / 3600)}h` : "—", icon: Clock },
        ];

        return (
          <div className="space-y-6">
            {/* STATUS HEADER */}
            <div className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-card/40 backdrop-blur">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Gateway & VPS</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {gatewayStatus?.config?.gateway_url ?? url ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${statusDot}`} />
                <span className="text-sm text-muted-foreground">{statusLabel}</span>
                {minutesAgo !== null && (
                  <span className="text-xs text-muted-foreground">
                    · heartbeat há {minutesAgo} min
                  </span>
                )}
              </div>
            </div>

            {/* MÉTRICAS */}
            {latest && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {metrics.map(({ label, value, icon: Icon }) => (
                  <div key={label} className="p-3 rounded-2xl border border-border/40 bg-card/40 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </div>
                    <p className="text-lg font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* CONFIGURAÇÃO DA CONEXÃO */}
            <div className="glass-card-glow glow-accent">
              <div className="glass-card-glow-effect" />
              <div className="relative z-10 p-5 space-y-4">
                <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                  <Settings className="h-4 w-4" /> Conexão
                </h3>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Gateway URL</label>
                  <div className="glass-input px-3 py-0 mt-1">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://gateway.exemplo.com"
                      className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Bearer Token {hasSavedToken && <span className="ml-2 text-success normal-case tracking-normal">(salvo)</span>}
                  </label>
                  <div className="glass-input px-3 py-0 mt-1">
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      type="password"
                      autoComplete="off"
                      placeholder={hasSavedToken ? "●●●●●●●●●●●●●●●●  (deixe em branco para manter o atual)" : "sk-..."}
                      className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleTest}
                    disabled={!url || (!token && !hasSavedToken) || testing}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    {testing ? "Testando..." : "Testar Conexão"}
                  </button>
                  <button
                    onClick={async () => { await handleSaveGateway(); refetchGatewayStatus(); }}
                    disabled={!url || (!token && !hasSavedToken)}
                    className="flex items-center gap-2 px-5 py-2 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
                  >
                    <Save className="h-4 w-4" /> {saved ? "Salvo!" : "Salvar"}
                  </button>
                </div>
                {testResult?.success && (
                  <p className="text-xs flex items-center gap-1.5 text-success">
                    <CheckCircle className="h-3.5 w-3.5" /> Gateway respondeu
                    {testResult.version ? ` — versão ${testResult.version}` : ""}
                  </p>
                )}
                {testResult && !testResult.success && (
                  <div className="space-y-1.5">
                    <p className="text-xs flex items-start gap-1.5 text-destructive">
                      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="font-mono break-all">
                        {testResult.error ?? "Falha na conexão, sem motivo informado."}
                      </span>
                    </p>
                    {/* O texto de ajuda é escolhido pelo motivo, porque cada um
                        leva a um lugar diferente — mandar "verifique o token"
                        para quem está com o túnel fechado atrasa a correção. */}
                    <p className="text-[11px] text-muted-foreground pl-5">
                      {/refused|timed? ?out|timeout|unreachable|refus/i.test(testResult.error ?? "")
                        ? "O backend não alcançou o endereço. Em produção o gateway só aceita conexão que chega pelo loopback dele, então isto costuma ser o túnel SSH fechado — veja scripts/tunel-openclaw.sh."
                        : /scope/i.test(testResult.error ?? "")
                          ? "Conectou, mas sem permissão. O gateway concede escopo só para client.id \"gateway-client\" em modo backend, e apenas os escopos que o cliente pede no handshake."
                          : /não configurado|nao configurado/i.test(testResult.error ?? "")
                            ? "Falta a URL ou o token. Preencha acima e salve, ou defina no .env do backend."
                            : "Motivo acima, como o gateway o reportou."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* LOG DE ATIVIDADES */}
            {recentHistory.length > 0 && (
              <div className="space-y-3 p-4 rounded-2xl border border-border/40 bg-card/40">
                <p className="text-sm font-medium flex items-center gap-2 text-foreground">
                  <Clock className="h-4 w-4" /> Últimas atividades do collector
                </p>
                <div className="space-y-2">
                  {recentHistory.map((entry: any) => {
                    const ts = entry.collected_at ?? entry.created_at;
                    const windowTokens: number = entry.window_tokens ?? 0;
                    const topAgent = entry.top_agent as { agent_id: string; tokens: number } | null;
                    return (
                      <div key={entry.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 text-xs">
                        <span className="text-muted-foreground font-mono">
                          {ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                        <span className="text-foreground">Heartbeat recebido</span>
                        <span className="text-muted-foreground font-mono tabular-nums">
                          {windowTokens > 0 ? `+${windowTokens.toLocaleString("pt-BR")} tk` : "—"}
                        </span>
                        <span className="text-muted-foreground truncate max-w-[160px]">
                          {topAgent ? `${topAgent.agent_id} · ${topAgent.tokens.toLocaleString("pt-BR")}` : "—"}
                        </span>
                        <span className={entry.status === "ok" || entry.status === "online" ? "text-success" : "text-destructive"}>
                          {entry.status ?? "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}


      {/* HS.OS Tab */}
      {activeTab === "dnos" && (
        <div className="-mx-6 -mb-6">
          <MissionControlDossierPage embedded />
        </div>
      )}

      {/* Users Tab */}
      {activeTab === "users" && isAdmin && (
        <div className="-mx-6 -mb-6">
          <UsersPage embedded />
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === "integrations" && isAdmin && (
        <ConnectorsTab />
      )}

      {/* Documentation Tab */}
      {activeTab === "documentation" && isMemberOrAdmin && (
        <div className="-mx-6 -mb-6 h-[calc(100dvh-15rem)] overflow-hidden">
          <DocumentationPage embedded />
        </div>
      )}
    </div>
  );
}
