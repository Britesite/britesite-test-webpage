import type { MetadataRoute } from "next";

/**
 * Single source of truth for the site's STATIC routes. `sitemap.ts`, the
 * `llms.txt` route, and (indirectly) canonical/hreflang derive from this —
 * register a route here once and every machine-facing surface stays in sync.
 *
 * Dynamic routes (`services/[slug]`, `cases/[slug]`) are intentionally NOT
 * listed here. Their slugs come from content and are enumerated in
 * `dynamic-routes.ts` from the same source the `[slug]` pages'
 * `generateStaticParams` reads — so the sitemap can never list a slug that
 * 404s, and a built page can never be missing from the sitemap.
 *
 * Pure + client-safe (only a type import + nothing runtime): a nav component may
 * import it. Step 5.3 of `/redesign` populates it from the committed site plan.
 */

export type StaticRoute = {
  /** Path without locale prefix. "" = home. */
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  /** Key under the `meta` message namespace for this route's title/description. */
  metaKey: string;
  /**
   * Set when the site plan marks this route `noindex`. It keeps the route out of
   * the sitemap — a sitemap entry asks a crawler to index a URL, so advertising a
   * page that then serves `noindex` asks for two contradictory things, and Google
   * reports it as "Submitted URL marked 'noindex'".
   *
   * The page must ALSO set `robots: { index: false }` in its own metadata: this
   * flag governs the sitemap, the metadata governs the crawler. `verify:source`
   * check 11 reads the rendered robots meta and fails if the two disagree in
   * either direction, so they cannot drift apart silently.
   *
   * Without this flag the pairing had nowhere to live, and a real site shipped
   * both legal pages in its sitemap with a source comment explaining they were
   * there only because the verifier demanded every generated route appear.
   */
  noindex?: true;
};

// TODO(Step 5.3): align with the routes committed in SITE_PLAN_TEMPLATE.md.
// These are the common corporate routes as a starting point. Until Step 5.3
// reconciles this list and Step 6 builds the pages, `npm run verify` will report
// the not-yet-built routes as failures — that is expected. verify is a post-build
// gate, not a check for the bare template; do not "fix" it by deleting routes here.
export const STATIC_ROUTES: StaticRoute[] = [
  { path: "", priority: 1.0, changeFrequency: "monthly", metaKey: "home" },
  { path: "/services", priority: 0.9, changeFrequency: "monthly", metaKey: "services" },
  { path: "/cases", priority: 0.8, changeFrequency: "weekly", metaKey: "cases" },
  { path: "/about", priority: 0.7, changeFrequency: "monthly", metaKey: "about" },
  { path: "/contact", priority: 0.8, changeFrequency: "yearly", metaKey: "contact" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly", metaKey: "privacy" },
  { path: "/cookies", priority: 0.2, changeFrequency: "yearly", metaKey: "cookies" },
];
