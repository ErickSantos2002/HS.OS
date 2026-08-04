// .dnos — proprietary export format for shareable dnOS agents.
// Internally JSON, extension .dnos identifies the ecosystem.

export interface DnosFile {
  dnos_version: string;
  exported_at: string;
  agent: {
    agent_id: string;
    name: string;
    role?: string | null;
    department?: string | null;
    description?: string | null;
    author?: string;
    color?: string | null;
    emoji?: string | null;
  };
  required_connectors: string[];
  capabilities: string[];
  files: {
    "SOUL.md"?: string;
    "IDENTITY.md"?: string;
    "TOOLS.md"?: string;
    [key: string]: string | undefined;
  };
}

export interface CompanyProfileLite {
  company_name?: string | null;
  founder_name?: string | null;
  segment?: string | null;
  description?: string | null;
  target_audience?: string | null;
  products_services?: string | null;
  tone?: string | null;
}

// Known connectors mapped to keywords found in TOOLS.md.
// Extend this list as new connectors are added.
export const KNOWN_CONNECTORS: {
  id: string;
  label: string;
  keywords: string[];
  keyNames?: string[]; // integrations.key_name matches
}[] = [
  { id: "meta-ads", label: "Meta Ads", keywords: ["meta ads", "meta-ads", "meta_ads"], keyNames: ["META_ADS_ACCESS_TOKEN"] },
  { id: "meta", label: "Meta (Facebook)", keywords: ["facebook graph", "meta graph", "facebook app"], keyNames: ["META_ACCESS_TOKEN", "FACEBOOK_APP_ID"] },
  { id: "instagram", label: "Instagram", keywords: ["instagram"], keyNames: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_SESSIONID", "KIRA_IG_ACCESS_TOKEN"] },
  { id: "google-ads", label: "Google Ads", keywords: ["google ads", "google-ads", "google_ads"], keyNames: ["GOOGLE_ADS_TOKEN"] },
  { id: "google-oauth", label: "Google (Sheets/Drive)", keywords: ["google sheets", "google drive", "google oauth"], keyNames: ["GOOGLE_CLIENT_ID"] },
  { id: "linkedin", label: "LinkedIn", keywords: ["linkedin"], keyNames: ["LINKEDIN_ACCESS_TOKEN"] },
  { id: "telegram", label: "Telegram", keywords: ["telegram"], keyNames: ["TELEGRAM_BOT_TOKEN"] },
  { id: "slack", label: "Slack", keywords: ["slack"], keyNames: ["SLACK_BOT_TOKEN"] },
  { id: "whatsapp", label: "WhatsApp", keywords: ["whatsapp"], keyNames: ["WHATSAPP_TOKEN"] },
  { id: "canva", label: "Canva", keywords: ["canva"], keyNames: ["CANVA_API_KEY", "CANVA_CLIENT_ID"] },
  { id: "elevenlabs", label: "ElevenLabs", keywords: ["elevenlabs", "eleven labs"], keyNames: ["ELEVENLABS_API_KEY"] },
  { id: "perplexity", label: "Perplexity", keywords: ["perplexity"], keyNames: ["PERPLEXITY_API_KEY"] },
  { id: "anthropic", label: "Anthropic Claude", keywords: ["anthropic", "claude"], keyNames: ["ANTHROPIC_API_KEY"] },
  { id: "deepseek", label: "DeepSeek", keywords: ["deepseek"], keyNames: ["DEEPSEEK_API_KEY"] },
  { id: "gemini", label: "Google Gemini", keywords: ["gemini"], keyNames: ["GEMINI_API_KEY"] },
];

/** Scan TOOLS.md content for known connectors. */
export function extractConnectors(tools: string): string[] {
  if (!tools) return [];
  const lower = tools.toLowerCase();
  const hits = new Set<string>();
  for (const c of KNOWN_CONNECTORS) {
    if (c.keywords.some((kw) => lower.includes(kw))) hits.add(c.id);
  }
  return Array.from(hits);
}

/** Extract capability tags from SOUL.md — looks for "capacidades", "habilidades" list items. */
export function extractCapabilities(soul: string, extraTags: string[] = []): string[] {
  const set = new Set<string>(extraTags.filter(Boolean).map((t) => t.toLowerCase()));
  if (!soul) return Array.from(set);
  // Grab bullet lines under a "Capacidades" / "Habilidades" / "Skills" heading
  const re = /(?:capacidades|habilidades|skills)[^\n]*\n((?:\s*[-*]\s+.+\n?)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(soul)) !== null) {
    m[1].split("\n").forEach((line) => {
      const item = line.replace(/^\s*[-*]\s+/, "").trim();
      if (item) set.add(item.toLowerCase().slice(0, 60));
    });
  }
  return Array.from(set);
}

/** Replace company data with placeholders, longest first to avoid partial hits. */
export function restorePlaceholders(content: string, profile: CompanyProfileLite | null): string {
  if (!content || !profile) return content;
  const pairs: [string | null | undefined, string][] = [
    [profile.company_name, "{{COMPANY_NAME}}"],
    [profile.founder_name, "{{FOUNDER_NAME}}"],
    [profile.segment, "{{COMPANY_SEGMENT}}"],
    [profile.description, "{{COMPANY_DESCRIPTION}}"],
    [profile.target_audience, "{{TARGET_AUDIENCE}}"],
    [profile.products_services, "{{COMPANY_PRODUCT}}"],
    [profile.tone, "{{BRAND_VOICE}}"],
  ];
  const valid = pairs.filter(([v]) => typeof v === "string" && v.trim().length >= 3) as [string, string][];
  valid.sort((a, b) => b[0].length - a[0].length);
  let out = content;
  for (const [value, token] of valid) {
    // Escape regex specials
    const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), token);
  }
  return out;
}

/**
 * Inverso do restorePlaceholders — usado na IMPORTAÇÃO, não na exportação.
 * A exportação troca dado real → {{PLACEHOLDER}} (deixa o arquivo seguro pra
 * compartilhar). Sem esse passo simétrico, um agente importado nascia com o
 * SOUL.md/IDENTITY.md cheio de placeholder cru ("eu trabalho pra
 * {{COMPANY_NAME}}") — a importação nunca preenchia com os dados da empresa
 * que está importando. Placeholder sem valor correspondente no perfil fica
 * como está (não apaga silenciosamente — fica visível pra alguém notar e
 * completar o perfil da empresa).
 */
export function fillPlaceholders(content: string, profile: CompanyProfileLite | null): string {
  if (!content || !profile) return content;
  const pairs: [string, string | null | undefined][] = [
    ["{{COMPANY_NAME}}", profile.company_name],
    ["{{FOUNDER_NAME}}", profile.founder_name],
    ["{{COMPANY_SEGMENT}}", profile.segment],
    ["{{COMPANY_DESCRIPTION}}", profile.description],
    ["{{TARGET_AUDIENCE}}", profile.target_audience],
    ["{{COMPANY_PRODUCT}}", profile.products_services],
    ["{{BRAND_VOICE}}", profile.tone],
  ];
  let out = content;
  for (const [token, value] of pairs) {
    if (typeof value === "string" && value.trim()) {
      out = out.split(token).join(value);
    }
  }
  return out;
}

/** Validate parsed JSON as a DnosFile. Returns error string or null. */
export function validateDnos(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "Arquivo inválido.";
  const d = raw as Partial<DnosFile>;
  if (!d.dnos_version) return "Campo dnos_version ausente.";
  if (!d.agent || typeof d.agent !== "object") return "Bloco agent ausente.";
  if (!d.agent.agent_id || !/^[a-z0-9-]{2,32}$/.test(d.agent.agent_id)) return "agent_id inválido.";
  if (!d.agent.name) return "agent.name ausente.";
  if (!d.files || typeof d.files !== "object") return "Bloco files ausente.";
  if (!d.files["SOUL.md"]) return "SOUL.md ausente.";
  return null;
}

export function triggerDownload(dnos: DnosFile) {
  const blob = new Blob([JSON.stringify(dnos, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${dnos.agent.agent_id}.dnos`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
