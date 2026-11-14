/**
 * Third-party embed providers the facades can load, and nothing else.
 *
 * Plain data with no React import: next.config.ts builds the CSP's frame-src
 * from the providers a site lists in site-providers.ts. The cookie or privacy
 * policy must name every provider a site actually uses — verify:source fails
 * until it does.
 */
export const EMBED_PROVIDERS = {
  youtube: {
    name: "YouTube",
    origin: "https://www.youtube-nocookie.com",
    privacyPolicy: "https://policies.google.com/privacy",
    embedUrl: (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`,
  },
  vimeo: {
    name: "Vimeo",
    origin: "https://player.vimeo.com",
    privacyPolicy: "https://vimeo.com/privacy",
    embedUrl: (id: string) => `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1&autoplay=1`,
  },
  "google-maps": {
    name: "Google Maps",
    origin: "https://www.google.com",
    privacyPolicy: "https://policies.google.com/privacy",
    // The keyless embed: no API key, no billing account.
    embedUrl: (query: string) => `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`,
  },
} as const;

export type EmbedProvider = keyof typeof EMBED_PROVIDERS;
export type VideoProvider = Exclude<EmbedProvider, "google-maps">;

/** The link a visitor follows to the map without loading anything on this page. */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The CSP frame-src: the providers this site's facades load on click, plus the
 *  origins a mirrored page's facades (or kept iframes) record. Without it,
 *  `default-src 'self'` blocks the frame the visitor just asked for. Null when
 *  nothing loads a frame: then `default-src 'self'` stands. */
export function frameSrcDirective(mirrorOrigins: readonly string[], providers: readonly EmbedProvider[]): string | null {
  const origins = [...new Set([...providers.map((p) => EMBED_PROVIDERS[p].origin), ...mirrorOrigins])];
  return origins.length ? `frame-src ${origins.join(" ")}` : null;
}
