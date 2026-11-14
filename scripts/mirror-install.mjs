#!/usr/bin/env node
// mirror-install — wire a site-mirror capture into this site (replicate mode).
//
// Copies each captured page into src/mirror/pages/<path>/index.html, replaces
// public/_mirror with the capture's localised assets, generates src/mirror/index.ts
// (the page list the proxy, the route handler, the sitemap and llms.txt read),
// and removes the template's own homepage so the original's URL set is the
// site's URL set.
//
// Usage: node scripts/mirror-install.mjs --from <mirror dir> --crawl <crawl dir> [--site <dir>]

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const normalizePath = (p) => {
  const s = String(p || "/").replace(/\/+$/, "");
  return s === "" ? "/" : s.startsWith("/") ? s : `/${s}`;
};

const pageFile = (path) => (path === "/" ? "src/mirror/pages/index.html" : `src/mirror/pages${path}/index.html`);

const decode = (s) =>
  String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function headMeta(html) {
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const description = decode(html.match(/<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]*)"/i)?.[1] ?? "").trim();
  return { title, description };
}

function localeOf(route, path, mirrorLocale, detected) {
  for (const [locale, altPath] of Object.entries(route?.alternates || {})) {
    if (normalizePath(altPath) === path) return locale;
  }
  const short = String(route?.lang || mirrorLocale || "").split(/[-_]/)[0].toLowerCase();
  if (short && (!detected?.length || detected.includes(short))) return short;
  return detected?.[0] ?? short;
}

const THANK_YOU = /(^|\/)(tak|tack|takk|thank-?you|thanks|danke|merci|gracias)(-for[-a-z]*)?$/i;

/** Origins of every iframe across the captured pages, for the CSP's frame-src —
 *  including the frame a click-to-load facade inserts (`data-embed-src`), which
 *  is not an iframe in the markup until the visitor asks for it. */
export function frameOrigins(htmls) {
  const out = new Set();
  for (const html of htmls) {
    for (const m of html.matchAll(/<iframe\b[^>]*\bsrc="(https?:\/\/[^/"]+)/gi)) out.add(m[1]);
    for (const m of html.matchAll(/\sdata-embed-src="(https?:\/\/[^/"]+)/gi)) out.add(m[1]);
  }
  return [...out].sort();
}

/** Join the capture's pages with the crawl's routes. `readHtml(path)` returns the captured HTML. */
export function planPages(mirrorManifest, crawlManifest, readHtml) {
  const routes = new Map((crawlManifest.routes || []).map((r) => [normalizePath(r.path), r]));
  const detected = crawlManifest.locales?.detected || [];
  const pages = [];
  for (const p of mirrorManifest.pages || []) {
    if (!p.ok) continue;
    const path = normalizePath(p.path);
    const route = routes.get(path);
    const html = readHtml(path);
    const meta = headMeta(html);
    const alternates = {};
    for (const [locale, altPath] of Object.entries(route?.alternates || {})) alternates[locale] = normalizePath(altPath);
    const locale = localeOf(route, path, p.locale, detected);
    if (!alternates[locale]) alternates[locale] = path;
    pages.push({
      path,
      locale,
      alternates,
      title: meta.title || route?.title || path,
      description: meta.description,
      file: pageFile(path),
      ...(route?.noindex || p.noindex ? { noindex: true } : {}),
      hasForm: /data-mirror-form/.test(html),
    });
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  for (const page of pages) {
    const thankYou = pages.find((q) => q.locale === page.locale && THANK_YOU.test(q.path));
    page.successPath = page.hasForm ? (thankYou?.path ?? null) : null;
    delete page.hasForm;
  }
  return pages;
}

/** The original's own permanent redirects — dropped crawl URLs of class
 *  `redirect` — mapped onto the mirrored page they end at, chains followed,
 *  in the site's trailing-slash form. Inbound links hold the old slugs; the
 *  mirror pages themselves already link the targets directly. */
export function planRedirects(crawlManifest, pages) {
  const trailing = Boolean(crawlManifest.locales?.trailingSlash);
  const form = (p) => (p === "/" ? p : trailing ? `${p}/` : p);
  const served = new Set(pages.map((p) => normalizePath(p.path)));
  const hops = new Map();
  for (const d of crawlManifest.dropped || []) {
    if (d.class !== "redirect" || !d.redirectsTo || !d.path) continue;
    let target;
    try {
      target = new URL(d.redirectsTo);
    } catch {
      continue;
    }
    hops.set(normalizePath(d.path), normalizePath(target.pathname));
  }
  const out = [];
  for (const source of hops.keys()) {
    let cur = source;
    const seen = new Set([cur]);
    while (hops.has(cur) && !seen.has(hops.get(cur))) {
      cur = hops.get(cur);
      seen.add(cur);
    }
    if (cur !== source && served.has(cur)) out.push({ source: form(source), destination: form(cur) });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/** Runtime responses a mirrored page fetches at a path it was not stored under —
 *  an extensionless endpoint (TanStack Start's `GET /_serverFn/<id>`) saved as
 *  `<path>.json`. The capture records the request path and the headers the
 *  framework reads to decode the body; the proxy answers each from its file. */
export function planReplays(mirrorManifest) {
  return (mirrorManifest.runtimeAssets || [])
    .filter((r) => r?.replayPath && r.local)
    .map((r) => ({ path: r.replayPath, file: r.local, headers: r.replayHeaders || {} }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function renderMirrorIndex(pages, frameSrc = [], redirects = [], replays = []) {
  return [
    "// GENERATED by scripts/mirror-install.mjs from a capture. Owners may edit MIRROR_PAGES and the HTML files for routine site changes.",
    "// Re-run the installer only to replace the captured site or its asset set. Empty on a redesign site.",
    'import type { MirrorPage } from "@/lib/mirror/head";',
    "",
    `export const MIRROR_PAGES: MirrorPage[] = ${JSON.stringify(pages, null, 2)};`,
    "",
    "export const MIRROR_PATHS = new Set(MIRROR_PAGES.map((p) => p.path));",
    "",
    "/** Origins of iframes the mirrored pages embed; next.config.ts grants them in frame-src. */",
    `export const MIRROR_FRAME_SRC: string[] = ${JSON.stringify(frameSrc)};`,
    "",
    "/** Runtime responses the mirrored pages fetch at an extensionless path; src/proxy.ts answers each from its file with the headers the page's framework reads. */",
    `export const MIRROR_REPLAYS: { path: string; file: string; headers: Record<string, string> }[] = ${JSON.stringify(replays, null, 2)};`,
    "",
    "export const MIRROR_REPLAYS_BY_PATH = new Map(MIRROR_REPLAYS.map((r) => [r.path, r]));",
    "",
    "/** The original's own permanent redirects (old slugs its CMS still honoured); next.config.ts spreads them. */",
    `export const MIRROR_REDIRECTS: { source: string; destination: string }[] = ${JSON.stringify(redirects, null, 2)};`,
    "",
  ].join("\n");
}

export function installMirror({ siteDir, fromDir, crawlDir }) {
  const mirrorManifest = JSON.parse(readFileSync(join(fromDir, "mirror-manifest.json"), "utf8"));
  const crawlManifest = JSON.parse(readFileSync(join(crawlDir, "manifest.json"), "utf8"));
  const sourceFile = (path) => (path === "/" ? join(fromDir, "index.html") : join(fromDir, path.slice(1), "index.html"));
  const pages = planPages(mirrorManifest, crawlManifest, (path) => readFileSync(sourceFile(path), "utf8"));

  const pagesRoot = join(siteDir, "src", "mirror", "pages");
  rmSync(pagesRoot, { recursive: true, force: true });
  for (const page of pages) {
    const dest = join(siteDir, page.file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(sourceFile(page.path), dest);
  }

  const assetsDest = join(siteDir, "public", "_mirror");
  rmSync(assetsDest, { recursive: true, force: true });
  if (existsSync(join(fromDir, "_mirror"))) cpSync(join(fromDir, "_mirror"), assetsDest, { recursive: true });

  const frameSrc = frameOrigins(pages.map((page) => readFileSync(join(siteDir, page.file), "utf8")));
  mkdirSync(join(siteDir, "src", "mirror"), { recursive: true });
  const redirects = planRedirects(crawlManifest, pages);
  const replays = planReplays(mirrorManifest);
  writeFileSync(join(siteDir, "src", "mirror", "index.ts"), renderMirrorIndex(pages, frameSrc, redirects, replays));

  const homepage = join(siteDir, "src", "app", "[locale]", "page.tsx");
  const removedHomepage = existsSync(homepage);
  if (removedHomepage) rmSync(homepage);

  return { pages, removedHomepage, frameSrc, redirects, replays, assets: (mirrorManifest.assets || []).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const fromDir = opt("--from");
  const crawlDir = opt("--crawl");
  const siteDir = resolve(opt("--site") ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if (!fromDir || !crawlDir) {
    console.error("usage: mirror-install.mjs --from <mirror dir> --crawl <crawl dir> [--site <dir>]");
    process.exit(2);
  }
  const r = installMirror({ siteDir, fromDir: resolve(fromDir), crawlDir: resolve(crawlDir) });
  for (const p of r.pages) console.log(`MIRROR_PAGE path=${p.path} locale=${p.locale} file=${p.file}`);
  for (const p of r.replays) console.log(`MIRROR_REPLAY path=${p.path} file=${p.file}`);
  console.log(`MIRROR_INSTALLED pages=${r.pages.length} assets=${r.assets} homepageRemoved=${r.removedHomepage}`);
}
