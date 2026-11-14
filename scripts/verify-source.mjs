#!/usr/bin/env node
// Source-boundary verifier — deterministic grep-class checks for defect patterns
// that have already cost real debugging time in this kit's builds (see
// GUIDELINES.md and the IMAGE_SLOTS.md / IMAGE_REQUESTS.md contract). Checks the
// SOURCE tree directly; verify-delivery.mjs is the counterpart that checks the
// rendered/delivered artifact against a running server.
//
// Checks:
//   1. Tailwind font-size token misuse   — a bracketed var() font-size compiles as color
//   2. SSR hydration trap                — storage read inside a useState initializer
//   3. Component-library imports         — @mui/@chakra-ui/bootstrap/antd
//   4. Map library                       — leaflet/openstreetmap/mapbox-gl
//   5. Orphan image markers              — [NEEDS:image IMG-...] with no manifest row
//   6. Unresolved image slots            — pending, unknown, or unbacked drawn-in-code
//   7. Lazy [NEEDS:] markers             — marker text names a source it didn't use
//   8. Redirect coverage                 — a live old URL neither preserved nor redirected
//   9. Banned marketing phrases          — category-generic filler in user-facing copy
//  10. Shared JS budget                  — measured, not asserted (needs a build; skipped otherwise)
//  11. Sitemap coverage                 — indexable routes vs sitemap, both directions, plus noindex-in-sitemap (needs a build)
//  12. JS-deferred content              — Suspense payload hidden from no-JS visitors (needs a build)
//  13. Rendered placeholders            — a [NEEDS:] marker reached a live page (needs a build)
//  14. Redirect destinations            — a 301 landing on a route nothing built (needs a build)
//  15. SVG viewBox aspect               — mismatched box silently shrinks every stroke
//  16. Route meta parity                — a registry metaKey with no meta.<key> entry
//  17. Hook in an async component       — useTranslations() that breaks the build
//  18. outline-none                     — silently removes the focus ring (Tailwind v4)
//  19. Build vocabulary                 — how the site was MADE, on a customer page
//  20. Cleared-namespace utilities      — a class the theme deleted; emits no CSS
//  21. Client namespace parity          — a client component reading unshipped messages
//  22. Self-redirecting outbound links  — an absolute link to a path this app redirects
//  23. Hardcoded figure names          — an SVG <title>/<desc> not coming from next-intl
//  24. Tailwind v4 layer defeat        — a utility silently overriding an @layer base rule
//  27. Third-party frame before interaction — a raw iframe/external script in source or built
//      output, or a facade provider the cookie policy does not name (built half needs a build)
//  28. Consent purposes                — a tracker for a purpose src/lib/site-consent.ts does not
//      declare or in a file that never checks purposeAllowed(), a rewrite proxying another
//      origin, a <script src={expr}> it cannot read, a tracker on a mirrored page or a purpose
//      declared on a mirrored site, a declared purpose with no banner/settings control or
//      nothing using it, or a cookie inventory that disagrees with the declaration or omits
//      BotID where the site runs it. A fast first pass: verify-third-party.mjs, in a browser,
//      is the authority on what a page stores or sends before consent
//  29. Image weight                    — a raster image in public/ over 1000 KB (a camera
//      original or a photograph saved as PNG); `npm run images -- --write` shrinks it
//
// Usage: node scripts/verify-source.mjs [--warn-only] [--root <site dir>]
//   --warn-only        report violations without failing the exit code
//   --root <dir>       verify that site directory instead of this script's (also VERIFY_ROOT)
//   --require-complete a SKIPPED check fails the run (use at Step 10 / publish)
//
// Exit 0 = clean (or --warn-only), 1 = at least one violation. A referenced file
// that doesn't exist yet (e.g. IMAGE_SLOTS.md before Step 5.2) is skipped, not
// failed, so early-pipeline runs aren't blocked.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readPipelineMode } from "./pipeline-mode.mjs";
import { loadCrawlCorpus, corpusIncludes } from "./crawl-corpus.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join, basename, extname } from "node:path";

const rootFlag = process.argv.indexOf("--root");
const root = resolve(
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : process.env.VERIFY_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const WARN_ONLY = process.argv.includes("--warn-only");
/** Treat a SKIPPED check as a failure. Off by default, because skips are correct
 *  earlier in the pipeline (no build yet, no IMAGE_SLOTS.md yet). Step 10 passes it,
 *  because at release time a check that never ran is indistinguishable from a check
 *  that passed — and the publish gate reads the exit code, not the summary line.
 *  Observed shape of this failure: a check silently stops running when framework
 *  output moves directory, and every subsequent release is green on a check nothing
 *  has executed in months. */
const REQUIRE_COMPLETE = process.argv.includes("--require-complete");
/** Keep in sync with performance-budget/SKILL.md. */
const JS_BUDGET_KB = 200;
/** Heaviest raster image a site may carry in public/. A photograph at 2400 px on
 *  its long edge, saved as JPEG, is 300 to 700 KB; anything past this is a
 *  camera original or a photograph saved as PNG. */
const IMAGE_BUDGET_KB = 1000;

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────

/** 1-based line number of a character offset. */
export function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Index of the `)` matching the `(` at `openIdx`, or -1 if unbalanced. */
export function findMatchingParen(text, openIdx) {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Check 1: a `text-` utility whose arbitrary value is a bare CSS variable is
 *  ambiguous in Tailwind v4 and resolves to a
 *  color rule, not font-size — every heading using it silently renders at 16px.
 *  The correct form carries an explicit length type hint before the var(). */
export function findFontSizeTokenMisuse(text) {
  // Split so this file never contains a contiguous, class-shaped literal.
  // Tailwind v4 scans the project for class names — including scripts/ — and
  // will happily generate CSS from a string it finds here. The wildcard form
  // produces `color: var(--...)`, which is malformed and crashes PostCSS for
  // the whole site. The checker for this bug must not be a carrier of it.
  const BAD = "text-" + "[var(--";
  const hits = [];
  let idx = text.indexOf(BAD);
  while (idx !== -1) {
    hits.push({
      line: lineAt(text, idx),
      why: `a ${"text-"}[var(--…)] utility compiles as a Tailwind color rule, not font-size — headings silently render at the 16px default. Use the length type hint: ${"text-"}[length:var(--…)].`,
    });
    idx = text.indexOf(BAD, idx + BAD.length);
  }
  return hits;
}

/** Check 1b: Tailwind v4 scans the project as TEXT, not as parsed source — so a
 *  class-shaped literal inside a code comment, a design doc or a compliance file
 *  compiles into real CSS. One build shipped a pill radius
 *  (`border-radius: 3.40282e38px`) and three keyframe blocks generated ENTIRELY from
 *  prose in `design-system.md` and `.redesign-state/*.md`, with no component using
 *  them — the brief's own Avoid list violated through documentation. The guideline
 *  already forbade this; nothing enforced it, and it recurred four times.
 *
 *  Static utilities are the dangerous ones: a cleared theme namespace cannot reach
 *  them, so they emit their stock value no matter what the tokens say. Extend BANNED
 *  when a design system clears a namespace whose stock utility must not ship. */
export function findClassShapedLiteralsInProse(text) {
  // Assembled, never contiguous — this checker must not be a carrier of its own rule.
  const BANNED = ["rounded" + "-full", "animate" + "-spin", "animate" + "-pulse", "animate" + "-bounce"];
  const hits = [];
  for (const bad of BANNED) {
    let idx = text.indexOf(bad);
    while (idx !== -1) {
      hits.push({
        line: lineAt(text, idx),
        why: `class-shaped literal "${bad}" in prose — Tailwind v4 scans this file as text and emits the utility into the shipped CSS even though no component uses it. Describe it in prose instead (e.g. "the pill-radius utility").`,
      });
      idx = text.indexOf(bad, idx + bad.length);
    }
  }
  return hits;
}

/** Check 15: an inline SVG whose `viewBox` aspect differs from the box it renders into.
 *
 *  `preserveAspectRatio` defaults to `xMidYMid meet`, which scales by the SMALLER of the
 *  two axis ratios. So a mismatched viewBox silently shrinks every stroke and letterboxes
 *  the artwork: a 120×88 viewBox in a 96×96 box scales by 0.8, turning the brief's
 *  mandated `strokeWidth="2"` into 1.6px on screen and leaving 13px of dead space above
 *  and below. The drawing then reads as thin and undersized next to its own type, and
 *  nothing in the source looks wrong — the stroke width says 2.
 *
 *  Only flagged when both dimensions are plain Tailwind spacing steps, so `h-auto`,
 *  arbitrary values and computed class strings are skipped rather than guessed at. */
export function findSvgViewBoxAspectMismatch(text) {
  const hits = [];
  for (const m of text.matchAll(/<svg\b([^>]*)>/g)) {
    const attrs = m[1];
    const vb = attrs.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/);
    const cls = attrs.match(/className="([^"]*)"/);
    if (!vb || !cls) continue;
    const w = cls[1].match(/(?:^|\s)w-(\d+(?:\.\d+)?)(?:\s|$)/);
    const h = cls[1].match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/);
    if (!w || !h) continue;
    const [vbW, vbH] = [parseFloat(vb[1]), parseFloat(vb[2])];
    const [boxW, boxH] = [parseFloat(w[1]) * 4, parseFloat(h[1]) * 4];   // Tailwind step = 4px
    if (!vbW || !vbH || !boxW || !boxH) continue;
    if (Math.abs(vbW / vbH - boxW / boxH) / (boxW / boxH) <= 0.02) continue;
    const scale = Math.min(boxW / vbW, boxH / vbH);
    const sw = attrs.match(/strokeWidth="([\d.]+)"/);
    hits.push({
      line: lineAt(text, m.index),
      why:
        `inline SVG viewBox is ${vbW}×${vbH} but renders into ${boxW}×${boxH}px — preserveAspectRatio scales by ` +
        `${scale.toFixed(2)}, so the drawing occupies ${Math.round(vbW * scale)}×${Math.round(vbH * scale)}px inside ` +
        `that box and the rest is letterbox.` +
        (sw ? ` strokeWidth="${sw[1]}" renders at ${(parseFloat(sw[1]) * scale).toFixed(2)}px, not ${sw[1]}px.` : "") +
        ` Give the viewBox the same aspect ratio as the rendered box — ideally units that map 1:1 to CSS pixels.`,
    });
  }
  return hits;
}

/** Index of the `}` matching the `{` at `openIdx`, or -1 if unbalanced. */
export function findMatchingBrace(text, openIdx) {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Names of same-file functions whose body touches web storage.
 *
 *  This exists because the incident that motivated check 2 hid the read behind a
 *  helper — `useState(() => !getStoredPreferences())` — so matching only a literal
 *  `localStorage` inside the initializer misses the exact shape the rule was
 *  written for. Resolution stops at ONE hop, within the file: chasing imported
 *  helpers or arbitrary call graphs needs a real parser and starts producing false
 *  positives, and a checker that cries wolf gets switched off, which costs more
 *  than the cases it would have caught. */
export function findStorageReadingHelpers(text) {
  const names = new Set();
  const decl =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\()|(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*)?\()/g;
  let m;
  while ((m = decl.exec(text)) !== null) {
    const name = m[1] || m[2];
    if (!name) continue;
    const openParen = m.index + m[0].length - 1;
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen === -1) continue;
    // Braced body if a `{` arrives before any `;` (tolerates a return-type
    // annotation between the parameter list and the brace); otherwise treat it as
    // a single-expression arrow body and read to the end of the statement.
    const braceIdx = text.indexOf("{", closeParen);
    const semiIdx = text.indexOf(";", closeParen);
    let body;
    if (braceIdx !== -1 && (semiIdx === -1 || braceIdx < semiIdx)) {
      const end = findMatchingBrace(text, braceIdx);
      if (end === -1) continue;
      body = text.slice(braceIdx, end);
    } else {
      body = text.slice(closeParen, semiIdx === -1 ? text.length : semiIdx);
    }
    if (/localStorage|sessionStorage/.test(body)) names.add(name);
  }
  return names;
}

/** Check 2: localStorage/sessionStorage read inside a useState(...) initializer,
 *  in a client component — either directly or through a same-file helper. window
 *  is undefined during SSR, so the server always renders the "nothing stored"
 *  state; a client with a real stored value then mismatches on hydration, and
 *  React can discard the mismatched subtree — eating real clicks. Read storage in
 *  a useEffect after mount instead. */
export function findStorageInUseState(text) {
  const hits = [];
  if (!/["']use client["']/.test(text)) return hits;
  const helpers = findStorageReadingHelpers(text);
  const re = /useState(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(text, openIdx);
    if (closeIdx === -1) continue;
    const span = text.slice(openIdx, closeIdx);

    let via = null;
    if (/localStorage|sessionStorage/.test(span)) via = "reads storage directly";
    else {
      for (const name of helpers) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(span)) {
          via = `calls ${name}(), which reads storage`;
          break;
        }
      }
    }

    if (via) {
      hits.push({
        line: lineAt(text, openIdx),
        why: `useState(...) initializer ${via} — server has no window, so the client's first render mismatches and can eat real clicks. Read storage in a useEffect after mount instead.`,
      });
    }
  }
  return hits;
}

/** A `source` pattern from next.config.ts, as a matcher. Next path syntax allows
 *  `:param` (one segment) and `:param*` / `:param+` (one or more segments), so a
 *  literal string compare would miss `/vvs/page/2/` against `/vvs/page/:page*`. */
export function sourceToRegExp(source) {
  const escaped = source.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped
    .replace(/:[A-Za-z_][\w]*\*/g, ".*")
    .replace(/:[A-Za-z_][\w]*\+/g, ".+")
    .replace(/:[A-Za-z_][\w]*/g, "[^/]+")
    // A `trailingSlash: true` site's static sources carry a literal trailing
    // slash (Next normalises the request before custom redirects run). Strip it
    // before the optional-slash suffix below, or the two stack into a mandatory
    // slash and every documented slash-less path reads as "not implemented".
    .replace(/\/$/, "");
  // Tolerate an optional trailing slash: Next matches `/a/:x` against both `/a/b`
  // and `/a/b/`, and this kit's sites use the trailing-slash convention. Anchoring
  // strictly produced false "documented but not implemented" reports.
  return new RegExp(`^${body}\\/?$`);
}

/** Every `/path/` quoted in backticks inside a markdown table cell. */
/** A line that NAMES a path in order to record that it does not exist. An inventory
 *  documents absences as well as presences — "no `/jobs/` page", "`/wp-admin/`
 *  disallowed in robots", "`/cases/` — 404". Harvesting those as live URLs demands
 *  redirects for pages that never existed. Measured: 18 false failures on one run. */
// No trailing \b: these verbs inflect. `\bdisallow\b` misses "disallows", which is
// how a robots line actually reads, and that single boundary leaked two of the
// eighteen false failures.
const ABSENCE_LINE_RE =
  /\b(?:404|410|never existed|does not exist|doesn't exist|not present|no such|absent|deliberately gone|disallow|exclu[ds]|placeholder|does not resolve|no longer|never returned)/i;

export function extractBacktickedPaths(md, { skipAbsenceLines = false } = {}) {
  const out = new Set();
  const lines = md.split("\n");
  for (const line of lines) {
    if (skipAbsenceLines && ABSENCE_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(/`(\/[^`\s]*)`/g)) collect(m[1], out);
  }
  return out;
}

function collect(p, out) {
  // Inventories summarise as well as enumerate. Three shapes are notation, not URLs:
  // an ellipsis marks an abbreviated listing, `/page/2-5/` is a range covering
  // several real URLs, and a file extension is a machine surface (sitemap, robots)
  // that is generated by the new site rather than redirected to it.
  if (/[…]|\.\.\./.test(p)) return;
  if (/\/page\/\d+-\d+\//.test(p)) return;
  if (/\.(xml|txt|json|ico|png|jpg|svg|webmanifest)$/i.test(p)) return;
  out.add(p);
}

/** `source:` values from the redirects() block of next.config.ts. */
export function extractRedirectSources(configText) {
  const block = configText.match(/async redirects\(\)[\s\S]*?\n {2}\}/);
  const generated = configText.match(/MIRROR_REDIRECTS[^=]*=\s*\[[\s\S]*?\n\];/);
  const scopes = [block, generated].filter(Boolean).map((m) => m[0]);
  const scope = scopes.length ? scopes.join("\n") : configText;
  return [...scope.matchAll(/"?source"?:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

/** Check 8: on a rebuild-in-place every live old URL must be accounted for — either
 *  preserved at its path or given a 301. Nothing else in the pipeline proves this:
 *  `verify:full` confirms the redirects that exist resolve, never that the *set* is
 *  complete. A real run shipped four redirect rules against an inventory containing
 *  thirty root-level article URLs; all thirty would have 404'd on launch day, and
 *  every other check passed. Absence is the failure mode, so absence is what this
 *  check looks for. */
export function findUnmappedInventoryUrls(inventoryMd, redirectsMd) {
  const hits = [];
  const inventory = extractBacktickedPaths(inventoryMd, { skipAbsenceLines: true });
  const accounted = extractBacktickedPaths(redirectsMd);
  for (const url of inventory) {
    if (!accounted.has(url)) {
      hits.push({
        line: 1,
        why: `old URL \`${url}\` appears in url-inventory.md but nowhere in redirects.md — on a rebuild-in-place an unaccounted URL is a page that 404s on launch. Record it as preserved, redirected, or deliberately gone.`,
      });
    }
  }
  return hits;
}

// Homepage/Page/Service/Catch-all are the Type values emitted by the original
// mapping template. Keep them readable as redirects while new documents use the
// explicit statuses below.
const REDIRECT_MAPPING_STATUSES = new Set([
  "redirected", "redirect", "pattern match", "homepage", "page", "service", "catch-all",
]);
const NON_REDIRECT_MAPPING_STATUSES = new Set([
  "preserve", "preserved", "dropped", "no redirect", "unchanged",
  "no redirect — unchanged", "no redirect - unchanged",
]);

function mappingStatus(cell) {
  return cell.trim().replace(/^\*\*(.*)\*\*$/, "$1").toLowerCase();
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function mappingStatusColumn(header) {
  return header.findIndex((cell) => /^(?:class|status|type)$/i.test(cell));
}

/** Mapping rows have a backticked leading-slash source in their first cell. The
 *  status comes from the Class/Status/Type column when a table declares one; for
 *  the compact rows used by older generated documents, infer it from the explicit
 *  status token rather than searching prose or the whole row. */
function redirectMappingRows(redirectsMd) {
  const rows = [];
  let header = null;
  const lines = redirectsMd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const cells = tableCells(lines[i]);
    if (!cells) {
      header = null;
      continue;
    }
    const next = tableCells(lines[i + 1] || "");
    if (next && next.length === cells.length && next.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      header = cells;
      i++;
      continue;
    }
    const source = cells[0].match(/^`(\/[^`\s]*)`$/);
    if (!source) continue;
    const declaredColumn = header && header.length === cells.length ? mappingStatusColumn(header) : -1;
    const explicitColumn = cells.findIndex((cell, index) =>
      index > 0 && (REDIRECT_MAPPING_STATUSES.has(mappingStatus(cell)) || NON_REDIRECT_MAPPING_STATUSES.has(mappingStatus(cell))),
    );
    // Standard rows are source | destination | status | reason. Compact legacy
    // rows put the status first; a known status always wins over that fallback.
    const statusColumn = declaredColumn !== -1
      ? declaredColumn
      : explicitColumn !== -1
        ? explicitColumn
        : /^`?\//.test(cells[1] || "") || cells[1] === "—"
          ? 2
          : 1;
    const status = mappingStatus(cells[statusColumn] || "");
    rows.push({ source: source[1], status, line: i + 1 });
  }
  return rows;
}

function isRedirectMappingStatus(status) {
  return REDIRECT_MAPPING_STATUSES.has(status);
}

function isKnownMappingStatus(status) {
  return isRedirectMappingStatus(status) || NON_REDIRECT_MAPPING_STATUSES.has(status);
}

function malformedMappingWhy(source, status) {
  return `redirects.md records \`${source}\` with unsupported mapping status ${status ? `\`${status}\`` : "(blank)"} — use REDIRECTED, PRESERVE, DROPPED, or the documented legacy Type values so the route cannot evade redirect coverage.`;
}

/** Check 8b: a mapping-table row documented as redirected must actually exist in
 *  next.config.ts. Unsupported status cells fail explicitly instead of becoming
 *  accidental exemptions. */
export function findUnimplementedRedirects(redirectsMd, configText) {
  const hits = [];
  const matchers = extractRedirectSources(configText).map(sourceToRegExp);
  for (const row of redirectMappingRows(redirectsMd)) {
    if (!isKnownMappingStatus(row.status)) {
      hits.push({ line: row.line, why: malformedMappingWhy(row.source, row.status) });
    } else if (isRedirectMappingStatus(row.status) && !matchers.some((re) => re.test(row.source))) {
      hits.push({
        line: row.line,
        why: `redirects.md marks \`${row.source}\` as redirected, but no source in next.config.ts matches it — documented but not implemented.`,
      });
    }
  }
  return hits;
}

/** Check 8c: the original's own permanent redirects — an old slug its CMS still
 *  answers with a 301 — are inventory rows of class `redirect`. They carry the
 *  inbound links the rename was meant to keep, so filing them as DROPPED loses
 *  exactly what the original preserved. Each must be documented as REDIRECTED
 *  (8b then makes next.config.ts carry it). */
export function findDroppedOriginRedirects(inventoryMd, redirectsMd) {
  const hits = [];
  const documented = new Map();
  for (const row of redirectMappingRows(redirectsMd)) {
    documented.set(row.source, row);
  }
  for (const row of inventoryMd.split("\n")) {
    const cells = row.split("|").map((c) => c.trim());
    if (!cells.some((c) => c === "redirect")) continue;
    const src = row.match(/`(\/[^`\s]*)`/);
    if (!src) continue;
    const target = (row.match(/→\s*(\S+)/) || [])[1] || "(unknown)";
    const doc = documented.get(src[1]);
    if (doc && isRedirectMappingStatus(doc.status)) continue;
    if (doc && !isKnownMappingStatus(doc.status)) {
      hits.push({ line: doc.line, why: malformedMappingWhy(src[1], doc.status) });
      continue;
    }
    hits.push({
      line: 1,
      why: `the original answers \`${src[1]}\` with a permanent redirect to ${target}; redirects.md must record it as REDIRECTED to that path (a DROPPED or missing row lets the links the original kept 404 on launch).`,
    });
  }
  return hits;
}

/** Check 9: category-generic marketing filler in user-facing copy. The standing Avoid
 *  list in the visual vocabulary already bans these; nothing checked them, so the ban
 *  relied on an agent remembering it while writing 400 translation keys. Deterministic
 *  because these are literal strings — the judgment half (does this sound like *this*
 *  company) stays with customer-perspective, which is the right owner for it. */
export const BANNED_COPY = [
  "leverage", "empower", "unlock", "streamline", "synergy", "seamless",
  "cutting-edge", "state-of-the-art", "world-class", "best-in-class",
  "one-stop shop", "solutions provider", "leading provider",
];

/** Build vocabulary — words that describe the PROCESS of making the site, on a
 *  page meant for a customer.
 *
 *  Different failure from marketing filler, and worse. Filler is merely empty;
 *  this is evidence. A visitor who reads "the original detail page was never
 *  extracted" or "SITE_PLAN §10.1 item 3" on a page asking for $2000 learns they
 *  are looking at a half-finished port, and a procurement reader concludes the
 *  supplier is disorganised — the single conclusion that audience acts on hardest.
 *
 *  It reaches the page because builders are told to REPORT a content gap, and
 *  "report" is ambiguous about the audience. The gap belongs in the compliance
 *  file, which the orchestrator reads. The visitor gets either the content or
 *  nothing — never a narration of why it is missing. Measured on one real run:
 *  57 instances across 6 of 18 routes, including the homepage. */
export const BANNED_BUILD_VOCAB = [
  // PHRASES ONLY. Bare words were over-broad: this kit builds sites for arbitrary
  // companies, and "scaffold hire" is a scaffolding firm's core product, "extraction"
  // belongs to mining and dentistry, "placeholder" to software documentation. A
  // check that fails correct customer copy gets switched off, and then catches
  // nothing at all.
  "never extracted", "not extracted", "was not extracted", "were not extracted",
  "unextracted", "site plan", "SITE_PLAN",
  "this build", "legacy site", "crawl time", "at crawl",
  "the old site", "old homepage",
  "not available for this", "publishing boundary", "extraction boundary",
  // Found by a cleanup pass: these narrate the build without using any of the
  // words above, so the first version of this list walked straight past them.
  // "the source page" is the old site by another name; the permission phrasings
  // describe a rights problem between the owner and a third party that the
  // visitor has no stake in and cannot act on.
  "source page", "display permission", "permission pending", "no display permission",
];

/** `opts.exemptCorpus` (replicate mode) is the crawl corpus from crawl-corpus.mjs:
 *  a value that appears verbatim in the original site is the client's own wording
 *  and is not a finding, whichever list it trips. Anything NOT in the corpus is a
 *  builder's addition and is checked as before. */
export function findBannedCopy(jsonText, banned = BANNED_COPY, opts = {}) {
  const hits = [];
  const lines = jsonText.split("\n");
  lines.forEach((line, i) => {
    const value = line.match(/:\s*"((?:[^"\\]|\\.)*)"/);
    if (!value) return;
    if (opts.exemptCorpus && corpusIncludes(opts.exemptCorpus, value[1], { jsonEscaped: true })) return;
    for (const phrase of banned) {
      if (new RegExp(`\\b${phrase.replace(/[-]/g, "\\-")}\\b`, "i").test(value[1])) {
        hits.push({
          line: i + 1,
          why: `user-facing copy contains "${phrase}" — category-generic filler the direction's Avoid list bans. Say the specific thing instead.`,
        });
        break;
      }
    }
  });
  return hits;
}

/** Check 10: the shared client JS every route pays for, gzipped, against the budget.
 *  performance-budget states a hard number and the publish gate lists it as a check,
 *  but nothing measured it — the gate passed because someone asserted it. Reads the
 *  build output when present; a stated guarantee nobody measures is not a guarantee. */
export function sharedJsBudgetHit(bytes, budgetKb) {
  const kb = bytes / 1024;
  return kb > budgetKb
    ? [{ line: 1, why: `shared client JS is ${kb.toFixed(0)} KB gzipped, over the ${budgetKb} KB budget — every route pays this before its own code.` }]
    : [];
}

/** The chunk set every prerendered route actually downloads, derived from the emitted
 *  `<script>` tags rather than from a build manifest.
 *
 *  Manifest keys are the wrong source. `rootMainFiles` omits `polyfillFiles` and, under
 *  Turbopack, several chunks that appear in every page's HTML — measuring it alone under-
 *  reports by tens of KB and hands back a PASS on a budget the site is over. The HTML is
 *  ground truth and survives Next renaming its manifests.
 *
 *  `nomodule` scripts are excluded: no browser that runs this site downloads them. */
export function sharedScriptSrcs(htmlPages) {
  let shared = null;
  for (const html of htmlPages) {
    const srcs = new Set();
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
      if (/\bnomodule\b/.test(tag)) continue;
      const src = tag.match(/\bsrc="(\/_next\/[^"]+)"/);
      if (src) srcs.add(src[1]);
    }
    shared = shared === null ? srcs : new Set([...shared].filter((s) => srcs.has(s)));
  }
  return [...(shared ?? [])].sort();
}

/** Matchers for banned import specifiers/dependency names (checks 3 & 4). Each
 *  `test` receives a bare module specifier or package.json dependency name. */
export const UI_LIBRARY_MATCHERS = [
  { test: (s) => s.startsWith("@mui/"), why: "component-library import — this kit is Tailwind + shadcn patterns only; install primitives from shadcn/ui instead" },
  { test: (s) => s.startsWith("@chakra-ui/"), why: "component-library import — this kit is Tailwind + shadcn patterns only; install primitives from shadcn/ui instead" },
  { test: (s) => s === "bootstrap" || s.startsWith("bootstrap/"), why: "component-library import — this kit is Tailwind + shadcn patterns only; install primitives from shadcn/ui instead" },
  { test: (s) => s === "antd" || s.startsWith("antd/"), why: "component-library import — this kit is Tailwind + shadcn patterns only; install primitives from shadcn/ui instead" },
];

const MAP_LIBRARY_WHY =
  "a map library fetches third-party tiles before the visitor asks. Maps use src/components/embeds/MapFacade (a committed static image, the address, an Open in Google Maps link, and an optional click-to-load Google embed)";
export const MAP_LIBRARY_MATCHERS = [
  { test: (s) => s === "leaflet" || s.startsWith("leaflet/"), why: MAP_LIBRARY_WHY },
  { test: (s) => s === "react-leaflet" || s.startsWith("react-leaflet/"), why: MAP_LIBRARY_WHY },
  { test: (s) => s === "mapbox-gl" || s.startsWith("mapbox-gl/"), why: MAP_LIBRARY_WHY },
];

const IMPORT_SPECIFIER_RE = /\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Check 29: a raster image in public/ heavier than the budget.
 *
 *  next/image re-encodes for the visitor, so an oversized original does not show
 *  up as a slow page in a quick look, and that is why it survived as prose in a
 *  skill ("don't ship 4000px originals") that nothing enforced. It still costs:
 *  the image optimizer decodes the full original on the first request for every
 *  size it serves, each clone of the repo by the editing agent downloads it, and
 *  the repo grows for good. Measured on a real site: four photographs between 2
 *  and 3 MB, 14 MB of images in a 39 MB repo.
 *
 *  `files` are `{ path, bytes, marked }` for the raster images to judge
 *  (`marked`: the file carries a C2PA manifest, so it must not be re-encoded:
 *  the site shows no "made with AI" caption because the file says it); the caller
 *  leaves out mirrored originals (the client's own, kept byte for byte) and the
 *  old-site reference screenshots (working material, not content). */
export function findHeavyImages(files, budgetKb) {
  return files
    .filter((f) => f.bytes > budgetKb * 1024)
    .sort((a, b) => b.bytes - a.bytes)
    .map((f) => ({
      path: f.path,
      line: 1,
      why: f.marked
        ? `${(f.bytes / 1024 / 1024).toFixed(1)} MB image, over the ${budgetKb} KB budget, and it carries the mark that says how it was generated. Do not resize or re-encode it (that drops the mark): generate it again at a smaller size.`
        : `${(f.bytes / 1024 / 1024).toFixed(1)} MB image, over the ${budgetKb} KB budget — a camera original or a photograph saved as PNG. Run \`npm run images -- --write\` to resize and re-encode it in place; a photograph that is still over as a PNG needs saving as JPEG, or as WebP if it needs transparency.`,
    }));
}

/** Checks 3 & 4 (import half): flag any import/require/dynamic-import whose
 *  specifier matches a banned-library matcher. */
export function findBannedImports(text, matchers) {
  const hits = [];
  const re = new RegExp(IMPORT_SPECIFIER_RE.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3];
    const hit = matchers.find((b) => b.test(spec));
    if (hit) hits.push({ line: lineAt(text, m.index), why: `imports "${spec}" — ${hit.why}` });
  }
  return hits;
}

/** Checks 3 & 4 (package.json half): flag any dependency/devDependency name
 *  matching a banned-library matcher. `pkgText` is the raw file text (so a line
 *  number can be recovered), not the parsed object. */
export function findBannedDependencies(pkgText, matchers) {
  const pkg = JSON.parse(pkgText);
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hits = [];
  for (const name of Object.keys(deps)) {
    const hit = matchers.find((b) => b.test(name));
    if (!hit) continue;
    const keyRe = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
    const m = keyRe.exec(pkgText);
    hits.push({ line: m ? lineAt(pkgText, m.index) : 1, why: `dependency "${name}" — ${hit.why}` });
  }
  return hits;
}

/** Generic plain-text mention scan (used for the "openstreetmap" half of check 4 —
 *  it's typically referenced via a tile-server URL/attribution string, not an
 *  import specifier). */
export function findTextMentions(text, pattern, why) {
  const hits = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ line: lineAt(text, m.index), why });
  return hits;
}

/** Check 5: `[NEEDS:image IMG-...]` markers with no matching row in
 *  IMAGE_REQUESTS.md. `knownIds` is the set of IDs already present there. */
export function findOrphanImageMarkers(text, knownIds) {
  const hits = [];
  const re = /\[NEEDS:image\s+(IMG-[A-Za-z0-9-]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    if (!knownIds.has(id)) {
      hits.push({
        line: lineAt(text, m.index),
        why: `marker references ${id}, which has no matching row in public/images/IMAGE_REQUESTS.md — orphan marker, the image will never be generated`,
      });
    }
  }
  return hits;
}

/** IDs from every `## IMG-...` heading in IMAGE_REQUESTS.md. */
export function extractImageRequestIds(md) {
  return new Set([...md.matchAll(/^##\s+(IMG-\S+)/gm)].map((m) => m[1]));
}

/** Evidence test for a `drawn-in-code` row: the component exists and contains
 *  artwork authored in source — an inline `<svg>` drawing or a `<pre>` typeset
 *  specimen. Diagrammatic briefs routinely define imagery as both kinds, and a
 *  specimen doing a hero's job is as load-bearing as a drawing.
 *
 *  Exported so the check and its tests exercise one definition. Keeping a second
 *  copy in a test harness produces a fixture that passes against itself while the
 *  real call site diverges. */
export function hasAuthoredArtwork(rootDir, componentPath) {
  const abs = resolve(rootDir, componentPath);
  return existsSync(abs) && /<svg[\s>]|<pre[\s>]/i.test(readFileSync(abs, "utf8"));
}

/** Terminal Resolution states an IMAGE_SLOTS.md row may name. Keep in sync with
 *  the schema block in IMAGE_SLOTS.md and the architect's absence audit. */
const SLOT_STATES = new Set([
  "pending",
  "catalog-reuse",
  "manifest-row",
  "image-present",
  "drawn-in-code",
  "justified-none",
]);

/** Check 6: unresolved or unverifiable slots in IMAGE_SLOTS.md, attributed to the
 *  nearest `### SLOT-...` heading above each hit. Three failure modes:
 *
 *    1. `Resolution: pending`      — never resolved.
 *    2. `Resolution: drawn-in-code: <path>` where the component is missing or
 *       contains neither an inline `<svg>` nor a `<pre>` specimen. Every other
 *       terminal state cites evidence something can check (a catalog path, a
 *       manifest row, a file on disk); without this, drawn-in-code is the one
 *       state that resolves a slot by assertion alone — and on a diagrammatic
 *       brief that is *every* slot on the site.
 *
 *       This checks that artwork was *authored*, not that it is the *right*
 *       artwork: a bare rect passes here. Judging whether the drawing depicts the
 *       specific artifact the brief names is the architect's principle 5, which is
 *       where it belongs — the deterministic layer catches assertion-without-
 *       execution, the reviewing layer catches execution-without-meaning.
 *    3. A Resolution naming a state outside the schema — a typo silently resolves
 *       a slot, since only literal `pending` used to fail.
 *
 *  The schema template line (`<pending | catalog-reuse | ...>`) is skipped: it
 *  opens with `<`, which no filled-in value does.
 *
 *  `componentHasSvg` is injected so this stays pure and testable. When omitted,
 *  mode 2 is skipped rather than assumed-passing by the caller's silence. */
export function findUnresolvedSlots(text, componentHasSvg) {
  const hits = [];
  const lines = text.split("\n");
  let currentSlot = "unknown slot";
  lines.forEach((line, i) => {
    const heading = line.match(/^###\s+(SLOT-\S+)/);
    if (heading) currentSlot = heading[1];

    const m = line.match(/\*\*Resolution:\*\*\s*(.+?)\s*$/);
    if (!m) return;
    // Strip backticks/asterisks HERE, before anything measures or slices this
    // string. The documented row format wraps the whole value in backticks
    // (`` `drawn-in-code: src/components/Foo.tsx` ``), so deriving `state` from a
    // stripped copy while slicing the unstripped original puts the two out of
    // sync by exactly the leading backtick — which ate the first character of
    // every path below and failed correctly-formatted rows with "that component
    // is missing".
    const value = m[1].replace(/[`*]/g, "");
    if (value.startsWith("<")) return; // schema template line, not a filled-in row

    const state = value.split(/[:\s]/)[0];
    const at = (why) => hits.push({ line: i + 1, why: `${currentSlot} ${why}` });

    if (!SLOT_STATES.has(state)) {
      at(`has Resolution "${state}", which is not a slot state — expected one of ${[...SLOT_STATES].join(", ")}`);
      return;
    }
    if (state === "pending") {
      at("still Resolution: pending — must reach a terminal state before Phase 3 can pass");
      return;
    }
    if (state === "drawn-in-code" && componentHasSvg) {
      const path = value.slice(state.length).replace(/^[:\s]+/, "").trim();
      if (!path) {
        at("resolves drawn-in-code but names no component path");
      } else if (!componentHasSvg(path)) {
        at(`resolves drawn-in-code: ${path}, but that component is missing or contains no <svg>/<pre> — the artwork was asserted, not made`);
      }
    }
  });
  return hits;
}

/** Blank out // and block comments and string literals, preserving offsets so
 *  lineAt() stays correct. Textual checks that skip this flag their own
 *  documentation: three comments describing a removed utility were reported as
 *  live uses of it, and a comment mentioning a banned call reads as the call. */
export function maskComments(text) {
  return maskInternal(text, false);
}

/** Full mask: comments AND string literals. Only for scans that parse structure
 *  (check 17 brace-matching). Do NOT use for class-name scans — a className value
 *  IS a string literal, so masking strings makes those checks vacuous. Verified:
 *  it silently zeroed checks 18 and 20 until a fixture caught it. */
export function maskNonCode(text) {
  return maskInternal(text, true);
}

function maskInternal(text, maskStrings) {
  const out = text.split("");
  let i = 0, mode = null, quote = null;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (!mode) {
      // ALWAYS enter string mode, even when not blanking strings. Otherwise the
      // `//` in `href="https://example.com"` reads as a line comment and blanks
      // the rest of the line — including the className beside it. That silently
      // zeroed checks 18 and 20 on every component containing a URL, which is
      // most of them. Tracking is what makes comment detection correct; blanking
      // is a separate decision.
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; if (maskStrings) out[i] = " "; i++; continue; }
      if (c === "/" && d === "/") { mode = "line"; }
      else if (c === "/" && d === "*") { mode = "block"; }
      if (mode) { out[i] = " "; i++; continue; }
      i++; continue;
    }
    if (mode === "line" && c === "\n") { mode = null; i++; continue; }
    if (mode === "block" && c === "*" && d === "/") { out[i] = out[i + 1] = " "; mode = null; i += 2; continue; }
    if (mode === "str") {
      if (c === "\\") { if (maskStrings) out[i] = out[i + 1] = " "; i += 2; continue; }
      if (c === quote) { if (maskStrings) out[i] = " "; mode = null; i++; continue; }
      // `${...}` inside a template literal is EXECUTABLE CODE, not string content.
      // Masking it hid real calls from the scans that read masked source — a hook
      // written as `${useTranslations("x")("t")}` simply vanished. Skip the
      // expression verbatim, matching braces so a nested object literal or a
      // nested template does not close it early.
      if (quote === "`" && c === "$" && d === "{") {
        let depth = 0, j = i + 1;
        for (; j < text.length; j++) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}" && --depth === 0) break;
        }
        i = j + 1; continue;
      }
      if (maskStrings && c !== "\n") out[i] = " ";
      i++; continue;
    }
    if (c !== "\n") out[i] = " ";
    i++;
  }
  return out.join("");
}

/** Check 20: a utility from a theme namespace `globals.css` deliberately cleared.
 *
 *  A design system that means it clears whole Tailwind namespaces — `--shadow-*:
 *  initial`, `--radius-*: initial`, `--font-weight-*: initial` — so the brief's
 *  Avoid list is enforced by there being no utility to reach for.
 *
 *  The trap is that Tailwind v4 **emits nothing for an unknown utility rather than
 *  erroring**, and the initial values are already on-brief: radius 0, no shadow,
 *  16px. So `shadow-lg rounded-md font-bold text-6xl` in a component is invisible
 *  to tsc, to eslint, to `next build`, and to every other check here — the page
 *  renders, plausibly, and the author's intent silently evaporates. Measured: a
 *  404 numeral written as `text-6xl` rendered at 16px, the same size as the
 *  sentence beneath it, for the entire life of the build. The theme was built so
 *  its own violations are invisible.
 *
 *  Derived from globals.css rather than hardcoded, so the list cannot drift from
 *  the design system it polices. Only flags namespaces whose utility prefix is
 *  unambiguous — `text-*` is deliberately excluded because it is shared with the
 *  colour namespace, and a false positive on every coloured word would get the
 *  whole check switched off. */
const CLEARED_NS_UTILITIES = {
  "--shadow-": "shadow-",
  "--inset-shadow-": "inset-shadow-",
  "--drop-shadow-": "drop-shadow-",
  "--text-shadow-": "text-shadow-",
  "--radius-": "rounded-",
  "--font-weight-": ["font-thin", "font-extralight", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black"],
  "--animate-": "animate-",
  // The motivating failure was `text-6xl` rendering at 16px, and the first version
  // of this check could not see it: --text-* steps are cleared individually, not as
  // a namespace. Listed explicitly. Safe because the test is "did it compile", so a
  // size the theme kept is found in the CSS and skipped.
  "--text-": ["text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"],
};

/** Tailwind escapes the characters that are not selector-legal. A source class of
 *  `md:text-6xl` compiles to `.md\:text-6xl`, and `shadow-red-500/50` to
 *  `.shadow-red-500\/50`. Looking up the raw string finds neither — which made the
 *  check both skip every variant and report working escaped classes as dead. */
export function tailwindSelector(cls) {
  return "." + cls.replace(/[:/.]/g, (c) => "\\" + c);
}

/** Whether the compiled stylesheet can be trusted to answer "did Tailwind emit
 *  this class?" for the given sources. A stylesheet older than a source file
 *  answers "no" for every utility that file introduced. */
export function builtCssFreshness({ cssMtimes = [], sources = [] } = {}) {
  if (!cssMtimes.length) return { state: "no-build", stale: [] };
  const newestCss = Math.max(...cssMtimes);
  const stale = sources.filter((s) => s.mtimeMs > newestCss).map((s) => s.path);
  return { state: stale.length ? "stale" : "fresh", stale };
}

/** Check 26: production notes rendered as customer copy.
 *
 *  A Phase 1 builder wrote an IMAGE_SLOTS usage constraint into a translation
 *  value — "…autentiske kilder på 600 × 336 px og allerede AI-opskaleret én
 *  gang…" — and it rendered as body copy at 65% scroll on a service page.
 *  Nothing mechanical could see it: the JSON parses, the key is real, the value
 *  is prose. Only the customer lane caught it, on the rendered page, hours later
 *  and at the price of a fix round.
 *
 *  These markers are words that appear in instructions to a builder and never in
 *  copy addressed to a client's customer: a pixel measurement, the vocabulary of
 *  image production, the name of an internal artifact, a developer marker. The
 *  list is deliberately narrow — a false positive here deletes real copy, so a
 *  marker earns its place only if a sentence containing it could not have been
 *  written for the reader. Physical dimensions ("3 x 6 meter") are not pixels
 *  and are left alone.
 */
//  Markers carry a strength. STRONG markers cannot appear in copy addressed to a
//  reader — nobody's customer is told about the master file. WEAK ones are only
//  suspicious in company: a pixel measurement is production vocabulary on a
//  carpentry site and the literal product on a site that sells advertising
//  slots, where "Forside 980 × 200 px" is the thing being bought. Measured on
//  four real sites: px alone fired 12 times on the ad site and every one was
//  real copy. So a value is flagged on any STRONG marker, or on two markers of
//  any strength — which is what the note that shipped actually looked like.
const PRODUCTION_MARKERS = [
  ["weak", /\b\d+\s*px\b/i, "a pixel measurement"],
  ["strong", /\bAI[- ]?(opskaleret|upscaled|genereret|generated)\b/i, "image-production vocabulary"],
  ["strong", /\b(opskaleret|upscaled|nedskaleret|downscaled)\b/i, "image-production vocabulary"],
  ["strong", /\boriginalfil(er)?\b|\boriginal files?\b|\bmaster ?fil(e|er)?\b/i, "source-file vocabulary"],
  ["strong", /IMAGE_SLOTS|IMAGE_REQUESTS|\bSLOT-[A-Z0-9]|design-direction\.md|build-manifest|content-strategy\.md/i, "the name of an internal artifact"],
  ["strong", /\bTODO\b|\bFIXME\b|\bXXX\b/, "a developer marker"],
];

export function findProductionNotes(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return []; // not our file to judge; JSON validity is checked elsewhere
  }
  const hits = [];
  const seen = new Set();
  const walkValue = (value, path) => {
    if (typeof value === "string") {
      const matched = PRODUCTION_MARKERS.filter(([, re]) => re.test(value));
      const strong = matched.filter(([strength]) => strength === "strong");
      if (!strong.length && matched.length < 2) return;
      const key = path.join(".");
      if (seen.has(key)) return;
      seen.add(key);
      const reasons = [...new Set((strong.length ? strong : matched).map(([, , why]) => why))];
      hits.push({
        line: lineOfValue(text, value),
        why: `\`${key}\` reads as a note to the builder, not copy for the client's customer — it contains ${reasons.join(" and ")}. Move the constraint to IMAGE_SLOTS.md or the compliance file; a translation value is published text.`,
      });
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walkValue(v, [...path, k]);
    }
  };
  walkValue(data, []);
  return hits;
}

/** Line of the first raw occurrence of a decoded string value, 1-based. */
function lineOfValue(text, value) {
  const probe = value.slice(0, 40);
  const at = text.indexOf(probe);
  return at < 0 ? 1 : lineAt(text, at);
}

export function findClearedNamespaceUtilities(text, builtCss) {
  // Compare against what actually COMPILED, never against the namespace clear.
  // A design system routinely clears a namespace and then re-defines the steps it
  // wants — this one clears --font-weight-* and re-points `font-normal` onto
  // `--weight-regular`, so it emits real CSS and is perfectly correct to use.
  // Inferring "cleared namespace ⇒ dead utility" produced 10 false positives on
  // the first version of this check, all of them on working code. The only sound
  // test is whether the class exists in the built stylesheet.
  if (!builtCss) return [];
  const hits = [];
  for (const [ns, util] of Object.entries(CLEARED_NS_UTILITIES)) {
    const needles = Array.isArray(util) ? util : [util];
    for (const needle of needles) {
      // (?<!-) only: a leading "-" means this is the tail of a longer utility
      // (drop-shadow-lg contains shadow-lg). Variants are NOT skipped any more —
      // md:text-6xl is just as dead as text-6xl when the namespace is cleared, and
      // skipping them meant the check never looked at responsive or state classes
      // at all. The variant prefix is captured so the CSS lookup can escape it.
      const re = Array.isArray(util)
        ? new RegExp(`(?<!-)((?:[a-z0-9-]+:)*)${needle}\\b`, "g")
        : new RegExp(`(?<!-)((?:[a-z0-9-]+:)*)${needle}[a-z0-9./-]+`, "g");
      let m;
      while ((m = re.exec(text)) !== null) {
        const cls = m[0];
        // Emitted? Then the theme kept or re-defined it and there is nothing wrong.
        // Compare against the ESCAPED selector Tailwind actually writes.
        const sel = tailwindSelector(cls);
        if (builtCss.includes(sel + "{") || builtCss.includes(sel + ":") || builtCss.includes(sel + " ")) continue;
        hits.push({
          line: lineAt(text, m.index),
          why: `"${cls}" is used here but emits NO CSS — it belongs to the ${ns}* namespace, which globals.css clears with \`initial\`, and the theme did not re-define it. Tailwind drops unknown utilities silently rather than erroring, and the initial value (radius 0, no shadow, 16px) looks plausible on this design system, so the intent evaporates with every other check still green. Use a token that exists, or delete the class.`,
        });
      }
    }
  }
  return hits;
}

/** Check 18: `outline-none` on a focusable element.
 *
 *  design-system.md's focus-ring rule ("never remove it, never rely on the browser
 *  default") is defeated by a single Tailwind utility, and silently. Tailwind v4
 *  redefined `outline-none` to genuinely remove the outline — v3's transparent-ring
 *  behaviour is now `outline-hidden` — so the class reads as harmless to anyone who
 *  learned it on v3. And it wins on layer order, not specificity: the base-layer
 *  `:focus-visible { outline: ... }` rule cannot beat a utility-layer declaration,
 *  so no amount of care in globals.css helps.
 *
 *  Observed: five form fields shipped with no visible focus indicator on the site's
 *  only conversion path. A keyboard user tabbing the form cannot tell which field
 *  they are in. `tsc` and `eslint` are both blind to it, and so is a source review
 *  that greps for colours rather than for this one class.
 *
 *  `outline-hidden` is the correct utility when a custom ring replaces the default;
 *  it is not flagged. */
/** Check 24: a Tailwind v4 utility silently defeating a rule in @layer base.
 *
 *  v4 orders layers `theme, base, components, utilities`, and layer order beats
 *  specificity AND media queries. So a utility class on an element overrides a
 *  correct `@layer base` rule with no warning — and both declarations look right
 *  where they are written, which is why source review never catches it and why the
 *  people who wrote the base rule believed it was working.
 *
 *  Two instances measured on one real run, both dead code someone wrote on purpose:
 *  a `prefers-reduced-motion` `scroll-behavior: auto` override defeated by the
 *  `scroll-smooth` utility on <html> (reduced-motion users still got smooth
 *  scrolling), and `:focus-visible { transition: none }` defeated by
 *  `transition-colors`, which in v4 includes `outline-color` — the focus ring faded
 *  in over 120ms from currentColor, measuring 1.06:1 during the ramp.
 *
 *  Only fires when the base rule EXISTS. A site that never wrote the rule has
 *  nothing being defeated, and telling it about a bug it does not have is noise. */
export function findLayerDefeat(text, globalsCss) {
  const hits = [];
  const hasMotionRule = /@media[^{]*prefers-reduced-motion[^{]*\{[^}]*scroll-behavior\s*:\s*auto/s.test(globalsCss);
  const hasFocusRule = /:focus-visible[^{]*\{[^}]*transition\s*:\s*none/s.test(globalsCss);

  if (hasMotionRule) {
    for (const m of text.matchAll(/\bscroll-smooth\b/g)) {
      hits.push({
        line: lineAt(text, m.index),
        why: "`scroll-smooth` is a utility, and globals.css declares a `prefers-reduced-motion` override for `scroll-behavior` in @layer base. Tailwind v4 puts utilities after base, so the utility wins and the override is dead code — a reduced-motion visitor still gets smooth scrolling. Drop the utility and set `scroll-behavior: smooth` in the base layer, where the media query can beat it.",
      });
    }
  }
  if (hasFocusRule) {
    for (const m of text.matchAll(/\btransition-(colors|all)\b/g)) {
      hits.push({
        line: lineAt(text, m.index),
        why: `\`transition-${m[1]}\` includes \`outline-color\` in Tailwind v4, and globals.css declares \`:focus-visible { transition: none }\` in @layer base. Utilities beat base, so the focus ring FADES IN rather than appearing — measured at 1.06:1 against the page during the ramp before settling. Scope it (\`transition-[background-color,color]\`) instead.`,
      });
    }
  }
  return hits;
}

/** Is `index` inside an <svg> that the accessibility tree can actually see?
 *
 *  Walks every svg tag before the position, maintaining a stack, so self-closing
 *  figures net to zero and a hidden ANCESTOR hides everything beneath it — an
 *  aria-hidden wrapper makes its children unreachable no matter what they say. */
export function isInsideExposedSvg(text, index) {
  // NOT maskNonCode. Masking tracks JS string state, and an apostrophe in ordinary
  // JSX prose — "Don't stop" — opens single-quote mode and blanks the rest of the
  // file, so every later <svg> vanished and the check silently returned nothing.
  // A vacuous check that looks like a passing one is the failure mode this whole
  // file exists to avoid, and it traded a common hazard for a rare one.
  //
  // The rare one is `const s = "<svg>"`, and it is enough to notice the quote.
  const stack = [];
  const re = /<svg\b([^>]*)>|<\/svg\s*>/g;
  let m;
  while ((m = re.exec(text)) !== null && m.index < index) {
    const prev = text[m.index - 1];
    if (prev === '"' || prev === "'" || prev === "`") continue;   // inside a string literal
    if (m[0].startsWith("</")) { stack.pop(); continue; }
    if (m[1].trimEnd().endsWith("/")) continue;       // <svg ... /> opens nothing
    stack.push(/aria-hidden=\{?["']?true/.test(m[1]) || /role=["']presentation["']/.test(m[1]));
  }
  return stack.length > 0 && !stack.some(Boolean);
}

/** Check 23: a hardcoded accessible name on a drawn-in-code figure.
 *
 *  `<title>` and `<desc>` inside an inline `<svg>` ARE user-facing — they are the
 *  figure's accessible name and description, and a screen reader announces them
 *  like any other copy. So the house rule that every user-facing string comes from
 *  next-intl applies to them, and the localisation check that walks JSX text nodes
 *  walks straight past them, because to that check they look like markup.
 *
 *  A diagrammatic brief makes this worse rather than rarer: the more the site draws
 *  instead of photographing, the more of its content lives in exactly this element.
 *  Measured on a real run: 7 figures, 3 localised and 4 hardcoded English, on a site
 *  whose own compliance table claimed every string on the route resolved from a
 *  namespace — one builder had done it properly and set the pattern nothing enforced.
 *
 *  Literal text only. `<title>{t("x")}</title>` and any other `{expression}` pass. */
export function findHardcodedFigureNames(text) {
  const hits = [];
  for (const m of text.matchAll(/<(title|desc)\b[^>]*>([^<]*)</g)) {
    // Only inside an <svg>, and only one the accessibility tree can see. A <title>
    // elsewhere in a .tsx file is not a figure name, and a title inside an
    // aria-hidden or presentational SVG is announced to nobody — flagging either
    // fails correct code. `lastIndexOf("<svg")` was not enough: it treated a
    // self-closing `<svg />`, an `<svg>` inside a string, and a hidden OUTER svg
    // wrapping a plain inner one as all still open. Walk the tags instead.
    if (!isInsideExposedSvg(text, m.index)) continue;

    const raw = m[2];
    const body = raw.trim();
    // A body mixing literal words with an expression still ships the literal half,
    // so `includes("{")` alone let "Figure {n}: signed affidavits" through. Strip
    // expressions DEPTH-AWARE: a non-greedy /\{[^}]*\}/ stops at the first inner
    // brace, so `{t("d", { lines: N })}` left `")}"` behind and the check reported
    // a correctly-localised figure. Found by exactly the false positive this
    // tightening was meant to prevent.
    let literal = "";
    let depth = 0;
    for (const ch of raw) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0) literal += ch;
    }
    literal = literal.trim();
    // Punctuation left over from an expression is not copy. Require real words —
    // in ANY script. /[A-Za-z]{2}/ let a hardcoded CJK or Arabic figure name pass
    // on a kit whose entire purpose is multilingual sites.
    if (!body || !/\p{L}{2}/u.test(literal)) continue;
    hits.push({
      line: lineAt(text, m.index),
      why: `<${m[1]}> carries the literal string "${literal.length > 60 ? literal.slice(0, 57) + "…" : literal}". This is the figure's accessible name — a screen reader reads it aloud, so it is user-facing copy and belongs in next-intl like everything else. Use {t("…")}.`,
    });
  }
  return hits;
}

export function findOutlineNone(text) {
  const hits = [];
  const re = /\boutline-none\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Scope the exemption to THIS element's own class string, not a 400-character
    // window — the window could be satisfied by a different element entirely. And
    // require the paired utility to actually draw something: focus-visible:ring-0
    // and focus-visible:outline-0 remove the indicator just as thoroughly as
    // outline-none does, so they are not a substitute for it.
    const open = text.lastIndexOf('"', m.index);
    const close = text.indexOf('"', m.index);
    const own = open === -1 || close === -1 ? "" : text.slice(open, close);
    if (/focus-visible:(outline|ring)-(?!0\b)[a-z0-9[]/.test(own)) continue;
    hits.push({
      line: lineAt(text, m.index),
      why: "`outline-none` removes the focus ring outright in Tailwind v4 (v3's transparent-ring behaviour is now `outline-hidden`), and it beats the base-layer :focus-visible rule on LAYER ORDER, so globals.css cannot win it back. Keyboard users get no focus indicator. Use `outline-hidden` if a custom ring replaces it.",
    });
  }
  return hits;
}

/** Check 25: `transition-colors` animating the focus ring in from `currentColor`.
 *
 *  Tailwind v4's `transition-colors` property list includes `outline-color`. Put it
 *  on a focusable element and the focus ring does not appear — it INTERPOLATES,
 *  starting at the element's own `currentColor` and reaching the intended colour only
 *  when the transition ends. Measured on a real build with a 160ms duration: 1.06:1
 *  contrast at the instant of focus, 2.81:1 mid-ramp, 5.08:1 settled. The 3:1 floor of
 *  SC 1.4.11 is missed for most of the ramp.
 *
 *  Why a deterministic check and not a review note: it is invisible to source review
 *  (both utilities are individually correct and idiomatic), invisible to a static
 *  screenshot, and invisible to anyone testing with `prefers-reduced-motion: reduce`
 *  set — the reduced-motion rule collapses the duration, so the ring looks instant and
 *  correct. A rendered, timing-dependent defect on the default path is exactly the
 *  class a human reviewer cannot be relied on to catch.
 *
 *  Gated on globals.css actually declaring a base-layer `:focus-visible` outline, the
 *  same way check 24 is gated: a site that never drew a ring has no ring to animate.
 *  That gate is also what makes this check match reality — the ring is normally drawn
 *  ONCE in globals.css, not per element, so requiring a `focus-visible:` utility on the
 *  element itself would look rigorous and catch nothing. (Written that way first; it
 *  passed its unit tests and found zero of the seventeen real occurrences on the site it
 *  was written for.)
 *
 *  Attribution: walk back to the enclosing JSX tag. Tags that cannot take focus are
 *  skipped as noise; an unattributable occurrence — a `const BASE = "… transition-colors"`
 *  shared by every button in the file — is REPORTED, because that is the shape most
 *  likely to be applied to something focusable. */
const FOCUSABLE_UNLIKELY = new Set([
  "div", "span", "section", "article", "header", "footer", "main", "nav", "aside",
  "ul", "ol", "li", "p", "figure", "figcaption", "table", "tr", "td", "th", "form", "fieldset",
]);

export function findFocusRingTransition(text, globalsCss) {
  // No base-layer focus ring declared → nothing for transition-colors to animate.
  if (!/:focus-visible[^{]*\{[^}]*\boutline(-color)?\s*:/.test(globalsCss || "")) return [];
  const hits = [];
  const re = /\btransition-colors\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = text.lastIndexOf("<", m.index);
    const close = text.lastIndexOf(">", m.index);
    // Inside an opening tag only when the nearest `<` is nearer than the nearest `>`.
    const tag = open > close ? (text.slice(open + 1, open + 20).match(/^([A-Za-z][A-Za-z0-9]*)/) || [])[1] : null;
    if (tag && FOCUSABLE_UNLIKELY.has(tag)) continue;
    hits.push({
      line: lineAt(text, m.index),
      why: "`transition-colors` includes `outline-color` in Tailwind v4, so the base-layer :focus-visible ring animates in from `currentColor` instead of appearing — below the 3:1 of WCAG 1.4.11 for most of the transition, and invisible to anyone testing with prefers-reduced-motion set. Use an explicit property list that omits outline-color, e.g. `transition-[color,background-color,border-color]`.",
    });
  }
  return hits;
}

/** Check 21: a client component reads a namespace the locale layout does not ship.
 *
 *  The layout scopes NextIntlClientProvider to a fixed CLIENT_NAMESPACES list so a
 *  page does not inline the whole site's copy. That list is correct only while it
 *  matches reality, and it lives in a LOCKED file — a builder that adds a client
 *  component reading a new namespace gets MISSING_MESSAGE at runtime and cannot fix
 *  the cause. An allowlist nobody can see breaking is worse than no allowlist.
 *
 *  So derive the truth and compare: every "use client" file, every namespace it
 *  passes to useTranslations, checked against what the layout ships. Turns a silent
 *  runtime break into a build-time failure naming the file and the namespace. */
export function findUnshippedClientNamespaces(files, readFile, layoutSrc) {
  const m = layoutSrc.match(/CLIENT_NAMESPACES\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  const shipped = new Set([...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
  const hits = [];
  for (const f of files) {
    const src = readFile(f);
    if (!/^\s*["'`]use client["'`]/m.test(src)) continue;
    for (const u of src.matchAll(/useTranslations\(\s*["']([^"']+)["']/g)) {
      const root = u[1].split(".")[0];
      if (shipped.has(root)) continue;
      hits.push({
        file: f,
        line: lineAt(src, u.index),
        why: 'client component reads namespace "' + u[1] + '", but the locale layout ships only [' +
             [...shipped].join(", ") + ']. It renders MISSING_MESSAGE at runtime, and the layout is a ' +
             'locked file the builder cannot edit. Add "' + root + '" to CLIENT_NAMESPACES, or make this a Server Component.',
      });
    }
  }
  return hits;
}

/** Check 17: `useTranslations` called inside an async component.
 *
 *  App Router pages must be `async` to `await params`, and next-intl's
 *  `useTranslations` is a hook — the two cannot coexist. Next fails the build with
 *  "useTranslations is not callable within an async component"; the fix is
 *  `getTranslations` from next-intl/server, or a sync child component.
 *
 *  Worth a deterministic check because NOTHING else catches it. It is not a type
 *  error, so `tsc --noEmit` passes. It is not a lint rule here. It is a render-time
 *  RSC constraint, so only `next build` surfaces it — and in the Step 6 fan-out the
 *  build runs once, AFTER every route has merged. Observed: a route that passed
 *  tsc, eslint, its own 9-row all-PASS compliance table and its builder's
 *  mechanical verification, and still broke the build.
 *
 *  Scoped to the default-export async component's own body, stopping at the first
 *  nested `function` so a sync child component defined below it is not flagged. */
/** The hosts this deployment answers for.
 *
 *  Derived, not guessed. A host this app redirects *to* is a host this app serves —
 *  the www/www2/www3 consolidation rule is where a rebuild-in-place writes its
 *  canonical hostname down, and it is the only place in the tree that knows it.
 *  site-config's scaffold domain is the other source; an unsubstituted {{DOMAIN}}
 *  means no domain is assigned yet and contributes nothing.
 *
 *  When neither yields a host the caller gets an empty set and check 22 stays
 *  silent, which is the right failure: a check that cannot tell "our host" from
 *  "someone else's" would flag every external link on the site. */
export function ownHosts(configText, siteConfigText = "") {
  const hosts = new Set();
  // ONLY hosts from a host-consolidation rule — one carrying a `has:` host
  // condition, i.e. "when the request arrives on host X, send it to host Y".
  // Both ends of that rule are necessarily this deployment.
  //
  // Taking every absolute destination was wrong: a site that redirects /jobs to
  // https://jobs.example/careers does not SERVE jobs.example, and treating it as
  // ours meant a perfectly good link to https://jobs.example/about got flagged
  // purely because this app also redirects its own /about.
  const block = configText.match(/async redirects\(\)[\s\S]*?\n {2}\}/);
  const scope = block ? block[0] : configText;
  // Per rule OBJECT. A character window spanning rule boundaries paired a `has:`
  // from one rule with a `destination:` from the next, so a redirect to an
  // unrelated third party became an "own host" — the exact false-positive class
  // this tightening was meant to remove.
  for (const m of scope.matchAll(/\bhas:\s*\[/g)) {
    // Walk LEFT with depth, don't take the nearest "{": a rule carrying
    // `missing: [{ type: 'header' }]` before its `has:` put a nested object's
    // brace here, whose match closed before `destination:` was ever reached, and
    // the canonical host went missing entirely.
    let open = -1;
    for (let i = m.index, depth = 0; i >= 0; i--) {
      if (scope[i] === "}") depth++;
      else if (scope[i] === "{") {
        if (depth === 0) { open = i; break; }
        depth--;
      }
    }
    if (open === -1) continue;
    const close = findMatchingBrace(scope, open);
    const rule = close === -1 ? scope.slice(open) : scope.slice(open, close);
    if (!/type:\s*['"`]host['"`]/.test(rule)) continue;
    const dest = rule.match(/destination:\s*['"`]https?:\/\/([^/'"`\s:]+)/);
    if (dest) hosts.add(dest[1].toLowerCase());
  }
  const scaffold = siteConfigText.match(/SCAFFOLD_DOMAIN\s*=\s*["'`]([^"'`]+)["'`]/);
  const clean = (d) => d.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].toLowerCase();
  if (scaffold && !scaffold[1].startsWith("{{")) hosts.add(clean(scaffold[1]));
  // The template's own documented resolution order puts NEXT_PUBLIC_SITE_DOMAIN
  // FIRST and leaves SCAFFOLD_DOMAIN as an unsubstituted {{DOMAIN}} on most sites
  // — the scaffolder no longer prompts for a domain. Reading only the literal
  // meant the standard configuration produced no hosts at all and check 22 went
  // quiet on exactly the sites it was written for. verify-source runs in the same
  // environment as the build, so the variable is right here.
  if (process.env.NEXT_PUBLIC_SITE_DOMAIN) hosts.add(clean(process.env.NEXT_PUBLIC_SITE_DOMAIN));
  return hosts;
}

/** Redirect rules that fire on path alone.
 *
 *  A rule carrying `has:` is conditional — the www consolidation matches
 *  `source: '/:path*'` but only when the request arrives on a www hostname. Feeding
 *  that source to sourceToRegExp yields a pattern matching EVERY path, so counting
 *  it would make check 22 flag every absolute URL in the tree, including the
 *  canonical `@id` values in the site's own JSON-LD. Unconditional rules only. */
export function unconditionalRedirectSources(configText) {
  const block = configText.match(/async redirects\(\)[\s\S]*?\n {2}\}/);
  const scope = block ? block[0] : configText;
  const out = [];
  for (const m of scope.matchAll(/source:\s*['"`]([^'"`]+)['"`]/g)) {
    const open = scope.lastIndexOf("{", m.index);
    if (open === -1) continue;
    const close = findMatchingBrace(scope, open);
    const entry = close === -1 ? scope.slice(open) : scope.slice(open, close);
    if (/\bhas:\s*\[/.test(entry)) continue;
    out.push(m[1]);
  }
  return out;
}

/** Check 22: an absolute outbound link whose path this app already redirects.
 *
 *  Two different failures wear one shape, and the redirect table settles both. If
 *  the host is this deployment, the visitor is bounced back to the page they are
 *  standing on: the reference-router page shipped with its primary call to action
 *  308ing to itself, three times over. If the host is the OLD site, the rebuild
 *  hands the visitor back to the thing it replaced — strictly worse than not
 *  having rebuilt. Either way the app has already declared this path is not where
 *  the content lives.
 *
 *  Found by an SEO auditor after every other lane passed clean, including a
 *  homepage that cited two of its own pages as external "Source:" links. Nothing
 *  about it needs judgment, so nothing about it should have needed an agent. */
export function findSelfRedirectingLinks(text, configText, siteConfigText = "") {
  const hosts = ownHosts(configText, siteConfigText);
  const matchers = unconditionalRedirectSources(configText).map((src) => [src, sourceToRegExp(src)]);
  if (!hosts.size || !matchers.length) return [];
  const hits = [];
  for (const m of text.matchAll(/https?:\/\/([^/'"`\s)<>]+)(\/[^'"`\s)<>]*)?/g)) {
    const host = m[1].toLowerCase().split(":")[0];
    if (!hosts.has(host) && !hosts.has(host.replace(/^www\d?\./, ""))) continue;
    const path = (m[2] || "/").replace(/[#?].*$/, "");
    const hit = matchers.find(([, re]) => re.test(path));
    if (!hit) continue;
    hits.push({
      line: lineAt(text, m.index),
      why: `\`${m[0]}\` points at a path this site redirects (next.config.ts \`source: '${hit[0]}'\`), on a host this deployment answers for. A visitor who clicks it is 301'd — back into this site, or out to the old one. Link to the destination route directly, with next/link if it is internal.`,
    });
  }
  return hits;
}

export function findHookInAsyncComponent(text) {
  const m = text.match(/export\s+default\s+async\s+function\s+\w*\s*\(/);
  if (!m) return [];
  // Walk the PARAMETER list to its closing paren before looking for the body.
  // Searching for the next "{" instead finds the destructuring pattern
  // (`({ params }: {...})`), whose braces then match to the end of the params —
  // so the body is never scanned and the check silently passes on every page.
  let p = m.index + m[0].length - 1, paren = 0, j = p;
  for (; j < text.length; j++) {
    if (text[j] === "(") paren++;
    else if (text[j] === ")" && --paren === 0) break;
  }
  const i = text.indexOf("{", j);
  if (i === -1) return [];
  let depth = 0, end = i;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    else if (text[end] === "}" && --depth === 0) break;
  }
  const body = text.slice(i, end).split(/\bfunction\b/)[0];
  const hit = body.match(/\buseTranslations\s*\(/);
  if (!hit) return [];
  return [{
    line: lineAt(text, i + hit.index),
    why: "useTranslations() is called inside the default-export async component — Next fails the build with \"not callable within an async component\". Use getTranslations() from next-intl/server, or move the markup into a sync child component. tsc does not catch this.",
  }];
}

/** Check 16: every `metaKey` in the route registry resolves to a
 *  {title, description} pair in each locale's messages.
 *
 *  Step 5.3 owns both halves — it reconciles STATIC_ROUTES to the site plan AND
 *  scaffolds `meta.<metaKey>` for every route — so the two drift apart silently
 *  when it registers a route set wider than the meta it writes.
 *
 *  The drift is close to invisible downstream. next-intl's default fallback
 *  renders the key path itself, so the page ships
 *  `<title>meta.support.proSupport.title</title>`: non-empty, not a [NEEDS:]
 *  marker, and 33 characters, which clears every title assertion the delivery
 *  verifier makes. Only the *description* minimum trips, reporting "35 chars
 *  outside 120-160" — a message that sends you to rewrite copy rather than to
 *  the absent key, and only after a build and a running server. This catches it
 *  against the source in milliseconds, before a single page is built. */
export function findMissingRouteMeta(routesSrc, messagesByLocale) {
  // Both quote styles: a registry written with single quotes yielded ZERO keys,
  // so the parity check passed while every locale lacked the metadata. A check
  // that cannot fire is worse than no check, because it reads as a green light.
  // Key may be quoted too: a registry serialised as JSON ({"metaKey":"home"}) yielded
  // zero keys, so the parity check passed while every locale lacked metadata.
  const keys = [...routesSrc.matchAll(/["']?metaKey["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const hits = [];
  for (const [locale, messages] of Object.entries(messagesByLocale)) {
    for (const key of keys) {
      let node = messages?.meta;
      for (const part of key.split(".")) node = node?.[part];
      if (!node || typeof node.title !== "string" || typeof node.description !== "string") {
        hits.push({
          line: 1,
          why: `route metaKey "${key}" has no {title, description} under \`meta\` in messages/${locale}.json — the page will render "meta.${key}.title" as its <title>`,
        });
      }
    }
  }
  return hits;
}

const LAZY_NEEDS_PHRASES = [/from the old/i, /per their/i, /per the old/i, /from their/i, /on the old site/i];

/** Check 7: a `[NEEDS: ...]` marker whose own text names a source it should
 *  already have used — unfinished extraction wearing a client-input marker. */
export function findLazyNeedsMarkers(text) {
  const hits = [];
  const re = /\[NEEDS:([^\]]*)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    for (const phrase of LAZY_NEEDS_PHRASES) {
      const match = body.match(phrase);
      if (match) {
        hits.push({
          line: lineAt(text, m.index),
          why: `marker names a source it should already have used ("${match[0]}") — this is unfinished extraction wearing a client-input marker`,
        });
        break;
      }
    }
  }
  return hits;
}

// ───────────────────────── filesystem driver ─────────────────────────

/** Routes that exist in the build but must never appear in a sitemap. */
/** Extensionless routes that are never sitemap entries. Anything WITH an extension is
 *  caught by shape in `isAssetRoute` instead — naming them one at a time is how
 *  `/og.png` and `/icon.svg` came to be reported as missing pages the moment the kit
 *  moved its social image off Next's `opengraph-image` convention. */
export const SITEMAP_EXCLUDED = new Set(["/_not-found", "/_global-error", "/opengraph-image"]);

/** A generated route serving a file, not a page — `/og.png`, `/sitemap.xml`, `/llms.txt`.
 *  Crawlers reach these by reference or convention; none belongs in a sitemap. */
export function isAssetRoute(path) {
  return /\.[a-z0-9]+$/i.test(path.slice(path.lastIndexOf("/") + 1));
}

/** Reduce a route or absolute URL to a comparable path.
 *
 *  The locale segment is stripped from BOTH sides because the two sources
 *  disagree about it in a way that is correct on each side: with
 *  `localePrefix: 'never'` Next prerenders `/da/byer` (the app-dir segment) while
 *  the proxy serves — and the sitemap rightly advertises — `/byer`. Comparing raw
 *  would flag every route on every single-locale site. Under `'always'` both sides
 *  carry the prefix, so stripping it is a no-op and the comparison still holds. */
export function normalizeRoutePath(input, locales = []) {
  let p = input;
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch { /* keep raw */ } }
  p = p.split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");           // trailingSlash-insensitive
  const segs = p.split("/").filter(Boolean);
  if (segs.length && locales.includes(segs[0])) segs.shift();
  return "/" + segs.join("/");
}

/** Locale + logical route, as ONE identity.
 *
 *  normalizeRoutePath deliberately strips the locale, which is right for asking
 *  "which page is this" and catastrophic for asking "is this page listed": with
 *  generated `/en/about` and `/da/about`, both collapse to `/about`, so a sitemap
 *  containing only the Danish URL satisfied the English one and an entire locale
 *  could vanish while the gate stayed green.
 *
 *  A bare `/about` under `localePrefix: "as-needed"` IS the default locale, so it
 *  must key the same as `/en/about` — keying on the raw prefix instead would
 *  report every default-locale route as missing on the most common config. */
export function localeKeyOf(input, locales = [], defaultLocale = "") {
  let p = input;
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch { /* keep raw */ } }
  const segs = p.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const loc = segs.length && locales.includes(segs[0]) ? segs[0] : defaultLocale || locales[0] || "";
  return `${loc}|${normalizeRoutePath(input, locales)}`;
}

/** Turn an app-router pattern (`/[locale]/[by]`, `/[locale]/artikler/[slug]`) into
 *  a matcher, so a sitemap URL served by a dynamic route is not mistaken for a
 *  dangling one. */
export function dynamicRouteMatcher(pattern, locales = []) {
  // The pattern carries the literal placeholder `[locale]`, not a locale value, so
  // normalizeRoutePath's locale stripping never fires on it. Drop it here or every
  // matcher demands one segment more than the served URL has.
  const stripped = pattern.replace(/\/(page|route)$/, "").replace(/^\/\[(locale|lang)\]/, "");
  const norm = normalizeRoutePath(stripped || "/", locales);
  const body = norm
    .split("/")
    .map((s) =>
      /^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${body}$`);
}

/** Check 14: every redirect must land on a route that exists.
 *
 *  Step 4 maps old URLs against the *planned* route set; Step 6 decides what actually
 *  gets built. When a planned section ships empty — a slug function still returning `[]`
 *  — the redirects survive and point into nothing. A 301 into a 404 is worse than a bare
 *  404: the redirect is spent, so the old URL's ranking transfers to a dead end.
 *
 *  `verify:full` proves redirects *resolve*; check 8 proves the mapping is *complete*.
 *  Neither asks whether the destination exists.
 *
 *  A destination is reachable when it is prerendered, or served by a route with no
 *  dynamic segment of its own (an on-demand page like `/byer` is absent from every
 *  prerender list yet perfectly real). A destination that only matches a dynamic pattern
 *  declaring `dynamicParams = false` is dead unless that exact path was generated —
 *  which is the shipped-empty case. */
export function findDeadRedirectTargets(redirects, prerenderedRoutes, routePatterns, fallbackByPattern = {}, locales = []) {
  const built = new Set(prerenderedRoutes.map((r) => normalizeRoutePath(r, locales)));
  const patterns = routePatterns.map((p) => ({
    raw: p,
    re: dynamicRouteMatcher(p, locales),
    dynamic: /\[[^\]]+\]/.test(p.replace(/^\/\[(locale|lang)\]/, "")),
    fallback: fallbackByPattern[p],
  }));
  const hits = [];
  for (const r of redirects) {
    if (r.internal) continue;
    if (/^https?:\/\//i.test(r.destination)) continue;
    if (/:[a-zA-Z]/.test(r.destination)) continue;   // param-substituting; needs the source to resolve
    const dest = normalizeRoutePath(r.destination, locales);
    if (built.has(dest)) continue;
    const matched = patterns.filter((p) => p.re.test(dest));
    if (matched.some((p) => !p.dynamic || p.fallback !== false)) continue;
    hits.push({
      line: 1,
      why: matched.length
        ? `redirect ${r.source} → ${r.destination} lands on a dynamic route that generated zero pages and refuses unknown params — it 301s into a 404, spending the old URL's ranking on a dead end. Either build the destination or repoint the redirect at a route that exists.`
        : `redirect ${r.source} → ${r.destination} names a route that does not exist in this build — it 301s into a 404, which is worse than leaving the old URL alone.`,
    });
  }
  return hits;
}

/** Check 11: the sitemap and the built route set must agree, in both directions.
 *
 *  The failure this exists for is silent and green. The route registry is a data
 *  constant that Step 5.3 rewrites per site, but the machine-facing surfaces reach
 *  dynamic routes through *functions* — and a leftover `getServiceSlugs()` from the
 *  template compiles, type-checks, and returns `[]`. The sitemap then emits valid
 *  XML containing none of the product. On a directory site that is the entire SEO
 *  value, absent, with every existing check passing.
 *
 *  Direction A (prerendered but unlisted) is that bug. Direction B (listed but not
 *  generated) is the inverse: advertising URLs that 404. */
/** Routes whose own rendered `<meta name="robots">` says noindex.
 *
 *  Read from the emitted HTML rather than from a route registry, because the
 *  registry states intent and the meta tag is what a crawler acts on. */
export function findNoindexRoutes(htmlByRoute, locales = [], defaultLocale = "") {
  const out = new Set();
  for (const [route, html] of htmlByRoute) {
    const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
    if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*\bnoindex\b/i.test(head)) {
      // Per LOCALE. Keyed by logical route alone, one locale's noindex exempted
      // every other locale's copy of that page from coverage entirely. Keyed by
      // the PUBLIC route, because that is the form every route this feeds is
      // compared in — a mirrored page's HTML is filed under the handler path.
      out.add(localeKeyOf(publicRouteOf(route), locales, defaultLocale));
    }
  }
  return out;
}

/** Mirrored pages (replicate mode) are prerendered under the internal handler
 *  `/api/mirror-page/<path>` and served at `<path>` through the proxy's rewrite;
 *  the sitemap rightly advertises the public form. */
export function publicRouteOf(route) {
  const m = route.match(/^\/api\/mirror-page(?=\/|$)(.*)$/);
  if (!m) return route;
  return m[1] === "" ? "/" : m[1];
}

export function findSitemapCoverageGaps(prerenderedRoutes, sitemapUrls, dynamicPatterns = [], locales = [], noindexRoutes = new Set(), defaultLocale = "") {
  const hits = [];
  const norm = (p) => normalizeRoutePath(p, locales);
  // Identity is locale + route. Comparing on the logical route alone let a sitemap
  // that omitted an entire locale satisfy every route in it.
  const key = (p) => localeKeyOf(p, locales, defaultLocale);
  const shown = (raw) => (locales.length > 1 ? key(raw).replace("|", " ") : norm(raw));

  const listed = new Set(sitemapUrls.map(key));
  const generated = new Set(prerenderedRoutes.map(key));
  const matchers = dynamicPatterns.map((p) => dynamicRouteMatcher(p, locales));

  for (const raw of prerenderedRoutes) {
    const p = norm(raw);
    if (SITEMAP_EXCLUDED.has(p) || isAssetRoute(p) || p.startsWith("/api")) continue;
    // A noindex route belongs in neither direction: it is deliberately not for
    // the index, so its absence is correct and demanding it was this check
    // OVERREACHING into a decision it does not own. That was not theoretical —
    // a real site shipped its privacy and cookie pages in the sitemap with a
    // source comment explaining they were there "because check 11 fails any
    // generated route that is absent", which is a gate dictating a defect.
    // Google reports the result as "Submitted URL marked noindex".
    if (noindexRoutes.has(key(raw))) continue;
    if (!listed.has(key(raw))) {
      hits.push({ line: 1, why: `route "${shown(raw)}" is generated but absent from the sitemap — crawlers will never be told it exists` });
    }
  }

  // Direction C: the inverse of the overreach. Having stopped demanding these,
  // demand the opposite — a sitemap entry is a request to index, so listing a
  // page that tells crawlers not to index it asks for two contradictory things.
  for (const raw of sitemapUrls) {
    if (!noindexRoutes.has(key(raw))) continue;
    hits.push({ line: 1, why: `sitemap advertises "${shown(raw)}" but the page's own robots meta says noindex — a sitemap entry asks crawlers to index a URL the page then tells them not to. Google reports it as "Submitted URL marked 'noindex'". Drop it from the sitemap, or drop the noindex.` });
  }

  for (const raw of sitemapUrls) {
    const p = norm(raw);
    if (generated.has(key(raw))) continue;
    if (matchers.some((re) => re.test(p))) continue;
    hits.push({ line: 1, why: `sitemap advertises "${shown(raw)}" but no route generates it — this URL will 404 for every crawler that follows it` });
  }

  return hits;
}

/** Check 27 (built half): every `<iframe src>` or `<script src>` in rendered markup
 *  that loads from a host this deployment does not serve. Any one of them contacts a
 *  third party — and may read or write the visitor's device — before the visitor has
 *  asked for anything, which EU ePrivacy rules forbid without consent. A facade
 *  carries its URL in `data-embed-src` and is not an iframe until clicked, so it
 *  passes. Protocol-relative URLs count: the browser fills in the scheme. */
export function findThirdPartyFrames(html, hosts = new Set()) {
  const hits = [];
  for (const tag of scanStartTags(html)) {
    if (tag.name !== "iframe" && tag.name !== "script") continue;
    // A lazy-loader or consent tool parks the real source in a data-* attribute
    // (src is then empty or about:blank) and loads it without a click.
    for (const name of FRAME_SRC_ATTRS) {
      const raw = String(tag.attrs.get(name) ?? "").trim();
      if (!/^(?:https?:)?\/\//i.test(raw)) continue;
      let host;
      try {
        host = new URL(raw, "https://placeholder.invalid").hostname.toLowerCase();
      } catch {
        continue;
      }
      if (!hosts.has(host)) hits.push({ tag: tag.name, url: raw, host, line: lineAt(String(html), tag.start) });
      break;
    }
  }
  return hits;
}

/** Same list, same order as the kit's facadeIframes reads (EMBED_SRC_ATTRS). */
const FRAME_SRC_ATTRS = ["data-src", "data-cmplz-src", "data-cookieblock-src", "data-lazy-src", "src"];

const RAW_TEXT_TAGS = new Set(["script", "style", "iframe", "textarea", "title", "xmp", "noembed", "noframes"]);
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/** Keep in sync with scanStartTags in the kit plugin's scripts/lib/mirror-core.mjs
 *  (values are left undecoded here) — check 27 flags exactly the frames its
 *  facadeIframes replaces, and a kit test holds the two together.
 *
 *  Every start tag in `html`, read the way a browser tokenizes it: a `>` inside
 *  a quoted attribute value does not end the tag, comments hide what they
 *  contain, and the text inside a raw-text element (script, style, iframe, …)
 *  is not markup. Attribute names are lowercased and the first of a repeated
 *  name wins. `close` is the index just after a raw-text element's end tag
 *  (-1 when it has none); `end` is the index just after the start tag's `>`. */
export function scanStartTags(html) {
  const s = String(html);
  const tags = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    if (s.startsWith("<!--", lt)) {
      const e = s.indexOf("-->", lt + 4);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s[lt + 1] === "!" || s[lt + 1] === "?" || s[lt + 1] === "/") {
      const e = s.indexOf(">", lt + 2);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(s[lt + 1] || "")) { i = lt + 1; continue; }
    let j = lt + 1;
    while (j < s.length && !isSpace(s[j]) && s[j] !== "/" && s[j] !== ">") j++;
    const name = s.slice(lt + 1, j).toLowerCase();
    const attrs = new Map();
    let end = -1;
    while (j < s.length) {
      while (j < s.length && (isSpace(s[j]) || s[j] === "/")) j++;
      if (j >= s.length) break;
      if (s[j] === ">") { end = j + 1; break; }
      const n0 = j;
      j++;
      while (j < s.length && !isSpace(s[j]) && s[j] !== "/" && s[j] !== ">" && s[j] !== "=") j++;
      const attr = s.slice(n0, j).toLowerCase();
      let k = j;
      while (k < s.length && isSpace(s[k])) k++;
      let value = "";
      if (s[k] === "=") {
        k++;
        while (k < s.length && isSpace(s[k])) k++;
        if (s[k] === '"' || s[k] === "'") {
          const q = s.indexOf(s[k], k + 1);
          if (q < 0) { j = s.length; break; }
          value = s.slice(k + 1, q);
          k = q + 1;
        } else {
          const v0 = k;
          while (k < s.length && !isSpace(s[k]) && s[k] !== ">") k++;
          value = s.slice(v0, k);
        }
        j = k;
      }
      if (!attrs.has(attr)) attrs.set(attr, value);
    }
    if (end < 0) break; // a tag cut off by the end of the document is no tag
    let close = -1;
    if (RAW_TEXT_TAGS.has(name)) {
      const m = new RegExp(`</${name}[\\s/>]`, "i").exec(s.slice(end));
      if (m) {
        const gt = s.indexOf(">", end + m.index);
        close = gt < 0 ? s.length : gt + 1;
      }
    }
    tags.push({ name, attrs, start: lt, end, close });
    i = close > 0 ? close : end;
  }
  return tags;
}


/** Check 27 (source half): a raw `<iframe>` or an external `<script src>` /
 *  `next/script` written into a component. Only src/components/embeds/ may create
 *  a third-party frame, and only after a click. Comments are masked so a component
 *  documenting the rule is not read as breaking it. */
export function findThirdPartyEmbedsInSource(text) {
  const code = maskComments(text);
  const hits = [];
  for (const m of code.matchAll(/<iframe\b/g)) {
    hits.push({
      line: lineAt(code, m.index),
      why: "raw <iframe> — it loads its provider (and may set cookies) before the visitor asks. Use VideoFacade or MapFacade from src/components/embeds/, which load the frame only on click.",
    });
  }
  for (const m of code.matchAll(/<(?:script|Script)\b[^>]*?\ssrc=\{?\s*["'`]((?:https?:)?\/\/[^"'`]+)/g)) {
    hits.push({
      line: lineAt(code, m.index),
      why: `external script ${m[1]} — it contacts a third party on page load, before the visitor has agreed to anything. Self-host it, or gate it behind a click or consent.`,
    });
  }
  return hits;
}

/** The name a policy must use for each facade provider. The provider's own
 *  product name, never its parent company: "Google" is already in a policy that
 *  only discloses Google Analytics. */
export const EMBED_PROVIDER_NAMES = {
  youtube: ["YouTube"],
  vimeo: ["Vimeo"],
  "google-maps": ["Google Maps"],
};

/** The providers src/components/embeds/site-providers.ts grants frame-src to. */
export function siteEmbedProviders(text) {
  const list = maskComments(String(text)).match(/SITE_EMBED_PROVIDERS\b[^=]*=\s*\[([^\]]*)\]/);
  return list ? new Set([...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])) : null;
}

/** Providers the site's facades can load: a VideoFacade with a `provider`, and a
 *  MapFacade offering the interactive Google embed. A self-hosted VideoFacade and a
 *  static-only MapFacade load nothing third-party and need no disclosure. */
export function facadeProvidersInSource(text) {
  const code = maskComments(text);
  const out = new Set();
  for (const m of code.matchAll(/<VideoFacade\b[^>]*?\sprovider=["'{]*(youtube|vimeo)/g)) out.add(m[1]);
  for (const m of code.matchAll(/<MapFacade\b([^>]*)>/g)) {
    if (/\sinteractive(?!\s*=\s*\{\s*false\s*\})\b/.test(m[1])) out.add("google-maps");
  }
  return out;
}

/** Providers a mirrored page's facades load (written by facadeIframes). An embed
 *  from an unrecognised provider is named by its host. */
export function facadeProvidersInMirror(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/<[a-z]+\b([^>]*\bdata-embed-provider="([^"]+)"[^>]*)>/gi)) {
    if (m[2] !== "other") out.add(m[2]);
    else {
      const host = m[1].match(/\bdata-embed-host="([^"]+)"/)?.[1];
      if (host) out.add(host);
    }
  }
  return out;
}

/** Check 27 (policy half): a provider the facades load that the cookie policy
 *  never names. Clicking a facade is the visitor's consent to that provider, and
 *  consent is only informed if the policy says who it is and what it sets. */
export function findUnnamedEmbedProviders(providers, policyText) {
  const text = String(policyText).toLowerCase();
  const hits = [];
  for (const p of providers) {
    const names = EMBED_PROVIDER_NAMES[p] ?? [p.replace(/^www\./, "").split(".").slice(-2)[0]];
    if (names.some((n) => text.includes(n.toLowerCase()))) continue;
    hits.push({
      line: 1,
      why: `a facade loads ${names[0]} on click, but neither the cookie nor the privacy policy names ${names[0]}. Add it to the policy's third-party section: what loads on click, what it may set, and a link to the provider's privacy policy.`,
    });
  }
  return hits;
}

/** Check 12: content deferred behind JavaScript in a PRERENDERED page.
 *
 *  A route-level `loading.tsx` wraps its segment in a Suspense boundary. When that
 *  boundary suspends, React streams the real markup as `<div hidden id="S:n">` and
 *  swaps it in on the client — so with JavaScript disabled, blocked, or simply slow,
 *  the visitor sees the fallback and the content is unreachable.
 *
 *  On a static marketing site the boundary buys nothing (every page is prerendered)
 *  and can cost everything. Measured on an emergency-services directory: every
 *  listed 24/7 phone number sat inside the boundary, leaving the advertising sales
 *  line as the only `tel:` a no-JS visitor could reach — on the exact site whose
 *  entire purpose is reaching a plumber at 2am.
 *
 *  `html` is one prerendered page's markup. */
export function findJsDeferredContent(html, file) {
  const deferred = [...html.matchAll(/<div hidden id="S:(\d+)"/g)];
  if (!deferred.length) return [];
  const tel = /href="tel:/.test(html);
  return [
    {
      line: 1,
      why:
        `${file} defers ${deferred.length} content block(s) behind JavaScript (\`div hidden id="S:"\`) — ` +
        `a Suspense boundary, usually from a route-level loading.tsx. With JS off or slow the visitor sees the ` +
        `fallback, not this content` +
        (tel ? `, and this page contains tel: links — phone numbers must never require JavaScript.` : `.`) +
        ` A prerendered page has nothing to stream: delete the loading.tsx for this segment, or move the boundary ` +
        `below the content that must always render.`,
    },
  ];
}

/** Check 13: an unresolved `[NEEDS:]` marker that reached rendered output.
 *
 *  Markers are internal notes to the client and sometimes address them by name, so one
 *  on a live page is a disclosure defect, not a cosmetic one. `.placeholder-content`
 *  was a naming convention nothing enforced; this is what makes it a contract. Render
 *  possibly-client-owed copy through the `Placeholder` component, which drops the
 *  marker outside dev and preview.
 *
 *  Script blocks are stripped first: Next embeds the RSC flight payload in `<script>`
 *  tags, which duplicates page text and inflates a naive count several-fold. */
export function findRenderedPlaceholders(html, file) {
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const markers = [...visible.matchAll(/\[NEEDS:\s*([^\]]*)\]/g)];
  if (!markers.length) return [];
  const shown = markers.slice(0, 3).map((m) => m[1].trim().slice(0, 60));
  return [
    {
      line: 1,
      why:
        `${file} renders ${markers.length} unresolved [NEEDS:] marker(s) as visible text — ` +
        `${shown.map((s) => `"${s}…"`).join(", ")}. These are internal notes to the client and must never ` +
        `reach a live page. Render the copy through the Placeholder component (src/components/Placeholder.tsx), ` +
        `passing a truthful fallback where the page is obliged to say something.`,
    },
  ];
}

/** A Next.js rewrite `source` as an anchored regex (the subset of path-to-regexp
 *  sites use: literals, `:name`, `:name*`, `:name+`, `:name?`, `:name(re)`). */
export function nextSourceToRegex(source) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = "";
  let i = 0;
  while (i < source.length) {
    const param = /^\/:[A-Za-z_]\w*/.exec(source.slice(i));
    if (!param) { out += esc(source[i]); i++; continue; }
    i += param[0].length;
    let pattern = "[^/]+";
    if (source[i] === "(") {
      let depth = 0, j = i;
      for (; j < source.length; j++) {
        if (source[j] === "\\") { j++; continue; }
        if (source[j] === "(") depth++;
        else if (source[j] === ")" && --depth === 0) break;
      }
      pattern = source.slice(i + 1, j);
      i = j + 1;
    }
    const mod = "*+?".includes(source[i] ?? "") ? source[i++] : "";
    if (mod === "*") out += `(?:/${pattern === "[^/]+" ? ".*" : `(?:${pattern})`})?`;
    else if (mod === "+") out += `/${pattern === "[^/]+" ? ".+" : `(?:${pattern})`}`;
    else if (mod === "?") out += `(?:/(?:${pattern}))?`;
    else out += `/(?:${pattern})`;
  }
  return `^${out}(?:/)?$`;
}

/** Rewrites in next.config.ts or vercel.json whose destination is another origin: a
 *  first-party path that forwards the visitor's request to a third party (a proxied
 *  tracker). */
export function externalRewrites(configText) {
  const code = maskComments(String(configText));
  const str = String.raw`(['"\x60])((?:\\.|(?!\1).)*)\1`;
  const pairs = [
    [new RegExp(String.raw`\bsource["']?\s*:\s*${str}\s*,\s*["']?destination["']?\s*:\s*${str.replaceAll("\\1", "\\3")}`, "g"), 2, 4],
    [new RegExp(String.raw`\bdestination["']?\s*:\s*${str}\s*,\s*["']?source["']?\s*:\s*${str.replaceAll("\\1", "\\3")}`, "g"), 4, 2],
  ];
  const out = [];
  for (const [re, si, di] of pairs) {
    for (const m of code.matchAll(re)) {
      const source = m[si].replace(/\\\\/g, "\\");
      const destination = m[di];
      if (!/^https?:\/\//i.test(destination)) continue;
      let origin;
      try { origin = new URL(destination).origin; } catch { continue; }
      out.push({ source, destination, origin, line: lineAt(code, m.index), index: m.index, regex: nextSourceToRegex(source) });
    }
  }
  return out.sort((a, b) => a.index - b.index).map(({ index, ...r }) => r);
}

/** The consent purposes src/lib/site-consent.ts declares. */
export function siteConsentPurposes(text) {
  const list = maskComments(String(text)).match(/SITE_CONSENT_PURPOSES\b[^=]*=\s*\[([^\]]*)\]/);
  return list ? new Set([...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])) : null;
}

/** Check 28: what each tracker stores on or reads from the visitor's device for.
 *  Strings are scanned on purpose — a tracker's URL in a string is how it loads —
 *  but comments and link targets are masked. Google Tag Manager is a container for
 *  anything, so it counts as marketing: the conservative reading of what it will be
 *  used to load; it is matched by its loader only, since a bare GTM-1234 is as
 *  often a product code. `gate: true` marks the gated wrapper itself; `fix` is the
 *  remedy when a signature is used outside a consent check. */
const Q = "[\"'`]";
const sig = (purpose, what, source, extra = {}) => ({ purpose, what, re: new RegExp(source, "g"), ...extra });
const VERCEL_FIX = "Render <AnalyticsGate /> and send events with trackWithConsent() from @/lib/analytics.";
export const TRACKER_SIGNATURES = [
  sig("analytics", "trackWithConsent()", String.raw`\btrackWithConsent\s*\(`, { gate: true }),
  sig("analytics", "Vercel Web Analytics (@vercel/analytics)", `${Q}@vercel/analytics(?:/[\\w-]+)?${Q}`, { fix: VERCEL_FIX }),
  sig("analytics", "Vercel Speed Insights (@vercel/speed-insights)", `${Q}@vercel/speed-insights(?:/[\\w-]+)?${Q}`, {
    fix: "Render <SpeedInsights /> inside AnalyticsGate, next to <Analytics />, where it loads only after the visitor accepts analytics.",
  }),
  sig("analytics", "Google Analytics", String.raw`googletagmanager\.com\/gtag|google-analytics\.com|\bgtag\s*\(|<GoogleAnalytics\b`),
  sig("analytics", "Hotjar", String.raw`\bhotjar\.com`),
  sig("analytics", "Microsoft Clarity", String.raw`\bclarity\.ms`),
  sig("analytics", "Plausible", String.raw`\bplausible\.io`),
  sig("analytics", "PostHog", `${Q}posthog-js(?:/[\\w-]+)?${Q}|\\.posthog\\.com\\b`),
  sig("analytics", "Mixpanel", `${Q}mixpanel-browser${Q}|cdn\\.mxpnl\\.com|\\bapi(?:-js)?\\.mixpanel\\.com`),
  sig("analytics", "Segment", `${Q}@segment/analytics-[\\w-]+${Q}|cdn\\.segment\\.com|api\\.segment\\.io`),
  sig("analytics", "Fathom", `${Q}fathom-client${Q}|cdn\\.usefathom\\.com`),
  sig("analytics", "Umami", `\\bumami\\.is\\b|${Q}@umami/[\\w-]+${Q}|\\bumami\\.track\\s*\\(`),
  sig("analytics", "Matomo", String.raw`\b_paq\b|\bmatomo\.js\b|\bpiwik\.js\b`),
  sig("analytics", "a beacon to another origin (navigator.sendBeacon)", `\\bnavigator\\.sendBeacon\\s*\\(\\s*${Q}(?:https?:)?//`),
  sig("marketing", "Google Tag Manager", String.raw`googletagmanager\.com\/(?:gtm|ns\.html)|\bgtm\.js\b|<GoogleTagManager\b`),
  sig("marketing", "Meta Pixel", String.raw`connect\.facebook\.net|\bfbq\s*\(|facebook\.com\/tr\b`),
  sig("marketing", "LinkedIn Insight", String.raw`snap\.licdn\.com|\b_linkedin_partner_id\b|px\.ads\.linkedin\.com`),
  sig("marketing", "Google Ads", String.raw`googleadservices\.com|doubleclick\.net|googlesyndication\.com`),
  sig("marketing", "TikTok Pixel", String.raw`analytics\.tiktok\.com`),
];

/** Blank the target of a link — a policy that links to Google's privacy page loads
 *  nothing. Only <a>, <Link> and `href:` in data: a <link href> does connect. */
function maskLinkTargets(code) {
  const blank = (m, url) => m.slice(0, m.length - url.length - 1) + " ".repeat(url.length) + m.slice(-1);
  return code
    .replace(/<(?:a|Link)\b[^<>]*?\shref\s*=\s*\{?\s*(["'`])([^"'`\n]*)\1/g, (m, _q, url) => blank(m, url))
    .replace(/\bhref\s*:\s*(["'`])([^"'`\n]*)\1/g, (m, _q, url) => blank(m, url));
}

/** Signatures for the site's own paths that a rewrite forwards to another origin. */
export function proxiedTrackerSignatures(rewrites) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = [];
  for (const r of rewrites) {
    const cut = r.source.search(/[:(]/);
    const prefix = cut === -1 ? r.source : r.source.slice(0, cut);
    if (prefix.replace(/\//g, "") === "") continue;
    out.push(sig("analytics", `${r.origin} through the rewrite ${r.source}`, `${Q}${esc(prefix)}${cut === -1 ? `(?=${Q}|[?#])` : ""}`));
  }
  return out;
}

/** One hit per line. `extra`: signatures for this site's proxy rewrites. `html`: the
 *  text is a mirrored page, whose comments are <!-- --> and whose apostrophes are prose. */
export function trackerPurposesInSource(text, extra = [], { html = false } = {}) {
  const raw = String(text);
  const code = maskLinkTargets(html ? raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")) : maskComments(raw));
  const hits = [];
  for (const { re, ...s } of [...TRACKER_SIGNATURES, ...extra]) {
    for (const m of code.matchAll(re)) hits.push({ ...s, line: lineAt(code, m.index), index: m.index });
  }
  const seen = new Set();
  return hits
    .sort((a, b) => a.index - b.index)
    .filter((h) => !seen.has(h.line) && seen.add(h.line))
    .map(({ index, ...h }) => h);
}

/** A <script>/<Script> whose src is an expression neither check 27 nor check 28 can
 *  read. A same-origin string constant in the same file is resolved and allowed. */
export function nonLiteralScriptSrcs(text) {
  const code = maskComments(String(text));
  const hits = [];
  for (const m of code.matchAll(/<(?:script|Script)\b[^>]*?\ssrc=\{\s*(?!["'`])([^}]*)\}/g)) {
    const expr = m[1].trim();
    const line = lineAt(code, m.index);
    const decl = /^[A-Za-z_$][\w$]*$/.test(expr)
      ? code.match(new RegExp(String.raw`\b(?:const|let|var)\s+${expr.replace(/\$/g, "\\$")}\b\s*(?::[^=]+)?=\s*(["'\`])([^"'\`]*)\1`))
      : null;
    if (!decl) {
      hits.push({ line, why: `<script src={${expr}}> — cannot tell what this loads, so neither the third-party nor the consent check can judge it. Write the src as a literal, or as a same-origin string constant in this file.` });
    } else if (/^(?:https?:)?\/\//i.test(decl[2])) {
      hits.push({ line, why: `<script src={${expr}}> loads ${decl[2]} from another origin through a variable the third-party check cannot see. Write the src literally, and gate it by consent or a click.` });
    }
  }
  return hits;
}

/** Check 28 (policy half): the cookie inventory in one locale's messages against
 *  the declaration. Only judged once an inventory exists (a cookie named by its
 *  technical name); prose alone is left to review. */
export function findCookieInventoryGaps(text, bannerShown, usesBotId = false) {
  const s = String(text);
  const namesLocale = s.includes("NEXT_LOCALE");
  const namesConsent = s.includes("cookie-consent");
  if (!namesLocale && !namesConsent) return [];
  const hits = [];
  if (!namesLocale) hits.push({ line: 1, why: "the cookie inventory omits NEXT_LOCALE — next-intl sets it when the visitor chooses a language or lands on one other than their browser's: a session cookie with no identifier that remembers the site language (strictly necessary). List it." });
  if (bannerShown && !namesConsent) hits.push({ line: 1, why: "the site declares consent purposes and shows a banner, but the cookie inventory omits cookie-consent (1 year, strictly necessary: stores the visitor's choice). List it." });
  if (usesBotId && !/\bBotID\b/i.test(s)) hits.push({ line: 1, why: "the site runs Vercel BotID on the contact form (src/instrumentation-client.ts), but the cookie policy does not disclose it. Say that it is Vercel's bot protection, that it reads browser signals when the form is sent to stop spam, and that it is necessary for the form." });
  if (!bannerShown && namesConsent) hits.push({ line: 1, why: "the cookie inventory lists cookie-consent, but the site declares no consent purposes (src/lib/site-consent.ts), shows no banner and never sets it. Say the site stores only strictly necessary items and list those." });
  return hits;
}

/** Locales come from the routing module, not a guess — every route comparison here
 *  hinges on stripping exactly the segments next-intl adds. */
function readLocales(root) {
  const routingPath = join(root, "src", "i18n", "routing.ts");
  if (!existsSync(routingPath)) return [];
  const list = readFileSync(routingPath, "utf8").match(/locales\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...list.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

/** The locale that carries no prefix under `localePrefix: "as-needed"`. */
function readDefaultLocale(root, locales) {
  const routingPath = join(root, "src", "i18n", "routing.ts");
  if (!existsSync(routingPath)) return locales[0] ?? "";
  const m = readFileSync(routingPath, "utf8").match(/defaultLocale\s*:\s*["'`]([^"'`]+)["'`]/);
  return m ? m[1] : locales[0] ?? "";
}

function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function main() {
  const fails = [];
  const skips = [];
  let passes = 0;
  const relPath = (abs) => relative(root, abs);
  const report = (file, hits) => {
    if (hits.length) for (const h of hits) fails.push(`${relPath(file)}:${h.line} — ${h.why}`);
    else passes++;
  };
  const runFileCheck = (files, checkFn, ...args) => {
    for (const file of files) report(file, checkFn(readFileSync(file, "utf8"), ...args));
  };

  const mode = readPipelineMode(root);
  console.log(`verify-source → template source tree${WARN_ONLY ? " (--warn-only)" : ""}${mode !== "redesign" ? ` (mode: ${mode})` : ""}`);

  // Replicate mode: the client's own words are exempt from checks 9 and 19 — see
  // crawl-corpus.mjs. A replicate site with no crawl is a broken hand-off (the
  // front half never ran), and must fail rather than quietly exempt nothing.
  let exemptCorpus = null;
  if (mode === "replicate") {
    exemptCorpus = loadCrawlCorpus(root);
    if (!exemptCorpus.pages) fails.push(".redesign-state/pipeline-mode is replicate but .redesign-state/crawl/ holds no page JSON — the /replicate front half did not run");
  }

  // ── Check 9: banned marketing phrases ───────────────────────────────────────
  {
    const msgs = existsSync(join(root, "messages"))
      ? readdirSync(join(root, "messages")).filter((f) => f.endsWith(".json")).map((f) => join(root, "messages", f))
      : [];
    if (msgs.length) {
      runFileCheck(msgs, findBannedCopy, BANNED_COPY, { exemptCorpus });
      // Check 19: build vocabulary. Same mechanism, different (worse) failure —
      // see BANNED_BUILD_VOCAB. Scans every locale monolith AND every per-route
      // fragment, because the fan-out writes fragments and the merge composes them.
      const fragments = walk(join(root, "messages"), [".json"]);
      for (const f of fragments) {
        report(f, findBannedCopy(readFileSync(f, "utf8"), BANNED_BUILD_VOCAB, { exemptCorpus }).map((h) => ({
          ...h,
          why: h.why.replace(
            /category-generic filler.*$/,
            "build vocabulary — it describes how the site was MADE, on a page meant for a customer. Put the gap in the compliance file, which the orchestrator reads. The visitor gets the content or nothing; never a narration of why it is missing.",
          ),
        })));
      }
    } else skips.push("banned copy — no messages/*.json yet");
  }

  // ── Check 10: shared JS budget ──────────────────────────────────────────────
  {
    const appDir = join(root, ".next", "server", "app");
    const pages = existsSync(appDir) ? walk(appDir, [".html"]) : [];
    if (!pages.length) {
      skips.push("shared JS budget — no prerendered pages (run `npm run build` first)");
    } else {
      const files = sharedScriptSrcs(pages.map((p) => readFileSync(p, "utf8")))
        .map((s) => join(root, ".next", s.replace(/^\/_next\//, "")))
        .filter((f) => existsSync(f));
      const bytes = files.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
      console.log(`  shared client JS: ${(bytes / 1024).toFixed(0)} KB gzipped across ${pages.length} routes (budget ${JS_BUDGET_KB} KB)`);
      report(pages[0], sharedJsBudgetHit(bytes, JS_BUDGET_KB));
    }
  }

  // ── Check 29: image weight ──────────────────────────────────────────────────
  {
    const publicDir = join(root, "public");
    const skipDirs = [join(publicDir, "_mirror") + "/", join(publicDir, "images", "old-site-screenshots") + "/"];
    // Every file, then by lowercased extension: `walk` matches case as written,
    // and a camera writes .JPG where a phone writes .Jpeg.
    const raster = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
    const images = walk(publicDir, [""])
      .filter((f) => raster.has(extname(f).toLowerCase()) && !skipDirs.some((d) => f.startsWith(d)))
      .map((f) => ({ path: f, bytes: statSync(f).size }))
      // Only an image over the budget is opened to look for the mark.
      .map((f) => ({ ...f, marked: f.bytes > IMAGE_BUDGET_KB * 1024 && /c2pa/i.test(readFileSync(f.path, "latin1")) }));
    const heavy = findHeavyImages(images, IMAGE_BUDGET_KB);
    for (const h of heavy) report(h.path, [h]);
    if (images.length && !heavy.length) passes++;
  }

  // ── Check 12: JS-deferred content in prerendered pages ─────────────────────
  {
    const appDir = join(root, ".next", "server", "app");
    if (!existsSync(appDir)) {
      skips.push("JS-deferred content — no build output (run `npm run build` first)");
    } else {
      const pages = walk(appDir, [".html"]);
      if (!pages.length) skips.push("JS-deferred content — no prerendered pages found");
      // A preview build renders markers on purpose — that is what the client tours.
      const preview = process.env.VERCEL_ENV === "preview";
      if (preview) skips.push("rendered placeholders — preview build renders markers by design");
      for (const page of pages) {
        const html = readFileSync(page, "utf8");
        report(page, findJsDeferredContent(html, relPath(page)));
        if (!preview) report(page, findRenderedPlaceholders(html, relPath(page)));
      }
    }
  }

  // ── Check 27: third-party frame before interaction ──────────────────────────
  {
    const cfg = join(root, "next.config.ts");
    const sc = join(root, "src/lib/site-config.ts");
    const hosts = ownHosts(existsSync(cfg) ? readFileSync(cfg, "utf8") : "", existsSync(sc) ? readFileSync(sc, "utf8") : "");
    const embedsDir = join(root, "src", "components", "embeds");
    const sourceFiles = walk(join(root, "src"), [".tsx", ".jsx", ".ts", ".js"]).filter(
      (f) => !f.startsWith(embedsDir + "/") && !/\.test\.[jt]sx?$/.test(f),
    );
    for (const f of sourceFiles) report(f, findThirdPartyEmbedsInSource(readFileSync(f, "utf8")));

    const appDir = join(root, ".next", "server", "app");
    if (!existsSync(appDir)) {
      skips.push("third-party frames in built output — no build output (run `npm run build` first)");
    } else {
      // `.body` too: a mirrored page is prerendered as a route handler.
      for (const f of walk(appDir, [".html", ".body"])) {
        report(
          f,
          findThirdPartyFrames(readFileSync(f, "utf8"), hosts).map((h) => ({
            line: h.line,
            why:
              `<${h.tag} src="${h.url}"> loads from ${h.host} before the visitor asks — no request, frame or cookie may reach a ` +
              `third party until a click. Use VideoFacade/MapFacade; on a mirrored page run \`site-mirror.mjs facade\`.`,
          })),
        );
      }
    }

    const used = new Map();
    const note = (providers, file) => { for (const p of providers) if (!used.has(p)) used.set(p, file); };
    for (const f of sourceFiles) note(facadeProvidersInSource(readFileSync(f, "utf8")), f);

    // frame-src grants the providers listed in site-providers.ts (next.config.ts
    // reads it) — exactly those the source uses: one missing blocks the frame
    // the visitor asked for, one extra lets a frame load that nothing offers.
    const listFile = join(embedsDir, "site-providers.ts");
    if (existsSync(listFile)) {
      const listText = readFileSync(listFile, "utf8");
      const listed = siteEmbedProviders(listText);
      const line = listed ? lineAt(listText, listText.indexOf("SITE_EMBED_PROVIDERS")) : 1;
      const hits = [];
      if (!listed) hits.push({ line, why: "cannot read the SITE_EMBED_PROVIDERS array — keep it a plain list of provider names" });
      else {
        for (const [p, file] of used) {
          if (!listed.has(p)) hits.push({ line, why: `"${p}" is used by ${relPath(file)} but missing from SITE_EMBED_PROVIDERS, so the CSP's frame-src blocks the frame the visitor asks for. Add it.` });
        }
        for (const p of listed) {
          if (!used.has(p)) hits.push({ line, why: `"${p}" is in SITE_EMBED_PROVIDERS but no VideoFacade/MapFacade in src/ loads it, so frame-src grants a provider nothing offers. Remove it.` });
        }
      }
      report(listFile, hits);
    }

    const mirrorPages = walk(join(root, "src", "mirror", "pages"), [".html"]);
    for (const f of mirrorPages) note(facadeProvidersInMirror(readFileSync(f, "utf8")), f);
    if (used.size) {
      const policyParts = [];
      const collectCookieText = (node, path) => {
        // A combined "privacy and cookies" policy may disclose embeds under privacy.
        if (typeof node === "string") { if (/cookie|privacy/i.test(path)) policyParts.push(node); return; }
        if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collectCookieText(v, `${path}.${k}`);
      };
      for (const f of walk(join(root, "messages"), [".json"])) {
        try { collectCookieText(JSON.parse(readFileSync(f, "utf8")), /cookie|privacy/i.test(relPath(f)) ? "cookie" : ""); } catch { /* malformed JSON fails check 9 */ }
      }
      const POLICY_PAGE = /cookie|privacy|privatliv|persondata/i;
      for (const f of mirrorPages.filter((f) => POLICY_PAGE.test(relPath(f)))) {
        policyParts.push(readFileSync(f, "utf8").replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>/gi, " "));
      }
      if (mode === "replicate" && !mirrorPages.some((f) => POLICY_PAGE.test(relPath(f)))) {
        skips.push("embed providers in cookie policy — no mirrored cookie-policy page; NEEDS_FROM_CLIENT must carry the embeds to add");
      } else {
        const policy = policyParts.join("\n");
        for (const [p, file] of used) report(file, findUnnamedEmbedProviders(new Set([p]), policy));
      }
    }
  }

  // ── Check 28: consent purposes match what the site uses ─────────────────────
  // One declaration (src/lib/site-consent.ts) decides whether a banner exists.
  // A tracker for an undeclared purpose would load with no way to consent to it;
  // a declared purpose with no banner or no settings control would be consent
  // nobody can give or withdraw; a declared purpose nothing uses asks for nothing.
  {
    const declFile = join(root, "src", "lib", "site-consent.ts");
    if (!existsSync(declFile)) {
      skips.push("consent purposes — no src/lib/site-consent.ts");
    } else {
      const declText = readFileSync(declFile, "utf8");
      const declared = siteConsentPurposes(declText);
      const line = declared ? lineAt(declText, declText.indexOf("SITE_CONSENT_PURPOSES")) : 1;
      const GATE_FILES = new Set(["src/components/AnalyticsGate.tsx", "src/lib/analytics.ts"].map((p) => join(root, p)));
      const DEFINITIONS = new Set(["src/components/CookieConsent.tsx", "src/components/CookieSettingsButton.tsx"].map((p) => join(root, p)));
      const files = walk(join(root, "src"), [".tsx", ".jsx", ".ts", ".js"]).filter((f) => !/\.test\.[jt]sx?$/.test(f) && f !== declFile);
      const mirrorPages = walk(join(root, "src", "mirror", "pages"), [".html"]);
      const mirrored = mode === "replicate" || mirrorPages.length > 0;
      const used = new Map();
      const undeclared = (purpose) =>
        `serves "${purpose}", which SITE_CONSENT_PURPOSES (src/lib/site-consent.ts) does not declare — it would store or read on the visitor's device with no banner to consent in. Declare "${purpose}" (which turns the banner on) or remove it`;

      // A rewrite to another origin makes a tracker look first-party to the browser;
      // the visitor's request still reaches the third party.
      const rewrites = [];
      for (const cfgFile of ["next.config.ts", "vercel.json"].map((p) => join(root, p)).filter(existsSync)) {
        const own = externalRewrites(readFileSync(cfgFile, "utf8"));
        if (!own.length) continue;
        rewrites.push(...own);
        used.set("analytics", cfgFile);
        report(cfgFile, declared && !declared.has("analytics")
          ? own.map((r) => ({ line: r.line, why: `the rewrite ${r.source} → ${r.origin} proxies a third party through the site's own origin, so the visitor's requests still reach ${r.origin}. It ${undeclared("analytics")}.` }))
          : []);
      }
      const proxySigs = proxiedTrackerSignatures(rewrites);

      let banner = false;
      let settings = false;
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        const code = maskComments(text);
        if (!DEFINITIONS.has(f)) {
          banner ||= /<CookieConsent\b/.test(code);
          settings ||= /<CookieSettingsButton\b/.test(code);
        }
        if (/<AnalyticsGate\b/.test(code) && !used.has("analytics")) used.set("analytics", f);
        const hits = nonLiteralScriptSrcs(text);
        if (GATE_FILES.has(f)) { report(f, hits); continue; }
        const checksConsent = /\bpurposeAllowed\s*\(/.test(code);
        for (const h of trackerPurposesInSource(text, proxySigs)) {
          if (!used.has(h.purpose)) used.set(h.purpose, f);
          const problems = [];
          if (declared && !declared.has(h.purpose)) problems.push(undeclared(h.purpose));
          if (!h.gate && !checksConsent) {
            problems.push(`is used in a file that never checks purposeAllowed("${h.purpose}"), so it would load or send before the visitor consents. ${h.fix ?? `Render or call it only while purposeAllowed("${h.purpose}") from @/lib/cookie-consent is true`}`);
          }
          if (problems.length) hits.push({ line: h.line, why: `${h.what} ${problems.join("; and it ")}`.replace(/\.?$/, ".") });
        }
        report(f, hits);
      }

      // A mirrored page renders without the layout, so neither the banner nor a gate
      // reaches it: nothing on it can wait for consent.
      for (const f of mirrorPages) {
        report(f, trackerPurposesInSource(readFileSync(f, "utf8"), proxySigs, { html: true }).map((h) => ({
          line: h.line,
          why: `${h.what} on a mirrored page, which renders without the kit's banner, so nothing can hold it back until the visitor consents. Mirrored sites run without analytics for now: remove it.`,
        })));
      }

      const hits = [];
      if (!declared) hits.push({ line, why: "cannot read the SITE_CONSENT_PURPOSES array — keep it a plain list of purpose names" });
      else if (declared.size && mirrored) {
        hits.push({ line, why: `this is a mirrored site (${mode === "replicate" ? ".redesign-state/pipeline-mode is replicate" : "src/mirror/pages/ holds mirrored pages"}) and declares ${[...declared].map((p) => `"${p}"`).join(", ")}, but mirrored pages do not render the layout's banner or AnalyticsGate — mirrored sites run without analytics for now; a banner for mirrors is a later feature. Empty the list.` });
      } else if (declared.size) {
        if (!banner) hits.push({ line, why: `the site declares ${[...declared].map((p) => `"${p}"`).join(", ")} but no layout renders <CookieConsent /> — nobody can give that consent. Render it in the locale layout.` });
        if (!settings) hits.push({ line, why: "the site declares consent purposes but nothing renders <CookieSettingsButton /> — withdrawing consent must be as easy as giving it (GDPR Art. 7(3)). Render it in the footer." });
        for (const p of declared) {
          if (!used.has(p)) hits.push({ line, why: `"${p}" is declared but nothing in src/ uses it, so the banner asks consent for a purpose the site does not have. Remove it.` });
        }
      }
      report(declFile, hits);

      if (declared) {
        const monoliths = existsSync(join(root, "messages"))
          ? readdirSync(join(root, "messages")).filter((f) => f.endsWith(".json")).map((f) => join(root, "messages", f))
          : [];
        const instr = join(root, "src", "instrumentation-client.ts");
        const usesBotId = existsSync(instr) && /\binitBotId\s*\(/.test(maskComments(readFileSync(instr, "utf8")));
        runFileCheck(monoliths, findCookieInventoryGaps, declared.size > 0, usesBotId);
      }
    }
  }

  // ── Check 14: redirect destinations must exist ──────────────────────────────
  {
    const rm = join(root, ".next", "routes-manifest.json");
    const pre = join(root, ".next", "prerender-manifest.json");
    const app = join(root, ".next", "app-path-routes-manifest.json");
    if (![rm, pre, app].every(existsSync)) {
      skips.push("redirect destinations — no build output (run `npm run build` first)");
    } else {
      const redirects = JSON.parse(readFileSync(rm, "utf8")).redirects ?? [];
      const manifest = JSON.parse(readFileSync(pre, "utf8"));
      const patternsInUse = [...new Set(Object.values(JSON.parse(readFileSync(app, "utf8"))))];
      const fallbacks = Object.fromEntries(
        Object.entries(manifest.dynamicRoutes ?? {}).map(([k, v]) => [k, v.fallback]),
      );
      const skipped = redirects.filter((r) => !r.internal && /:[a-zA-Z]/.test(r.destination)).length;
      if (skipped) console.log(`  redirect destinations: ${skipped} param-substituting destination(s) not checked`);
      report(rm, findDeadRedirectTargets(redirects, Object.keys(manifest.routes ?? {}), patternsInUse, fallbacks, readLocales(root)));
    }
  }

  // ── Check 11: sitemap ↔ built route set ─────────────────────────────────────
  {
    const pre = join(root, ".next", "prerender-manifest.json");
    const body = join(root, ".next", "server", "app", "sitemap.xml.body");
    if (!existsSync(pre) || !existsSync(body)) {
      skips.push("sitemap coverage — no build output (run `npm run build` first)");
    } else {
      const manifest = JSON.parse(readFileSync(pre, "utf8"));
      const prerendered = Object.keys(manifest.routes ?? {}).map(publicRouteOf);
      const xml = readFileSync(body, "utf8");
      const sitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
      // Only routes that can serve params which were NOT prerendered may absorb a
      // sitemap URL. A route with `dynamicParams = false` is fully enumerated into
      // `routes` and never appears here — so on a fully-static site this list is
      // empty and direction B stays strict. Sourcing these from
      // app-path-routes-manifest instead would absorb every root-level dynamic
      // segment (`/[by]` matches `/services`) and silently disable the check.
      const dynamicPatterns = Object.keys(manifest.dynamicRoutes ?? {});
      const locales = readLocales(root);
      const defaultLocale = readDefaultLocale(root, locales);
      // The robots meta ships in the prerendered HTML, so read it from there.
      const htmlDir = existsSync(join(root, ".next", "server", "app")) ? join(root, ".next", "server", "app") : null;
      // `.body` as well as `.html`: a mirrored page is prerendered as a route
      // HANDLER, so its markup — and the robots meta that exempts it from
      // sitemap coverage — lands in `<route>.body`, never in a `.html` file.
      const htmlByRoute = new Map(
        (htmlDir ? walk(htmlDir, [".html", ".body"]) : []).map((f) => [
          "/" + relative(htmlDir, f).replace(/\\/g, "/").replace(/\.(html|body)$/, ""),
          readFileSync(f, "utf8"),
        ]),
      );
      const noindex = findNoindexRoutes(htmlByRoute, locales, defaultLocale);
      if (noindex.size) console.log(`  sitemap: ${noindex.size} noindex route(s) excluded from coverage`);
      console.log(`  sitemap: ${sitemapUrls.length} URL(s) vs ${prerendered.length} generated route(s)`);
      if (!sitemapUrls.length) {
        fails.push(`${relPath(body)}:1 — sitemap rendered zero URLs; every crawler-facing surface is empty`);
      } else {
        report(body, findSitemapCoverageGaps(prerendered, sitemapUrls, dynamicPatterns, locales, noindex, defaultLocale));
      }
    }
  }

  // ── Check 8: redirect coverage ──────────────────────────────────────────────
  {
    const inv = join(root, ".redesign-state", "url-inventory.md");
    const red = join(root, "redirects.md");
    const cfg = join(root, "next.config.ts");
    if (!existsSync(inv) || !existsSync(red)) {
      skips.push("redirect coverage — url-inventory.md or redirects.md not present yet (pre-Step-4)");
    } else {
      const invText = readFileSync(inv, "utf8");
      const redText = readFileSync(red, "utf8");
      report(red, findUnmappedInventoryUrls(invText, redText));
      report(red, findDroppedOriginRedirects(invText, redText));
      const mirrorIndex = join(root, "src", "mirror", "index.ts");
      const readConfigAndGenerated = () => readFileSync(cfg, "utf8") + (existsSync(mirrorIndex) ? "\n" + readFileSync(mirrorIndex, "utf8") : "");
      if (existsSync(cfg)) report(cfg, findUnimplementedRedirects(redText, readConfigAndGenerated()));
      else skips.push("redirect implementation — next.config.ts not present");
    }
  }

  const srcDir = join(root, "src");
  if (!existsSync(srcDir)) skips.push("src/ not found — source checks skipped");
  const srcFiles = walk(srcDir, [".tsx", ".ts", ".jsx", ".js", ".css"]);
  const messageFiles = walk(join(root, "messages"), [".json"]);

  // 26. Production notes rendered as customer copy
  for (const f of messageFiles) report(f, findProductionNotes(readFileSync(f, "utf8")));
  const sitePlanPath = join(root, "SITE_PLAN_TEMPLATE.md");
  const needsScopeFiles = [...srcFiles, ...messageFiles, ...(existsSync(sitePlanPath) ? [sitePlanPath] : [])];

  // 16. Route registry <-> meta namespace parity
  {
    const routesPath = join(root, "src/lib/seo/routes.ts");
    const localeMsgs = Object.fromEntries(
      messageFiles
        .filter((f) => /messages[/\\][^/\\]+\.json$/.test(f))
        .map((f) => [basename(f, ".json"), JSON.parse(readFileSync(f, "utf8"))]),
    );
    if (!existsSync(routesPath)) skips.push("route meta parity — src/lib/seo/routes.ts not present");
    else if (!Object.keys(localeMsgs).length) skips.push("route meta parity — no messages/<locale>.json yet");
    else report(routesPath, findMissingRouteMeta(readFileSync(routesPath, "utf8"), localeMsgs));
  }

  // 21. Client components reading namespaces the layout does not ship
  {
    const lp = join(root, "src/app/[locale]/layout.tsx");
    if (!existsSync(lp)) skips.push("client namespace parity — [locale]/layout.tsx not found");
    else {
      const layoutSrc = readFileSync(lp, "utf8");
      for (const h of findUnshippedClientNamespaces(srcFiles, (f) => readFileSync(f, "utf8"), layoutSrc)) {
        report(h.file, [{ line: h.line, why: h.why }]);
      }
    }
  }

  // 22. Absolute links to paths this app redirects. Masked so a URL quoted inside
  //     a comment (redirects.md-style documentation of the old tree) is not a link.
  {
    const cfg = join(root, "next.config.ts");
    const sc = join(root, "src/lib/site-config.ts");
    if (!existsSync(cfg)) skips.push("self-redirecting links — next.config.ts not present");
    else {
      const cfgText = readFileSync(cfg, "utf8");
      const scText = existsSync(sc) ? readFileSync(sc, "utf8") : "";
      if (!ownHosts(cfgText, scText).size) {
        skips.push("self-redirecting links — no canonical host in next.config.ts or site-config.ts yet");
      } else {
        for (const f of [...srcFiles, ...messageFiles]) {
          report(f, findSelfRedirectingLinks(maskComments(readFileSync(f, "utf8")), cfgText, scText));
        }
      }
    }
  }

  // 17. useTranslations inside an async component. Masked first: a brace inside a
  //     string truncated the scanned body (false negative) and a comment naming the
  //     hook read as a call (false positive). `next build` is the hard backstop, so this
  //     is a fast early warning rather than a parser.
  for (const f of srcFiles) report(f, findHookInAsyncComponent(maskNonCode(readFileSync(f, "utf8"))));

  // 18. outline-none defeating the focus ring (code only — a comment naming the
  //     utility is documentation, not a use)
  for (const f of srcFiles) report(f, findOutlineNone(maskComments(readFileSync(f, "utf8"))));

  // 25. transition-colors animating the focus ring in from currentColor. Sibling of
  //     check 18: that one catches a ring REMOVED, this one a ring that arrives late.
  //     Gated on globals.css declaring the ring, so it skips rather than misfires on a
  //     site that has not tokenized yet.
  {
    const gp = join(root, "src/app/globals.css");
    if (!existsSync(gp)) skips.push("focus-ring transition — src/app/globals.css not found");
    else {
      const css = readFileSync(gp, "utf8");
      for (const f of srcFiles.filter((f) => /\.[jt]sx$/.test(f))) {
        report(f, findFocusRingTransition(maskComments(readFileSync(f, "utf8")), css));
      }
    }
  }

  // 23. Hardcoded accessible names on drawn-in-code figures. Masked so a <title>
  //     quoted inside a comment (documenting the pattern) is not read as one.
  //     .tsx/.jsx only: a <title> in a .ts file is a string, not an element.
  for (const f of srcFiles.filter((f) => /\.[jt]sx$/.test(f))) {
    report(f, findHardcodedFigureNames(maskComments(readFileSync(f, "utf8"))));
  }

  // 24. Utilities defeating @layer base rules. Only meaningful once globals.css
  //     actually declares the rules being defeated, so read it first and skip when
  //     it is absent — a site that never wrote the rule has no bug to report.
  {
    const gp = join(root, "src/app/globals.css");
    if (!existsSync(gp)) skips.push("layer defeat — src/app/globals.css not found");
    else {
      const css = readFileSync(gp, "utf8");
      for (const f of srcFiles.filter((f) => /\.[jt]sx$/.test(f))) {
        report(f, findLayerDefeat(maskComments(readFileSync(f, "utf8")), css));
      }
    }
  }

  // 20. Utilities that emit no CSS. Needs a build: the only sound test is whether
  //     the class survived into the compiled stylesheet.
  {
    // Turbopack emits under chunks/, webpack under css/. Reading only one made the
    // check silently skip on half of all builds — and a skipped check reads green.
    const cssDirs = [join(root, ".next/static/chunks"), join(root, ".next/static/css")];
    const cssFiles = cssDirs
      .filter(existsSync)
      .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".css")).map((f) => join(d, f)));
    const builtCss = cssFiles.map((f) => readFileSync(f, "utf8")).join("\n");
    // A STALE build is worse than no build. This check asks "did Tailwind emit
    // this class?", and a stylesheet compiled before a component existed answers
    // no for every utility that component introduced — so a freshly written,
    // perfectly correct file reports as a wall of dead utilities. That is a false
    // positive that actively invites damage: the fix it suggests is "use a token
    // that exists, or delete the class", and an agent trusting it will strip
    // working styling. Measured on a real Phase 0 wave: three findings across two
    // new components, all three gone after `npm run build`, nothing else changed.
    // Skipping is the honest answer — an unrunnable check must not look like a
    // passing one, and it must not look like a failing one either.
    const scanned = srcFiles.filter((p) => !p.endsWith(".css"));
    const freshness = builtCssFreshness({
      cssMtimes: cssFiles.map((f) => statSync(f).mtimeMs),
      sources: scanned.map((f) => ({ path: f, mtimeMs: statSync(f).mtimeMs })),
    });
    if (freshness.state === "no-build") skips.push("cleared-namespace utilities — no built CSS (run `npm run build` first)");
    else if (freshness.state === "stale") {
      skips.push(
        `cleared-namespace utilities — built CSS is older than ${freshness.stale.length} source file(s) ` +
          `(e.g. ${relative(root, freshness.stale[0])}); re-run \`npm run build\` before trusting this check`,
      );
    } else {
      for (const f of scanned) {
        report(f, findClearedNamespaceUtilities(maskComments(readFileSync(f, "utf8")), builtCss));
      }
    }
  }

  // 1. Tailwind font-size token misuse
  runFileCheck(srcFiles, findFontSizeTokenMisuse);

  // Check 1b: Tailwind reads every file as text, so design docs, compliance notes and
  // code comments are carriers too. Scan every surface it sees, not just src/.
  {
    const prose = [
      ...srcFiles,
      ...walk(root, [".md"]).filter((f) => !f.includes("node_modules") && !f.includes(`${"."}next`)),
    ];
    for (const f of prose) report(f, findClassShapedLiteralsInProse(readFileSync(f, "utf8")));
  }

  // 2. SSR hydration trap
  runFileCheck(srcFiles, findSvgViewBoxAspectMismatch);

  runFileCheck(srcFiles, findStorageInUseState);

  // 3. Component-library imports (source + package.json)
  runFileCheck(srcFiles, findBannedImports, UI_LIBRARY_MATCHERS);

  // 4. Map library (source imports + plain-text OSM mentions + package.json)
  //    The static map MapFacade shows is an OSM render with its attribution, so the
  //    embeds folder may name OpenStreetMap; anywhere else it signals live tiles.
  const embedsPrefix = join(root, "src", "components", "embeds") + "/";
  runFileCheck(srcFiles, findBannedImports, MAP_LIBRARY_MATCHERS);
  runFileCheck(srcFiles.filter((f) => !f.startsWith(embedsPrefix)), findTextMentions, /openstreetmap/i, `references OpenStreetMap — ${MAP_LIBRARY_WHY}`);

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkgText = readFileSync(pkgPath, "utf8");
    report(pkgPath, findBannedDependencies(pkgText, UI_LIBRARY_MATCHERS));
    report(pkgPath, findBannedDependencies(pkgText, MAP_LIBRARY_MATCHERS));
  } else {
    skips.push("package.json not found — dependency checks skipped");
  }

  // 5. Orphan image markers
  const requestsPath = join(root, "public", "images", "IMAGE_REQUESTS.md");
  if (existsSync(requestsPath)) {
    const knownIds = extractImageRequestIds(readFileSync(requestsPath, "utf8"));
    runFileCheck(srcFiles, findOrphanImageMarkers, knownIds);
  } else {
    skips.push("public/images/IMAGE_REQUESTS.md not found — orphan-image-marker check skipped");
  }

  // 6. Unresolved image slots
  //    Not applicable to a mirror: the imagery is the original's, captured and
  //    localized, so there is no slot inventory to resolve and no route build to
  //    resolve it against. Left as a *skip* this was worse than noise —
  //    `--require-complete` treats a skip as a failure at release time, so the
  //    release gate failed on a check that can never run in this mode.
  const slotsPath = join(root, "IMAGE_SLOTS.md");
  if (mode === "replicate") {
    console.log("  image slots: n/a in replicate mode (imagery is the original's)");
  } else if (existsSync(slotsPath)) {
    // Phase-aware: `pending` is the CORRECT derived state for a slot until the
    // route that owns it is built, so failing on it before Step 6 has run reports
    // a defect where there is none. Non-shell compliance files are the signal
    // that route building has started; `_shell-*` are Phase 0 components.
    const builtRoutes = existsSync(join(root, ".redesign-state", "compliance"))
      ? readdirSync(join(root, ".redesign-state", "compliance")).filter(
          (f) => f.endsWith(".md") && !f.startsWith("_shell"),
        ).length
      : 0;
    if (builtRoutes === 0) {
      skips.push("unresolved image slots — no routes built yet (pending is correct pre-Step-6)");
    } else {
      report(
        slotsPath,
        findUnresolvedSlots(readFileSync(slotsPath, "utf8"), (p) => hasAuthoredArtwork(root, p)),
      );
    }
  } else {
    skips.push("IMAGE_SLOTS.md not found — unresolved-slots check skipped");
  }

  // 7. Lazy [NEEDS:] markers
  runFileCheck(needsScopeFiles, findLazyNeedsMarkers);

  console.log(`\n  ${passes} passed, ${skips.length} skipped, ${fails.length} failure(s)`);
  for (const s of skips) console.log(`  ⚠︎  ${s}`);
  for (const f of fails) console.log(`  ✘  ${f}`);

  if (fails.length && !WARN_ONLY) {
    console.log(`\nFAILED — ${fails.length} source-hygiene violation(s).`);
    process.exit(1);
  }
  if (fails.length && WARN_ONLY) {
    console.log(`\nWARN-ONLY — ${fails.length} source-hygiene violation(s) reported, not failing (--warn-only).`);
    return;
  }
  if (skips.length && REQUIRE_COMPLETE) {
    console.log(
      `\nINCOMPLETE — ${skips.length} check(s) did not run. At release time that is a failure, not a pass:\n` +
        `  a check that never executed cannot tell you anything, and the gate reads the exit code.\n` +
        `  Resolve each skip above (usually: run \`npm run build\` first) and re-run.`,
    );
    process.exit(1);
  }
  console.log(`\nPASS — source tree clean${skips.length ? ` (${skips.length} check(s) skipped — see above)` : ""}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
