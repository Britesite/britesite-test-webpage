import type { EmbedProvider } from "./providers";

/**
 * The facade providers THIS site loads, and so the only ones the CSP's
 * frame-src allows (next.config.ts). List a provider when a page uses
 * `<VideoFacade provider="…">` or `<MapFacade interactive>` ("google-maps");
 * remove it when the last one goes. verify:source check 27 fails while this
 * list and src/ disagree. A plain list, read by that check as text.
 */
export const SITE_EMBED_PROVIDERS: readonly EmbedProvider[] = ["google-maps"];
