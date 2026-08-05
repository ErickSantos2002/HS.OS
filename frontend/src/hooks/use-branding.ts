import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { api } from "@/lib/api";

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

/** Formato do backend (snake_case, espelhando as colunas de public.branding). */
interface BrandingApi {
  company_name: string;
  primary_color: string;
  logo: string;
  logo_light: string;
  logo_dark: string;
  mark_light: string;
  mark_dark: string;
  favicon_url: string;
  pwa_icon_url: string;
}

const STORAGE_KEY = "hsos-branding-cache";

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

// Marca padrão de qualquer instalação nova. Os arquivos vivem em public/,
// servidos pela própria instalação, para não depender de nada estar semeado no
// banco. O backend tem o mesmo padrão em app/routers/branding.py — os dois
// precisam continuar concordando.
const DEFAULT_BRANDING: BrandingConfig = {
  logo: "/HS-OS-logo.png",
  logoLight: "/HS-OS-logo.png",
  logoDark: "/HS-OS-logo.png",
  markLight: "/logo-hs-padrao.png",
  markDark: "/logo-hs-padrao.png",
  companyName: "HS.OS",
  primaryColor: "203 79% 44%", // #1885c8, o azul da marca Health & Safety
  faviconUrl: "/hs.ico",
  pwaIconUrl: "/HS-OS-logo.png",
};

function daApi(d: BrandingApi): BrandingConfig {
  return {
    companyName: d.company_name,
    primaryColor: d.primary_color,
    logo: d.logo,
    logoLight: d.logo_light,
    logoDark: d.logo_dark,
    markLight: d.mark_light,
    markDark: d.mark_dark,
    faviconUrl: d.favicon_url,
    pwaIconUrl: d.pwa_icon_url,
  };
}

function paraApi(c: BrandingConfig): BrandingApi {
  return {
    company_name: c.companyName,
    primary_color: c.primaryColor,
    logo: c.logo,
    logo_light: c.logoLight,
    logo_dark: c.logoDark,
    mark_light: c.markLight,
    mark_dark: c.markDark,
    favicon_url: c.faviconUrl,
    pwa_icon_url: c.pwaIconUrl,
  };
}

function hslToHex(hslStr: string): string {
  // Parse "H S% L%" format
  const m = hslStr.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return "#1885c8";
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

  // O manifest é servido pela própria instalação (public/manifest.json). Antes
  // apontava para uma edge function de OUTRO projeto Supabase — endereço que
  // não é nosso e que quebraria numa instalação própria.
  const version = encodeURIComponent(
    (icon || "") + "|" + (config.companyName || "") + "|" + themeColor,
  );
  const manifestUrl = `/manifest.json?v=${version}`;

  let link = document.querySelector("link[rel='manifest']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  if (!link.href.endsWith(manifestUrl)) link.href = manifestUrl;

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
  try {
    // Chamada anônima: a tela de login precisa da marca antes de haver sessão.
    const config = daApi(await api<BrandingApi>("/branding", { autenticar: false }));
    cachedBranding = config;
    saveToStorage(config);
    return config;
  } catch {
    // Backend fora do ar não pode deixar o app sem marca — cai no padrão.
    return null;
  }
}

async function upsertBranding(config: BrandingConfig) {
  await api("/branding", { method: "PUT", body: paraApi(config) });
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
    if (link) link.href = DEFAULT_BRANDING.faviconUrl;
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
