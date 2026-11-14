import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planPages, renderMirrorIndex, installMirror, frameOrigins, planRedirects, planReplays } from "./mirror-install.mjs";

const mirrorManifest = {
  origin: "https://www.old.example",
  pages: [
    { url: "https://www.old.example/", path: "/", slug: "home", locale: "da-DK", ok: true },
    { url: "https://www.old.example/en", path: "/en", slug: "en", locale: "en-US", ok: true },
    { url: "https://www.old.example/om-os", path: "/om-os", slug: "om-os", locale: "da-DK", ok: true },
    { url: "https://www.old.example/broken", path: "/broken", slug: "broken", locale: "da-DK", ok: false },
    { url: "https://www.old.example/tak", path: "/tak", slug: "tak", locale: "da-DK", ok: true, noindex: true },
  ],
  runtimeAssets: [
    { url: "https://www.old.example/assets/app.js", local: "/_mirror/origin/assets/app.js", contentType: "text/javascript" },
    { url: "https://www.old.example/_serverFn/1c1d", local: "/_mirror/origin/_serverFn/1c1d.json", contentType: "application/json", replayPath: "/_serverFn/1c1d", replayHeaders: { "x-tss-serialized": "true" } },
    null,
  ],
};
const crawlManifest = {
  locales: { detected: ["da", "en"], default: "da", defaultUnprefixed: true, trailingSlash: true },
  routes: [
    { path: "/", slug: "home", title: "Home - Firma", lang: "da-DK", alternates: { da: "/", en: "/en" } },
    { path: "/en", slug: "en", title: "Home - Company", lang: "en-US", alternates: { da: "/", en: "/en" } },
    { path: "/om-os/", slug: "om-os", title: "Om os - Firma", lang: "da-DK", alternates: { da: "/om-os/", en: "/en/about-us/" } },
    { path: "/tak/", slug: "tak", title: "Tak", lang: "da-DK", noindex: true, alternates: { da: "/tak/" } },
  ],
};

test("planPages joins ok mirror pages with crawl routes: locale from alternates, normalised paths, title and description", () => {
  const pages = planPages(mirrorManifest, crawlManifest, (path) =>
    `<html><head><title>T ${path}</title><meta name="description" content="D ${path}"></head></html>`,
  );
  assert.deepEqual(pages.map((p) => p.path), ["/", "/en", "/om-os", "/tak"]);
  assert.equal(pages[0].locale, "da");
  assert.equal(pages[1].locale, "en");
  assert.deepEqual(pages[2].alternates, { da: "/om-os", en: "/en/about-us" });
  assert.equal(pages[2].title, "T /om-os");
  assert.equal(pages[2].description, "D /om-os");
  assert.equal(pages[2].file, "src/mirror/pages/om-os/index.html");
  assert.equal(pages[0].file, "src/mirror/pages/index.html");
  assert.equal(pages[3].noindex, true);
  assert.equal(pages[0].successPath, null, "no form → no success path");
});

test("planPages points a page with a marked form at the same-locale thank-you page", () => {
  const pages = planPages(mirrorManifest, crawlManifest, (path) =>
    path === "/om-os" ? '<html><head><title>x</title></head><body><form data-mirror-form="1"></form></body></html>' : "<html><head><title>x</title></head></html>",
  );
  assert.equal(pages.find((p) => p.path === "/om-os").successPath, "/tak");
  assert.equal(pages.find((p) => p.path === "/en").successPath, null);
  assert.ok(pages.every((p) => !("hasForm" in p)));
});

test("frameOrigins grants the origin a facade loads on click", () => {
  assert.deepEqual(
    frameOrigins(['<span data-embed-facade data-embed-src="https://www.youtube-nocookie.com/embed/y?autoplay=1"></span>', '<iframe src="https://player.vimeo.com/video/1"></iframe>']),
    ["https://player.vimeo.com", "https://www.youtube-nocookie.com"],
  );
});

test("frameOrigins collects distinct iframe origins across pages", () => {
  assert.deepEqual(
    frameOrigins(['<iframe src="https://www.google.com/maps/embed?x"></iframe>', '<iframe src="https://www.youtube.com/embed/y"></iframe><iframe src="https://www.google.com/maps/embed?z"></iframe>']),
    ["https://www.google.com", "https://www.youtube.com"],
  );
});

test("renderMirrorIndex emits a typed constant with every page and a path set", () => {
  const src = renderMirrorIndex([
    { path: "/", locale: "da", alternates: { da: "/" }, title: "T", description: "D", file: "src/mirror/pages/index.html" },
  ]);
  assert.match(src, /export const MIRROR_PAGES: MirrorPage\[\] = \[/);
  assert.match(src, /"path": "\/"/);
  assert.match(src, /export const MIRROR_PATHS = new Set\(MIRROR_PAGES\.map\(\(p\) => p\.path\)\)/);
  assert.match(renderMirrorIndex([], ["https://www.google.com"]), /MIRROR_FRAME_SRC: string\[\] = \["https:\/\/www.google.com"\]/);
});

// The crawl records the original's own 301s (an old slug the CMS still
// honours) as dropped URLs of class `redirect`. Inbound links hold those
// slugs; the installer carries them so next.config.ts redirects them.
test("planRedirects maps origin 301s onto mirrored pages, following chains, in the site's trailing-slash form", () => {
  const crawl = {
    locales: { trailingSlash: true },
    dropped: [
      { path: "/en/company-profile", class: "redirect", redirectsTo: "https://www.old.example/en/om-os" },
      { path: "/en/about", class: "redirect", redirectsTo: "https://www.old.example/en/company-profile" },
      { path: "/gone", class: "redirect", redirectsTo: "https://www.old.example/not-mirrored" },
      { path: "/wp-admin", class: "admin-system" },
    ],
  };
  const pages = [{ path: "/en/om-os" }, { path: "/" }];
  assert.deepEqual(planRedirects(crawl, pages), [
    { source: "/en/about/", destination: "/en/om-os/" },
    { source: "/en/company-profile/", destination: "/en/om-os/" },
  ]);
  assert.deepEqual(planRedirects({ locales: { trailingSlash: false }, dropped: crawl.dropped }, pages), [
    { source: "/en/about", destination: "/en/om-os" },
    { source: "/en/company-profile", destination: "/en/om-os" },
  ]);
});

test("renderMirrorIndex emits the redirects next.config.ts spreads", () => {
  const src = renderMirrorIndex([], [], [{ source: "/en/company-profile/", destination: "/en/om-os/" }]);
  assert.match(src, /export const MIRROR_REDIRECTS: \{ source: string; destination: string \}\[\] = \[/);
  assert.match(src, /"source": "\/en\/company-profile\/"/);
  assert.match(renderMirrorIndex([], []), /MIRROR_REDIRECTS: \{ source: string; destination: string \}\[\] = \[\]/);
});

// A mirrored framework fetches some data at an extensionless path at runtime
// (TanStack Start's `GET /_serverFn/<id>`); the capture stored the response as
// `<path>.json`, a name the page never asks for, so every load logged a 404.
test("planReplays lists each runtime response the capture recorded a request path for", () => {
  assert.deepEqual(planReplays(mirrorManifest), [
    { path: "/_serverFn/1c1d", file: "/_mirror/origin/_serverFn/1c1d.json", headers: { "x-tss-serialized": "true" } },
  ]);
  assert.deepEqual(planReplays({ pages: [] }), []);
});

test("renderMirrorIndex emits the replays the proxy answers", () => {
  const replays = [{ path: "/_serverFn/1c1d", file: "/_mirror/origin/_serverFn/1c1d.json", headers: { "x-tss-serialized": "true" } }];
  const src = renderMirrorIndex([], [], [], replays);
  assert.match(src, /export const MIRROR_REPLAYS: \{ path: string; file: string; headers: Record<string, string> \}\[\] = \[/);
  assert.match(src, /"path": "\/_serverFn\/1c1d"/);
  assert.match(src, /export const MIRROR_REPLAYS_BY_PATH = new Map\(MIRROR_REPLAYS\.map\(\(r\) => \[r\.path, r\]\)\);/);
  assert.match(renderMirrorIndex([], []), /MIRROR_REPLAYS: \{ path: string; file: string; headers: Record<string, string> \}\[\] = \[\]/);
});

test("installMirror copies pages and assets into the site, writes the index, and removes the template homepage", () => {
  const site = mkdtempSync(join(tmpdir(), "mirror-site-"));
  const from = mkdtempSync(join(tmpdir(), "mirror-from-"));
  const crawl = mkdtempSync(join(tmpdir(), "mirror-crawl-"));
  try {
    writeFileSync(join(from, "mirror-manifest.json"), JSON.stringify(mirrorManifest));
    writeFileSync(join(crawl, "manifest.json"), JSON.stringify(crawlManifest));
    writeFileSync(join(from, "index.html"), "<html><head><title>Home</title></head><body>h</body></html>");
    mkdirSync(join(from, "en"));
    writeFileSync(join(from, "en", "index.html"), "<html><head><title>Home EN</title></head><body>e</body></html>");
    mkdirSync(join(from, "om-os"));
    writeFileSync(join(from, "om-os", "index.html"), '<html><head><title>Om os</title></head><body><iframe src="https://www.google.com/maps/embed"></iframe></body></html>');
    mkdirSync(join(from, "tak"));
    writeFileSync(join(from, "tak", "index.html"), "<html><head><title>Tak</title></head><body>t</body></html>");
    mkdirSync(join(from, "_mirror", "css"), { recursive: true });
    writeFileSync(join(from, "_mirror", "css", "a.css"), "body{}");
    mkdirSync(join(site, "src", "app", "[locale]"), { recursive: true });
    writeFileSync(join(site, "src", "app", "[locale]", "page.tsx"), "export default function Home(){return null}");
    mkdirSync(join(site, "public", "_mirror", "stale"), { recursive: true });
    writeFileSync(join(site, "public", "_mirror", "stale", "old.css"), "x");

    const result = installMirror({ siteDir: site, fromDir: from, crawlDir: crawl });

    assert.equal(result.pages.length, 4);
    assert.ok(existsSync(join(site, "src", "mirror", "pages", "index.html")));
    assert.ok(existsSync(join(site, "src", "mirror", "pages", "en", "index.html")));
    assert.ok(existsSync(join(site, "src", "mirror", "pages", "om-os", "index.html")));
    assert.ok(existsSync(join(site, "public", "_mirror", "css", "a.css")));
    assert.ok(!existsSync(join(site, "public", "_mirror", "stale")), "stale assets are replaced, not merged");
    const index = readFileSync(join(site, "src", "mirror", "index.ts"), "utf8");
    assert.match(index, /"path": "\/om-os"/);
    assert.match(index, /MIRROR_FRAME_SRC: string\[\] = \["https:\/\/www.google.com"\]/);
    assert.match(index, /"path": "\/_serverFn\/1c1d"/);
    assert.ok(!existsSync(join(site, "src", "app", "[locale]", "page.tsx")), "template homepage removed");
    assert.equal(result.removedHomepage, true);
  } finally {
    rmSync(site, { recursive: true, force: true });
    rmSync(from, { recursive: true, force: true });
    rmSync(crawl, { recursive: true, force: true });
  }
});
