// Centralized model pricing, context windows and friendly labels.

export interface ModelPricing {
  input: number;  // USD per token
  output: number; // USD per token
}

// deepseek-v4-flash não está aqui de propósito: não temos o preço confirmado na
// fonte. Sem entrada, ele cai no DEFAULT_PRICING (preço do v4-pro), o que
// SUPERESTIMA o custo — errar pra cima é o lado seguro. Preencher quando o preço
// real for confirmado.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-pro":   { input: 0.27 / 1_000_000, output: 1.10 / 1_000_000 },
  "deepseek-chat":     { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },
  "claude-opus-4":     { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  "claude-sonnet-4":   { input:  3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-sonnet-4-6": { input:  3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-haiku-4":    { input: 0.80 / 1_000_000, output:  4.0 / 1_000_000 },
  "claude-haiku-4-5":  { input: 0.80 / 1_000_000, output:  4.0 / 1_000_000 },
  "gpt-4o":            { input: 2.50 / 1_000_000, output: 10.0 / 1_000_000 },
};

export const DEFAULT_PRICING: ModelPricing = {
  input: 0.27 / 1_000_000,
  output: 1.10 / 1_000_000,
};

// Janelas confirmadas contra o Gateway real (openclaw sessions list / config):
// deepseek-chat = 131072 (estava 64000 aqui, o que dobrava o % exibido sempre
// que o snapshot não trazia context_window); v4-pro e v4-flash = 1M.
export const CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-v4-pro":   1_000_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-chat":       131_072,
  "claude-opus-4":       200_000,
  "claude-sonnet-4":     200_000,
  "claude-sonnet-4-6":   200_000,
  "claude-haiku-4":      200_000,
  "claude-haiku-4-5":    200_000,
  "gpt-4o":              128_000,
};

export const DEFAULT_CONTEXT_WINDOW = 128_000;

const MODEL_LABELS: Record<string, string> = {
  "deepseek-v4-pro":   "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-chat":     "DeepSeek Chat",
  "claude-opus-4":     "Claude Opus 4",
  "claude-sonnet-4":   "Claude Sonnet 4",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4":    "Claude Haiku 4",
  "claude-haiku-4-5":  "Claude Haiku 4.5",
  "gpt-4o":            "GPT-4o",
};

export function getPricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

export function getContextWindowFor(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  return CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

export function getModelLabel(model: string | null | undefined): string {
  if (!model) return "Modelo desconhecido";
  return MODEL_LABELS[model] ?? model;
}

export function formatPricingNote(model: string | null | undefined): string {
  const p = getPricingFor(model);
  const inUsd  = (p.input  * 1_000_000).toFixed(2);
  const outUsd = (p.output * 1_000_000).toFixed(2);
  return `Preço estimado: ${getModelLabel(model)} — $${inUsd}/1M input, $${outUsd}/1M output`;
}

export function formatTokensShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
