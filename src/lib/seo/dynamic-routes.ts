/**
 * DYNAMIC ROUTE SOURCES — wire these in Step 5.3, or delete them.
 *
 * ⚠ THESE SHIP RETURNING `[]` AND ARE ALREADY CALLED by `src/app/sitemap.ts`
 * and `src/app/llms.txt/route.ts`. That is deliberate scaffolding, and it is
 * also the exact silent failure `verify:source` check 11 exists to catch: an
 * unwired enumerator compiles, type-checks, returns nothing, and the sitemap
 * emits valid XML containing none of the site's pages. Measured on a real run:
 * 46 town pages absent from search, every other check green.
 *
 * Step 5.3 item 2 must do ONE of these — never neither:
 *   • point each function at the SAME source the `[slug]` page's
 *     `generateStaticParams` reads, and rename it for this site's content
 *     model; or
 *   • if the frozen plan has no dynamic routes at all, DELETE these functions
 *     and their call sites. A correctly-named enumerator that nobody calls is
 *     the same bug with better spelling.
 */
import "server-only";

/**
 * Server-only enumeration of dynamic route slugs for `sitemap.ts` and the
 * `llms.txt` route.
 *
 * CONTRACT: each function MUST return the exact slug set that the corresponding
 * `[slug]/page.tsx` exposes via `generateStaticParams`. Wire both to ONE source
 * (a content directory, a typed content map, a CMS query) so the sitemap can
 * never list a slug that 404s and a built page can never be missing from the
 * sitemap. A hand-maintained array here re-introduces the exact drift this
 * module exists to prevent — derive, don't duplicate.
 *
 * The boilerplate ships these empty; Step 6 wires them when the `[slug]` routes
 * are built. `server-only` makes an accidental client import fail at build time
 * rather than silently shipping this into a browser bundle.
 */

export async function getServiceSlugs(): Promise<string[]> {
  return [];
}

export async function getCaseSlugs(): Promise<string[]> {
  return [];
}
