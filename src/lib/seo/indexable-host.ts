/** Whether a request host is the one this site is configured to be indexed
 *  on. Anything else — a Vercel deployment URL, the git-preview host, a spare
 *  verify port — gets `X-Robots-Tag: noindex, nofollow` from the proxy: the
 *  site's canonicals already name `siteDomain`, and a crawler that indexes a
 *  temporary host files pages under a canonical that may still resolve to
 *  the client's old site. Keyed on the request host so indexing switches on
 *  the moment DNS moves, with nothing to flip on launch day. */
export function isIndexableHost(host: string | null | undefined, siteDomain: string): boolean {
  if (!host) return false;
  return host.trim().toLowerCase() === siteDomain.trim().toLowerCase();
}
