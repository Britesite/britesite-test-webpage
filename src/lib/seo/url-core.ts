/**
 * Pure URL composition for SEO surfaces. NO framework imports — every function
 * takes its configuration explicitly, so it is trivially unit-testable
 * (`src/lib/seo/url-core.test.ts`) and runs under `node --test` without a
 * bundler or path-alias resolution.
 *
 * `src/lib/seo/url.ts` binds these to the project's routing + site config.
 * App code should import the bound helpers from `url.ts`, not from here.
 */

export type PrefixMode = "always" | "as-needed" | "never";

/** Leading-slash, no-trailing-slash form. Home ("" or "/") collapses to "". */
export function normalizePath(path: string): string {
  if (!path || path === "/") return "";
  const withLead = path.startsWith("/") ? path : `/${path}`;
  return withLead.replace(/\/+$/, "");
}

/**
 * Re-attach the trailing slash when `next.config.ts` sets `trailingSlash: true`.
 *
 * Without this every canonical, hreflang alternate, sitemap entry and breadcrumb
 * `item` names the URL that 308-redirects instead of the one returning 200 —
 * silently, and on precisely the rebuild-in-place runs where preserving URL
 * equity is the entire point.
 *
 * Two edge cases, both of which have drawn blood:
 *
 * 1. **Append to the path only, never after `?` or `#`.** A SearchAction target
 *    like `/byer?by={search_term_string}` must not become `/byer?by={…}/`.
 * 2. **Skip a last segment carrying a file extension.** Next exempts extension
 *    paths from trailing-slash redirects, so `/og.png/` simply 404s. Only the
 *    LAST segment counts — `/v1.2/byer` has a dot earlier in the path and still
 *    needs its slash.
 */
export function applyTrailingSlash(url: string, enabled: boolean): string {
  if (!enabled || !url) return url;

  const cut = url.search(/[?#]/);
  const head = cut === -1 ? url : url.slice(0, cut);
  const tail = cut === -1 ? "" : url.slice(cut);

  if (head.endsWith("/")) return url;

  const lastSegment = head.slice(head.lastIndexOf("/") + 1);
  if (/\.[a-z0-9]+$/i.test(lastSegment)) return url;

  return `${head}/${tail}`;
}

/** Locale-prefixed path (no domain), honoring next-intl's localePrefix mode. */
export function composeLocalizedPath(
  locale: string,
  path: string,
  defaultLocale: string,
  prefixMode: PrefixMode,
  trailingSlash = false,
): string {
  const p = normalizePath(path);
  let out: string;
  if (prefixMode === "never") out = p || "/";
  else if (prefixMode === "as-needed" && locale === defaultLocale) out = p || "/";
  else out = `/${locale}${p}`;
  return applyTrailingSlash(out, trailingSlash);
}

/** Absolute, locale-correct URL — the only place domain + locale are composed. */
export function composeAbsoluteUrl(
  siteUrl: string,
  locale: string,
  path: string,
  defaultLocale: string,
  prefixMode: PrefixMode,
  trailingSlash = false,
): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${composeLocalizedPath(locale, path, defaultLocale, prefixMode, trailingSlash)}`;
}

/** hreflang map: every locale + `x-default` pointing at the default locale. */
export function composeHreflang(
  siteUrl: string,
  path: string,
  locales: readonly string[],
  defaultLocale: string,
  prefixMode: PrefixMode,
  trailingSlash = false,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = composeAbsoluteUrl(siteUrl, locale, path, defaultLocale, prefixMode, trailingSlash);
  }
  languages["x-default"] = composeAbsoluteUrl(
    siteUrl,
    defaultLocale,
    path,
    defaultLocale,
    prefixMode,
    trailingSlash,
  );
  return languages;
}

// Open Graph wants `language_TERRITORY`. We only know the language code, so map
// the common European locales this kit targets and fall back to the bare code.
// This is derived per-locale (never frozen to one value across all locales).
const OG_LOCALE: Record<string, string> = {
  da: "da_DK",
  en: "en_US",
  de: "de_DE",
  sv: "sv_SE",
  nb: "nb_NO",
  nn: "nn_NO",
  no: "nb_NO",
  fi: "fi_FI",
  fr: "fr_FR",
  nl: "nl_NL",
  es: "es_ES",
  it: "it_IT",
  pt: "pt_PT",
};

/** Map a language code to an Open Graph locale. Falls back to the bare code. */
export function composeOgLocale(locale: string): string {
  return OG_LOCALE[locale] ?? locale;
}
