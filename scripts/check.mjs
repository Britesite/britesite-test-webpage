#!/usr/bin/env node
// check — fast, deterministic pre-build gate for owner/agent edits.
//
// Catches the failure classes an owner's edit actually produces long before
// `next build` would: a missing translation key in one locale (renders as the
// raw key path; the build itself stays green), invalid JSON under messages/,
// fragment drift (a per-route fragment edited without re-running `npm run
// merge`, or vice versa), and type errors.
//
// Self-contained — node builtins only, no imports from sibling scripts — so
// update-child-sites.sh can copy this one file into an already-scaffolded site
// without also shipping every other script it happens to import.
//
// Usage:
//   node scripts/check.mjs [root] [--skip=step,step]
//
// Steps (in order): messages, parity, fragments, seo, types, source.
// messages, parity, fragments and seo read files only and need no install, so
// `--skip=types` runs them on a site with no node_modules (the editing helper
// does this after a text-only edit).
// Exit 0 = every step that ran is pass/warn/skip; 1 = at least one step failed.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────

/** Dotted leaf paths of a nested object. Arrays are leaves, not containers. */
export function flattenKeys(obj, prefix = "") {
  const out = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out.push(prefix);
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenKeys(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Locales + default locale from the source text of src/i18n/routing.ts.
 * Same regexes verify-delivery.mjs uses, so the two never disagree.
 */
export function resolveLocales(routingSrc) {
  const locales = [...(routingSrc.match(/locales:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  const defaultLocale = routingSrc.match(/defaultLocale:\s*['"]([^'"]+)['"]/)?.[1] ?? locales[0];
  return { locales, defaultLocale };
}

/** Parse each file's JSON via the injected `readFile(file)`. Never throws. */
export function parseMessageFiles(files, readFile) {
  const parsed = new Map();
  const errors = [];
  for (const file of files) {
    try {
      parsed.set(file, JSON.parse(readFile(file)));
    } catch (e) {
      errors.push({ file, message: e.message });
    }
  }
  return { parsed, errors };
}

/**
 * Key-set diff of each secondary locale against the primary, both directions.
 * `keysByLocale` holds the SECONDARY locales only — `{ locale: string[] }}`.
 */
export function compareKeySets(primaryKeys, keysByLocale) {
  const primarySet = new Set(primaryKeys);
  const results = [];
  for (const [locale, keys] of Object.entries(keysByLocale)) {
    const keySet = new Set(keys);
    const missing = primaryKeys.filter((k) => !keySet.has(k));
    const extra = keys.filter((k) => !primarySet.has(k));
    results.push({ locale, missing, extra });
  }
  return results;
}

/** True if any locale under messages/ has _base.json or a non-dotfile *.json under _routes/. */
export function hasFragments(root) {
  const msgDir = join(root, "messages");
  if (!existsSync(msgDir)) return false;
  for (const entry of readdirSync(msgDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const localeDir = join(msgDir, entry.name);
    if (existsSync(join(localeDir, "_base.json"))) return true;
    const routesDir = join(localeDir, "_routes");
    if (
      existsSync(routesDir) &&
      readdirSync(routesDir).some((f) => f.endsWith(".json") && !f.startsWith("."))
    ) {
      return true;
    }
  }
  return false;
}

// ───────────────────────── internal fs/spawn helpers ─────────────────────────

function walkJsonFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(p);
  }
  return out;
}

function capLines(lines, max = 50) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `+${lines.length - max} more`];
}

function defaultSpawn(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── (a) messages ──────────────────────────────────────────────────────────────

function runMessagesStep(root) {
  const files = walkJsonFiles(join(root, "messages"));
  const { errors } = parseMessageFiles(files, (f) => readFileSync(f, "utf8"));
  if (errors.length) {
    return {
      name: "messages",
      status: "fail",
      lines: errors.map((e) => `${relative(root, e.file)}: ${e.message}`),
    };
  }
  return { name: "messages", status: "pass", lines: [] };
}

// ── (b) parity ────────────────────────────────────────────────────────────────

/** Locales to compare monoliths for: routing.ts when present, else a directory scan. */
function detectParityLocales(root) {
  const routingPath = join(root, "src", "i18n", "routing.ts");
  if (existsSync(routingPath)) {
    const { locales, defaultLocale } = resolveLocales(readFileSync(routingPath, "utf8"));
    if (locales.length) return { locales, defaultLocale: defaultLocale ?? locales[0] };
  }
  const msgDir = join(root, "messages");
  if (!existsSync(msgDir)) return { locales: [], defaultLocale: undefined };
  const locales = readdirSync(msgDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  return { locales, defaultLocale: locales[0] };
}

function runParityStep(root) {
  const { locales, defaultLocale } = detectParityLocales(root);
  if (!defaultLocale || locales.length < 2) {
    return { name: "parity", status: "pass", lines: [] };
  }

  const readMonolith = (locale) => JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"));

  let primaryKeys;
  try {
    primaryKeys = flattenKeys(readMonolith(defaultLocale));
  } catch (e) {
    return { name: "parity", status: "fail", lines: [`${defaultLocale}.json: ${e.message}`] };
  }

  const lines = [];
  const keysByLocale = {};
  for (const locale of locales.filter((l) => l !== defaultLocale)) {
    try {
      keysByLocale[locale] = flattenKeys(readMonolith(locale));
    } catch (e) {
      lines.push(`${locale}.json: ${e.message}`);
    }
  }
  for (const { locale, missing, extra } of compareKeySets(primaryKeys, keysByLocale)) {
    for (const k of missing) lines.push(`missing in ${locale}: ${k}`);
    for (const k of extra) lines.push(`extra in ${locale}: ${k}`);
  }

  const capped = capLines(lines);
  return { name: "parity", status: capped.length ? "fail" : "pass", lines: capped };
}

// ── (c) fragments ─────────────────────────────────────────────────────────────

function runFragmentsStep(root, spawn) {
  if (!hasFragments(root)) {
    return { name: "fragments", status: "skip", lines: ["no fragments"] };
  }
  const result = spawn("node", ["scripts/merge-fragments.mjs", "--check"], { cwd: root });
  if (result.status === 0) {
    return { name: "fragments", status: "pass", lines: [] };
  }
  const lines = `${result.stdout}\n${result.stderr}`.split("\n").filter(Boolean);
  lines.push("run `npm run merge`");
  return { name: "fragments", status: "fail", lines };
}

// ── (d) seo ───────────────────────────────────────────────────────────────────
//
// The search-engine fields an edit can break without anything else noticing:
// a page's Google title and description, picture alt text, the page language,
// and the business facts behind the local result (address, phone, opening
// hours). The full rendered audit lives in verify-delivery.mjs and needs a
// running server; this step reads source only, needs no install, and runs in
// well under a second, so the editing helper can run it after every edit —
// including a text-only one.
//
// Fails only on what is broken outright: a registered page with no title or
// description in some language, a scaffold `{{PLACEHOLDER}}` that would ship
// verbatim, a picture with no alt attribute at all, or a layout that drops the
// page language. House conventions (length bands, duplicates, missing business
// facts) are warnings: a few characters over is a nit, not a reason to refuse
// an owner's edit.

/** Defaults, used only when src/lib/seo/constants.ts cannot be read. */
const SEO_DEFAULTS = { titleMax: 60, descMin: 120, descMax: 160, suffix: "" };

/** Strip // and /* *\/ comments from JS/TS source, leaving strings intact
 *  ("https://…" inside a string is not a comment). */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const block = src.slice(i, end === -1 ? src.length : end + 2);
      out += block.replace(/[^\n]/g, " ");
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The text between the bracket at `open` and its matching closer, or null. */
function balanced(src, open) {
  const pairs = { "[": "]", "{": "}" };
  const opener = src[open];
  const closer = pairs[opener];
  if (!closer) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === opener) depth++;
    else if (c === closer && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** Read one exported string constant from TS source (`export const NAME = "…"`). */
function stringConst(src, name) {
  const m = src.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*(["'\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`));
  return m ? m[2].replace(/\\(.)/g, "$1") : null;
}
/** Read one string property from an object literal (`name: "…"`). */
function propString(src, name) {
  const m = src.match(new RegExp(`["']?\\b${name}["']?\\s*:\\s*(["'\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`));
  return m ? m[2].replace(/\\(.)/g, "$1") : null;
}
function numberConst(src, name) {
  const m = src.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

/** Title suffix and length limits from src/lib/seo/constants.ts. `TITLE_SUFFIX`
 *  is often a template literal over the company name, so `${…}` is resolved
 *  from string constants in the same file. */
export function readSeoConstants(src) {
  if (!src) return { ...SEO_DEFAULTS };
  const code = stripComments(src);
  let suffix = stringConst(code, "TITLE_SUFFIX") ?? "";
  suffix = suffix.replace(/\$\{\s*([A-Z_][A-Z0-9_]*)\s*\}/g, (_m, n) => stringConst(code, n) ?? "");
  return {
    titleMax: numberConst(code, "TITLE_MAX_LENGTH") ?? SEO_DEFAULTS.titleMax,
    descMin: numberConst(code, "DESCRIPTION_MIN_LENGTH") ?? SEO_DEFAULTS.descMin,
    descMax: numberConst(code, "DESCRIPTION_MAX_LENGTH") ?? SEO_DEFAULTS.descMax,
    suffix,
  };
}

/** Every object under the `meta` namespace that carries a title or a
 *  description, as `{ key, title, description }`. A dynamic route's entries
 *  (`meta.services.welding`) are found the same way as a static route's. */
export function metaEntries(messages) {
  const out = [];
  const walk = (node, key) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node.title === "string" || typeof node.description === "string") {
      out.push({ key, title: node.title, description: node.description });
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") walk(v, key ? `${key}.${k}` : k);
    }
  };
  walk(messages?.meta, "");
  return out;
}

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

const SCAFFOLD_RE = /\{\{[A-Z_]+\}\}/;
const NEEDS_RE = /\[NEEDS:/;

/** Length, placeholder and duplicate findings for one language's pages.
 *  `pages`: [{ label, title, description, absolute }] where `absolute` means the
 *  title is shown without the " | Brand" suffix (the homepage). */
export function judgeMeta(pages, limits, { fail, warn }) {
  const seenTitle = new Map();
  const seenDesc = new Map();
  for (const p of pages) {
    const pending = [];
    for (const [field, value] of [["title", p.title], ["description", p.description]]) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (SCAFFOLD_RE.test(value)) fail(`${p.label}: the ${field} still holds a scaffold placeholder (${value.match(SCAFFOLD_RE)[0]}) and would show in Google as written`);
      else if (NEEDS_RE.test(value)) pending.push(field);
    }
    if (pending.length) warn(`${p.label}: the ${pending.join(" and ")} ${pending.length > 1 ? "are [NEEDS:] markers" : "is a [NEEDS:] marker"}; Google would show ${pending.length > 1 ? "them" : "it"} as written`);
    if (typeof p.title === "string" && p.title.trim() && !NEEDS_RE.test(p.title)) {
      const shown = p.absolute ? p.title : `${p.title}${limits.suffix}`;
      if (shown.length > limits.titleMax) {
        warn(`${p.label}: title is ${shown.length} characters as Google shows it ("${shown}"); keep it within ${limits.titleMax} or Google cuts it off`);
      }
      const t = p.title.trim().toLowerCase();
      if (seenTitle.has(t)) warn(`${p.label}: same title as ${seenTitle.get(t)}; every page needs its own`);
      else seenTitle.set(t, p.label);
    }
    if (typeof p.description === "string" && p.description.trim() && !NEEDS_RE.test(p.description)) {
      const n = p.description.length;
      if (n < limits.descMin || n > limits.descMax) {
        warn(`${p.label}: description is ${n} characters; aim for ${limits.descMin}–${limits.descMax} so Google shows it whole instead of writing its own`);
      }
      const d = p.description.trim().toLowerCase();
      if (seenDesc.has(d)) warn(`${p.label}: same description as ${seenDesc.get(d)}; every page needs its own`);
      else seenDesc.set(d, p.label);
    }
  }
}

/** JSX `<img>` / `<Image>` opening tags with no `alt` attribute. A tag that
 *  spreads props (`{...props}`) may get its alt from them and is not judged. */
export function imagesWithoutAlt(src) {
  const out = [];
  // `<img>` always; a component only when it is next/image's under whatever
  // name the file imports it as. An icon named Image (lucide-react) is no picture.
  const nextImage = src.match(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']next\/(?:legacy\/)?image["']/)?.[1];
  const names = ["img", ...(nextImage ? [nextImage] : [])].map((n) => n.replace(/\$/g, "\\$"));
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  let m;
  while ((m = re.exec(src))) {
    // Markup inside a string or template literal is text, not a rendered tag.
    const before = src.slice(0, m.index);
    if (/["'`]$/.test(before) || ((before.match(/(?<!\\)`/g) ?? []).length % 2 === 1)) continue;
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index, i + 1);
    if (/\{\s*\.\.\./.test(tag)) continue;
    if (!/\salt\s*=/.test(tag)) out.push({ line: src.slice(0, m.index).split("\n").length, tag: m[1] });
  }
  return out;
}

/** HTML `<img>` tags with no alt attribute (mirrored pages). */
export function htmlImagesWithoutAlt(html) {
  let n = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\salt\s*=/i.test(m[0])) n++;
  return n;
}

/** What the source says about the business facts behind the local search
 *  result. Reads SITE_BUSINESS from site-config.ts and, for sites built before
 *  it fed organizationSchema, the fields typed straight into structured-data.ts. */
export function readBusinessFacts({ siteConfig, structuredData }) {
  const facts = { known: false, name: null, locality: null, hasPhone: false, hasHours: false, badHours: [], needs: false };
  const cfg = siteConfig ? stripComments(siteConfig) : "";
  const at = cfg.search(/\bSITE_BUSINESS\b[^=]*=/);
  if (at !== -1) {
    const eq = cfg.indexOf("=", at);
    const rest = cfg.slice(eq + 1).trimStart();
    if (rest.startsWith("{")) {
      const body = balanced(rest, 0) ?? rest;
      facts.known = /\bstreetAddress\s*:/.test(body);
      facts.name = propString(body, "name");
      facts.locality = propString(body, "addressLocality");
      facts.hasPhone = /\btelephone\s*:\s*\[\s*["'`]/.test(body);
      facts.hasHours = /\bopeningHours\s*:\s*\[\s*\{/.test(body);
      for (const t of body.matchAll(/\b(opens|closes)\s*:\s*["'`]([^"'`]*)["'`]/g)) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t[2]) && t[2] !== "24:00") facts.badHours.push(`${t[1]} "${t[2]}"`);
      }
      facts.needs = NEEDS_RE.test(body);
    }
  }
  const sd = structuredData ? stripComments(structuredData) : "";
  if (!facts.known && /\bstreetAddress\s*:/.test(sd)) {
    facts.known = true;
    facts.hasPhone = /\btelephone\s*:/.test(sd);
    facts.locality = propString(sd, "addressLocality");
    facts.name ??= propString(sd, "name");
  }
  if (!facts.hasHours && /\bopeningHours(Specification)?\s*:/.test(sd)) facts.hasHours = true;
  if (NEEDS_RE.test(sd)) facts.needs = true;
  return facts;
}

/** The town a local customer searches with: "Odense C" → "odense",
 *  "København K" → "københavn". */
export function townOf(locality) {
  if (!locality) return null;
  return locality.trim().replace(/\s+(?:[A-ZÆØÅ]{1,2}|\d+)$/u, "").toLowerCase() || null;
}

/** Phrasings that mean opening hours, not "48 hours' notice" or "lovely hours". */
const HOURS_WORDS = /åbningstid|åbent\s+(?:alle|hver|man|tir|ons|tor|fre|lør|søn)|opening hours|opening times|open (?:daily|mon|tue|wed|thu|fri|sat|sun)|öffnungszeit/i;

function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function walkFiles(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e)) && !/\.test\.[a-z]+$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** MIRROR_PAGES from src/mirror/index.ts. The installer writes it with
 *  JSON.stringify; an entry added by hand may not be strict JSON, so each
 *  object is parsed on its own and a field-by-field read is the fallback. */
export function parseMirrorPages(src) {
  const code = stripComments(src);
  const at = code.search(/\bMIRROR_PAGES\b[^=]*=\s*\[/);
  if (at === -1) return [];
  const list = balanced(code, code.indexOf("[", code.indexOf("=", at)));
  if (!list) return [];
  const pages = [];
  for (let i = 1; i < list.length; i++) {
    if (list[i] !== "{") continue;
    const obj = balanced(list, i);
    if (!obj) break;
    i += obj.length - 1;
    let page = null;
    try {
      page = JSON.parse(obj.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      const field = (k) => {
        const m = obj.match(new RegExp(`["']?${k}["']?\\s*:\\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`));
        return m ? m[2].replace(/\\(.)/g, "$1") : undefined;
      };
      page = { path: field("path"), locale: field("locale"), title: field("title"), description: field("description"), file: field("file"), noindex: /noindex["']?\s*:\s*true/.test(obj) };
    }
    if (page && typeof page.path === "string") pages.push(page);
  }
  return pages;
}

function htmlHead(html) {
  const decode = (s) =>
    s
      ?.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .trim();
  const title = html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1];
  // The closing quote must match the opening one: "Denmark's largest…" or
  // "Hans' Frisør" inside a double-quoted attribute is one value, not two.
  const tag = html.match(/<meta\b(?=[^>]*\bname=["']description["'])(?:[^>"']|"[^"]*"|'[^']*')*>/i)?.[0];
  const desc = tag?.match(/\bcontent=(["'])([\s\S]*?)\1/i)?.[2];
  return { title: decode(title), description: decode(desc) };
}

/** All SEO findings for a site, as `{ fails, warns, skipped }`. */
export function seoFindings(root) {
  const fails = [];
  const warns = [];
  const fail = (m) => fails.push(m);
  const warn = (m) => warns.push(m);

  const constantsSrc = readText(join(root, "src", "lib", "seo", "constants.ts"));
  const layoutSrc = readText(join(root, "src", "app", "[locale]", "layout.tsx"));
  // The kit's own template, before setup-website.sh has filled it in. Nothing
  // here is a defect yet.
  if ((constantsSrc && /\{\{COMPANY_NAME\}\}/.test(stringConst(stripComments(constantsSrc), "TITLE_SUFFIX") ?? "")) || (layoutSrc && /siteName:\s*["']\{\{COMPANY_NAME\}\}["']/.test(layoutSrc))) {
    return { fails, warns, skipped: "template not scaffolded yet" };
  }
  const limits = readSeoConstants(constantsSrc);

  const mirrorSrc = readText(join(root, "src", "mirror", "index.ts"));
  const mirrorPages = mirrorSrc ? parseMirrorPages(mirrorSrc) : [];
  const { locales, defaultLocale } = detectParityLocales(root);

  let homeTitle = null;
  let homeDescription = null;
  let siteText = "";

  if (mirrorPages.length) {
    // ── Mirrored site: the captured HTML's own <head> is what Google reads. ──
    const byLocale = new Map();
    for (const page of mirrorPages) {
      const rel = page.path === "/" ? "index.html" : `${page.path.replace(/^\/|\/$/g, "")}/index.html`;
      const file = [join(root, "src", "mirror", "pages", rel), page.file ? join(root, page.file) : null].find((f) => f && existsSync(f));
      const html = file ? readText(file) : null;
      const label = `page ${page.path}`;
      if (!html) {
        fail(`${label}: its HTML file is missing (src/mirror/pages/${rel})`);
        continue;
      }
      siteText += html;
      const head = htmlHead(html);
      if (!page.noindex) {
        if (!head.title) fail(`${label}: no <title> in its HTML`);
        if (!head.description) warn(`${label}: no meta description in its HTML; Google will write its own from the page`);
      }
      if (head.title && page.title && head.title !== page.title.trim()) {
        warn(`${label}: the <title> in its HTML ("${head.title}") differs from its MIRROR_PAGES title ("${page.title}"); update both`);
      }
      if (head.description && page.description && head.description !== page.description.trim()) {
        warn(`${label}: the meta description in its HTML differs from its MIRROR_PAGES description; update both`);
      }
      const missingAlt = htmlImagesWithoutAlt(html);
      if (missingAlt) warn(`${label}: ${missingAlt} picture(s) with no alt text`);
      if (!page.noindex) {
        const list = byLocale.get(page.locale) ?? [];
        list.push({ label, title: head.title, description: head.description, absolute: true });
        byLocale.set(page.locale, list);
      }
      if (page.path === "/" && (page.locale === defaultLocale || !homeTitle)) {
        homeTitle = head.title ?? null;
        homeDescription = head.description ?? null;
      }
    }
    for (const list of byLocale.values()) judgeMeta(list, limits, { fail, warn });
  } else {
    // ── Redesigned site: titles and descriptions live in messages/<locale>.json. ──
    const routesSrc = readText(join(root, "src", "lib", "seo", "routes.ts"));
    const routes = routesSrc ? parseRegistry(routesSrc) : [];
    for (const locale of locales) {
      const messages = (() => {
        try {
          return JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"));
        } catch {
          return null; // the messages step reports unreadable JSON
        }
      })();
      if (!messages) continue;
      siteText += JSON.stringify(messages);
      for (const r of routes) {
        if (r.noindex) continue;
        const entry = getPath(messages, `meta.${r.metaKey}`);
        const where = `page ${r.path || "/"} (${locale})`;
        if (!entry || typeof entry !== "object") {
          fail(`${where}: no meta.${r.metaKey} in messages/${locale}.json, so the page has no title or description of its own`);
          continue;
        }
        if (typeof entry.title !== "string" || !entry.title.trim()) fail(`${where}: meta.${r.metaKey}.title is missing or empty`);
        if (typeof entry.description !== "string" || !entry.description.trim()) fail(`${where}: meta.${r.metaKey}.description is missing or empty`);
      }
      const absoluteKeys = new Set(routes.filter((r) => r.path === "").map((r) => r.metaKey));
      if (!routes.length) absoluteKeys.add("home");
      const noindexKeys = new Set(routes.filter((r) => r.noindex).map((r) => r.metaKey));
      const pages = metaEntries(messages)
        .filter((e) => !noindexKeys.has(e.key))
        .map((e) => ({ label: `meta.${e.key} (${locale})`, title: e.title, description: e.description, absolute: absoluteKeys.has(e.key) }));
      judgeMeta(pages, limits, { fail, warn });
      if (locale === defaultLocale) {
        const homeKey = [...absoluteKeys][0] ?? "home";
        homeTitle = getPath(messages, `meta.${homeKey}.title`) ?? null;
        homeDescription = getPath(messages, `meta.${homeKey}.description`) ?? null;
      }
    }

    // Picture alt text in the components and pages.
    for (const file of walkFiles(join(root, "src"), [".tsx", ".jsx"])) {
      const src = readText(file);
      if (!src || !/<(img|Image)[\s/>]/.test(src)) continue;
      // Only comment blocks are blanked here: JSX text is not JS, and an
      // apostrophe in it would send a string-aware stripper the wrong way.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
      for (const hit of imagesWithoutAlt(code)) {
        fail(`${relative(root, file)}:${hit.line}: <${hit.tag}> has no alt text; describe the picture, or alt="" if it is only decoration`);
      }
    }

    // The page language. Search engines and screen readers both read it.
    if (layoutSrc && !/<html\b[^>]*\blang=/.test(layoutSrc)) {
      fail("src/app/[locale]/layout.tsx: <html> has no lang attribute; search engines are not told which language the page is in");
    }
  }

  // ── The business behind the local result (both modes). ──
  const facts = readBusinessFacts({
    siteConfig: readText(join(root, "src", "lib", "site-config.ts")),
    structuredData: readText(join(root, "src", "lib", "seo", "structured-data.ts")),
  });
  if (!facts.known) {
    warn("SITE_BUSINESS in src/lib/site-config.ts is empty, so Google gets no address or phone number for the business in its structured data; fill it in from the site's own contact details");
  } else {
    if (!facts.hasPhone) warn("the business's structured data has no phone number; if the site shows one, add it to SITE_BUSINESS.telephone");
    if (!facts.hasHours && HOURS_WORDS.test(siteText)) {
      warn("the site shows opening hours but its structured data has none; add them to SITE_BUSINESS.openingHours so Google can show them");
    }
  }
  for (const bad of facts.badHours) fail(`SITE_BUSINESS.openingHours: ${bad} is not a 24-hour HH:MM time`);
  if (facts.needs) warn("the business's structured data still holds a [NEEDS:] marker, which Google would read as the real value");

  // ── The homepage names who and where. ──
  if (homeTitle && facts.name) {
    const brand = facts.name.toLowerCase().replace(/\s+(aps|a\/s|i\/s|ivs|v\/.*)$/i, "").trim();
    if (brand && !homeTitle.toLowerCase().includes(brand)) {
      warn(`homepage title "${homeTitle}" does not name the business (${facts.name}); people often search for it by name`);
    }
  }
  const town = townOf(facts.locality);
  if (town && homeTitle) {
    const text = `${homeTitle} ${homeDescription ?? ""}`.toLowerCase();
    if (!text.includes(town)) {
      warn(`homepage title and description do not mention ${facts.locality.replace(/\s+(?:[A-ZÆØÅ]{1,2}|\d+)$/u, "")}; local customers search with the town`);
    }
  }

  // ── A favicon, beside every search result. ──
  const iconFiles = ["src/app/icon.svg", "src/app/icon.png", "src/app/icon.ico", "src/app/favicon.ico", "src/app/[locale]/icon.svg", "src/app/[locale]/icon.png", "public/favicon.ico"];
  if (!mirrorPages.length && !iconFiles.some((f) => existsSync(join(root, f)))) {
    warn("no favicon (src/app/icon.svg or favicon.ico); Google shows it beside every search result");
  }

  return { fails, warns, skipped: null };
}

/** STATIC_ROUTES entries from src/lib/seo/routes.ts (same reading as site-guide.mjs). */
export function parseRegistry(routesSrc) {
  const code = stripComments(routesSrc);
  const arrayMatch = code.match(/STATIC_ROUTES[^=]*=\s*\[([\s\S]*)\]\s*;/);
  const body = arrayMatch ? arrayMatch[1] : code;
  const routes = [];
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const entry = m[1];
    const pathMatch = entry.match(/path:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    const metaKeyMatch = entry.match(/metaKey:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    if (!pathMatch || !metaKeyMatch) continue;
    routes.push({ path: pathMatch[2], metaKey: metaKeyMatch[2], noindex: /noindex\s*:\s*true/.test(entry) });
  }
  return routes;
}

function runSeoStep(root) {
  const { fails, warns, skipped } = seoFindings(root);
  if (skipped) return { name: "seo", status: "skip", lines: [skipped] };
  const lines = capLines([...fails.map((m) => `✘ ${m}`), ...warns.map((m) => `⚠ ${m}`)]);
  return { name: "seo", status: fails.length ? "fail" : warns.length ? "warn" : "pass", lines };
}

// ── (e) types ─────────────────────────────────────────────────────────────────

function runTypesStep(root, spawn) {
  const tscBin = join(root, "node_modules", ".bin", "tsc");
  if (!existsSync(tscBin)) {
    return { name: "types", status: "fail", lines: ["node_modules/.bin/tsc not found — run npm install"] };
  }
  const result = spawn(tscBin, ["--noEmit", "--pretty", "false"], { cwd: root });
  if (result.status === 0) {
    return { name: "types", status: "pass", lines: [] };
  }
  const lines = `${result.stdout}\n${result.stderr}`.split("\n").filter(Boolean);
  return { name: "types", status: "fail", lines };
}

// ── (f) source (warn-only for FINDINGS; a crash is a failure) ──────────────────

function runSourceStep(root, spawn) {
  // Sites built before the source verifier have check.mjs without it.
  if (!existsSync(join(root, "scripts", "verify-source.mjs"))) {
    return { name: "source", status: "skip", lines: ["no scripts/verify-source.mjs on this site"] };
  }
  const result = spawn("node", ["scripts/verify-source.mjs", "--warn-only"], { cwd: root });
  const output = `${result.stdout}\n${result.stderr}`;
  const flagged = output.split("\n").filter((l) => l.includes("✘") || l.includes("WARN"));
  if (flagged.length) return { name: "source", status: "warn", lines: flagged };
  if (result.status !== 0) {
    // Non-zero with no ✘/WARN line means the verifier never ran a check — a
    // module it imports is missing, or the pipeline-mode marker is unreadable. A
    // check that did not execute cannot be a warning: `--warn-only` downgrades
    // findings, not crashes, and the orchestrator halts on exactly this shape.
    return {
      name: "source",
      status: "fail",
      lines: [`verify-source exited ${result.status} without running — a crashed verifier is not a clean tree`, ...output.split("\n").filter(Boolean).slice(0, 8)],
    };
  }
  return { name: "source", status: "pass", lines: [] };
}

// ───────────────────────── orchestration ─────────────────────────

const STEP_RUNNERS = {
  messages: (root) => runMessagesStep(root),
  parity: (root) => runParityStep(root),
  fragments: (root, spawn) => runFragmentsStep(root, spawn),
  seo: (root) => runSeoStep(root),
  types: (root, spawn) => runTypesStep(root, spawn),
  source: (root, spawn) => runSourceStep(root, spawn),
};

export function runChecks({ root = process.cwd(), spawn = defaultSpawn, skip = new Set() } = {}) {
  const steps = [];
  for (const [name, run] of Object.entries(STEP_RUNNERS)) {
    steps.push(skip.has(name) ? { name, status: "skip", lines: [] } : run(root, spawn));
  }
  const ok = !steps.some((s) => s.status === "fail");
  return { steps, ok };
}

// ───────────────────────── CLI ─────────────────────────

const SYMBOL = { pass: "✔", fail: "✘", warn: "⚠", skip: "–" };

function parseArgs(argv) {
  let root = process.cwd();
  const skip = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--skip=")) {
      for (const name of arg.slice("--skip=".length).split(",")) {
        if (name.trim()) skip.add(name.trim());
      }
    } else if (!arg.startsWith("-")) {
      root = resolve(arg);
    }
  }
  return { root, skip };
}

function renderCli({ steps }) {
  for (const step of steps) {
    const suffix = step.status === "skip" && step.lines.length ? ` (${step.lines[0]})` : "";
    console.log(`${SYMBOL[step.status]} ${step.name}${suffix}`);
  }
  for (const step of steps) {
    if (step.status === "fail" || step.status === "warn") {
      for (const line of step.lines) console.log(`  ${line}`);
    }
  }
}

function main() {
  const { root, skip } = parseArgs(process.argv.slice(2));
  const result = runChecks({ root, skip });
  renderCli(result);
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
