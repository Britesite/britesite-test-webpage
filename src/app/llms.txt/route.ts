import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { STATIC_ROUTES } from "@/lib/seo/routes";
import { getServiceSlugs, getCaseSlugs } from "@/lib/seo/dynamic-routes";
import { absoluteUrl } from "@/lib/seo/url";
import { MIRROR_PAGES } from "@/mirror/index";
import { mirrorAbsoluteUrl } from "@/lib/mirror/head";
import { SITE_URL } from "@/lib/site-config";
import { TRAILING_SLASH } from "@/lib/site-routing-config";

/**
 * llms.txt — a map of the site for AI answer engines (see https://llmstxt.org/).
 *
 * GENERATED from the route registry + `meta` message titles, never hand-written,
 * so it can't rot: rename or add a route and this file follows. The only
 * human-authored part is the curated one-paragraph summary. Emitted in the
 * default locale, linking to absolute (locale-prefixed) URLs.
 */
export async function GET() {
  const locale = routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "meta" });

  const titleFor = (metaKey: string): string => {
    const value = t(`${metaKey}.title`);
    // A [NEEDS:] marker is tracked client-owed copy, not a usable label.
    return value.includes("[NEEDS:") ? metaKey : value;
  };

  // On a mirror the summary is not ours to write: the site already has one, in
  // the homepage description the original published. Using it keeps llms.txt
  // truthful AND keeps a [NEEDS:] marker — an internal note to the client — out
  // of a response a crawler reads. The marker stands only if there is nothing
  // to use.
  const mirrorHome = MIRROR_PAGES.find((p) => p.path === "/");
  const summary =
    mirrorHome?.description?.trim() ||
    "[NEEDS: One-paragraph summary of Britesite Test for AI answer engines — what the company does, who it serves, and why it is credible. This is the curated description an LLM reads first.]";

  const lines: string[] = [
    "# Britesite Test",
    "",
    `> ${summary}`,
    "",
    "## Pages",
  ];

  if (MIRROR_PAGES.length) {
    for (const page of MIRROR_PAGES) {
      lines.push(`- [${page.title || page.path}](${mirrorAbsoluteUrl(SITE_URL, page.path, TRAILING_SLASH)})`);
    }
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }

  for (const route of STATIC_ROUTES) {
    lines.push(`- [${titleFor(route.metaKey)}](${absoluteUrl(locale, route.path)})`);
  }

  const serviceSlugs = await getServiceSlugs();
  const caseSlugs = await getCaseSlugs();
  for (const slug of serviceSlugs) {
    lines.push(`- [${slug}](${absoluteUrl(locale, `/services/${slug}`)})`);
  }
  for (const slug of caseSlugs) {
    lines.push(`- [${slug}](${absoluteUrl(locale, `/cases/${slug}`)})`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
