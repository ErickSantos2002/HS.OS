import logoCanva from "@/assets/integration-logos/canva.png";
import logoClaude from "@/assets/integration-logos/claude.png";
import logoDeepseek from "@/assets/integration-logos/deepseek.png";
import logoChatgpt from "@/assets/integration-logos/chatgpt.png";
import logoElevenlabs from "@/assets/integration-logos/elevenlabs.png";
import logoInstagram from "@/assets/integration-logos/instagram.png";
import logoMeta from "@/assets/integration-logos/meta.png";

export interface ConnectorField {
  key: string;
  label: string;
  secret: boolean;
}

export interface ConnectorTemplate {
  id: string;
  name: string;
  fields: ConnectorField[];
  /** Optional local asset used as the card artwork. */
  localLogo?: string;
  /** Optional brand domain resolved via Google favicons CDN. */
  brandDomain?: string;
}

export const CONNECTOR_CATALOG: ConnectorTemplate[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    localLogo: logoClaude,
    fields: [{ key: "api_key", label: "API Key", secret: true }],
  },
  {
    id: "canva",
    name: "Canva",
    localLogo: logoCanva,
    fields: [
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    localLogo: logoDeepseek,
    fields: [{ key: "api_key", label: "API Key", secret: true }],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    localLogo: logoElevenlabs,
    fields: [{ key: "api_key", label: "API Key", secret: true }],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    brandDomain: "ai.google.dev",
    fields: [{ key: "api_key", label: "API Key", secret: true }],
  },
  {
    id: "gmail",
    name: "Gmail",
    brandDomain: "gmail.com",
    fields: [
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
      { key: "refresh_token", label: "Refresh Token", secret: true },
    ],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    brandDomain: "calendar.google.com",
    fields: [
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
      { key: "refresh_token", label: "Refresh Token", secret: true },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    brandDomain: "hubspot.com",
    fields: [{ key: "access_token", label: "Access Token", secret: true }],
  },
  {
    id: "instagram",
    name: "Instagram",
    localLogo: logoInstagram,
    fields: [
      { key: "access_token", label: "Access Token", secret: true },
      { key: "page_id", label: "Page ID", secret: false },
    ],
  },
  {
    id: "meta-ads",
    name: "Meta Ads",
    localLogo: logoMeta,
    fields: [
      { key: "access_token", label: "Access Token", secret: true },
      { key: "ad_account_id", label: "Ad Account ID", secret: false },
      { key: "app_id", label: "App ID", secret: false },
    ],
  },
  {
    id: "nexus",
    name: "Nexus CRM",
    brandDomain: "dnia.ai",
    fields: [
      { key: "api_key", label: "API Key", secret: true },
      { key: "base_url", label: "URL do CRM", secret: false },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    localLogo: logoChatgpt,
    fields: [{ key: "api_key", label: "API Key", secret: true }],
  },
  {
    id: "stripe",
    name: "Stripe",
    brandDomain: "stripe.com",
    fields: [
      { key: "secret_key", label: "Secret Key", secret: true },
      { key: "webhook_secret", label: "Webhook Secret", secret: true },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    brandDomain: "telegram.org",
    fields: [{ key: "bot_token", label: "Bot Token", secret: true }],
  },
  {
    id: "twilio",
    name: "Twilio",
    brandDomain: "twilio.com",
    fields: [
      { key: "account_sid", label: "Account SID", secret: false },
      { key: "auth_token", label: "Auth Token", secret: true },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    brandDomain: "whatsapp.com",
    fields: [
      { key: "phone_number_id", label: "Phone Number ID", secret: false },
      { key: "access_token", label: "Access Token", secret: true },
      { key: "webhook_secret", label: "Webhook Secret", secret: true },
    ],
  },
];

export function getConnectorTemplate(id: string | null | undefined): ConnectorTemplate | null {
  if (!id) return null;
  return CONNECTOR_CATALOG.find((t) => t.id === id) ?? null;
}

export function connectorLogoUrl(t: Pick<ConnectorTemplate, "localLogo" | "brandDomain">): string | null {
  if (t.localLogo) return t.localLogo;
  if (t.brandDomain) return `https://www.google.com/s2/favicons?domain=${t.brandDomain}&sz=128`;
  return null;
}

/** Name-based logo lookup for legacy/custom connectors without template_id. */
const NAME_LOGO_MAP: Record<string, string> = {
  openai: logoChatgpt,
  chatgpt: logoChatgpt,
  anthropic: logoClaude,
  claude: logoClaude,
  deepseek: logoDeepseek,
  elevenlabs: logoElevenlabs,
  instagram: logoInstagram,
  meta: logoMeta,
  canva: logoCanva,
};

const NAME_DOMAIN_MAP: Record<string, string> = {
  openai: "openai.com",
  chatgpt: "openai.com",
  anthropic: "anthropic.com",
  claude: "anthropic.com",
  deepseek: "deepseek.com",
  groq: "groq.com",
  openclaw: "openclaw.com",
  supabase: "supabase.com",
  meta: "meta.com",
  "meta ads": "meta.com",
  facebook: "facebook.com",
  instagram: "instagram.com",
  tiktok: "tiktok.com",
  "tiktok ads": "tiktok.com",
  linkedin: "linkedin.com",
  higgsfield: "higgsfield.ai",
  canva: "canva.com",
  telegram: "telegram.org",
  github: "github.com",
  gmail: "gmail.com",
  google: "google.com",
  "google calendar": "calendar.google.com",
  "google drive": "drive.google.com",
  "google sheets": "sheets.google.com",
  "google analytics": "analytics.google.com",
  gemini: "ai.google.dev",
  slack: "slack.com",
  notion: "notion.so",
  discord: "discord.com",
  whatsapp: "whatsapp.com",
  stripe: "stripe.com",
  twilio: "twilio.com",
  hubspot: "hubspot.com",
  asana: "asana.com",
  elevenlabs: "elevenlabs.io",
  perplexity: "perplexity.ai",
  "dn.marketing": "dnia.ai",
  "dn.nexus": "dnia.ai",
  "dn.mentor-ia": "dnia.ai",
  "dn.task": "dnia.ai",
  dnmarketing: "dnia.ai",
  dntask: "dnia.ai",
};

/**
 * Descobre a qual provedor de LLM um conector pertence.
 *
 * Usa `template_id` quando existe, mas cai para o NOME quando não existe — e
 * isso não é detalhe: conectores criados pelo fluxo "Personalizado" (como o
 * "Anthropic Claude" e o "DeepSeek API" já cadastrados) ficam com template_id
 * nulo, e uma detecção só por template_id os deixaria de fora. É o mesmo
 * fallback por nome que `logoForName` já usa para achar o logo certo deles.
 *
 * Retorna sempre uma das chaves conhecidas ou null — nunca um valor livre —
 * porque este resultado vira caminho de escrita na config do Gateway.
 */
export const LLM_PROVIDERS = ["deepseek", "openai", "anthropic", "gemini"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const LLM_NAME_HINTS: Array<[string, LlmProvider]> = [
  ["deepseek", "deepseek"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["openai", "openai"],
  ["chatgpt", "openai"],
  ["gpt", "openai"],
  ["gemini", "gemini"],
];

export function llmProviderFor(
  templateId: string | null | undefined,
  name: string | null | undefined,
): LlmProvider | null {
  const tid = String(templateId ?? "").trim().toLowerCase();
  const byTemplate = LLM_PROVIDERS.find((p) => p === tid);
  if (byTemplate) return byTemplate;

  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const [hint, provider] of LLM_NAME_HINTS) {
    if (key.includes(hint)) return provider;
  }
  return null;
}

export function logoForName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (NAME_LOGO_MAP[key]) return NAME_LOGO_MAP[key];
  for (const [k, url] of Object.entries(NAME_LOGO_MAP)) {
    if (key.includes(k)) return url;
  }
  if (NAME_DOMAIN_MAP[key]) return `https://www.google.com/s2/favicons?domain=${NAME_DOMAIN_MAP[key]}&sz=128`;
  for (const [k, dom] of Object.entries(NAME_DOMAIN_MAP)) {
    if (key.includes(k)) return `https://www.google.com/s2/favicons?domain=${dom}&sz=128`;
  }
  return null;
}

