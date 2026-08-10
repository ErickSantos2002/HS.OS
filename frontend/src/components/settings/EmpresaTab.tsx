import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { enviarArquivo } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2, Mic, MicOff, Sparkles, Upload, Save, Send, Loader2,
  CheckCircle2, AlertCircle, FileText, RefreshCw,
} from "lucide-react";

type Profile = {
  id: string;
  company_name: string | null;
  founder_name: string | null;
  segment: string | null;
  description: string | null;
  target_audience: string | null;
  products_services: string | null;
  tone: string | null;
  revenue: string | null;
  employees_count: string | null;
  extra_context: string | null;
  onboarding_notified_at: string | null;
};

const TONES = ["formal", "informal", "técnico", "descontraído"] as const;

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export default function EmpresaTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [founderName, setFounderName] = useState("");
  const [segment, setSegment] = useState("");
  const [description, setDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [productsServices, setProductsServices] = useState("");
  const [tone, setTone] = useState<string>("");
  const [revenue, setRevenue] = useState("");
  const [employeesCount, setEmployeesCount] = useState("");
  const [extraContext, setExtraContext] = useState("");

  // Input livre
  const [subTab, setSubTab] = useState<"text" | "file">("text");
  const [freeText, setFreeText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await api<any>("/integracoes/empresa/perfil")
        .then((d) => ({ data: d, error: null as Error | null }),
              (e: Error) => ({ data: null, error: e }));
      if (error) {
        toast.error("Erro ao carregar perfil da empresa");
      } else if (data) {
        applyProfile(data as Profile);
      }
      setLoading(false);
    })();
  }, []);

  function applyProfile(p: Profile) {
    setProfile(p);
    setCompanyName(p.company_name ?? "");
    setFounderName(p.founder_name ?? "");
    setSegment(p.segment ?? "");
    setDescription(p.description ?? "");
    setTargetAudience(p.target_audience ?? "");
    setProductsServices(p.products_services ?? "");
    setTone(p.tone ?? "");
    setRevenue(p.revenue ?? "");
    setEmployeesCount(p.employees_count ?? "");
    setExtraContext(p.extra_context ?? "");
  }

  function applyParsed(d: any) {
    if (!d || typeof d !== "object") return;
    if (d.company_name) setCompanyName(d.company_name);
    if (d.founder_name) setFounderName(d.founder_name);
    if (d.segment) setSegment(d.segment);
    if (d.description) setDescription(d.description);
    if (d.target_audience) setTargetAudience(d.target_audience);
    if (d.products_services) setProductsServices(d.products_services);
    if (d.tone && TONES.includes(d.tone)) setTone(d.tone);
    if (d.revenue) setRevenue(d.revenue);
    if (d.employees_count) setEmployeesCount(d.employees_count);
    if (d.extra_context) setExtraContext(d.extra_context);
  }

  const toggleRecording = () => {
    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Seu navegador não suporta gravação de voz. Use Chrome ou Edge.");
      return;
    }
    if (isRecording && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* noop */ }
      setIsRecording(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join(" ");
      setFreeText((prev) => (prev ? prev + " " : "") + transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  };

  const processWithAI = async () => {
    if (!freeText.trim()) return;
    setProcessing(true);
    try {
      const { data, error } = await api<any>("/ia/perfil-da-empresa", {
        method: "POST", body: { text: freeText },
      }).then((d) => ({ data: d, error: null as Error | null }),
             (e: Error) => ({ data: null, error: e }));
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      applyParsed(data);
      toast.success("Campos preenchidos! Revise e salve.");
    } catch (e: any) {
      toast.error(`Erro ao processar: ${e.message ?? e}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
    if (![".pdf", ".docx", ".txt", ".md"].includes(ext)) {
      toast.error("Formato não suportado. Use PDF, DOCX, TXT ou MD.");
      return;
    }
    setProcessing(true);
    try {
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/_+/g, "_");
      const path = `uploads/${Date.now()}-${safeName}`;
      // `company-docs` é privado: o arquivo só é lido por quem tem token.
      await enviarArquivo("company-docs", path, file, file.name);
      // A extração do texto já é nossa. O passo seguinte — transformar esse
      // texto nos campos da empresa — ainda depende de LLM, e a edge que fazia
      // isso (`parse-company-context`) usa o Lovable AI Gateway. Enquanto essa
      // decisão não sai, o texto é entregue para revisão manual em vez de a
      // tela falhar. Ver o bloqueio em `docs/ROADMAP.md`.
      const { text } = await api<{ text: string }>(
        `/storage/extrair-texto/company-docs/${encodeURIComponent(path)}`,
        { method: "POST" },
      );
      applyParsed({ extra_context: text });
      toast.success(
        `Texto de "${file.name}" extraído. O preenchimento automático dos campos `
        + `ainda não está disponível — revise e complete manualmente.`,
      );
    } catch (e: any) {
      toast.error(`Erro ao processar arquivo: ${e.message ?? e}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      // PUT cria a linha se ela não existir: há uma por instalação, e a tela
      // não deveria precisar saber se alguém já salvou alguma coisa antes.
      await api("/integracoes/empresa/perfil", {
        method: "PUT",
        body: {
          company_name: companyName || null,
          founder_name: founderName || null,
          segment: segment || null,
          description: description || null,
          target_audience: targetAudience || null,
          products_services: productsServices || null,
          tone: tone || null,
          revenue: revenue || null,
          employees_count: employeesCount || null,
          extra_context: extraContext || null,
        },
      });

      if (companyName && founderName) {
        const notif = await api<any>("/integracoes/onboarding-empresa", {
          method: "POST",
        });
        if (notif?.dispatched) {
          toast.success("Perfil salvo e orquestrador notificado.");
        } else {
          toast.success(`Perfil salvo. ${notif?.reason ?? ""}`);
        }
      } else {
        toast.success("Perfil salvo. Preencha nome e fundador para notificar agentes.");
      }

      // Recarrega para pegar onboarding_notified_at atualizado
      const data = await api<any>("/integracoes/empresa/perfil").catch(() => null);
      if (data) applyProfile(data as Profile);
    } catch (e: any) {
      toast.error(`Erro ao salvar: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResend = async () => {
    if (!companyName || !founderName) {
      toast.error("Preencha nome da empresa e fundador antes de re-enviar.");
      return;
    }
    setSaving(true);
    try {
      const data = await api<any>("/integracoes/onboarding-empresa", { method: "POST" });
      if (data?.dispatched) {
        toast.success("Contexto re-enviado ao orquestrador.");
        const fresh = await api<any>("/integracoes/empresa/perfil").catch(() => null);
        if (fresh) applyProfile(fresh as Profile);
      } else {
        toast.error(data?.reason ?? "Falha ao re-enviar.");
      }
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  // Status badge
  const status = (() => {
    if (!companyName || !founderName) {
      return { label: "Não configurado", tone: "muted", Icon: AlertCircle };
    }
    if (!profile?.onboarding_notified_at) {
      return { label: "Contexto pendente", tone: "warning", Icon: AlertCircle };
    }
    return {
      label: `Super agentes atualizados — ${timeAgo(profile.onboarding_notified_at)}`,
      tone: "success" as const,
      Icon: CheckCircle2,
    };
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="aurora-glow rounded-2xl p-5">
        <div className="relative z-10">
          <h2 className="text-base font-display font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Perfil da Empresa
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Informações compartilhadas com todos os agentes do time como contexto base.
          </p>
        </div>
      </div>

      {/* Input livre com IA */}
      <div className="glass-card-glow glow-accent">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Conte sobre sua empresa
            </h3>
            <div className="flex gap-1 p-1 rounded-full bg-secondary/30">
              {[
                { id: "text" as const, label: "Digitar" },
                { id: "file" as const, label: "Subir arquivo" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    subTab === t.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {subTab === "text" ? (
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Fale ou escreva sobre a sua empresa livremente. A IA vai preencher os campos automaticamente."
                  rows={5}
                  className="w-full bg-input border border-border rounded-xl px-3 py-2 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={toggleRecording}
                  title={isRecording ? "Parar gravação" : "Gravar voz"}
                  className={`absolute right-2 top-2 h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                    isRecording
                      ? "bg-destructive/20 text-destructive animate-pulse"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={processWithAI}
                disabled={!freeText.trim() || processing}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Processar com IA
              </button>
            </div>
          ) : (
            <FileDropZone disabled={processing} processing={processing} onFile={handleFileUpload} />
          )}
        </div>
      </div>

      {/* Form */}
      <div className="glass-card-glow">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5 space-y-5">
          <SectionTitle title="Informações essenciais" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome da empresa *">
              <Input value={companyName} onChange={setCompanyName} />
            </Field>
            <Field label="Fundador / CEO *">
              <Input value={founderName} onChange={setFounderName} />
            </Field>
          </div>

          <SectionTitle title="Enriquecimento" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Segmento">
              <Input value={segment} onChange={setSegment} />
            </Field>
            <Field label="Tom de voz">
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione</option>
                {TONES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Faturamento" hint="ex: R$ 2M/ano">
              <Input value={revenue} onChange={setRevenue} />
            </Field>
            <Field label="Número de funcionários" hint="ex: 15, 50-100">
              <Input value={employeesCount} onChange={setEmployeesCount} />
            </Field>
          </div>

          <Field label="Descrição da empresa">
            <Textarea value={description} onChange={setDescription} rows={3} />
          </Field>
          <Field label="Público-alvo">
            <Textarea value={targetAudience} onChange={setTargetAudience} rows={2} />
          </Field>
          <Field label="Produtos / Serviços">
            <Textarea value={productsServices} onChange={setProductsServices} rows={2} />
          </Field>
          <Field label="Contexto adicional" hint="Campo livre para qualquer informação relevante">
            <Textarea value={extraContext} onChange={setExtraContext} rows={3} />
          </Field>

          {/* Status */}
          <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <status.Icon
                className={`h-4 w-4 ${
                  status.tone === "success"
                    ? "text-emerald-400"
                    : status.tone === "warning"
                    ? "text-amber-400"
                    : "text-muted-foreground"
                }`}
              />
              <span className="text-foreground">{status.label}</span>
            </div>
            <button
              onClick={handleResend}
              disabled={saving || !companyName || !founderName}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/40 transition disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-enviar contexto
            </button>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar e notificar agentes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-border/50" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</span>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function Textarea({
  value, onChange, rows = 3,
}: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function FileDropZone({
  onFile, disabled, processing,
}: { onFile: (f: File | undefined) => void; disabled?: boolean; processing?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
        dragOver ? "border-primary bg-primary/5" : "border-border bg-secondary/10"
      }`}
    >
      <FileText className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-foreground">Arraste e solte ou selecione um arquivo</p>
      <p className="text-[11px] text-muted-foreground mt-1">Formatos: PDF, DOCX, TXT, MD</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-secondary/40 hover:bg-secondary/60 transition disabled:opacity-50"
      >
        {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        Selecionar arquivo
      </button>
    </div>
  );
}
