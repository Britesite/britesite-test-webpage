import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorPaths, parseAllowList, proxiedRoutes, thirdPartyViolations, verifyThirdParty } from "./verify-third-party.mjs";

const SITE = "http://localhost:3000";

test("thirdPartyViolations flags a request, a frame and a cookie from another origin before any click", () => {
  const v = thirdPartyViolations(
    {
      requests: [`${SITE}/_next/static/a.js`, "https://www.google.com/maps/embed?pb=x", "data:image/png;base64,x", "blob:http://localhost:3000/1"],
      frames: [`${SITE}/om-os`, "https://www.google.com/maps/embed?pb=x", "about:blank"],
      cookies: [{ name: "NEXT_LOCALE", domain: "localhost" }, { name: "NID", domain: ".google.com" }],
    },
    SITE,
    [],
  );
  assert.deepEqual(v, [
    "request to https://www.google.com before any click (https://www.google.com/maps/embed?pb=x)",
    "frame from https://www.google.com before any click",
    "cookie NID set by .google.com before any click",
  ]);
});

test("thirdPartyViolations passes an allow-listed origin", () => {
  const v = thirdPartyViolations({ requests: ["https://fonts.example/x.woff2"], frames: [], cookies: [] }, SITE, [{ origin: "https://fonts.example", reason: "x" }]);
  assert.deepEqual(v, []);
});

test("parseAllowList requires a reason for every entry and defaults to empty", () => {
  assert.deepEqual(parseAllowList(null), { allow: [], errors: [] });
  const { allow, errors } = parseAllowList(JSON.stringify([{ origin: "https://a.example", reason: "self-hosted CDN mirror" }, { origin: "https://b.example" }]));
  assert.deepEqual(allow.map((a) => a.origin), ["https://a.example"]);
  assert.match(errors[0], /https:\/\/b\.example.*reason/);
});

test("thirdPartyViolations flags a same-origin request a rewrite forwards to another origin, and Vercel's first-party analytics paths", () => {
  const proxied = [{ regex: "^/js/script\\.js(?:/)?$", destination: "https://plausible.io/js/script.js" }];
  const v = thirdPartyViolations(
    { requests: [`${SITE}/js/script.js`, `${SITE}/_vercel/insights/script.js`, `${SITE}/_vercel/speed-insights/vitals`, `${SITE}/_next/static/a.js`, `${SITE}/da/kontakt`] },
    SITE,
    [],
    { proxied },
  );
  assert.deepEqual(v, [
    `request to ${SITE}/js/script.js before any click — the site forwards it to https://plausible.io`,
    `request to ${SITE}/_vercel/insights/script.js before any click — Vercel Web Analytics`,
    `request to ${SITE}/_vercel/speed-insights/vitals before any click — Vercel Speed Insights`,
  ]);
});

test("thirdPartyViolations: before consent the site's own cookies are at most NEXT_LOCALE, and web storage is empty", () => {
  const v = thirdPartyViolations(
    {
      cookies: [
        { name: "NEXT_LOCALE", domain: "localhost" },
        { name: "_pk_id.1.1fff", domain: "localhost" },
        { name: "cookie-consent", domain: "localhost" },
      ],
      storage: { local: ["ajs_anonymous_id"], session: ["ph_session"] },
    },
    SITE,
    [],
    { purposes: ["analytics"] },
  );
  assert.deepEqual(v, [
    "cookie _pk_id.1.1fff set on the site's own origin before consent — only NEXT_LOCALE may be",
    "cookie cookie-consent set before the visitor chose — the banner writes it only on a choice",
    "localStorage item ajs_anonymous_id written before consent",
    "sessionStorage item ph_session written before consent",
  ]);
});

test("thirdPartyViolations: cookie-consent is allowed once the visitor chose, and never on a site that declares no purpose", () => {
  const cookies = [{ name: "NEXT_LOCALE", domain: "localhost" }, { name: "cookie-consent", domain: "localhost" }];
  assert.deepEqual(thirdPartyViolations({ cookies }, SITE, [], { purposes: ["analytics"], chosen: true }), []);
  assert.deepEqual(thirdPartyViolations({ cookies }, SITE, [], { purposes: [] }), [
    "cookie cookie-consent set, but the site declares no consent purpose (src/lib/site-consent.ts), so nothing may write it",
  ]);
});

function scratchRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "vtp-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

test("mirrorPaths lists the mirrored pages only, not the replayed endpoints the index also carries", () => {
  const root = scratchRoot({
    "src/mirror/index.ts": 'export const MIRROR_PAGES: MirrorPage[] = [\n  {\n    "path": "/",\n    "file": "src/mirror/pages/index.html"\n  },\n  {\n    "path": "/kontakt",\n    "file": "src/mirror/pages/kontakt/index.html"\n  }\n];\n\nexport const MIRROR_REPLAYS: { path: string; file: string }[] = [\n  {\n    "path": "/_serverFn/abc",\n    "file": "/_mirror/origin/_serverFn/abc.json"\n  }\n];\n',
  });
  try {
    assert.deepEqual(mirrorPaths(root), ["/", "/kontakt"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("proxiedRoutes reads next.config.ts rewrites whose destination is another origin", () => {
  const root = scratchRoot({
    "next.config.ts": `export default { async rewrites() { return [
      { source: '/js/script.js', destination: 'https://plausible.io/js/script.js' },
      { source: "/stats/:path*", destination: "https://eu.i.posthog.com/:path*" },
      { source: '/:path(.*\\\\.svg)', destination: '/_mirror/origin/:path' },
    ]; } };`,
  });
  try {
    const routes = proxiedRoutes(root);
    assert.deepEqual(routes.map((r) => r.destination), ["https://plausible.io/js/script.js", "https://eu.i.posthog.com/:path*"]);
    const hit = (p) => routes.some((r) => new RegExp(r.regex).test(p));
    assert.equal(hit("/js/script.js"), true);
    assert.equal(hit("/stats/e/"), true);
    assert.equal(hit("/stats"), true);
    assert.equal(hit("/js/other.js"), false);
    assert.equal(hit("/logo.svg"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("proxiedRoutes adds vercel.json rewrites, which the platform applies in front of Next", () => {
  const root = scratchRoot({
    "next.config.ts": "export default {};",
    "vercel.json": JSON.stringify({ rewrites: [{ source: "/stats/:match*", destination: "https://eu.i.posthog.com/:match*" }, { source: "/old", destination: "/new" }] }),
  });
  try {
    const routes = proxiedRoutes(root);
    assert.deepEqual(routes.map((r) => r.destination), ["https://eu.i.posthog.com/:match*"]);
    assert.equal(new RegExp(routes[0].regex).test("/stats/e/"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("proxiedRoutes prefers the build's routes manifest, which includes rewrites a config plugin adds", () => {
  const root = scratchRoot({
    "next.config.ts": "export default {};",
    ".next/routes-manifest.json": JSON.stringify({
      rewrites: {
        beforeFiles: [{ source: "/bp/c.js", destination: "https://api.vercel.com/bot-protection/v1/challenge", regex: "^/bp/c\\.js(?:/)?$" }],
        afterFiles: [{ source: "/:path(.*\\.svg)", destination: "/_mirror/origin/:path", regex: "^(?:/(.*\\.svg))(?:/)?$" }],
        fallback: [],
      },
    }),
  });
  try {
    assert.deepEqual(proxiedRoutes(root), [{ regex: "^/bp/c\\.js(?:/)?$", destination: "https://api.vercel.com/bot-protection/v1/challenge" }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── In a real browser ─────────────────────────────────────────────────────────
// A local server stands in for the site. Every third-party request the pages make
// is aborted by the checker before it leaves the browser, so nothing here reaches
// a real provider; the trackers' own scripts are local stubs.

const chromiumPath = await import("playwright").then((p) => p.chromium.executablePath()).catch(() => null);
const noBrowser = !chromiumPath || !existsSync(chromiumPath) ? "Playwright Chromium is not installed (npx playwright install chromium)" : false;

const page = (body, head = "") => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><main style="height:1500px">${body}</main></body></html>`;
const BANNER = (onAccept, onReject) => `
  <div role="dialog" id="banner">
    <button data-consent-accept onclick="document.cookie='cookie-consent=%7B%22analytics%22%3Atrue%7D; path=/';${onAccept};this.parentNode.remove()">Accept</button>
    <button data-consent-reject onclick="document.cookie='cookie-consent=%7B%22analytics%22%3Afalse%7D; path=/';${onReject};this.parentNode.remove()">Reject</button>
  </div>
  <script>if (document.cookie.includes('cookie-consent') && document.cookie.includes('%22analytics%22%3Atrue')) ${onAccept};</script>`;
const LOAD_MATOMO = "(function(){var g=document.createElement('script');g.src='/matomo.js';document.head.appendChild(g)})()";

const ROUTES = {
  "/clean": { html: page("<h1>Hej</h1>"), cookie: "NEXT_LOCALE=da; Path=/" },
  "/plausible-proxy": { html: page("<h1>Proxied</h1>", '<script defer data-domain="x.dk" src="/js/script.js"></script>') },
  "/js/script.js": { js: "window.plausibleLoaded = true;" },
  "/fb-pixel": { html: page('<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1">') },
  "/matomo": { html: page("<h1>Matomo</h1>", `<script>var _paq = window._paq = window._paq || []; _paq.push(['trackPageView']); ${LOAD_MATOMO};</script>`) },
  "/matomo.js": { js: "document.cookie = '_pk_id.1.1fff=abc.1700000000; path=/'; document.cookie = '_pk_ses.1.1fff=1; path=/';" },
  "/storage-sdk": { html: page("<h1>SDK</h1>", "<script>localStorage.setItem('ajs_anonymous_id', 'x'); sessionStorage.setItem('ph_session', 'y');</script>") },
  "/banner-good": { html: page("<h1>Banner</h1>" + BANNER(LOAD_MATOMO, "void 0")) },
  "/banner-leaky": { html: page("<h1>Banner</h1>" + BANNER(LOAD_MATOMO, LOAD_MATOMO)) },
  "/banner-missing": { html: page("<h1>No controls</h1>") },
};

async function withSite(fn) {
  const server = createServer((req, res) => {
    const r = ROUTES[new URL(req.url, "http://x").pathname];
    if (!r) { res.writeHead(404); res.end(); return; }
    const headers = { "content-type": r.js ? "text/javascript" : "text/html; charset=utf-8" };
    if (r.cookie) headers["set-cookie"] = r.cookie;
    res.writeHead(200, headers);
    res.end(r.js ?? r.html);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const PROXY_ROOT = scratchRoot({ "next.config.ts": "export default { rewrites: async () => [{ source: '/js/script.js', destination: 'https://plausible.io/js/script.js' }] };" });
process.on("exit", () => rmSync(PROXY_ROOT, { recursive: true, force: true }));

test("in a browser: a clean page that sets only NEXT_LOCALE passes", { skip: noBrowser }, async () => {
  const r = await withSite((base) => verifyThirdParty({ base, paths: ["/clean"], proxied: proxiedRoutes(PROXY_ROOT) }));
  assert.deepEqual(r.fails, []);
});

test("in a browser: every pre-consent tracker fixture fails", { skip: noBrowser }, async () => {
  const r = await withSite((base) =>
    verifyThirdParty({ base, paths: ["/plausible-proxy", "/fb-pixel", "/matomo", "/storage-sdk"], proxied: proxiedRoutes(PROXY_ROOT) }),
  );
  const joined = r.fails.join("\n");
  assert.match(joined, /\/plausible-proxy: request to \S+\/js\/script\.js before any click — the site forwards it to https:\/\/plausible\.io/);
  assert.match(joined, /\/fb-pixel: request to https:\/\/www\.facebook\.com before any click/);
  assert.match(joined, /\/matomo: cookie _pk_id\.1\.1fff set on the site's own origin before consent/);
  assert.match(joined, /\/storage-sdk: localStorage item ajs_anonymous_id written before consent/);
  assert.match(joined, /\/storage-sdk: sessionStorage item ph_session written before consent/);
  assert.equal(r.passes, 0);
});

test("in a browser: with a purpose declared, Reject must leave the page as clean as before the choice", { skip: noBrowser }, async () => {
  const good = await withSite((base) => verifyThirdParty({ base, paths: ["/banner-good"], purposes: ["analytics"] }));
  assert.deepEqual(good.fails, []);
  const leaky = await withSite((base) => verifyThirdParty({ base, paths: ["/banner-leaky"], purposes: ["analytics"] }));
  assert.match(leaky.fails.join("\n"), /\/banner-leaky: after Reject: cookie _pk_id\.1\.1fff set on the site's own origin before consent/);
});

test("in a browser: with a purpose declared, the banner must carry the accept and reject controls the check presses", { skip: noBrowser }, async () => {
  const r = await withSite((base) => verifyThirdParty({ base, paths: ["/banner-missing"], purposes: ["analytics"] }));
  assert.match(r.fails.join("\n"), /\/banner-missing: .*\[data-consent-accept\].*\[data-consent-reject\]/);
});
