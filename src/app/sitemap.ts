import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { STATIC_ROUTES } from "@/lib/seo/routes";
import { getServiceSlugs, getCaseSlugs } from "@/lib/seo/dynamic-routes";
import { absoluteUrl, hreflangAlternates } from "@/lib/seo/url";
import { MIRROR_PAGES } from "@/mirror/index";
import { mirrorAbsoluteUrl, mirrorHreflang } from "@/lib/mirror/head";
import { SITE_URL } from "@/lib/site-config";
import { TRAILING_SLASH } from "@/lib/site-routing-config";

// `lastModified` is intentionally omitted for static routes. Setting it to the
// build time (`new Date()`) re-pins every URL's lastmod on every deploy — it
// tells crawlers "everything changed" even when nothing did, and they learn to
// distrust the signal. A lastmod should reflect when the CONTENT changed; static
// pages have no such source here, so we omit it rather than fake it. Dynamic
// routes (e.g. case studies) SHOULD pass their real content date below.
function entriesFor(
  path: string,
  priority: number,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  lastModified?: string | Date,
): MetadataRoute.Sitemap {
  return routing.locales.map((locale) => ({
    url: absoluteUrl(locale, path),
    changeFrequency,
    priority,
    alternates: { languages: hreflangAlternates(path) },
    ...(lastModified ? { lastModified } : {}),
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Replicate mode: the mirrored pages ARE the site. Their URLs are the
  // original's, so the locale registry below does not apply to them.
  if (MIRROR_PAGES.length) {
    return MIRROR_PAGES.filter((page) => !page.noindex).map((page) => ({
      url: mirrorAbsoluteUrl(SITE_URL, page.path, TRAILING_SLASH),
      changeFrequency: "monthly" as const,
      priority: page.path === "/" ? 1.0 : 0.8,
      alternates: { languages: mirrorHreflang(SITE_URL, page, routing.defaultLocale, TRAILING_SLASH) },
    }));
  }

  const result: MetadataRoute.Sitemap = [];

  for (const route of STATIC_ROUTES) {
    // A noindex route is deliberately not for the index, so listing it here would
    // ask the crawler to index a page that then tells it not to. See StaticRoute.
    if (route.noindex) continue;
    result.push(...entriesFor(route.path, route.priority, route.changeFrequency));
  }

  for (const slug of await getServiceSlugs()) {
    result.push(...entriesFor(`/services/${slug}`, 0.8, "monthly"));
  }

  for (const slug of await getCaseSlugs()) {
    result.push(...entriesFor(`/cases/${slug}`, 0.7, "monthly"));
  }

  return result;
}
