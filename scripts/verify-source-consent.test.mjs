import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  siteConsentPurposes,
  trackerPurposesInSource,
  findCookieInventoryGaps,
  nonLiteralScriptSrcs,
} from "./verify-source.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-source.mjs");
const DECL = (list) => `export const SITE_CONSENT_PURPOSES: readonly ConsentPurpose[] = [${list.map((p) => `"${p}"`).join(", ")}];\n`;
const LAYOUT_WITH_BANNER = "export default function L({children}){return <body>{children}<footer><CookieSettingsButton /></footer><CookieConsent /><AnalyticsGate /></body>;}\n";

function site(files) {
  const root = mkdtempSync(join(tmpdir(), "vs-consent-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const run = () => spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SITE_DOMAIN: "" } });
  return { root, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("siteConsentPurposes reads the declared list, and null when it cannot", () => {
  assert.deepEqual([...siteConsentPurposes(DECL([]))], []);
  assert.deepEqual([...siteConsentPurposes(DECL(["analytics", "marketing"]))], ["analytics", "marketing"]);
  assert.equal(siteConsentPurposes("export const SITE_CONSENT_PURPOSES = buildList();"), null);
});

test("trackerPurposesInSource names the purpose each tracker serves", () => {
  const src = [
    'import { trackWithConsent } from "@/lib/analytics";',
    'export const A = () => <button onClick={() => trackWithConsent("cta_click")} />;',
    'const px = "https://connect.facebook.net/en_US/fbevents.js";',
    'const ga = "https://www.googletagmanager.com/gtag/js?id=G-1";',
  ].join("\n");
  const hits = trackerPurposesInSource(src).map((h) => [h.purpose, h.line]);
  assert.deepEqual(hits, [["analytics", 2], ["marketing", 3], ["analytics", 4]]);
});

test("trackerPurposesInSource ignores comments and plain words", () => {
  assert.deepEqual(trackerPurposesInSource("// call trackWithConsent( here\nconst s = 'our analytics team';"), []);
});

test("findCookieInventoryGaps: no banner means the policy lists NEXT_LOCALE and never the consent cookie", () => {
  assert.deepEqual(findCookieInventoryGaps("Vi bruger kun NEXT_LOCALE, som er nødvendig.", false), []);
  const hits = findCookieInventoryGaps("NEXT_LOCALE og cookie-consent", false);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /cookie-consent.*no consent purposes/);
});

test("findCookieInventoryGaps: a banner means the policy lists the consent cookie too", () => {
  assert.match(findCookieInventoryGaps("Only NEXT_LOCALE.", true)[0].why, /cookie-consent/);
  assert.deepEqual(findCookieInventoryGaps("NEXT_LOCALE and cookie-consent", true), []);
});

test("findCookieInventoryGaps: an inventory without the framework cookie is incomplete; no inventory is not judged", () => {
  assert.match(findCookieInventoryGaps("cookie-consent stores your choice", true)[0].why, /NEXT_LOCALE/);
  assert.deepEqual(findCookieInventoryGaps("Cookie Settings", true), []);
});

test("verify-source fails a tracker used for a purpose the site does not declare", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/components/Cta.tsx": 'export const C = () => <a onClick={() => trackWithConsent("cta_click")} />;\n',
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /src\/components\/Cta\.tsx:1 — .*"analytics".*SITE_CONSENT_PURPOSES/);
  } finally { s.done(); }
});

test("verify-source fails Vercel Analytics rendered outside the consent gate", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": 'import { Analytics } from "@vercel/analytics/next";\n' + LAYOUT_WITH_BANNER,
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /src\/app\/layout\.tsx:1 — .*@vercel\/analytics.*AnalyticsGate/);
  } finally { s.done(); }
});

test("verify-source fails a declared purpose with no banner or no settings control", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": "export default function L({children}){return <body>{children}<AnalyticsGate /></body>;}\n",
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /site-consent\.ts:\d+ — .*<CookieConsent \/>/);
    assert.match(res.stdout, /site-consent\.ts:\d+ — .*<CookieSettingsButton \/>/);
  } finally { s.done(); }
});

test("verify-source fails a declared purpose nothing uses", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL(["analytics", "marketing"]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /site-consent\.ts:\d+ — .*"marketing".*nothing in src\//);
    assert.doesNotMatch(res.stdout, /"analytics".*nothing in src\//, "AnalyticsGate in the layout is the analytics use");
  } finally { s.done(); }
});

test("verify-source passes the template default and a declared, bannered analytics site", () => {
  const none = site({ "src/lib/site-consent.ts": DECL([]), "src/app/layout.tsx": LAYOUT_WITH_BANNER });
  const some = site({ "src/lib/site-consent.ts": DECL(["analytics"]), "src/app/layout.tsx": LAYOUT_WITH_BANNER });
  try {
    for (const s of [none, some]) {
      const res = s.run();
      assert.equal(res.status, 0, res.stdout + res.stderr);
    }
  } finally { none.done(); some.done(); }
});

test("verify-source checks each locale's cookie inventory against the declaration", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "messages/da.json": JSON.stringify({ cookiePolicy: { table: "NEXT_LOCALE — sprogvalg. cookie-consent — dit samtykke." } }),
    "messages/en.json": JSON.stringify({ cookiePolicy: { table: "NEXT_LOCALE — language choice." } }),
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /messages\/da\.json:1 — .*cookie-consent/);
    assert.doesNotMatch(res.stdout, /messages\/en\.json:1 — .*cookie-consent/);
  } finally { s.done(); }
});

test("findCookieInventoryGaps: a site running BotID discloses it in the inventory, banner or not", () => {
  for (const banner of [false, true]) {
    const base = banner ? "NEXT_LOCALE, cookie-consent" : "NEXT_LOCALE";
    assert.match(findCookieInventoryGaps(base, banner, true)[0].why, /BotID/);
    assert.deepEqual(findCookieInventoryGaps(`${base}. Vercel BotID checks the browser when the form is sent.`, banner, true), []);
    assert.deepEqual(findCookieInventoryGaps(base, banner, false), []);
  }
});

test("verify-source requires the BotID disclosure when instrumentation-client.ts runs it", () => {
  const s = site({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/instrumentation-client.ts": "import { initBotId } from 'botid/client/core';\ninitBotId({ protect: [{ path: '/*/contact', method: 'POST' }] });\n",
    "messages/da.json": JSON.stringify({ cookiePolicy: { table: "NEXT_LOCALE — sprogvalg. Vercel BotID beskytter kontaktformularen." } }),
    "messages/en.json": JSON.stringify({ cookiePolicy: { table: "NEXT_LOCALE — language choice." } }),
  });
  try {
    const res = s.run();
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /messages\/en\.json:1 — .*BotID/);
    assert.doesNotMatch(res.stdout, /messages\/da\.json:1 — .*BotID/);
  } finally { s.done(); }
});

// ── Every tracker must be gated, and the signatures cover what sites add ──────

const kinds = (src) => trackerPurposesInSource(src).map((h) => h.what);

test("trackerPurposesInSource recognises the common SDKs, pixels and loaders", () => {
  const cases = [
    ['import posthog from "posthog-js";', /PostHog/],
    ["import mixpanel from 'mixpanel-browser';", /Mixpanel/],
    ['import { AnalyticsBrowser } from "@segment/analytics-next";', /Segment/],
    ['import * as Fathom from "fathom-client";', /Fathom/],
    ['import { SpeedInsights } from "@vercel/speed-insights/next";', /Speed Insights/],
    ['<Script src="https://cloud.umami.is/script.js" data-website-id="x" />', /Umami/],
    ["var _paq = window._paq = window._paq || []; _paq.push(['trackPageView']);", /Matomo/],
    ['<img src="https://www.facebook.com/tr?id=1&ev=PageView" alt="" />', /Meta Pixel/],
    ['<img src="https://px.ads.linkedin.com/collect/?pid=1" alt="" />', /LinkedIn/],
    ['s.src = "https://connect.facebook.net/en_US/fbevents.js";', /Meta Pixel/],
    ['navigator.sendBeacon("https://collect.example.net/e", body);', /beacon/],
    ["const ph = await import(`posthog-js`);", /PostHog/],
    ['<Script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123" />', /Tag Manager/],
  ];
  for (const [src, what] of cases) assert.match(kinds(src).join(" | "), what, src);
});

test("trackerPurposesInSource: a product code, a same-origin beacon and a policy link are not trackers", () => {
  assert.deepEqual(kinds("export const G = () => <p>Product GTM-4420 spec sheet, order code GTM-12</p>;"), []);
  assert.deepEqual(kinds('navigator.sendBeacon("/api/log", body);'), []);
  assert.deepEqual(kinds('<a href="https://plausible.io/data-policy">Plausible</a> <Link href="https://www.hotjar.com/legal/policies/privacy/">Hotjar</Link>'), []);
  assert.deepEqual(kinds('const links = [{ label: "Meta", href: "https://www.facebook.com/tr/privacy" }];'), []);
  assert.deepEqual(kinds('<link rel="preconnect" href="https://www.google-analytics.com" />').length, 1, "a <link href> connects; only link targets are ignored");
});

test("trackerPurposesInSource reports each line once", () => {
  const hits = trackerPurposesInSource('<Script src="https://www.googletagmanager.com/gtag/js?id=G-1" /><Script id="ga">{`gtag("js", new Date()); gtag("config", "G-1");`}</Script>\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test("nonLiteralScriptSrcs: a <Script> whose src is not a readable literal needs review unless it resolves to a same-origin constant", () => {
  assert.deepEqual(nonLiteralScriptSrcs('const SRC = "/vendor/chat.js";\nexport const C = () => <Script src={SRC} />;'), []);
  assert.deepEqual(nonLiteralScriptSrcs('export const C = () => <Script src="/vendor/chat.js" />;'), []);
  const env = nonLiteralScriptSrcs("export const C = () => <Script src={process.env.NEXT_PUBLIC_TRACKER} />;");
  assert.equal(env.length, 1);
  assert.match(env[0].why, /cannot tell what .*loads/);
  const ext = nonLiteralScriptSrcs('const SRC = "https://cdn.example.net/x.js";\nexport const C = () => <script src={SRC} />;');
  assert.equal(ext[0].line, 2);
});

function runSite(files) {
  const s = site(files);
  try { return s.run(); } finally { s.done(); }
}

test("verify-source fails any tracker in a file that never checks purposeAllowed, even when its purpose is declared", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/components/Ph.tsx": 'import posthog from "posthog-js";\nexport function Ph() { posthog.init("k"); return null; }\n',
    "src/components/Speed.tsx": 'import { SpeedInsights } from "@vercel/speed-insights/next";\nexport const S = () => <SpeedInsights />;\n',
  });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /src\/components\/Ph\.tsx:1 — PostHog.*purposeAllowed\("analytics"\)/);
  assert.match(res.stdout, /src\/components\/Speed\.tsx:1 — .*Speed Insights.*AnalyticsGate/);
});

test("verify-source passes a declared tracker rendered only while purposeAllowed is true", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/components/Ga.tsx": 'import Script from "next/script";\nimport { purposeAllowed } from "@/lib/cookie-consent";\nexport const Ga = () => purposeAllowed("analytics") ? <Script src="https://www.googletagmanager.com/gtag/js?id=G-1" /> : null;\n',
  });
  assert.doesNotMatch(res.stdout, /Ga\.tsx:\d+ — (Google Analytics|.*purposeAllowed)/, res.stdout);
});

test("verify-source fails a tracker proxied through a next.config.ts rewrite, at the rewrite and where the site loads it", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "next.config.ts": "export default { async rewrites() { return [\n  { source: '/js/script.js', destination: 'https://plausible.io/js/script.js' },\n  { source: '/api/event', destination: 'https://plausible.io/api/event' },\n]; } };\n",
    "src/components/P.tsx": 'import Script from "next/script";\nexport const P = () => <Script src="/js/script.js" data-domain="x.dk" />;\n',
  });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /next\.config\.ts:2 — .*\/js\/script\.js.*https:\/\/plausible\.io/);
  assert.match(res.stdout, /src\/components\/P\.tsx:2 — .*plausible\.io.*"analytics"/);
});

test("verify-source fails a Meta pixel <img> and a Matomo snippet on a site that declares nothing", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/components/F.tsx": 'export const F = () => <img src="https://www.facebook.com/tr?id=1&ev=PageView" alt="" />;\n',
    "src/components/M.tsx": "export const M = () => <script dangerouslySetInnerHTML={{ __html: \"var _paq = window._paq || []; _paq.push(['trackPageView']);\" }} />;\n",
  });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /src\/components\/F\.tsx:1 — Meta Pixel serves "marketing"/);
  assert.match(res.stdout, /src\/components\/M\.tsx:1 — Matomo serves "analytics"/);
});

test("verify-source does not flag a product code or a policy link", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/components/G.tsx": 'export const G = () => <p>Product GTM-4420 <a href="https://plausible.io/data-policy">policy</a></p>;\n',
  });
  assert.equal(res.status, 0, res.stdout);
});

test("verify-source fails a tracker in a mirrored page, and a purpose declared on a mirrored site", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "src/mirror/pages/index.html": '<html><body><p>Hej</p><img src="https://www.facebook.com/tr?id=1&ev=PageView"></body></html>\n',
  });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /src\/mirror\/pages\/index\.html:1 — Meta Pixel .*mirrored/);
  assert.match(res.stdout, /site-consent\.ts:\d+ — .*mirrored sites run without analytics for now/);
});

test("verify-source refuses a consent purpose on a site whose pipeline mode is replicate", () => {
  const res = runSite({
    ".redesign-state/pipeline-mode": "replicate\n",
    "src/lib/site-consent.ts": DECL(["analytics"]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
  });
  assert.match(res.stdout, /site-consent\.ts:\d+ — .*mirrored sites run without analytics for now; a banner for mirrors is a later feature/);
});

test("findCookieInventoryGaps describes NEXT_LOCALE honestly", () => {
  const why = findCookieInventoryGaps("cookie-consent", true)[0].why;
  assert.match(why, /session cookie/);
  assert.match(why, /no identifier/);
  assert.match(why, /chooses a language or lands on one other than their browser's/);
});

test("verify-source fails a tracker proxied through a vercel.json rewrite", () => {
  const res = runSite({
    "src/lib/site-consent.ts": DECL([]),
    "src/app/layout.tsx": LAYOUT_WITH_BANNER,
    "vercel.json": JSON.stringify({ rewrites: [{ source: "/stats/:match*", destination: "https://eu.i.posthog.com/:match*" }] }, null, 2),
    "src/components/P.tsx": 'export function P() {\n  fetch("/stats/e/", { method: "POST" });\n  return null;\n}\n',
  });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stdout, /vercel\.json:\d+ — .*\/stats\/:match\*.*https:\/\/eu\.i\.posthog\.com/);
  assert.match(res.stdout, /src\/components\/P\.tsx:2 — .*eu\.i\.posthog\.com/);
});
