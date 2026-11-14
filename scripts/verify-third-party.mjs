#!/usr/bin/env node
// Rendered check: nothing third-party loads, and nothing is stored on the
// visitor's device, before the visitor asks. This is the authority on consent;
// verify-source check 28 is only a fast first pass over the source.
//
// For every page, in a fresh browser context: load, scroll to the bottom, let the
// network settle, and — before any click — fail on
//   - any request, frame or cookie from an origin other than the site's, unless
//     third-party-allow.json names it with a reason;
//   - any request to a same-origin path the site forwards to another origin (a
//     rewrite in the build's routes manifest, next.config.ts or vercel.json: a
//     proxied tracker looks first-party to the browser) or to Vercel's
//     first-party analytics paths;
//   - any cookie on the site's own origin other than NEXT_LOCALE, and
//     `cookie-consent` before the visitor has chosen (never, when the site
//     declares no consent purpose);
//   - anything in localStorage or sessionStorage (the template writes neither).
// Then press every embed facade ([data-embed-load]) and require that its frame
// appears and that the CSP did not block it.
//
// When src/lib/site-consent.ts declares purposes, the first page is also opened
// twice more: pressing Reject ([data-consent-reject]) must leave it as clean as
// before the choice, after a reload too; pressing Accept ([data-consent-accept])
// must store the choice, and may then load the declared trackers.
//
// Tracked requests are recorded and then aborted, never sent: the attempt is
// already the violation, and the check must not itself contact the providers it
// polices. That also means a clicked frame shows the browser's error page, which
// is fine — the CSP decides before any request is made, and that is what is asserted.
//
// Usage: node scripts/verify-third-party.mjs [BASE_URL] [--paths /a,/b]
//   Without --paths: every sitemap URL plus every mirrored page.
//   verify-delivery.mjs --full runs it too, so the release gate covers it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { externalRewrites, siteConsentPurposes } from "./verify-source.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const originOf = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
};

/** Same-origin paths that report to Vercel's analytics without a rewrite of the site's own. */
const FIRST_PARTY_TRACKERS = [
  { re: /^\/_vercel\/insights\//, what: "Vercel Web Analytics" },
  { re: /^\/_vercel\/speed-insights\//, what: "Vercel Speed Insights" },
];

/** Why a same-origin path is a tracker, or null. */
function sameOriginTracker(pathname, proxied) {
  const p = proxied.find((r) => new RegExp(r.regex).test(pathname));
  if (p) return `the site forwards it to ${originOf(p.destination) ?? p.destination}`;
  return FIRST_PARTY_TRACKERS.find((t) => t.re.test(pathname))?.what ?? null;
}

/** `third-party-allow.json`: `[{ "origin": "https://…", "reason": "…" }]`. Empty by
 *  default. An entry without a reason is refused — an exception nobody can explain
 *  is the thing this check exists to stop. */
export function parseAllowList(text) {
  if (!text) return { allow: [], errors: [] };
  const allow = [];
  const errors = [];
  for (const entry of JSON.parse(text)) {
    if (entry?.origin && String(entry.reason ?? "").trim()) allow.push({ origin: String(entry.origin).replace(/\/+$/, ""), reason: entry.reason });
    else errors.push(`third-party-allow.json: ${entry?.origin ?? JSON.stringify(entry)} has no reason — every allowed origin must say why`);
  }
  return { allow, errors };
}

/** What a page did before consent that reaches beyond the site or onto the device.
 *  `chosen`: the visitor has pressed Accept or Reject, so `cookie-consent` may exist. */
export function thirdPartyViolations({ requests = [], frames = [], cookies = [], storage = {} }, siteBase, allow = [], { proxied = [], purposes = [], chosen = false } = {}) {
  const site = originOf(siteBase);
  const siteHost = new URL(siteBase).hostname;
  const allowed = new Set(allow.map((a) => a.origin));
  const foreign = (url) => {
    const o = originOf(url);
    return o && o !== site && !allowed.has(o) ? o : null;
  };
  const out = [];
  const seen = new Set();
  for (const url of requests) {
    const o = foreign(url);
    if (o && !seen.has(`r${o}`)) {
      seen.add(`r${o}`);
      out.push(`request to ${o} before any click (${url})`);
    }
    if (originOf(url) !== site || seen.has(`p${url}`)) continue;
    const why = sameOriginTracker(new URL(url).pathname, proxied);
    if (why) {
      seen.add(`p${url}`);
      out.push(`request to ${url} before any click — ${why}`);
    }
  }
  for (const url of frames) {
    const o = foreign(url);
    if (o && !seen.has(`f${o}`)) {
      seen.add(`f${o}`);
      out.push(`frame from ${o} before any click`);
    }
  }
  for (const c of cookies) {
    const domain = String(c.domain || "").replace(/^\./, "");
    if (domain === siteHost || siteHost.endsWith(`.${domain}`)) {
      if (c.name === "NEXT_LOCALE") continue;
      if (c.name === "cookie-consent") {
        if (!purposes.length) out.push("cookie cookie-consent set, but the site declares no consent purpose (src/lib/site-consent.ts), so nothing may write it");
        else if (!chosen) out.push("cookie cookie-consent set before the visitor chose — the banner writes it only on a choice");
        continue;
      }
      out.push(`cookie ${c.name} set on the site's own origin before consent — only NEXT_LOCALE may be`);
      continue;
    }
    if ([...allowed].some((o) => new URL(o).hostname.endsWith(domain))) continue;
    out.push(`cookie ${c.name} set by ${c.domain} before any click`);
  }
  for (const k of storage.local ?? []) out.push(`localStorage item ${k} written before consent`);
  for (const k of storage.session ?? []) out.push(`sessionStorage item ${k} written before consent`);
  return out;
}

/** Mirrored pages, including the noindex ones the sitemap leaves out. Read from the
 *  MIRROR_PAGES export only: MIRROR_REPLAYS entries carry "path" keys too. */
export function mirrorPaths(siteRoot = root) {
  const index = join(siteRoot, "src", "mirror", "index.ts");
  if (!existsSync(index)) return [];
  const text = readFileSync(index, "utf8");
  const start = text.search(/export const MIRROR_PAGES\b/);
  if (start === -1) return [];
  const next = text.slice(start + 1).search(/^export /m);
  const block = next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  return [...block.matchAll(/"path":\s*"([^"]+)"/g)].map((m) => m[1]);
}

export function readAllowList(siteRoot = root) {
  const p = join(siteRoot, "third-party-allow.json");
  return parseAllowList(existsSync(p) ? readFileSync(p, "utf8") : null);
}

/** Same-origin paths the site forwards to another origin. The build's routes
 *  manifest is what Next actually runs, including rewrites a config plugin adds
 *  (withBotId); next.config.ts is read only when there is no build. vercel.json's
 *  rewrites run in front of Next on the platform, so they count either way. */
export function proxiedRoutes(siteRoot = root) {
  const external = (d) => /^https?:\/\//i.test(String(d));
  const pick = ({ regex, destination }) => ({ regex, destination });
  const read = (rel) => (existsSync(join(siteRoot, rel)) ? readFileSync(join(siteRoot, rel), "utf8") : null);
  const vercel = read("vercel.json");
  const platform = vercel ? externalRewrites(vercel).map(pick) : [];
  const manifest = read(".next/routes-manifest.json");
  if (manifest) {
    const r = JSON.parse(manifest).rewrites ?? [];
    const all = Array.isArray(r) ? r : [...(r.beforeFiles ?? []), ...(r.afterFiles ?? []), ...(r.fallback ?? [])];
    return [...all.filter((x) => external(x.destination)).map(pick), ...platform];
  }
  const cfg = read("next.config.ts");
  return [...(cfg ? externalRewrites(cfg).map(pick) : []), ...platform];
}

/** The purposes src/lib/site-consent.ts declares; none when it is absent. */
export function readConsentPurposes(siteRoot = root) {
  const p = join(siteRoot, "src", "lib", "site-consent.ts");
  return existsSync(p) ? [...(siteConsentPurposes(readFileSync(p, "utf8")) ?? [])] : [];
}

const CONSENT_CONTROLS = "[data-consent-accept] and [data-consent-reject]";

export async function verifyThirdParty({ base, paths, allow = [], proxied = [], purposes = [] }) {
  const { chromium } = await import("playwright");
  const site = originOf(base);
  const tracked = (href) => {
    const o = originOf(href);
    if (o === null) return false;
    return o !== site || sameOriginTracker(new URL(href).pathname, proxied) !== null;
  };
  const browser = await chromium.launch();
  const fails = [];
  let passes = 0;

  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const requests = [];
    await ctx.route(
      (url) => tracked(url.href),
      (route) => {
        requests.push(route.request().url());
        return route.abort();
      },
    );
    return { ctx, page: await ctx.newPage(), requests };
  };
  const settle = async (page) => {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  };
  const observe = async ({ ctx, page, requests }) => ({
    requests,
    frames: page.frames().map((f) => f.url()),
    cookies: await ctx.cookies(),
    storage: await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })),
  });
  const visible = (page, sel) => page.locator(sel).first().waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);

  try {
    for (const [n, path] of paths.entries()) {
      const run = await open();
      const { page } = run;
      try {
        await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 });
        await settle(page);
        const violations = thirdPartyViolations(await observe(run), base, allow, { proxied, purposes });
        if (violations.length) for (const v of violations) fails.push(`${path}: ${v}`);
        else passes++;

        const facades = await page.locator("[data-embed-load]").count();
        for (let i = 0; i < facades; i++) {
          const button = page.locator("[data-embed-load]").first();
          const before = await page.locator("iframe").count();
          await button.scrollIntoViewIfNeeded();
          await button.click();
          const appeared = await page
            .waitForFunction((n) => document.querySelectorAll("iframe").length > n, before, { timeout: 5000 })
            .then(() => true, () => false);
          if (!appeared) {
            fails.push(`${path}: facade ${i + 1} was pressed but no frame appeared`);
            continue;
          }
          await page.waitForTimeout(300);
          const blocked = (await page.evaluate(() => window.__cspViolations.splice(0))).filter((v) => v.startsWith("frame-src"));
          if (blocked.length) fails.push(`${path}: facade ${i + 1}'s frame was blocked by the CSP (${blocked[0]}) — its origin is missing from frame-src`);
          else passes++;
        }
      } catch (e) {
        fails.push(`${path}: could not check (${String(e.message).split("\n")[0]})`);
      } finally {
        await run.ctx.close();
      }

      // The banner is the layout's, the same on every page, so its two choices are
      // exercised once. Each gets a fresh visitor.
      if (n > 0 || !purposes.length) continue;
      for (const choice of ["reject", "accept"]) {
        const run = await open();
        const { ctx, page, requests } = run;
        try {
          await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 });
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          if (!(await visible(page, "[data-consent-accept]")) || !(await visible(page, "[data-consent-reject]"))) {
            fails.push(`${path}: the site declares consent purposes (${purposes.join(", ")}) but the page shows no ${CONSENT_CONTROLS} controls — the banner's Accept and Reject buttons must carry them so the choice can be checked`);
            break;
          }
          requests.length = 0;
          await page.locator(`[data-consent-${choice}]`).first().click();
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          if (choice === "accept") {
            if ((await ctx.cookies()).some((c) => c.name === "cookie-consent")) passes++;
            else fails.push(`${path}: pressing Accept stored no cookie-consent cookie, so the choice is lost on the next page`);
            continue;
          }
          await settle(page);
          await page.reload({ waitUntil: "load", timeout: 30000 });
          await settle(page);
          const after = thirdPartyViolations(await observe(run), base, allow, { proxied, purposes, chosen: true });
          if (after.length) for (const v of after) fails.push(`${path}: after Reject: ${v}`);
          else passes++;
        } catch (e) {
          fails.push(`${path}: could not check ${choice} (${String(e.message).split("\n")[0]})`);
        } finally {
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  return { fails, passes };
}

async function sitemapPaths(base) {
  const res = await fetch(`${base}/sitemap.xml`);
  if (!res.ok) return [];
  return [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    const u = new URL(m[1].trim());
    return u.pathname + u.search;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const base = (args.find((a) => a.startsWith("http")) ?? "http://localhost:3000").replace(/\/$/, "");
  const pi = args.indexOf("--paths");
  const paths =
    pi !== -1 ? args[pi + 1].split(",").filter(Boolean) : [...new Set([...(await sitemapPaths(base)), ...mirrorPaths()])];
  const { allow, errors } = readAllowList();
  console.log(`verify-third-party → ${base}, ${paths.length} page(s)`);
  const { fails, passes } = await verifyThirdParty({ base, paths, allow, proxied: proxiedRoutes(), purposes: readConsentPurposes() });
  fails.unshift(...errors);
  console.log(`\n  ${passes} passed, ${fails.length} failure(s)`);
  for (const f of fails) console.log(`  ✘  ${f}`);
  process.exit(fails.length ? 1 : 0);
}
