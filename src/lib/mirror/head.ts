/**
 * Head composition for mirrored pages (replicate mode).
 *
 * A mirrored page is the original's rendered DOM, so its <head> already carries
 * the original's title, description and Open Graph copy. What must NOT survive
 * is anything that names the original's URLs or locale as authoritative —
 * canonical, hreflang, og:url, og:locale, feed and oEmbed discovery links —
 * because the same page now lives at this site's origin. Those are stripped
 * and rebuilt here from the page's alternates, exactly as `buildMetadata` does
 * for template pages. Pure: no server-only imports, testable under node:test.
 */

import { applyTrailingSlash, composeOgLocale } from "../seo/url-core.ts";

export type MirrorPage = {
  /** Path as served, no trailing slash except the root "/". */
  path: string;
  /** Locale code the page is written in ("da", "en"). */
  locale: string;
  /** Locale → path of the same page in that locale, this page included. */
  alternates: Record<string, string>;
  title: string;
  description: string;
  /** Site-relative file holding the captured HTML. */
  file: string;
  /** The original served this page with a robots noindex; keep it out of the sitemap. */
  noindex?: boolean;
  /** Same-locale thank-you page the original's form led to, when the site has one. */
  successPath?: string | null;
};

const MANAGED_HEAD = [
  /<link\b[^>]*\brel="canonical"[^>]*>\s*/gi,
  /<link\b[^>]*\bhreflang=[^>]*>\s*/gi,
  /<link\b[^>]*\btype="application\/rss\+xml"[^>]*>\s*/gi,
  /<link\b[^>]*\btype="application\/atom\+xml"[^>]*>\s*/gi,
  /<link\b[^>]*oembed[^>]*>\s*/gi,
  /<meta\b[^>]*\bproperty="og:url"[^>]*>\s*/gi,
  /<meta\b[^>]*\bproperty="og:locale"[^>]*>\s*/gi,
  // The original's structured data. The kit publishes exactly one graph for
  // this site; leaving the CMS's alongside it gives crawlers two different,
  // partially conflicting descriptions of the same entity.
  /<script\b[^>]*\btype="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi,
];

export function stripManagedHead(html: string): string {
  const open = html.search(/<head[\s>]/i);
  const close = html.search(/<\/head>/i);
  if (open === -1 || close === -1) return html;
  let head = html.slice(open, close);
  for (const re of MANAGED_HEAD) head = head.replace(re, "");
  return html.slice(0, open) + head + html.slice(close);
}

export function mirrorAbsoluteUrl(siteUrl: string, path: string, trailingSlash: boolean): string {
  const base = siteUrl.replace(/\/+$/, "");
  if (path === "/" || path === "") return trailingSlash ? `${base}/` : base;
  return applyTrailingSlash(`${base}${path.startsWith("/") ? path : `/${path}`}`, trailingSlash);
}

export function mirrorHreflang(
  siteUrl: string,
  page: MirrorPage,
  defaultLocale: string,
  trailingSlash: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, path] of Object.entries(page.alternates)) {
    out[locale] = mirrorAbsoluteUrl(siteUrl, path, trailingSlash);
  }
  const fallback = page.alternates[defaultLocale] ?? page.path;
  out["x-default"] = mirrorAbsoluteUrl(siteUrl, fallback, trailingSlash);
  return out;
}

/** The site's own name, as the captured page already declares it. */
export function readSiteName(html: string): string | null {
  const m = /<meta\b[^>]*\bproperty="og:site_name"[^>]*\bcontent="([^"]*)"/i.exec(html);
  return m && m[1].trim() ? m[1].trim() : null;
}

/** Give a page with no social card the site's default one. The original set an
 *  og:image on most pages but not all, and a page shared with no card — the
 *  contact page above all — renders as a bare link everywhere. An existing card
 *  is never replaced: that one is the original's choice. */
export function ensureSocialImage(html: string, fallbackUrl: string | null): string {
  if (!fallbackUrl || /<meta\b[^>]*\bproperty="og:image"/i.test(html)) return html;
  return html.replace(/(<head\b[^>]*>)/i, `$1<meta property="og:image" content="${escapeAttr(fallbackUrl)}">`);
}

/** Facts the site already publishes about the business. Never inferred — see
 *  the note on `geo` in the caller. */
export type MirrorBusiness = {
  name: string;
  streetAddress: string;
  postalCode: string;
  addressLocality: string;
  addressCountry: string;
  telephone: readonly string[];
  email?: string;
  vatID?: string;
};

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function mirrorHeadFragment({
  siteUrl,
  page,
  defaultLocale,
  trailingSlash,
  siteName,
  business,
}: {
  siteUrl: string;
  page: MirrorPage;
  defaultLocale: string;
  trailingSlash: boolean;
  siteName?: string | null;
  business?: MirrorBusiness | null;
}): string {
  const canonical = mirrorAbsoluteUrl(siteUrl, page.path, trailingSlash);
  const lines = [`<link rel="canonical" href="${escapeAttr(canonical)}">`];
  for (const [lang, href] of Object.entries(mirrorHreflang(siteUrl, page, defaultLocale, trailingSlash))) {
    lines.push(`<link rel="alternate" hrefLang="${escapeAttr(lang)}" href="${escapeAttr(href)}">`);
  }
  lines.push(`<link rel="icon" href="/icon.svg" type="image/svg+xml">`);
  lines.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
  lines.push(`<meta property="og:locale" content="${escapeAttr(composeOgLocale(page.locale))}">`);
  const jsonLd: { "@context": string; "@graph": Record<string, unknown>[] } = {
    "@context": "https://schema.org",
    "@graph": [
      // The SITE's name — not this page's title, which made every page claim a
      // different name for the same @id.
      { "@type": "WebSite", "@id": `${siteUrl.replace(/\/+$/, "")}/#website`, url: mirrorAbsoluteUrl(siteUrl, "/", trailingSlash), name: siteName || page.title },
      { "@type": "WebPage", "@id": canonical, url: canonical, name: page.title, description: page.description, inLanguage: page.locale, isPartOf: { "@id": `${siteUrl.replace(/\/+$/, "")}/#website` } },
    ],
  };
  if (business) {
    // No `geo`: a coordinate has to come from a real geocoding lookup, never
    // from reasoning about an address.
    jsonLd["@graph"].push({
      "@type": "LocalBusiness",
      "@id": `${siteUrl.replace(/\/+$/, "")}/#business`,
      name: business.name,
      url: mirrorAbsoluteUrl(siteUrl, "/", trailingSlash),
      address: {
        "@type": "PostalAddress",
        streetAddress: business.streetAddress,
        postalCode: business.postalCode,
        addressLocality: business.addressLocality,
        addressCountry: business.addressCountry,
      },
      telephone: business.telephone,
      ...(business.email ? { email: business.email } : {}),
      ...(business.vatID ? { vatID: business.vatID } : {}),
    });
  }
  lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`);
  return lines.join("\n");
}

const SOCIAL_IMAGE_META = /(<meta\b[^>]*\b(?:property|name)="(?:og:image(?::(?:url|secure_url))?|twitter:image(?::src)?)"[^>]*\bcontent=")(\/[^"]*)(")/gi;

/** Make a localized social-card image absolute. Localizing the original's
 *  og:image leaves a root-relative path, and the crawlers that read it — a
 *  link unfurler, not a browser on the page — have no document to resolve it
 *  against. Only `/`-rooted values are touched; an already-absolute or
 *  off-site card is the original's choice and is left alone. */
export function absolutiseSocialImages(html: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return html.replace(SOCIAL_IMAGE_META, (_all, head, path, tail) => `${head}${base}${path}${tail}`);
}

export function injectMirrorHead(html: string, fragment: string): string {
  if (html.includes("<!-- mirror:head -->")) return html.replace("<!-- mirror:head -->", fragment);
  return html.replace(/(<head\b[^>]*>)/i, `$1${fragment}`);
}
