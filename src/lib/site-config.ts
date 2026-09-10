/**
 * Centralised site configuration.
 *
 * All domain / URL references should import from here so the value is
 * defined once and protocol-handling is consistent.
 *
 * When filling in SITE_DOMAIN, use the bare domain (e.g. "www.example.com").
 * If a protocol is accidentally included it will be stripped automatically.
 */

// Domain resolution, in priority order:
//   1. NEXT_PUBLIC_SITE_DOMAIN     — set this once a custom domain is attached
//   2. britesite-test-webpage.vercel.app                   — substituted by setup-website.sh IF a domain was
//                                     known at scaffold time (usually it isn't, so the
//                                     placeholder is left intact and skipped below)
//   3. VERCEL_PROJECT_PRODUCTION_URL — the stable production domain Vercel injects at
//                                     build time (NOT VERCEL_URL, which changes per deploy)
//   4. localhost:3000              — local dev fallback
// This is why setup-website.sh no longer prompts for the domain: the site self-resolves
// to Vercel's assigned URL and you only set an env var when a real domain goes live.
import type { MirrorBusiness } from "@/lib/mirror/head";

const SCAFFOLD_DOMAIN = "britesite-test-webpage.vercel.app";
const RAW_DOMAIN =
  process.env.NEXT_PUBLIC_SITE_DOMAIN ||
  (SCAFFOLD_DOMAIN.startsWith("{{") ? "" : SCAFFOLD_DOMAIN) ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  "localhost:3000";

/** Bare domain with any leading protocol stripped. */
export const SITE_DOMAIN = RAW_DOMAIN.replace(/^https?:\/\//, "").replace(
  /\/$/,
  "",
);

/** Full site URL with protocol — use this wherever a complete URL is needed. */
export const SITE_URL = `https://${SITE_DOMAIN}`;

/** Facts this site already publishes about the business — its own footer and
 *  contact page, transcribed, never inferred. Feeds the LocalBusiness node in
 *  the mirror head, which is skipped entirely while this is null.
 *
 *  `/replicate` fills this in at R6 from the captured pages. A redesign fills it
 *  from the client's own material. Leave `geo` out: a coordinate has to come
 *  from a real geocoding lookup, so it belongs in NEEDS_FROM_CLIENT.md until one
 *  has been done. Publishing an address the client never published, or a guessed
 *  coordinate, is a fabricated business record — the one thing this file must
 *  never contain. */
export const SITE_BUSINESS: MirrorBusiness | null = null;
