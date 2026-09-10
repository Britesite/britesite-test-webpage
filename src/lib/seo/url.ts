import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-config";
import { TRAILING_SLASH } from "@/lib/site-routing-config";
import {
  composeAbsoluteUrl,
  composeHreflang,
  composeLocalizedPath,
  composeOgLocale,
  type PrefixMode,
} from "./url-core";

/**
 * Bound URL helpers — the single place locale + domain are applied across every
 * SEO surface (canonical, hreflang, sitemap, breadcrumb `item`, llms.txt). The
 * server metadata layer and the `Breadcrumbs` component both import from here, so
 * this module must stay client-safe: import only `routing` (client-safe via
 * next-intl navigation) and the pure `SITE_URL` string, never `server-only` code.
 * (`Breadcrumbs` is a server component today; keeping this client-safe means it can
 * be made a client component without breaking, and keeps these helpers usable anywhere.)
 */

// next-intl's localePrefix is a string mode or an object `{ mode, ... }`; read it
// off routing so composition always matches what the proxy actually serves.
const localePrefix = (
  routing as { localePrefix?: string | { mode?: PrefixMode } }
).localePrefix;
const PREFIX_MODE: PrefixMode =
  typeof localePrefix === "string"
    ? (localePrefix as PrefixMode)
    : (localePrefix?.mode ?? "always");

export function localizedPath(locale: string, path: string): string {
  return composeLocalizedPath(locale, path, routing.defaultLocale, PREFIX_MODE, TRAILING_SLASH);
}

export function absoluteUrl(locale: string, path: string): string {
  return composeAbsoluteUrl(SITE_URL, locale, path, routing.defaultLocale, PREFIX_MODE, TRAILING_SLASH);
}

/**
 * Absolute URL for a NON-LOCALISED asset — the social card, the logo, anything
 * served by a route handler or from /public.
 *
 * These must NOT go through `absoluteUrl()`. That helper prefixes the locale
 * (`/en/og.png`), while `proxy.ts`'s matcher deliberately excludes any path
 * containing a dot from locale rewriting — so the locale-prefixed form is served
 * by nothing. Measured on a real scaffold: `/en/og.png` returned 404 while
 * `/og.png` returned 200, meaning every page advertised an `og:image` and a
 * `twitter:image` that did not exist.
 */
export function assetUrl(path: string): string {
  const base = SITE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function hreflangAlternates(path: string): Record<string, string> {
  return composeHreflang(SITE_URL, path, routing.locales, routing.defaultLocale, PREFIX_MODE, TRAILING_SLASH);
}

export { composeOgLocale as ogLocale };
