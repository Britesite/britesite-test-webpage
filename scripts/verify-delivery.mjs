// Delivery-boundary verifier — "render it, curl it, diff it across variants".
//
// Most SEO defects are a gap between a declared intention (in source) and the
// delivered artifact (the rendered <head>, the actual PNG, the HTTP status) on a
// surface no human looks at. This script checks the DELIVERED artifact, not the
// source, against a RUNNING server.
//
// Two altitudes:
//   default  — cheap checks that `next dev` renders accurately. Front-runs the
//              Step 8 SEO loop against the already-running dev server.
//   --full   — adds checks that only a production build answers truthfully
//              (real 404s, og:image bytes, sitemap/robots reachability, and
//              scripts/verify-third-party.mjs: no third-party or proxied request,
//              frame, cookie or web storage before consent; every facade loads
//              inside the CSP). Run
//              against `next build && next start` at the Step 10 gate.
//
// Usage: node --experimental-strip-types scripts/verify-delivery.mjs [BASE_URL] [--full]
//   BASE_URL defaults to http://localhost:3000
//
// Exit 0 = pass (warnings allowed), 1 = at least one failure.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "../src/lib/seo/constants.ts";
import { readPipelineMode } from "./pipeline-mode.mjs";
import { loadCrawlCorpus, normalizeCopy } from "./crawl-corpus.mjs";
import { parseHead } from "./head-meta.mjs";
import { mirrorPaths, proxiedRoutes, readAllowList, readConsentPurposes, verifyThirdParty } from "./verify-third-party.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Replicate mode (see .redesign-state/README.md): the rendered page is a faithful
 *  clone, so two checks change altitude. (1) A <title>/description over the length
 *  limit is a warning, not a failure, when it is the ORIGINAL's value verbatim — a
 *  builder composing a long one still fails. (2) The orphan-route check warns
 *  instead of failing: a site that links its secondary pages only from the nav
 *  is being reproduced as it is, and demanding an editorial link would change it. */
const MODE = readPipelineMode(root);
const ORIGINAL_META = MODE === "replicate" ? loadCrawlCorpus(root).meta : new Set();
// `title`/`description` are decoded once at extraction (see readHead), so the
// crawl's unescaped value and the rendered one are directly comparable here.
const isOriginalMeta = (s) => ORIGINAL_META.has(normalizeCopy(s));
const args = process.argv.slice(2);
const FULL = args.includes("--full");
const BASE = (args.find((a) => a.startsWith("http")) ?? "http://localhost:3000").replace(/\/$/, "");
/** Pre-launch runs point at a dev server, where a placeholder canonical is the
 *  documented expected state rather than a defect. */
const baseIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(BASE);

const fails = [];
const warns = [];
let passes = 0;
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);
const pass = () => passes++;
const isMarker = (s) => typeof s === "string" && s.includes("[NEEDS:");

// ── Project config (read from source so the verifier matches the app) ──────────
function readRouting() {
  const txt = readFileSync(resolve(root, "src/i18n/routing.ts"), "utf8");
  const locales = [...(txt.match(/locales:\s*\[([^\]]*)\]/)?.[1] ?? "")
    .matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const defaultLocale = txt.match(/defaultLocale:\s*['"]([^'"]+)['"]/)?.[1] ?? locales[0];
  return { locales, defaultLocale };
}
const { locales, defaultLocale } = readRouting();

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const body = res.headers.get("content-type")?.includes("image/") ? null : await res.text();
  return { status: res.status, headers: res.headers, body };
}
/**
 * Final status after following redirects.
 *
 * `get()` deliberately does not follow, because a canonical or og:image must itself
 * be the 200 — a redirect there is the defect. But "does a bad slug 404?" is a
 * question about the END of the chain: with `trailingSlash: true` every slash-less
 * URL 308s first, and with `localePrefix: "never"` a `/<locale>/…` probe 307s to the
 * unprefixed form. Judging the first hop reports a correct site as a soft-404 and
 * makes the verifier's own self-calibration fail. A genuine soft-404 still fails
 * here, because it returns 200 at the end of the chain.
 */
async function getFollowed(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "follow" });
  return { status: res.status, url: res.url };
}
function toLocalPath(absUrl) {
  try {
    return new URL(absUrl).pathname;
  } catch {
    return absUrl;
  }
}

// ── <head> parsing (regex — no DOM dependency) ──────────────────────────────────
/** Disallow prefixes that apply to every crawler (the `User-agent: *` group). */
export function wildcardDisallows(robotsTxt) {
  const out = [];
  let inWildcard = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    // Consecutive User-agent lines share one group, so do not reset on each.
    if (key === "user-agent") { inWildcard = val === "*"; continue; }
    if (inWildcard && key === "disallow" && val) out.push(val);
  }
  return out;
}

/** Stylesheet and script URLs the page needs in order to render as designed. */
export function renderCriticalAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi)) out.add(m[1]);
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) out.add(m[1]);
  return [...out].filter((u) => u.startsWith("/"));
}

/** Hosts that can never resolve. RFC 2606 / 6761 reserve these for documentation
 *  and testing, so a canonical pointing at one is unreachable by construction. */
const RESERVED_TLDS = [".example", ".invalid", ".test", ".localhost"];
export function isUnresolvableHost(host) {
  const h = (host || "").toLowerCase().split(":")[0];
  return RESERVED_TLDS.some((t) => h === t.slice(1) || h.endsWith(t));
}

/** `/en` or `/` — the homepage for a locale, which the wordmark always links. */
function localeRoot(path) {
  const p = path.replace(/\/+$/, "");
  return p === "" || p === "/" || locales.some((l) => p === `/${l}`);
}

function localeOf(path) {
  const seg = path.split("/").filter(Boolean)[0];
  return locales.includes(seg) ? seg : defaultLocale;
}
function logicalRoute(path) {
  const seg = path.split("/").filter(Boolean);
  return locales.includes(seg[0]) ? "/" + seg.slice(1).join("/") : path;
}

// ── 1. Message-key locale parity (a file check — catches "key in en, missing in da") ──
function flatten(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") keys.push(...flatten(v, key));
    else keys.push(key);
  }
  return keys;
}
function checkMessageParity() {
  const dir = resolve(root, "messages");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const keysets = files.map((f) => ({
    f,
    keys: new Set(flatten(JSON.parse(readFileSync(resolve(dir, f), "utf8")))),
  }));
  const union = new Set(keysets.flatMap((k) => [...k.keys]));
  for (const { f, keys } of keysets) {
    const missing = [...union].filter((k) => !keys.has(k));
    if (missing.length) fail(`message parity: ${f} is missing ${missing.length} key(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
    else pass();
  }
}

// ── 2. Per-page head checks (cheap, dev-accurate) ───────────────────────────────
/** Internal paths linked from inside a page's <main>.
 *
 *  Scoped to <main> on purpose: the header and footer link every route from every
 *  page, so counting them would make every route look well-linked and the check
 *  would be unable to fail. What matters is EDITORIAL linking — one page citing
 *  another because the content leads there — which is what carries context, and
 *  what a site plan means when it specifies a link graph. */
export function mainLinks(html) {
  const open = html.search(/<main[\s>]/i);
  if (open === -1) return null;                       // no landmark: caller decides
  const close = html.toLowerCase().lastIndexOf("</main>");
  const scope = html.slice(open, close === -1 ? html.length : close);
  const out = new Set();
  for (const m of scope.matchAll(/href="(\/[^"#?]*)/g)) {
    let p = m[1].replace(/\/+$/, "");
    out.add(p === "" ? "/" : p);
  }
  return out;
}

async function checkPages(paths) {
  const byRoute = {};
  const outbound = new Map();     // path -> Set of internal paths linked from <main>
  const noMain = [];
  for (const path of paths) {
    const { status, body } = await get(path);
    if (status !== 200 || !body) {
      fail(`page ${path}: expected 200 with HTML, got ${status}`);
      continue;
    }
    const h = parseHead(body);
    const loc = localeOf(path);

    // canonical present + self-referential + locale-correct
    if (!h.canonical) fail(`page ${path}: no canonical`);
    else {
      const cpath = toLocalPath(h.canonical);
      if (cpath !== path) fail(`page ${path}: canonical points elsewhere (${cpath})`);
      else if (localeOf(cpath) !== loc) fail(`page ${path}: canonical locale mismatch (${cpath})`);
      else pass();
      // toLocalPath keeps only the pathname, so a canonical on a scaffold domain
      // matched a real origin perfectly. Pre-launch that placeholder is correct and
      // deliberate — against localhost this stays silent. Once the verifier is
      // pointed at a real origin it is a launch-destroying defect: every page
      // declaring a canonical on a host that cannot resolve is the standard way to
      // deindex a site wholesale, and it is invisible until it has happened.
      if (!baseIsLocal) {
        let chost = "";
        try { chost = new URL(h.canonical).host; } catch { /* relative — already failed above */ }
        const expected = new URL(BASE).host;
        if (chost && isUnresolvableHost(chost)) {
          fail(`page ${path}: canonical host "${chost}" is a reserved TLD and can never resolve, but the verifier is running against a real origin (${BASE}). Set NEXT_PUBLIC_SITE_DOMAIN before deploying.`);
        } else if (chost && chost.toLowerCase().replace(/^www\./, "") !== expected.toLowerCase().replace(/^www\./, "")) {
          // Checking only for reserved TLDs left the worse case wide open: a
          // canonical on ANY resolving host passed, so a page could hand itself to
          // an unrelated domain and the gate stayed green. Search engines honour
          // that, so the consequence is the real site consolidating into someone
          // else's property. Cross-domain canonicalisation is occasionally
          // deliberate — it is never something to infer from silence.
          fail(`page ${path}: canonical host "${chost}" is not the origin being verified (${expected}). If this cross-domain canonical is deliberate, verify against that origin instead; otherwise every page here is being handed to another property.`);
        } else if (chost) pass();
      }
    }

    // og:locale present
    if (!h.ogLocale) fail(`page ${path}: no og:locale`);
    else pass();

    // hreflang present incl. x-default
    if (!h.hreflang["x-default"]) fail(`page ${path}: hreflang missing x-default`);
    else if (!locales.every((l) => h.hreflang[l])) fail(`page ${path}: hreflang missing a locale`);
    else pass();

    // title length (composed, as rendered) — skip placeholders
    if (!h.title) fail(`page ${path}: no <title>`);
    else if (isMarker(h.title)) warn(`page ${path}: title is a [NEEDS:] placeholder (content pending)`);
    else if (h.title.length > TITLE_MAX_LENGTH) {
      if (isOriginalMeta(h.title)) warn(`page ${path}: title ${h.title.length} > ${TITLE_MAX_LENGTH} chars — the original's own <title>, reproduced verbatim (replicate mode); search engines will truncate it as they did before`);
      else fail(`page ${path}: composed title ${h.title.length} > ${TITLE_MAX_LENGTH} chars`);
    } else pass();

    // description length — skip placeholders
    if (!h.description) warn(`page ${path}: no meta description`);
    else if (isMarker(h.description)) warn(`page ${path}: description is a [NEEDS:] placeholder (content pending)`);
    else if (h.description.length < DESCRIPTION_MIN_LENGTH || h.description.length > DESCRIPTION_MAX_LENGTH) {
      if (isOriginalMeta(h.description)) warn(`page ${path}: description ${h.description.length} chars outside ${DESCRIPTION_MIN_LENGTH}–${DESCRIPTION_MAX_LENGTH} — the original's own value, reproduced verbatim (replicate mode)`);
      else fail(`page ${path}: description ${h.description.length} chars outside ${DESCRIPTION_MIN_LENGTH}–${DESCRIPTION_MAX_LENGTH}`);
    } else pass();

    // <main> landmark + the editorial links inside it
    const links = mainLinks(body);
    if (links === null) {
      fail(`page ${path}: no <main> landmark — screen-reader users get no "skip to content" target, and the page's editorial links cannot be told apart from the site chrome`);
      noMain.push(path);
    } else {
      pass();
      outbound.set(path, links);
    }

    (byRoute[logicalRoute(path)] ??= []).push({ path, loc, h });
  }

  // ── Orphan routes: in the sitemap, linked from no other page's <main> ──────
  //
  // A route reachable only through the header and footer is advertised but never
  // *led to*. Crawlers read a link's surrounding text as the strongest signal of
  // what the target is about, and a site plan that specifies a link graph is
  // specifying exactly this. Nothing checked it, so on a real run three routes
  // shipped with zero editorial inbound — including the page the homepage's
  // central evidence section was built to support.
  //
  // Requires every page to have a <main>: a page without one contributes no
  // outbound links, which would invent orphans elsewhere. Skip rather than guess.
  if (noMain.length) {
    warn(`orphan-route check skipped — ${noMain.length} page(s) have no <main>, so their outbound links cannot be scoped (${noMain.slice(0, 3).join(", ")}${noMain.length > 3 ? ", …" : ""})`);
  } else if (outbound.size > 1) {
    const inbound = new Map([...outbound.keys()].map((p) => [p, 0]));
    for (const [from, links] of outbound) {
      for (const to of links) {
        if (to !== from && inbound.has(to)) inbound.set(to, inbound.get(to) + 1);
      }
    }
    for (const [path, count] of inbound) {
      // The homepage is every site's root and is linked by the wordmark; it is
      // never an orphan in the sense that matters.
      if (count > 0 || localeRoot(path)) { pass(); continue; }
      // A legal or utility page whose only inbound is the global footer is CORRECT
      // — that is where a reader looks for it, and demanding an editorial link into
      // a cookie policy would turn a house preference into a publish blocker. The
      // check keeps its teeth on content routes, where "nothing leads a reader
      // here" is a real defect, and drops to a warning on these.
      // logicalRoute strips the locale. Testing the raw path meant the downgrade
      // never fired on the template's DEFAULT configuration, where every URL is
      // /en/privacy — the fix was inert exactly where it was needed.
      if (/^\/(privacy|cookies?|terms|legal|imprint|impressum|accessibility|disclaimer)(\/|$)/.test(logicalRoute(path))) {
        warn(`page ${path}: no editorial inbound link — expected for a legal/utility route reached from the footer, noted rather than failed`);
        continue;
      }
      if (MODE === "replicate") {
        warn(`page ${path}: no editorial inbound link — the original links it only from the nav, reproduced as-is (replicate mode)`);
        continue;
      }
      fail(`page ${path}: no other page links to it from inside <main> — it is in the sitemap and reachable from the nav, but nothing on the site leads a reader there`);
    }
  }

  // cross-locale diff: values that MUST differ across locales actually do
  for (const [route, pages] of Object.entries(byRoute)) {
    if (pages.length < 2) continue;
    const canonicals = new Set(pages.map((p) => p.h.canonical));
    if (canonicals.size !== pages.length) fail(`route ${route}: canonical not unique per locale (frozen value)`);
    else pass();
    const ogLocales = new Set(pages.map((p) => p.h.ogLocale));
    if (ogLocales.size !== pages.length) fail(`route ${route}: og:locale not unique per locale (frozen value)`);
    else pass();
  }
}

// ── Route discovery from the live sitemap ───────────────────────────────────────
async function sitemapPaths() {
  const { status, body } = await get("/sitemap.xml");
  if (status !== 200 || !body) {
    fail(`/sitemap.xml: expected 200, got ${status}`);
    return [];
  }
  pass();
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => toLocalPath(m[1]));
}

// ── 3. Full-mode checks (need a production build) ────────────────────────────────
function pngSize(buf) {
  // PNG IHDR: 8-byte signature, then length(4)+"IHDR"(4)+width(4)+height(4).
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
/** The default-locale homepage as the sitemap advertises it. In replicate mode the
 *  original's URLs are kept, so `/<defaultLocale>` need not exist; the sitemap's
 *  first default-locale path is the one URL every mode guarantees. */
let HOME_PATH = `/${defaultLocale}`;
function resolveHomePath(paths) {
  const home = paths.find((p) => localeOf(p) === defaultLocale && (localeRoot(p) || logicalRoute(p) === "/")) ?? paths.find((p) => localeOf(p) === defaultLocale);
  if (home) HOME_PATH = home;
}
async function checkFull(paths) {
  // Nothing third-party and nothing stored on the device before the visitor asks
  // (Reject keeps it that way), and every facade loads inside the CSP once asked.
  // Mirrored pages the sitemap omits (noindex) are included.
  {
    const { allow, errors } = readAllowList(root);
    for (const e of errors) fail(e);
    const all = [...new Set([...paths, ...mirrorPaths(root)])];
    const { fails: tpFails, passes: tpPasses } = await verifyThirdParty({ base: BASE, paths: all, allow, proxied: proxiedRoutes(root), purposes: readConsentPurposes(root) });
    for (const f of tpFails) fail(`third-party: ${f}`);
    passes += tpPasses;
  }

  // self-calibration: the verifier must be able to tell 200 from 404
  const good = await getFollowed(HOME_PATH);
  const bad = await getFollowed(`/${defaultLocale}/__verify_nonexistent__`);
  if (good.status === 200 && bad.status === 404) pass();
  else fail(`self-calibration failed: known-good=${good.status} (want 200), known-bad=${bad.status} (want 404) — verifier cannot trust its own status reads`);

  // robots reachable at its canonical URL
  const robots = await get("/robots.txt");
  if (robots.status === 200) pass();
  else fail(`/robots.txt: expected 200, got ${robots.status} (proxy may be locale-prefixing it)`);

  // bad slug under a VALID locale → real 404 (not a soft 200)
  if (bad.status === 404) pass();
  else fail(`bad slug /${defaultLocale}/__verify_nonexistent__ returned ${bad.status}, not 404 (soft-404)`);

  // og:image resolves at the declared dimensions
  const sample = paths.find((p) => localeOf(p) === defaultLocale) ?? paths[0];
  if (sample) {
    const { body } = await get(sample);
    const h = body ? parseHead(body) : {};
    if (!h.ogImage) warn(`${sample}: no og:image to verify`);
    else {
      const imgPath = toLocalPath(h.ogImage);
      const res = await fetch(`${BASE}${imgPath}`, { redirect: "manual" });
      if (res.status !== 200) fail(`og:image ${imgPath}: expected 200, got ${res.status}`);
      else if (!res.headers.get("content-type")?.startsWith("image/")) fail(`og:image ${imgPath}: not an image (${res.headers.get("content-type")})`);
      else {
        const buf = Buffer.from(await res.arrayBuffer());
        const size = pngSize(buf);
        const wantW = Number(h.ogImageW), wantH = Number(h.ogImageH);
        if (size && wantW && wantH && (size.w !== wantW || size.h !== wantH))
          fail(`og:image ${imgPath}: rendered ${size.w}×${size.h} but meta declares ${wantW}×${wantH}`);
        else pass();
      }
    }
  }
}

/** robots.txt must not block what the page needs in order to render.
 *
 *  Deliberately NOT inside checkFull. Google crawls and then RENDERS, and it does
 *  not fetch a robots-blocked resource during render — so blocking the directory
 *  the stylesheet lives in makes every page render unstyled to the crawler while
 *  looking perfect in a browser. The template shipped `Disallow: /_next/` for a
 *  long time, which is exactly where Next puts every stylesheet, script and font;
 *  that was true of every site the kit had ever built and nothing looked at it.
 *  A defect that severe and that invisible does not belong behind an opt-in flag,
 *  and it costs two requests. */
async function checkRobotsAssets() {
  const robots = await get("/robots.txt");
  if (robots.status !== 200) return;          // reachability is checkFull's to report
  const blocked = wildcardDisallows(robots.body || "");
  const home = await get(HOME_PATH);
  const assets = renderCriticalAssets(home.body || "");
  if (!assets.length) {
    warn("robots vs assets: no stylesheet or script found on the homepage to check");
    return;
  }
  const hits = assets.filter((a) => blocked.some((d) => a.startsWith(d)));
  if (!hits.length) {
    pass();
    return;
  }
  const rule = blocked.find((d) => hits[0].startsWith(d));
  fail(
    `/robots.txt disallows ${hits.length} render-critical asset(s) for all crawlers — ` +
      `e.g. ${hits[0]} matches "Disallow: ${rule}". Google renders pages before judging ` +
      `them and will not fetch a blocked resource, so it sees the site unstyled.`,
  );
}

/** The site must ship *an* icon.
 *
 *  The template deliberately ships none, so this is absence-by-default rather
 *  than a wrong-file problem, and absence is invisible from the source tree —
 *  there is no wrong icon to notice, just nothing where one should be. Google
 *  puts the favicon beside every result and every browser tab shows it, so a
 *  site with none reads as unfinished exactly when a buyer is deciding.
 *
 *  Next emits the <link rel="icon"> automatically once `src/app/icon.*` or
 *  `favicon.ico` exists, so checking the rendered head catches every route Next
 *  supports without having to guess filenames. */
async function checkFavicon() {
  const home = await get(HOME_PATH);
  const declared = /<link[^>]*\brel="(?:shortcut )?icon"/i.test(home.body || "");
  if (declared) {
    pass();
    return;
  }
  const ico = await get("/favicon.ico");
  if (ico.status === 200) {
    pass();
    return;
  }
  fail(
    "no favicon: the rendered <head> declares no rel=\"icon\" and /favicon.ico is " +
      `${ico.status}. Add src/app/icon.svg or src/app/favicon.ico — Next wires the ` +
      "link tag automatically. Derive it from the brand mark, do not ship the " +
      "create-next-app default.",
  );
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`verify-delivery → ${BASE} (${FULL ? "full" : "cheap"} mode), locales=[${locales.join(",")}] default=${defaultLocale}${MODE !== "redesign" ? `, pipeline mode=${MODE}` : ""}`);
checkMessageParity();
const paths = await sitemapPaths();
resolveHomePath(paths);
if (paths.length) await checkPages(paths);
else warn("no sitemap paths discovered — page checks skipped");
await checkRobotsAssets();
await checkFavicon();
if (FULL) await checkFull(paths);

console.log(`\n  ${passes} passed, ${warns.length} warning(s), ${fails.length} failure(s)`);
for (const w of warns) console.log(`  ⚠︎  ${w}`);
for (const f of fails) console.log(`  ✘  ${f}`);
if (fails.length) {
  console.log(`\nFAILED — ${fails.length} delivery-boundary defect(s).`);
  process.exit(1);
}
console.log(`\nPASS — delivery boundary clean${warns.length ? ` (${warns.length} content placeholder warning(s))` : ""}.`);
