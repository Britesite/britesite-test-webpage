// The replicate crawl as a text corpus, for the verifiers' "is this the client's
// own copy?" question.
//
// In replicate mode every user-facing string is either verbatim client copy or a
// [NEEDS:] marker. verify-source's banned-phrase checks (9: marketing filler,
// 19: build vocabulary) and verify-delivery's title/description length limits
// would otherwise fail the build on words the client chose. Skipping those
// checks would also hide a BUILDER inventing "seamless" or narrating "not
// extracted" — the more likely failure on a clone, not the less. So the checks
// stay on and exempt exactly the values that appear verbatim in the crawl.
//
// `.redesign-state/crawl/<slug>.json` is written by the plugin's site-capture
// script; manifest.json / assets.json / site.json / measurements.json are
// indexes, not pages, and are excluded so a URL list cannot exempt a string.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX_FILES = new Set(["manifest.json", "assets.json", "site.json", "measurements.json"]);

/** Comparable form of a copy string: ICU-unescaped (next-intl doubles quotes and
 *  wraps literal braces), whitespace-collapsed, NFC, lowercased. */
export function normalizeCopy(s) {
  return String(s ?? "")
    .replace(/'\{'/g, "{")
    .replace(/'\}'/g, "}")
    .replace(/''/g, "'")
    .replace(/\s+/g, " ")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

/** Only COPY-bearing fields feed the corpus. A URL, a stylesheet body, a font
 *  family or a user-agent string is not the client's wording, and a banned word
 *  hiding inside one (a `/seamless-donations/` plugin path) must not exempt a
 *  builder's "Seamless". */
function copyLeaves(page) {
  const out = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) out.push(v);
  };
  push(page?.meta?.title);
  push(page?.meta?.description);
  for (const s of page?.sections || []) {
    push(s.text);
    for (const h of s.headings || []) push(h.text);
    for (const l of s.links || []) push(l.text);
  }
  for (const n of page?.outline || []) push(n.text);
  const navItems = (items) => {
    for (const i of items || []) {
      push(i.text);
      navItems(i.children);
    }
  };
  navItems(page?.nav?.primary);
  for (const i of page?.nav?.utility || []) push(i.text);
  for (const i of page?.nav?.breadcrumb || []) push(i.text);
  for (const c of page?.footer?.columns || []) {
    push(c.heading);
    push(c.text);
    for (const l of c.links || []) push(l.text);
  }
  push(page?.footer?.legal);
  for (const f of page?.forms || []) {
    push(f.submitText);
    for (const fld of f.fields || []) {
      push(fld.label);
      for (const o of fld.options || []) push(o);
    }
  }
  for (const im of page?.images || []) push(im.alt);
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™" };

/** Reverse the entity escaping a rendered <head> carries (React emits `&amp;`,
 *  `&#x27;`, `&quot;`), so a rendered title can be compared to the crawl's decoded
 *  `document.title`. */
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => (Object.hasOwn(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m));
}

/** { text: one normalized string of every leaf, meta: Set of normalized <title>/
 *  description values, pages: number of page files read }. Empty (not an error)
 *  when the crawl directory is absent — the caller decides whether that matters. */
export function loadCrawlCorpus(root) {
  const dir = join(root, ".redesign-state", "crawl");
  const corpus = { text: "", meta: new Set(), pages: 0 };
  if (!existsSync(dir)) return corpus;
  const parts = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || INDEX_FILES.has(name)) continue;
    let page;
    try {
      page = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    corpus.pages++;
    for (const leaf of copyLeaves(page)) parts.push(normalizeCopy(leaf));
    for (const v of [page?.meta?.title, page?.meta?.description]) if (typeof v === "string") corpus.meta.add(normalizeCopy(v));
  }
  corpus.text = parts.join("\n");
  return corpus;
}

/** Does `value` (a message value, optionally still JSON-escaped as it sits on the
 *  file's line) appear verbatim in the crawl? Substring on WORD boundaries, not
 *  equality: a message key usually carries one heading or paragraph of a section
 *  the crawl stored whole — but "seamlessly" must not exempt "seamless". */
export function corpusIncludes(corpus, value, { jsonEscaped = false } = {}) {
  if (!corpus || !corpus.text) return false;
  let raw = value;
  if (jsonEscaped) {
    try {
      raw = JSON.parse(`"${value}"`);
    } catch {
      raw = value;
    }
  }
  const needle = normalizeCopy(raw);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(corpus.text);
}
