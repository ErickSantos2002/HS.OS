import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";


export interface BrandingConfig {
  logo: string;
  logoLight: string;
  logoDark: string;
  markLight: string;
  markDark: string;
  companyName: string;
  primaryColor: string;
  faviconUrl: string;
  pwaIconUrl: string;
}


const STORAGE_KEY = "dnos-branding-cache";

function loadCachedFromStorage(): BrandingConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveToStorage(config: BrandingConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

// Marca padrão de qualquer instalação nova. Era "OpenClaw" — o nome do gateway,
// que o cliente do remix nunca ouviu falar e que aparecia já na tela de criar a
// conta. O logo aponta para arquivos de public/, servidos pela própria
// instalação, para não depender de nada estar semeado no banco.
// Os dois wordmarks são o mesmo desenho em cores opostas (transparente nos
// dois), então a marca não muda de forma ao trocar de tema.
const DEFAULT_BRANDING: BrandingConfig = {
  logo: "/dnia-wordmark.png",
  logoLight: "/dnia-wordmark-premium.png", // letras escuras, para fundo claro
  logoDark: "/dnia-wordmark.png", // letras brancas, para fundo escuro
  markLight: "",
  markDark: "",
  companyName: "dn.ia",
  primaryColor: "231 100% 62%",
  faviconUrl: "",
  pwaIconUrl: "",
};


function hslToHex(hslStr: string): string {
  // Parse "H S% L%" format
  const m = hslStr.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return "#3D61FF";
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function applyManifest(config: BrandingConfig) {
  const icon = config.pwaIconUrl || config.faviconUrl || config.logo;
  const themeColor = hslToHex(config.primaryColor);

  // Point <link rel="manifest"> at our edge function so installed PWAs
  // (desktop + mobile) pick up the branding icon/name at install time.
  // Bust the cache with a version param whenever branding changes.
  const origin = window.location.origin;
  const version = encodeURIComponent(
    (icon || "") + "|" + (config.companyName || "") + "|" + themeColor,
  );
  const manifestUrl = `https://zozyfhisrbkqvdcsdbfp.supabase.co/functions/v1/manifest?origin=${encodeURIComponent(origin)}&v=${version}`;

  let link = document.querySelector("link[rel='manifest']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    link.setAttribute("crossorigin", "use-credentials");
    document.head.appendChild(link);
  }
  if (link.href !== manifestUrl) link.href = manifestUrl;

  // Apple touch icon (iOS reads this separately from the manifest)
  if (icon) {
    let apple = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = icon;
  }

  // theme-color meta
  let meta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = themeColor;
}

function applyBranding(config: BrandingConfig) {
  document.documentElement.style.setProperty("--primary", config.primaryColor);
  document.documentElement.style.setProperty("--ring", config.primaryColor);
  document.documentElement.style.setProperty("--sidebar-primary", config.primaryColor);
  document.documentElement.style.setProperty("--sidebar-ring", config.primaryColor);
  document.documentElement.style.setProperty("--chart-1", config.primaryColor);
  document.documentElement.style.setProperty("--info", config.primaryColor);

  if (config.faviconUrl) {
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = config.faviconUrl;
  }

  applyManifest(config);
}

const listeners = new Set<() => void>();

// Module-level cache so every hook instance gets data instantly
const storedCache = loadCachedFromStorage();
let cachedBranding: BrandingConfig | null = storedCache;
let fetchPromise: Promise<BrandingConfig | null> | null = null;

async function fetchBranding(): Promise<BrandingConfig | null> {
  const { data } = await supabase.from("branding").select("*").limit(1).maybeSingle();
  if (!data) return null;
  const config: BrandingConfig = {
    companyName: data.company_name,
    primaryColor: data.primary_color,
    logo: data.logo ?? "",
    logoLight: (data as any).logo_light ?? "",
    logoDark: (data as any).logo_dark ?? "",
    faviconUrl: data.favicon_url ?? "",
    pwaIconUrl: (data as any).pwa_icon_url ?? "",
    markLight: (data as any).mark_light ?? "",
    markDark: (data as any).mark_dark ?? "",
  };
  cachedBranding = config;
  saveToStorage(config);
  return config;
}

async function upsertBranding(config: BrandingConfig) {
  const payload = {
    company_name: config.companyName,
    primary_color: config.primaryColor,
    logo: config.logo,
    logo_light: config.logoLight,
    logo_dark: config.logoDark,
    favicon_url: config.faviconUrl,
    pwa_icon_url: config.pwaIconUrl,
    mark_light: config.markLight,
    mark_dark: config.markDark,
  };
  const { data: existing } = await supabase.from("branding").select("id").limit(1).maybeSingle();
  if (existing) {

    await supabase.from("branding").update({ ...payload, updated_at: new Date().toISOString() } as any).eq("id", existing.id);
  } else {
    await supabase.from("branding").insert(payload as any);
  }
  cachedBranding = config;
  saveToStorage(config);
}

function fetchBrandingSingleton(): Promise<BrandingConfig | null> {
  if (!fetchPromise) {
    fetchPromise = fetchBranding().finally(() => { fetchPromise = null; });
  }
  return fetchPromise;
}

// Eagerly kick off fetch at module load time (before any component mounts)
fetchBrandingSingleton();

export function useBranding() {
  const [branding, setBrandingState] = useState<BrandingConfig>(cachedBranding ?? { ...DEFAULT_BRANDING });
  const [loaded, setLoaded] = useState(!!cachedBranding);

  // Apply cached branding immediately on first render
  useEffect(() => {
    if (cachedBranding) {
      applyBranding(cachedBranding);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // If we already have cache, mark loaded; still refresh in background
    if (cachedBranding) {
      setBrandingState(cachedBranding);
      setLoaded(true);
    }
    fetchBrandingSingleton().then((config) => {
      if (cancelled) return;
      const final = config ?? { ...DEFAULT_BRANDING };
      setBrandingState(final);
      applyBranding(final);
      setLoaded(true);
    });

    const listener = () => {
      fetchBranding().then((c) => {
        if (c) {
          setBrandingState(c);
          applyBranding(c);
        }
      });
    };
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
  }, []);

  // Apply branding on first load
  useEffect(() => {
    if (loaded) applyBranding(branding);
  }, [loaded]);

  const setBranding = useCallback(async (update: Partial<BrandingConfig>) => {
    const next = { ...branding, ...update };
    setBrandingState(next);
    applyBranding(next);
    await upsertBranding(next);
    listeners.forEach(fn => fn());
  }, [branding]);

  const resetBranding = useCallback(async () => {
    const def = { ...DEFAULT_BRANDING };
    setBrandingState(def);
    cachedBranding = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    await upsertBranding(def);
    ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1", "--info"].forEach(prop =>
      document.documentElement.style.removeProperty(prop)
    );
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (link) link.href = "/favicon.ico";
    listeners.forEach(fn => fn());
  }, []);

  return { branding, loaded, setBranding, resetBranding, DEFAULT_BRANDING };
}

/**
 * Returns the logo URL that matches the current theme, falling back to the
 * generic `logo` field when a themed variant is missing.
 */
export function useThemedLogo(): string {
  const { branding } = useBranding();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const themed = isLight ? branding.logoLight : branding.logoDark;
  return themed || branding.logo || "";
}

/**
 * Returns the brand mark (used in the collapsed sidebar) that matches the
 * current theme, falling back to the themed logo, the generic logo, and
 * finally the PWA icon / favicon.
 */
export function useThemedMark(): string {
  const { branding } = useBranding();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const themedMark = isLight ? branding.markLight : branding.markDark;
  const themedLogo = isLight ? branding.logoLight : branding.logoDark;
  return themedMark || themedLogo || branding.logo || branding.pwaIconUrl || branding.faviconUrl || "";
}

