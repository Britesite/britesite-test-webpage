import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routing } from "@/i18n/routing";
import { SITE_BUSINESS, SITE_URL } from "@/lib/site-config";
import { TRAILING_SLASH } from "@/lib/site-routing-config";
import { MIRROR_PAGES } from "@/mirror/index";
import { absolutiseSocialImages, ensureSocialImage, injectMirrorHead, mirrorHeadFragment, readSiteName, stripManagedHead } from "@/lib/mirror/head";
import { injectMirrorFormScript, mirrorFormScript } from "@/lib/mirror/form-script";
import { selectionBridgeScript } from "@/lib/selection/bridge";
import { selectionBridgeConfig } from "@/lib/selection/config";

/**
 * Serves a mirrored page (replicate mode). Reached only through the proxy's
 * rewrite of the page's public URL; prerendered at build time, so the captured
 * HTML is read once and the head fragment (canonical, hreflang, og:url,
 * og:locale, JSON-LD) is composed against this site's origin. The CSP for these
 * pages is the global one in next.config.ts, which reads MIRROR_FRAME_SRC.
 */
export const dynamic = "force-static";

const segments = (path: string) => (path === "/" ? [] : path.slice(1).split("/"));

// Statically scoped so Next's file tracing follows this folder, not the project.
const MIRROR_PAGES_ROOT = join(process.cwd(), "src", "mirror", "pages");
const selectionBridge = selectionBridgeConfig();

function injectSelectionBridge(html: string): string {
  if (!selectionBridge.origin) return html;
  const script = `<script>${selectionBridgeScript(selectionBridge.origin)}</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  const i = head ? head.index + head[0].length : 0;
  return html.slice(0, i) + script + html.slice(i);
}

export function generateStaticParams() {
  return MIRROR_PAGES.map((p) => ({ path: segments(p.path) }));
}

/** The homepage's own social card, reused for any page the original left
 *  without one. Read once: these routes are prerendered. */
function defaultSocialImage(): string | null {
  const home = MIRROR_PAGES.find((p) => p.path === "/");
  if (!home) return null;
  try {
    const html = readFileSync(join(MIRROR_PAGES_ROOT, "index.html"), "utf8");
    const m = /<meta\b[^>]*\bproperty="og:image"[^>]*\bcontent="([^"]*)"/i.exec(html);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const key = path.length ? `/${path.join("/")}` : "/";
  const page = MIRROR_PAGES.find((p) => p.path === key);
  if (!page) return new Response("Not found", { status: 404 });
  const captured = readFileSync(join(MIRROR_PAGES_ROOT, page.path === "/" ? "index.html" : `${page.path.slice(1)}/index.html`), "utf8");
  const fragment = mirrorHeadFragment({
    siteUrl: SITE_URL,
    page,
    defaultLocale: routing.defaultLocale,
    trailingSlash: TRAILING_SLASH,
    siteName: readSiteName(captured),
    business: SITE_BUSINESS,
  });
  const withHead = injectMirrorHead(stripManagedHead(ensureSocialImage(captured, defaultSocialImage())), fragment);
  const withForm = injectMirrorFormScript(withHead, mirrorFormScript({ locale: page.locale, successPath: page.successPath }));
  const html = injectSelectionBridge(absolutiseSocialImages(withForm, SITE_URL));
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
