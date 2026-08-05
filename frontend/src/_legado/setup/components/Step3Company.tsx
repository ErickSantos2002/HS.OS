import { useEffect, useMemo, useState } from "react";
import { Loader2, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface CompanyFormValues {
  company_name: string;
  founder_name: string;
  segment: string;
  description: string;
  target_audience: string;
  products_services: string;
  tone: string;
}

const EMPTY: CompanyFormValues = {
  company_name: "",
  founder_name: "",
  segment: "",
  description: "",
  target_audience: "",
  products_services: "",
  tone: "",
};

const FIELDS: Array<{
  key: keyof CompanyFormValues;
  label: string;
  placeholder: string;
  multiline?: boolean;
  hint?: string;
}> = [
  { key: "company_name", label: "Nome da empresa", placeholder: "Ex.: Acme Ltda." },
  { key: "founder_name", label: "Fundador(a) / responsável", placeholder: "Seu nome" },
  { key: "segment", label: "Segmento", placeholder: "Ex.: SaaS B2B, agência, e-commerce" },
  {
    key: "description",
    label: "O que a empresa faz",
    placeholder: "Descreva em uma ou duas frases",
    multiline: true,
  },
  {
    key: "target_audience",
    label: "Público-alvo",
    placeholder: "Quem são seus clientes ideais?",
    multiline: true,
  },
  {
    key: "products_services",
    label: "Produtos e serviços",
    placeholder: "Principais ofertas",
    multiline: true,
  },
  { key: "tone", label: "Tom de voz", placeholder: "Ex.: Direto e técnico, próximo e informal" },
];

interface Step3CompanyProps {
  values: Partial<CompanyFormValues>;
  onChange: (values: Partial<CompanyFormValues>) => void;
}

/**
 * Step 3 — Company / shared brain (optional).
 *
 * Every field is optional. Advance is always allowed. The caller decides,
 * on advance, whether to persist to `company_profile` or mark
 * `shared_brain_skipped`.
 */
export function Step3Company({ values, onChange }: Step3CompanyProps) {
  const merged = useMemo<CompanyFormValues>(() => ({ ...EMPTY, ...values }), [values]);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Brain className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-display font-semibold">Contexto da empresa</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tudo aqui é opcional. Quanto mais você contar, mais afiados os agentes vão trabalhar
          desde o dia zero. Você pode pular e preencher depois em Configurações.
        </p>
      </div>

      <div className="space-y-4">
        {FIELDS.map((f) => {
          const id = `company-${f.key}`;
          const val = merged[f.key];
          const common = {
            id,
            value: val,
            placeholder: f.placeholder,
            onChange: (
              e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => onChange({ [f.key]: e.target.value } as Partial<CompanyFormValues>),
          };
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                {f.label}
              </Label>
              {f.multiline ? (
                <Textarea rows={3} className="resize-none" {...common} />
              ) : (
                <Input {...common} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Persists the company form to `company_profile` if the user provided
 * anything. Returns whether the shared brain was actually saved.
 */
export async function persistCompanyProfile(
  values: Partial<CompanyFormValues>,
): Promise<{ saved: boolean; error?: string }> {
  const clean: Partial<CompanyFormValues> = {};
  let hasAny = false;
  for (const f of FIELDS) {
    const raw = values[f.key];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > 0) {
      clean[f.key] = trimmed;
      hasAny = true;
    }
  }
  if (!hasAny) return { saved: false };

  // company_profile is a singleton — grab existing row if any.
  const { data: existing } = await supabase
    .from("company_profile")
    .select("id")
    .limit(1)
    .maybeSingle();

  const payload = { ...clean, updated_at: new Date().toISOString() };
  const { error } = existing?.id
    ? await supabase.from("company_profile").update(payload).eq("id", existing.id)
    : await supabase.from("company_profile").insert(payload as never);

  if (error) return { saved: false, error: error.message };
  return { saved: true };
}

export function EmptyBrainNotice() {
  return (
    <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 opacity-0" aria-hidden />
      <span>Você pode pular e preencher depois em Configurações → Empresa.</span>
    </div>
  );
}
