/**
 * Build-time version identifier for the dn.os app.
 * Regenerated on every deploy/build via vite.config.ts `define`.
 *
 * Format: v{YYYY.MM.DD}-{git-short-sha}  (e.g. v2026.06.02-b0c04e0)
 * In dev mode the version still reflects the moment the dev server started.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export const APP_BUILD_DATE: string =
  typeof __APP_BUILD_DATE__ !== "undefined" ? __APP_BUILD_DATE__ : new Date().toISOString();

export function formatBuildDate(locale = "pt-BR"): string {
  try {
    return new Date(APP_BUILD_DATE).toLocaleString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return APP_BUILD_DATE;
  }
}
