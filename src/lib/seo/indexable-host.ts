/** Whether a request host is the one this site is configured to be indexed
 *  on. Anything else — a Vercel deployment URL, the git-preview host, a spare
 *  verify port — gets `X-Robots-Tag: noindex, nofollow` from the proxy: the
 *  site's canonicals already name `siteDomain`, and a crawler that indexes a
 *  temporary host files pages under a canonical that may still resolve to
 *  the client's old site. Keyed on the request host so indexing switches on
 *  the moment DNS moves, with nothing to flip on launch day.
 *
 *  A `*.vercel.app` host is never indexable, even when `siteDomain` fell back
 *  to it: before a real domain is attached the site is a scaffold or a mirror
 *  of the client's live site, and Vercel's production URL moves to the custom
 *  domain on the first deploy after it is attached. */
export function isIndexableHost(host: string | null | undefined, siteDomain: string): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  if (normalized.endsWith(".vercel.app")) return false;
  return normalized === siteDomain.trim().toLowerCase();
}
