import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findFontSizeTokenMisuse,
  findStorageInUseState,
  findBannedImports,
  findBannedDependencies,
  findTextMentions,
  findOrphanImageMarkers,
  extractImageRequestIds,
  findUnresolvedSlots,
  findLazyNeedsMarkers,
  UI_LIBRARY_MATCHERS,
  MAP_LIBRARY_MATCHERS,
  sourceToRegExp,
  extractBacktickedPaths,
  findUnmappedInventoryUrls,
  findUnimplementedRedirects,
  extractRedirectSources,
  findDroppedOriginRedirects,
  findBannedCopy,
  sharedJsBudgetHit,
  findHeavyImages,
  sharedScriptSrcs,
  findRenderedPlaceholders,
  findDeadRedirectTargets,
  findClassShapedLiteralsInProse,
  findSvgViewBoxAspectMismatch,
  findSelfRedirectingLinks,
  findNoindexRoutes,
  localeKeyOf,
  findHardcodedFigureNames,
  findLayerDefeat,
  maskComments,
  ownHosts,
  unconditionalRedirectSources,
  isAssetRoute,
  findSitemapCoverageGaps,
  publicRouteOf,
  builtCssFreshness,
  findProductionNotes,
  findFocusRingTransition,
} from "./verify-source.mjs";
import { placeholdersVisible } from "../src/lib/placeholder.ts";

// ── Check 1: Tailwind font-size token misuse ────────────────────────────────
const T = "text-";  // split literals: Tailwind scans this file too (see verify-source.mjs check 1)

test("findFontSizeTokenMisuse flags a bare var() font-size utility", () => {
  const text = `<h1 className="${T}[var(--font-size-xl)]">Hi</h1>`;
  const hits = findFontSizeTokenMisuse(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].why, /font-size/);
});

test("findFontSizeTokenMisuse does not flag the correct length-hinted form", () => {
  const text = `<h1 className="${T}[length:var(--font-size-xl)]">Hi</h1>`;
  assert.deepEqual(findFontSizeTokenMisuse(text), []);
});

test("findFontSizeTokenMisuse reports one hit per occurrence, with correct line numbers", () => {
  const text = [
    `const a = "${T}[var(--x)]";`,
    "const b = 1;",
    `const c = "${T}[var(--y)]";`,
  ].join("\n");
  const hits = findFontSizeTokenMisuse(text);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.line), [1, 3]);
});

// ── Check 2: SSR hydration trap ──────────────────────────────────────────────
test("findStorageInUseState flags a localStorage read inside a useState initializer in a client component", () => {
  const text = [
    '"use client";',
    'const [visible, setVisible] = useState(() => !localStorage.getItem("x"));',
  ].join("\n");
  const hits = findStorageInUseState(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].why, /hydration mismatch|mismatches/);
});

test("findStorageInUseState ignores files with no \"use client\" directive", () => {
  const text = 'const [visible, setVisible] = useState(() => !localStorage.getItem("x"));';
  assert.deepEqual(findStorageInUseState(text), []);
});

test("findStorageInUseState ignores a localStorage read that is outside the useState(...) call", () => {
  const text = [
    '"use client";',
    'useEffect(() => { const x = localStorage.getItem("x"); }, []);',
    "const [visible] = useState(false);",
  ].join("\n");
  assert.deepEqual(findStorageInUseState(text), []);
});

// The shape that actually shipped in CookieConsent.tsx: the storage read is one
// hop away, behind a same-file helper. A checker that only matched a literal
// `localStorage` inside the initializer passed this file clean for months.
test("findStorageInUseState resolves one hop through a same-file helper", () => {
  const text = [
    '"use client";',
    "function getStoredPreferences(): Prefs | null {",
    '  if (typeof window === "undefined") return null;',
    '  return JSON.parse(localStorage.getItem(K));',
    "}",
    "export function CookieConsent() {",
    "  const [visible] = useState(() => !getStoredPreferences());",
    "  const [prefs] = useState<Prefs>(() => getStoredPreferences() ?? d);",
    "  const [open] = useState(false);",
    "}",
  ].join("\n");
  const hits = findStorageInUseState(text);
  assert.equal(hits.length, 2);
  assert.match(hits[0].why, /getStoredPreferences\(\)/);
});

test("findStorageInUseState resolves a helper with an expression arrow body", () => {
  const text = [
    '"use client";',
    'const read = () => localStorage.getItem("k");',
    "const [v] = useState(() => read());",
  ].join("\n");
  assert.equal(findStorageInUseState(text).length, 1);
});

// The false positive that would get this check switched off: a storage-reading
// helper exists in the file, but the initializer calls something else entirely.
test("findStorageInUseState does not flag an initializer calling a non-storage helper", () => {
  const text = [
    '"use client";',
    "function computeDefault() { return { a: 1 }; }",
    'function getStored() { return localStorage.getItem("k"); }',
    "const [x] = useState(() => computeDefault());",
    "const [y] = useState(false);",
  ].join("\n");
  assert.deepEqual(findStorageInUseState(text), []);
});

// ── Checks 3/4: banned import & dependency matchers ──────────────────────────
test("findBannedImports flags a @mui import", () => {
  const text = `import Button from "@mui/material/Button";`;
  const hits = findBannedImports(text, UI_LIBRARY_MATCHERS);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /shadcn/);
});

test("findBannedImports does not flag an unrelated import", () => {
  const text = `import { Button } from "@/components/ui/button";`;
  assert.deepEqual(findBannedImports(text, UI_LIBRARY_MATCHERS), []);
});

test("findBannedImports flags a leaflet import against the map matcher", () => {
  const text = `import L from "leaflet";`;
  const hits = findBannedImports(text, MAP_LIBRARY_MATCHERS);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /Google Maps/);
});

test("findBannedDependencies flags bootstrap in package.json dependencies", () => {
  const pkg = JSON.stringify({ dependencies: { bootstrap: "^5.0.0", next: "^16.0.0" } }, null, 2);
  const hits = findBannedDependencies(pkg, UI_LIBRARY_MATCHERS);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /shadcn/);
});

test("findBannedDependencies does not flag an unrelated devDependency", () => {
  const pkg = JSON.stringify({ devDependencies: { typescript: "^5" } }, null, 2);
  assert.deepEqual(findBannedDependencies(pkg, UI_LIBRARY_MATCHERS), []);
});

test("findTextMentions flags an openstreetmap reference", () => {
  const text = "tile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'";
  const hits = findTextMentions(text, /openstreetmap/i, "references OpenStreetMap");
  assert.equal(hits.length, 1);
});

// ── Check 5: orphan image markers ────────────────────────────────────────────
test("findOrphanImageMarkers flags a marker with no matching manifest row", () => {
  const text = `<div>{/* [NEEDS:image IMG-home-hero-001] */}</div>`;
  const hits = findOrphanImageMarkers(text, new Set());
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /IMG-home-hero-001/);
});

test("findOrphanImageMarkers does not flag a marker with a matching manifest row", () => {
  const text = `<div>{/* [NEEDS:image IMG-home-hero-001] */}</div>`;
  const hits = findOrphanImageMarkers(text, new Set(["IMG-home-hero-001"]));
  assert.deepEqual(hits, []);
});

test("extractImageRequestIds reads IDs from ## IMG-... headings", () => {
  const md = [
    "# Image Requests",
    "",
    "## IMG-home-hero-001",
    "- Prompt: a",
    "",
    "## IMG-about-team-001",
    "- Prompt: b",
  ].join("\n");
  const ids = extractImageRequestIds(md);
  assert.deepEqual([...ids].sort(), ["IMG-about-team-001", "IMG-home-hero-001"]);
});

// ── Check 6: unresolved image slots ──────────────────────────────────────────
test("findUnresolvedSlots flags a Resolution: pending row, attributed to its slot heading", () => {
  const text = [
    "### SLOT-home-hero-001",
    "- **Section:** hero",
    "- **Resolution:** pending",
  ].join("\n");
  const hits = findUnresolvedSlots(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
  assert.match(hits[0].why, /SLOT-home-hero-001/);
});

test("findUnresolvedSlots does not flag the schema template line or a resolved slot", () => {
  const text = [
    "- **Resolution:** <pending | catalog-reuse | manifest-row | image-present | justified-none>",
    "### SLOT-home-hero-001",
    "- **Resolution:** image-present",
  ].join("\n");
  assert.deepEqual(findUnresolvedSlots(text), []);
});

// ── Check 7: lazy [NEEDS:] markers ───────────────────────────────────────────
test("findLazyNeedsMarkers flags a marker that names a source it should have already used", () => {
  const text = `<p>[NEEDS: Founding story from the old site]</p>`;
  const hits = findLazyNeedsMarkers(text);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /unfinished extraction/);
});

test("findLazyNeedsMarkers does not flag a genuine client-input marker", () => {
  const text = `<p>[NEEDS: Annual revenue figure for trust section]</p>`;
  assert.deepEqual(findLazyNeedsMarkers(text), []);
});

test("findLazyNeedsMarkers catches each of the five lazy-source phrases", () => {
  const phrases = ["from the old", "per their", "per the old", "from their", "on the old site"];
  for (const phrase of phrases) {
    const hits = findLazyNeedsMarkers(`[NEEDS: some text ${phrase} copy]`);
    assert.equal(hits.length, 1, `expected a hit for phrase "${phrase}"`);
  }
});

test("findLazyNeedsMarkers ignores lazy phrases that occur outside a [NEEDS:] marker", () => {
  const text = "// copy should come from their own brand, not generic agency branding.";
  assert.deepEqual(findLazyNeedsMarkers(text), []);
});

// ── Check 8: redirect coverage ───────────────────────────────────────────────
// The shape that actually shipped: an inventory listing 30 root-level article URLs
// against a config with four redirect rules. Every other check passed.
test("findUnmappedInventoryUrls flags a live URL absent from redirects.md", () => {
  const inv = "| `/allround-webmaster/` | 200 | An advertorial |\n| `/kontakt/` | 200 | |";
  const red = "| `/kontakt/` | `/kontakt/` | PRESERVED | |";
  const hits = findUnmappedInventoryUrls(inv, red);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /allround-webmaster/);
});

test("findUnmappedInventoryUrls passes when every URL is accounted for", () => {
  const inv = "| `/a/` | 200 | |\n| `/b/` | 200 | |";
  const red = "| `/a/` | `/a/` | PRESERVED |\n| `/b/` | `/c/` | REDIRECTED |";
  assert.deepEqual(findUnmappedInventoryUrls(inv, red), []);
});

// Inventories summarise as well as enumerate; notation is not a missing page.
test("extractBacktickedPaths ignores ranges, ellipses and machine surfaces", () => {
  const md = "| `/vvs/page/2-5/` | `/sitemap_index.xml` | `/barrit-…/` | `/real-page/` |";
  assert.deepEqual([...extractBacktickedPaths(md)], ["/real-page/"]);
});

test("sourceToRegExp matches Next path params", () => {
  assert.ok(sourceToRegExp("/vvs/page/:page*").test("/vvs/page/3/"));
  assert.ok(sourceToRegExp("/a/:x").test("/a/b/"));
  assert.ok(!sourceToRegExp("/a/:x").test("/a/b/c/"));
});

// On a mirrored site the installer writes the origin's own redirects into the
// generated index and next.config.ts spreads them; 8b must see both sources.
test("extractRedirectSources reads next.config.ts's block and the generated MIRROR_REDIRECTS", () => {
  const cfg = "async redirects() {\n    return [{ source: '/a.html', destination: '/a', permanent: true }, ...MIRROR_REDIRECTS.map((r) => ({ ...r, permanent: true }))];\n  }";
  const idx = 'export const MIRROR_REDIRECTS: { source: string; destination: string }[] = [\n  {\n    "source": "/en/company-profile/",\n    "destination": "/en/om-os/"\n  }\n];';
  assert.deepEqual(extractRedirectSources(cfg + "\n" + idx), ["/a.html", "/en/company-profile/"]);
});

test("findUnimplementedRedirects flags a documented redirect missing from the config", () => {
  const red = "| `/old/` | `/new/` | REDIRECTED | |";
  const cfg = "async redirects() {\n    return [];\n  }";
  assert.equal(findUnimplementedRedirects(red, cfg).length, 1);
});

test("findUnimplementedRedirects accepts a pattern that covers the documented source", () => {
  const red = "| `/vvs/page/2/` | `/vvs/` | REDIRECTED | |";
  const cfg = "async redirects() {\n    return [{ source: '/vvs/page/:page*', destination: '/vvs/', permanent: true }];\n  }";
  assert.deepEqual(findUnimplementedRedirects(red, cfg), []);
});

test("redirect implementation reads mapping status cells, not explanatory redirect prose", () => {
  const prose = "- The homepage, `/om-os`, and `/privatlivspolitik` are already final new paths; self-redirects would loop, so they are documented as unchanged.";
  const mapping = [
    "| Old URL | Destination | Type | Notes |",
    "| --- | --- | --- | --- |",
    "| `/home` | `/da` | Homepage | Default locale |",
    "| `/about` | `/da/about` | Page | Direct equivalent |",
    "| `/services/welding` | `/da/services/welding` | Service | Slug preserved |",
    "| `/blog/some-post` | `/en/about` | Catch-all | Closest surviving section |",
    "| `/om-os` | — | No redirect — unchanged | Already final path |",
  ].join("\n");
  const cfg = "async redirects() {\n    return [{ source: '/home' }, { source: '/about' }, { source: '/services/welding' }, { source: '/blog/some-post' }];\n  }";
  assert.deepEqual(findUnimplementedRedirects(prose, ""), []);
  assert.deepEqual(findUnimplementedRedirects(mapping, cfg), []);
  assert.equal(findUnimplementedRedirects(mapping, "").length, 4);
});

test("redirect implementation rejects unsupported mapping statuses", () => {
  const red = "| `/old/` | `/new/` | Needs decision | |";
  const hits = findUnimplementedRedirects(red, "");
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /unsupported mapping status/);
});

// Check 8c: the original's own 301s (an old English slug the CMS still honours)
// are inventory rows of class `redirect`. Filed as DROPPED they vanish on launch;
// they must be REDIRECTED so 8b makes the config carry them.
test("findDroppedOriginRedirects flags an origin 301 that redirects.md does not carry", () => {
  const inv = "| `/en/company-profile` | Redirect | 301 | no | redirect | → https://www.old.dk/en/firmaprofil |\n| `/wp-admin` | Admin/system | — | no | admin-system | admin-system URL |";
  const red = "| `/en/company-profile` | — | DROPPED | origin 301 |\n| `/wp-admin` | — | DROPPED | admin |";
  const hits = findDroppedOriginRedirects(inv, red);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /company-profile/);
  assert.match(hits[0].why, /\/en\/firmaprofil/);
});

test("findDroppedOriginRedirects passes when the origin 301 is documented as REDIRECTED", () => {
  const inv = "| `/en/company-profile` | Redirect | 301 | no | redirect | → https://www.old.dk/en/firmaprofil |";
  const red = "| `/en/company-profile` | `/en/firmaprofil/` | REDIRECTED | origin 301 kept |";
  assert.deepEqual(findDroppedOriginRedirects(inv, red), []);
});

test("findDroppedOriginRedirects accepts a documented pattern mapping and reports malformed coverage", () => {
  const inv = "| `/old` | redirect | → /new |";
  const pattern = "| `/old` | `/new` | Pattern match | Existing permanent mapping |";
  const malformed = "| `/old` | `/new` | Needs decision | |";
  assert.deepEqual(findDroppedOriginRedirects(inv, pattern), []);
  const hits = findDroppedOriginRedirects(inv, malformed);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /unsupported mapping status/);
});

// ── Check 9: banned marketing phrases ────────────────────────────────────────
test("findBannedCopy flags category-generic filler in a translation value", () => {
  const json = '{\n  "hero": "We deliver world-class solutions",\n  "ok": "We fit boilers in Aarhus"\n}';
  const hits = findBannedCopy(json);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].why, /world-class/);
});

test("findBannedCopy does not flag the phrase inside a key name", () => {
  const json = '{\n  "unlock_label": "Luk op"\n}';
  assert.deepEqual(findBannedCopy(json), []);
});

test("findBannedCopy matches whole words only", () => {
  const json = '{\n  "a": "Vi leverer varme"\n}'; // "leverer" must not trip "leverage"
  assert.deepEqual(findBannedCopy(json), []);
});

// ── Check 10: shared JS budget ───────────────────────────────────────────────
test("findHeavyImages never sends an image with an AI provenance mark to the shrink command", () => {
  const [marked, plain] = findHeavyImages(
    [
      { path: "public/images/hero/generated.webp", bytes: 3 * 1024 * 1024, marked: true },
      { path: "public/images/hero/camera.png", bytes: 2 * 1024 * 1024, marked: false },
    ],
    1000,
  );
  assert.match(marked.why, /generate it again at a smaller size/);
  assert.doesNotMatch(marked.why, /npm run images/);
  assert.match(plain.why, /npm run images -- --write/);
  assert.match(plain.why, /WebP if it needs transparency/);
});

test("findHeavyImages flags only images over the budget, heaviest first, and names the fix", () => {
  const hits = findHeavyImages(
    [
      { path: "public/images/hero/a.jpg", bytes: 400 * 1024 },
      { path: "public/images/hero/b.jpg", bytes: 2 * 1024 * 1024 },
      { path: "public/images/hero/c.png", bytes: 3 * 1024 * 1024 },
      { path: "public/images/hero/edge.jpg", bytes: 1000 * 1024 },
    ],
    1000,
  );
  assert.deepEqual(hits.map((h) => h.path), ["public/images/hero/c.png", "public/images/hero/b.jpg"]);
  assert.match(hits[0].why, /3\.0 MB/);
  assert.match(hits[0].why, /npm run images -- --write/);
  assert.deepEqual(findHeavyImages([], 1000), []);
});

test("sharedJsBudgetHit flags a bundle over budget and passes one under", () => {
  assert.equal(sharedJsBudgetHit(200 * 1024, 150).length, 1);
  assert.deepEqual(sharedJsBudgetHit(131 * 1024, 150), []);
});

const page = (...srcs) => srcs.map((s) => `<script src="${s}"></script>`).join("");

test("sharedScriptSrcs keeps only chunks every route loads", () => {
  assert.deepEqual(
    sharedScriptSrcs([
      page("/_next/a.js", "/_next/b.js", "/_next/home-only.js"),
      page("/_next/a.js", "/_next/b.js", "/_next/contact-only.js"),
    ]),
    ["/_next/a.js", "/_next/b.js"],
  );
});

// The bug this check was written against: the polyfill ships on every route but is
// absent from build-manifest's rootMainFiles, so measuring the manifest under-reported
// by ~39 KB gzipped and returned a PASS on a site that was over budget.
test("sharedScriptSrcs counts a chunk no build manifest lists", () => {
  assert.ok(
    sharedScriptSrcs([page("/_next/a.js", "/_next/polyfill.js"), page("/_next/a.js", "/_next/polyfill.js")])
      .includes("/_next/polyfill.js"),
  );
});

test("sharedScriptSrcs skips nomodule scripts no supported browser downloads", () => {
  const html = '<script src="/_next/a.js"></script><script nomodule src="/_next/legacy.js"></script>';
  assert.deepEqual(sharedScriptSrcs([html, html]), ["/_next/a.js"]);
});

test("sharedScriptSrcs ignores inline scripts and cross-origin sources", () => {
  const html = '<script>window.x=1</script><script src="https://cdn.example/x.js"></script><script src="/_next/a.js"></script>';
  assert.deepEqual(sharedScriptSrcs([html, html]), ["/_next/a.js"]);
});

test("sharedScriptSrcs returns nothing when there are no pages", () => {
  assert.deepEqual(sharedScriptSrcs([]), []);
});

// ── Check 13: unresolved markers in rendered output ──────────────────────────
test("findRenderedPlaceholders flags a marker in visible markup", () => {
  const hits = findRenderedPlaceholders("<p>[NEEDS: effective date from client]</p>", "privacy.html");
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /effective date from client/);
});

// Next embeds the RSC flight payload in script tags, duplicating page text — a naive
// count reported 30 markers where 6 were visible.
test("findRenderedPlaceholders ignores markers inside script payloads", () => {
  const html = '<p>real copy</p><script>self.__next_f.push("[NEEDS: from the flight payload]")</script>';
  assert.deepEqual(findRenderedPlaceholders(html, "page.html"), []);
});

test("findRenderedPlaceholders passes a clean page", () => {
  assert.deepEqual(findRenderedPlaceholders("<p>Vi opbevarer data …</p>", "page.html"), []);
});

// ── placeholdersVisible gate ─────────────────────────────────────────────────
test("placeholdersVisible shows markers in dev and on preview, never on production", () => {
  assert.equal(placeholdersVisible({ NODE_ENV: "development" }), true);
  assert.equal(placeholdersVisible({ NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
  assert.equal(placeholdersVisible({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
});

// A self-hosted production build has no VERCEL_ENV to prove it is a preview, so it must
// fail closed rather than leak internal notes onto a live site.
test("placeholdersVisible fails closed on a production build with no VERCEL_ENV", () => {
  assert.equal(placeholdersVisible({ NODE_ENV: "production" }), false);
});

// ── Check 14: redirect destinations must exist ───────────────────────────────
const PATTERNS = ["/[locale]", "/[locale]/artikler", "/[locale]/artikler/[slug]", "/[locale]/byer", "/[locale]/[by]"];
const FALLBACKS = { "/[locale]/artikler/[slug]": false, "/[locale]/[by]": false };
const PRERENDERED = ["/da", "/da/artikler", "/da/akut-vvs-aalborg"];
const deadTargets = (redirects) =>
  findDeadRedirectTargets(redirects, PRERENDERED, PATTERNS, FALLBACKS, ["da", "en"]);

test("findDeadRedirectTargets flags a destination no route serves", () => {
  const hits = deadTargets([{ source: "/gammel/", destination: "/findes-ikke/noget/" }]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /does not exist in this build/);
});

// The shipped-empty case: the redirect map was built against the planned article set,
// then the section shipped with zero articles.
test("findDeadRedirectTargets flags a destination under a dynamic route that generated nothing", () => {
  const hits = deadTargets([{ source: "/vvs/", destination: "/artikler/en-artikel/" }]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /generated zero pages/);
});

test("findDeadRedirectTargets passes a prerendered destination", () => {
  assert.deepEqual(deadTargets([{ source: "/gammel/", destination: "/artikler/" }]), []);
});

// An on-demand page reading searchParams is absent from every prerender list yet
// perfectly real — treating "not prerendered" as "does not exist" would have failed it.
test("findDeadRedirectTargets passes a server-rendered page that is not prerendered", () => {
  assert.deepEqual(deadTargets([{ source: "/bybjerg/", destination: "/byer/" }]), []);
});

test("findDeadRedirectTargets skips internal, external and param-substituting destinations", () => {
  assert.deepEqual(
    deadTargets([
      { source: "/a/", destination: "/nope/", internal: true },
      { source: "/b/", destination: "https://elsewhere.example/x" },
      { source: "/c/:slug/", destination: "/artikler/:slug/" },
    ]),
    [],
  );
});

// ── Check 1b: class-shaped literals in prose ─────────────────────────────────
const PILL = "rounded" + "-full";

test("findClassShapedLiteralsInProse flags a banned utility named in a comment", () => {
  const hits = findClassShapedLiteralsInProse(`// never use ${PILL} here`);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /scans this file as text/);
});

test("findClassShapedLiteralsInProse flags one named in a design doc", () => {
  const hits = findClassShapedLiteralsInProse(`Avoid #3: the ${PILL} utility is off-brief.`);
  assert.equal(hits.length, 1);
});

test("findClassShapedLiteralsInProse passes prose that describes rather than names", () => {
  assert.deepEqual(findClassShapedLiteralsInProse("Avoid #3: the pill-radius utility is off-brief."), []);
});

// ── Check 15: SVG viewBox aspect vs rendered box ─────────────────────────────
// The exact shape that shipped: a 120x88 viewBox in a 96x96 box scaled 2px strokes
// to 1.6px and letterboxed the art, with nothing in the source looking wrong.
test("findSvgViewBoxAspectMismatch flags a mismatched viewBox and reports the real stroke width", () => {
  const svg = '<svg className="h-24 w-24 text-signal-mark" viewBox="0 0 120 88" strokeWidth="2">';
  const hits = findSvgViewBoxAspectMismatch(svg);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /1\.60px, not 2px/);
});

test("findSvgViewBoxAspectMismatch passes a viewBox matching its box", () => {
  assert.deepEqual(findSvgViewBoxAspectMismatch('<svg className="h-24 w-24" viewBox="0 0 96 96">'), []);
});

test("findSvgViewBoxAspectMismatch passes a non-square viewBox in a matching non-square box", () => {
  assert.deepEqual(findSvgViewBoxAspectMismatch('<svg className="h-20 w-40" viewBox="0 0 240 120">'), []);
});

// h-auto derives height from the aspect ratio, so no mismatch is possible — guessing
// here would fire on every correctly-built plate.
test("findSvgViewBoxAspectMismatch skips sizes it cannot resolve", () => {
  assert.deepEqual(findSvgViewBoxAspectMismatch('<svg className="h-auto w-60" viewBox="0 0 240 160">'), []);
  assert.deepEqual(findSvgViewBoxAspectMismatch('<svg className="h-[7rem] w-24" viewBox="0 0 120 88">'), []);
});

// Asset routes are excluded by shape, not by name — enumerating them one at a time is
// how /og.png and /icon.svg got reported as missing pages when the kit moved its
// social image off Next's opengraph-image convention.
test("isAssetRoute recognises file-serving routes and leaves pages alone", () => {
  for (const p of ["/og.png", "/icon.svg", "/sitemap.xml", "/robots.txt", "/llms.txt", "/manifest.webmanifest"]) {
    assert.equal(isAssetRoute(p), true, p);
  }
  for (const p of ["/", "/kontakt", "/akut-vvs-aalborg", "/artikler/en-artikel"]) {
    assert.equal(isAssetRoute(p), false, p);
  }
});

test("publicRouteOf maps the mirror handler's prerendered routes to the public URLs they serve", () => {
  assert.equal(publicRouteOf("/api/mirror-page"), "/");
  assert.equal(publicRouteOf("/api/mirror-page/kompetencer"), "/kompetencer");
  assert.equal(publicRouteOf("/api/mirror-page/en/kompetencer"), "/en/kompetencer");
  assert.equal(publicRouteOf("/da/kontakt"), "/da/kontakt");
});

test("findSitemapCoverageGaps accepts mirrored pages once mapped to their public route", () => {
  const generated = ["/api/mirror-page", "/api/mirror-page/kompetencer", "/api/mirror-page/en", "/api/mirror-page/en/kompetencer"].map(publicRouteOf);
  const sitemap = ["https://x.dk/", "https://x.dk/kompetencer/", "https://x.dk/en/", "https://x.dk/en/kompetencer/"];
  assert.deepEqual(findSitemapCoverageGaps(generated, sitemap, [], ["da", "en"], new Set(), "da"), []);
});

test("findSitemapCoverageGaps does not demand asset routes appear in the sitemap", () => {
  assert.deepEqual(
    findSitemapCoverageGaps(["/da", "/da/og.png", "/da/icon.svg"], ["https://x.dk/"], [], ["da"]),
    [],
  );
});

// ── Check 22: absolute links to paths this app redirects ─────────────────────
// The shape that shipped: a reference-router page whose primary call to action
// 308'd back to itself, and a homepage citing two of its own pages as external
// "Source:" links. Four review lanes passed it; an SEO auditor found it by hand.
const CFG_22 = `
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www[23]?\\.acme\\.com' }],
        destination: 'https://acme.com/:path*',
        permanent: true,
      },
      { source: '/about.html', destination: '/en/about', permanent: true },
      { source: '/purchase/see', destination: '/en/support/extensions/see', permanent: true },
    ];
  },
};
`;
const SITECFG_22 = 'const SCAFFOLD_DOMAIN = "acme-new.example";';

test("findSelfRedirectingLinks flags an own-host link to a path the app redirects", () => {
  const hits = findSelfRedirectingLinks('<a href="https://acme.com/about.html">Source</a>', CFG_22, SITECFG_22);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /source: '\/about\.html'/);
});

// The whole point of the has: filter. '/:path*' compiles to a regex matching every
// path, so counting the host-conditional www rule would flag every absolute URL in
// the tree — starting with the site's own JSON-LD @id values.
test("unconditionalRedirectSources drops host-conditional rules", () => {
  const srcs = unconditionalRedirectSources(CFG_22);
  assert.equal(srcs.includes("/:path*"), false);
  assert.deepEqual(srcs, ["/about.html", "/purchase/see"]);
});

test("findSelfRedirectingLinks leaves a preserved path on the same host alone", () => {
  // /lang.html is served in place, not redirected — linking to it is the correct
  // way to reach a preserved documentation tree.
  assert.deepEqual(findSelfRedirectingLinks('<a href="https://acme.com/lang.html">Ref</a>', CFG_22, SITECFG_22), []);
});

test("findSelfRedirectingLinks ignores hosts this deployment does not answer for", () => {
  assert.deepEqual(findSelfRedirectingLinks('<a href="https://example.org/about.html">Third party</a>', CFG_22, SITECFG_22), []);
});

test("findSelfRedirectingLinks treats a www variant as the same deployment", () => {
  assert.equal(findSelfRedirectingLinks('<a href="https://www2.acme.com/about.html">x</a>', CFG_22, SITECFG_22).length, 1);
});

test("findSelfRedirectingLinks ignores the query string and fragment when matching", () => {
  assert.equal(findSelfRedirectingLinks('<a href="https://acme.com/about.html?utm=x#team">x</a>', CFG_22, SITECFG_22).length, 1);
});

// Under `trailingSlash: true`, Next adds the trailing slash to every extensionless
// request BEFORE custom redirects run, so a static `source` must carry the slash
// to ever match — and a documented path is written without one. The literal slash
// in the source must not stack on the optional-slash suffix into a mandatory one.
test("sourceToRegExp tolerates a trailing slash baked into a static source (trailingSlash: true)", () => {
  assert.ok(sourceToRegExp("/en/company-profile/").test("/en/company-profile"));
  assert.ok(sourceToRegExp("/en/company-profile/").test("/en/company-profile/"));
});

test("ownHosts reads the canonical host out of an absolute redirect destination", () => {
  assert.equal(ownHosts(CFG_22, SITECFG_22).has("acme.com"), true);
  assert.equal(ownHosts(CFG_22, SITECFG_22).has("acme-new.example"), true);
});

// An unsubstituted placeholder means the scaffolder never learned a domain. Adding
// "{{DOMAIN}}" to the host set would match nothing; asserting it is a host would be
// a lie the next check reads as truth.
test("ownHosts skips an unsubstituted scaffold placeholder", () => {
  assert.deepEqual([...ownHosts("const nextConfig = {};", 'const SCAFFOLD_DOMAIN = "{{DOMAIN}}";')], []);
});

// Degrade to silence, never to noise: with no derivable host the check cannot tell
// "our domain" from "someone else's" and must not guess.
test("findSelfRedirectingLinks reports nothing when no host can be derived", () => {
  assert.deepEqual(
    findSelfRedirectingLinks('<a href="https://acme.com/about.html">x</a>', "const c = {};", 'const SCAFFOLD_DOMAIN = "{{DOMAIN}}";'),
    [],
  );
});

// ── Check 11, direction C: noindex vs sitemap ────────────────────────────────
// This check used to force the defect it should have caught. A real site shipped
// its privacy and cookie pages in the sitemap, with a source comment saying they
// were there "because check 11 fails any generated route absent from the sitemap"
// — the gate overreaching into a decision it did not own, and the builder
// correctly resolving the contradiction in the gate's favour.
const NOINDEX_HTML = '<html><head><meta name="robots" content="noindex, follow"/><title>x</title></head><body>hi</body></html>';
const INDEX_HTML = '<html><head><meta name="robots" content="index, follow"/><title>x</title></head><body>hi</body></html>';

test("findNoindexRoutes reads the robots meta out of rendered HTML", () => {
  const found = findNoindexRoutes(new Map([["/en/privacy", NOINDEX_HTML], ["/en/about", INDEX_HTML]]), ["en"], "en");
  assert.deepEqual([...found], ["en|/privacy"]);
});

// A body mentioning the word must not count — only the head's robots meta ships
// the directive, and prose about SEO is exactly the sort of thing this site has.
test("findNoindexRoutes ignores the word noindex outside the head", () => {
  const html = '<html><head><title>x</title></head><body><p>We set noindex on legal pages.</p></body></html>';
  assert.deepEqual([...findNoindexRoutes(new Map([["/en/blog", html]]), ["en"], "en")], []);
});

// Replicate mode: a mirrored page is prerendered under the mirror handler, so its
// HTML file is keyed /api/mirror-page/<path> while every route this check compares
// against has already been mapped to the public form. Keyed differently, the noindex
// exemption never matches and the check demands a noindex page be advertised.
test("findNoindexRoutes keys a mirrored page by the PUBLIC route it is served at", () => {
  const found = findNoindexRoutes(new Map([["/api/mirror-page/persondatapolitik", NOINDEX_HTML]]), ["da"], "da");
  assert.deepEqual([...found], ["da|/persondatapolitik"]);
});

test("findSitemapCoverageGaps stops demanding a noindex route appear in the sitemap", () => {
  const hits = findSitemapCoverageGaps(["/en", "/en/privacy"], ["https://x.com/en"], [], ["en"], new Set(["en|/privacy"]), "en");
  assert.deepEqual(hits, []);
});

test("findSitemapCoverageGaps flags a noindex route that IS advertised in the sitemap", () => {
  const hits = findSitemapCoverageGaps(
    ["/en", "/en/privacy"], ["https://x.com/en", "https://x.com/en/privacy"], [], ["en"], new Set(["en|/privacy"]), "en",
  );
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /noindex/);
});

// Without the set, behaviour must be exactly what it always was — the noindex
// argument is additive, and a caller that has no build output still gets the
// original both-directions guarantee.
test("findSitemapCoverageGaps keeps its original behaviour when given no noindex set", () => {
  const hits = findSitemapCoverageGaps(["/en", "/en/privacy"], ["https://x.com/en"], [], ["en"]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /generated but absent from the sitemap/);
});

// Check 18 was vacuous for a while because masking treated the "//" in "https://"
// as a line comment and blanked the rest of the line. Check 22 is ALL URLs, so the
// same bug would silence it completely — and silently, since a check that finds
// nothing looks exactly like a check that passes. Pin the masked path explicitly.
test("findSelfRedirectingLinks survives comment-masking and sees URLs inside JSON strings", () => {
  const json = '{\n  "cite": "See https://acme.com/about.html for details",\n  "ok": "https://acme.com/lang.html"\n}';
  const hits = findSelfRedirectingLinks(maskComments(json), CFG_22, SITECFG_22);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

// ── Check 23: hardcoded accessible names on drawn figures ────────────────────
// The localisation rule walks JSX text nodes and steps straight over these,
// because to that walk they look like markup. A diagrammatic brief puts more of
// the site's content here, not less.
test("findHardcodedFigureNames flags a literal SVG title", () => {
  const hits = findHardcodedFigureNames('<svg><title id="t">Public domain badge</title></svg>');
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /Public domain badge/);
});

test("findHardcodedFigureNames flags a literal desc too", () => {
  assert.equal(findHardcodedFigureNames("<svg><desc>An orthographic line drawing.</desc></svg>").length, 1);
});

// A <title> in a .tsx file is not automatically a figure name, and one inside a
// decorative SVG is announced to nobody. Flagging either fails correct code.
test("findHardcodedFigureNames ignores a title outside any svg", () => {
  assert.deepEqual(findHardcodedFigureNames("<title>Not a figure</title>"), []);
});

test("findHardcodedFigureNames ignores a decorative svg", () => {
  assert.deepEqual(findHardcodedFigureNames('<svg aria-hidden="true"><title>Decorative</title></svg>'), []);
  assert.deepEqual(findHardcodedFigureNames('<svg role="presentation"><title>Decorative</title></svg>'), []);
});

// Mixing a literal with an expression still ships the literal half, and testing
// only for "{" let exactly that through.
// The tightening's own false positive: a non-greedy brace strip stops at the first
// inner "}", so a nested next-intl call left ")}" and the check flagged a correctly
// localised figure. Punctuation debris is not copy.
test("findHardcodedFigureNames ignores debris from a nested expression", () => {
  assert.deepEqual(
    findHardcodedFigureNames('<svg><desc id={d}>{t("description", { lines: LINE_COUNT })}</desc></svg>'),
    [],
  );
});

test("findHardcodedFigureNames catches a literal mixed with an expression", () => {
  const hits = findHardcodedFigureNames('<svg><title>Figure {n}: signed affidavits</title></svg>');
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /Figure : signed affidavits/);
});

// A previous <svg> having closed must not make the next element look enclosed.
test("findHardcodedFigureNames does not treat a closed svg as still open", () => {
  assert.deepEqual(findHardcodedFigureNames("<svg><path/></svg>\n<title>Head title</title>"), []);
});

test("findHardcodedFigureNames passes a title fed from next-intl", () => {
  assert.deepEqual(findHardcodedFigureNames('<title id="t">{t("figure.title")}</title>'), []);
  assert.deepEqual(findHardcodedFigureNames('<title id="t">{title}</title>'), []);
});

// An empty element is a different defect (a figure with no accessible name) and
// belongs to the a11y lane; reporting it here would be a second opinion, not a check.
test("findHardcodedFigureNames ignores an empty element", () => {
  assert.deepEqual(findHardcodedFigureNames("<title></title>"), []);
});

// ── Check 24: Tailwind v4 layer defeat ───────────────────────────────────────
// v4 orders layers theme, base, components, utilities — and layer order beats
// specificity AND media queries. Both declarations look correct where written,
// which is why source review never catches this and the author believes it works.
const CSS_WITH_RULES = `
@layer base {
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  :focus-visible { outline: 2px solid var(--accent); transition: none; }
}`;

test("findLayerDefeat flags scroll-smooth against a reduced-motion override", () => {
  const hits = findLayerDefeat('<html className="scroll-smooth">', CSS_WITH_RULES);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /reduced-motion visitor still gets smooth scrolling/);
});

test("findLayerDefeat flags transition-colors against :focus-visible transition:none", () => {
  const hits = findLayerDefeat('<button className="transition-colors duration-120">x</button>', CSS_WITH_RULES);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /outline-color/);
});

test("findLayerDefeat flags transition-all the same way", () => {
  assert.equal(findLayerDefeat('<a className="transition-all">x</a>', CSS_WITH_RULES).length, 1);
});

// A scoped transition names its properties and cannot touch outline-color.
test("findLayerDefeat passes a scoped transition", () => {
  assert.deepEqual(findLayerDefeat('<button className="transition-[background-color,color]">x</button>', CSS_WITH_RULES), []);
});

// The whole point of reading globals.css first: with no base rule there is nothing
// being defeated, and reporting a bug the site does not have is pure noise.
test("findLayerDefeat is silent when globals.css declares neither rule", () => {
  const css = "@layer base { body { margin: 0; } }";
  assert.deepEqual(findLayerDefeat('<html className="scroll-smooth"><button className="transition-colors"/>', css), []);
});

// ── The re-review round: my own fixes, checked ───────────────────────────────
// Both tightenings shipped with a boundary bug, caught by testing the thing
// rather than the diff. A window that spans rule objects, and a lastIndexOf that
// cannot tell an open tag from a closed one, are the same mistake twice.
test("ownHosts does not pair a has: from one rule with a destination: from another", () => {
  const cfg = `
    async redirects() {
      return [
        { source: '/a', has: [{ type: 'host', value: 'old.example' }], destination: '/en/a' },
        { source: '/b', destination: 'https://third-party.example/x' },
      ];
    }`;
  assert.equal([...ownHosts(cfg, "")].includes("third-party.example"), false);
});

test("ownHosts still reads the canonical host off a consolidation rule", () => {
  const cfg = `
    async redirects() {
      return [
        { source: '/:path*', has: [{ type: 'host', value: 'www\\.acme\\.com' }],
          destination: 'https://acme.com/:path*' },
      ];
    }`;
  assert.deepEqual([...ownHosts(cfg, "")], ["acme.com"]);
});

test("isInsideExposedSvg handles self-closing, nesting, hidden ancestors and strings", () => {
  assert.equal(findHardcodedFigureNames('<svg className="x" />\n<title>Head</title>').length, 0);
  assert.equal(findHardcodedFigureNames("<svg><svg><title>Inner figure</title></svg></svg>").length, 1);
  // A hidden wrapper hides everything under it, whatever the child says.
  assert.equal(findHardcodedFigureNames('<svg aria-hidden="true"><svg><title>Inner</title></svg></svg>').length, 0);
  assert.equal(findHardcodedFigureNames('const s = "<svg>";\n<title>Not a figure</title>').length, 0);
});

// The re-review's catches on my own fixes. Each looks like a detail and each one
// silently disabled or inverted a check on the kit's DEFAULT configuration.
test("findHardcodedFigureNames survives an apostrophe in JSX prose", () => {
  // maskNonCode tracked JS string state, so "Don't" opened single-quote mode and
  // blanked every later <svg> — the check returned 0 for the rest of the file and
  // looked exactly like a pass.
  const src = "<p>Don't stop</p><svg><title>Hardcoded figure</title></svg>";
  assert.equal(findHardcodedFigureNames(src).length, 1);
});

test("findHardcodedFigureNames catches non-Latin accessible names", () => {
  assert.equal(findHardcodedFigureNames("<svg><title>公開情報</title></svg>").length, 1);
  assert.equal(findHardcodedFigureNames("<svg><desc>معلومات عامة</desc></svg>").length, 1);
});

test("ownHosts finds the rule brace past a nested object", () => {
  const cfg = `async redirects() { return [
    { source: '/:p*', missing: [{ type: 'header', key: 'x' }],
      has: [{ type: 'host', value: 'www.acme.com' }],
      destination: 'https://acme.com/:p*' } ]; }`;
  assert.deepEqual([...ownHosts(cfg, "")], ["acme.com"]);
});

test("ownHosts reads the env-derived domain the template actually uses", () => {
  // Most scaffolds never substitute {{DOMAIN}} — the scaffolder stopped prompting
  // for one — so the literal is absent and the env var is the real answer.
  const prev = process.env.NEXT_PUBLIC_SITE_DOMAIN;
  process.env.NEXT_PUBLIC_SITE_DOMAIN = "acme.com";
  try {
    assert.equal([...ownHosts("const c = {};", 'const SCAFFOLD_DOMAIN = "{{DOMAIN}}";')].includes("acme.com"), true);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_DOMAIN;
    else process.env.NEXT_PUBLIC_SITE_DOMAIN = prev;
  }
});

// ── Check 11: locale identity ────────────────────────────────────────────────
// The collapse: normalizeRoutePath strips the locale, so /en/about and /da/about
// both became /about and a sitemap listing only one satisfied both. An entire
// locale could be missing with the gate green.
test("findSitemapCoverageGaps catches an entire locale missing from the sitemap", () => {
  const hits = findSitemapCoverageGaps(
    ["/en/about", "/da/about"], ["https://x.com/da/about"], [], ["en", "da"], new Set(), "en",
  );
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /en \/about/);
});

test("findSitemapCoverageGaps passes when every locale is listed", () => {
  assert.deepEqual(
    findSitemapCoverageGaps(
      ["/en/about", "/da/about"],
      ["https://x.com/en/about", "https://x.com/da/about"],
      [], ["en", "da"], new Set(), "en",
    ),
    [],
  );
});

// localePrefix: "as-needed" leaves the DEFAULT locale unprefixed, so /about and
// /en/about are the same page. Keying on the raw prefix would report every
// default-locale route as missing on the most common configuration there is.
test("localeKeyOf treats an unprefixed path as the default locale", () => {
  assert.equal(localeKeyOf("/about", ["en", "da"], "en"), localeKeyOf("/en/about", ["en", "da"], "en"));
  assert.notEqual(localeKeyOf("/da/about", ["en", "da"], "en"), localeKeyOf("/about", ["en", "da"], "en"));
});

test("findSitemapCoverageGaps accepts an as-needed sitemap", () => {
  assert.deepEqual(
    findSitemapCoverageGaps(
      ["/about", "/da/about"], ["https://x.com/about", "https://x.com/da/about"],
      [], ["en", "da"], new Set(), "en",
    ),
    [],
  );
});

// One locale's noindex must not exempt the others' copies of the same page.
test("noindex in one locale does not exempt another locale", () => {
  const hits = findSitemapCoverageGaps(
    ["/en/privacy", "/da/privacy"], ["https://x.com/en/privacy"],
    [], ["en", "da"], new Set(["en|/privacy"]), "en",
  );
  assert.equal(hits.length, 2, "da/privacy missing from sitemap AND en/privacy advertised while noindex");
});

// ── Checks 9/19 in replicate mode: the client's own words are exempt ────────

test("findBannedCopy exempts a value that appears verbatim in the crawl corpus", () => {
  const corpus = { text: "we are the leading provider of boilers in aarhus", meta: new Set(), pages: 1 };
  const json = '{\n  "hero": "We are the leading provider of boilers in Aarhus",\n  "invented": "A seamless experience"\n}';
  const hits = findBannedCopy(json, undefined, { exemptCorpus: corpus });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
  assert.match(hits[0].why, /seamless/);
});

test("findBannedCopy exemption survives ICU escaping and JSON escaping in the message value", () => {
  const corpus = { text: "we're the \"one-stop shop\" for heating", meta: new Set(), pages: 1 };
  const json = '{\n  "hero": "We\'\'re the \\"one-stop shop\\" for heating"\n}';
  assert.deepEqual(findBannedCopy(json, undefined, { exemptCorpus: corpus }), []);
});

test("findBannedCopy without a corpus behaves exactly as before", () => {
  const json = '{\n  "hero": "We are the leading provider of boilers"\n}';
  assert.equal(findBannedCopy(json).length, 1);
  assert.equal(findBannedCopy(json, undefined, {}).length, 1);
});

// Check 20 (cleared-namespace utilities) judges by diffing source classes against
// the compiled stylesheet, so it can only be trusted when the stylesheet is at
// least as new as every file it scans. Three states, three answers.
test("builtCssFreshness: no built CSS means the check cannot run", () => {
  const r = builtCssFreshness({ cssMtimes: [], sources: [{ path: "src/a.tsx", mtimeMs: 10 }] });
  assert.equal(r.state, "no-build");
});

test("builtCssFreshness: a source newer than the newest stylesheet makes the build stale", () => {
  const r = builtCssFreshness({
    cssMtimes: [100, 120],
    sources: [{ path: "src/old.tsx", mtimeMs: 50 }, { path: "src/new.tsx", mtimeMs: 130 }],
  });
  assert.equal(r.state, "stale");
  assert.deepEqual(r.stale, ["src/new.tsx"]);
});

test("builtCssFreshness: a stylesheet newer than every source is fresh", () => {
  const r = builtCssFreshness({ cssMtimes: [200], sources: [{ path: "src/a.tsx", mtimeMs: 130 }] });
  assert.equal(r.state, "fresh");
  assert.deepEqual(r.stale, []);
});

const RING_CSS = "@layer base { :where(a, button):focus-visible { outline: 2px solid var(--focus); } }";

test("findFocusRingTransition: transition-colors on a focusable element animates the base-layer ring", () => {
  const hits = findFocusRingTransition('<a className="text-ink transition-colors hover:text-accent">x</a>', RING_CSS);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /outline-color/);
});

test("findFocusRingTransition: an explicit property list omitting outline-color is the fix, not a hit", () => {
  assert.deepEqual(
    findFocusRingTransition('<a className="transition-[color,background-color,border-color]">x</a>', RING_CSS),
    [],
  );
});

test("findFocusRingTransition: skips when globals.css declares no focus ring to animate", () => {
  assert.deepEqual(findFocusRingTransition('<a className="transition-colors">x</a>', "@layer base { a { color: red; } }"), []);
  assert.deepEqual(findFocusRingTransition('<a className="transition-colors">x</a>', ""), []);
});

test("findFocusRingTransition: a non-focusable wrapper is noise, not a finding", () => {
  assert.deepEqual(findFocusRingTransition('<div className="p-4 transition-colors">x</div>', RING_CSS), []);
});

test("findFocusRingTransition: an unattributable shared class const is reported, not skipped", () => {
  // The shape that actually ships: one BASE string reused by every button in the file.
  // There is no enclosing tag to attribute it to, and skipping would miss the real case.
  const hits = findFocusRingTransition(
    'const BASE = "inline-flex min-h-11 items-center px-6 py-4 font-semibold transition-colors";',
    RING_CSS,
  );
  assert.equal(hits.length, 1);
});

test("findFocusRingTransition: flags every focusable element that carries it, not just the first", () => {
  const hits = findFocusRingTransition(
    '<a className="transition-colors">a</a><button className="transition-colors">b</button>',
    RING_CSS,
  );
  assert.equal(hits.length, 2);
});

// A builder wrote an IMAGE_SLOTS usage constraint into a translation value and
// it rendered as public body copy at 65% scroll on a service page. Nothing
// mechanical could see it: the JSON is valid, the key is real, the string is
// prose. Only the customer lane caught it, hours later, on the rendered page.
// These are words that are never customer copy.
test("findProductionNotes catches the note that shipped as body copy", () => {
  const leaked = JSON.stringify({
    intro: "Vi bygger tage på hele Fyn.",
    qualityNote:
      "De tre erhvervsfotos her er autentiske kilder på 600 × 336 px og allerede AI-opskaleret én gang. Vi bruger dem kun i små plader; originalfiler i højere opløsning ville være bedre.",
  });
  const hits = findProductionNotes(leaked);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /qualityNote/);
});

test("findProductionNotes leaves ordinary customer copy alone", () => {
  const clean = JSON.stringify({
    hero: "Tømrer med fokus på høj kvalitet",
    body: "Vi udskifter vinduer i mål fra Outline, Rationel, STM og KPK. Ring på 65 35 21 66.",
    price: "Prisen afhænger af opgaven og materialerne.",
    dims: "Vi bygger carporte i 3 x 6 meter og derover.",
  });
  assert.deepEqual(findProductionNotes(clean), []);
});

test("findProductionNotes reports each offending key once, with the marker named", () => {
  const two = JSON.stringify({ a: "kilde: originalfil mangler", b: "TODO: skriv rigtig tekst", c: "fin tekst" });
  const hits = findProductionNotes(two);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => typeof h.line === "number" && h.line > 0));
});

test("findProductionNotes leaves pixel dimensions alone where they are the product", () => {
  // A real site in the fleet sells advertising slots; "Forside 980 × 200 px" is
  // what the customer is buying. px alone must never be enough.
  const ads = JSON.stringify({
    rows: { frontPage: { name: "Forside 980 × 200 px", price: "3.500 kr." } },
    adSlotFormat: "Alle bannere leveres som 980 x 200 px JPG eller PNG.",
  });
  assert.deepEqual(findProductionNotes(ads), []);
});
