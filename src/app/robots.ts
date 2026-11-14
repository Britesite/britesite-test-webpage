import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-config";

/**
 * AI / answer-engine crawlers this site explicitly invites to index its content
 * for citation in tools like ChatGPT, Claude, and Perplexity, plus Google's AI
 * surfaces.
 *
 * POLICY DEFAULT — not a correctness invariant. The kit's thesis is that being
 * citable by answer engines (AEO) is worth more than withholding content, so the
 * default is "allow". This is a content-licensing decision: `Google-Extended`
 * governs use of your content for AI training/grounding, not classic Search. To
 * opt OUT, move a bot into a `disallow: "/"` rule. An auditor should NOT flag
 * "ClaudeBot is allowed" as a defect — it is a deliberate, documented choice.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/_next/` is deliberately NOT blocked. Google crawls and then RENDERS,
        // and it will not fetch a robots-blocked resource during render — and
        // `/_next/static/` is where Next puts every stylesheet, script and font.
        // Blocking it makes the crawler see every page unstyled while the site
        // looks perfect in a browser, which is why it survived here so long.
        // Google's own guidance is explicit: do not block CSS or JS.
        //
        // There is nothing under `/_next/` worth hiding on an App Router site —
        // it serves assets, not pages, and no crawler indexes a chunk as a page.
        // `verify-delivery` fails the build if robots blocks anything the
        // homepage actually loads.
        // `/api/` also covers `/api/mirror-page/`, the internal handler mirrored
        // pages are rewritten to (replicate mode); their public URLs are in the sitemap.
        disallow: ["/api/"],
      },
      {
        // Redundant with the wildcard allow above, but stated explicitly so the
        // policy is legible at the surface and opt-out is a one-line edit.
        userAgent: AI_CRAWLERS,
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
