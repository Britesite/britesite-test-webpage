#!/usr/bin/env node
/**
 * merge-fragments — compose per-route fragments into the monolithic artifacts the
 * app reads, so parallel page-builders never write the same file.
 *
 *   messages/<locale>/_routes/*.json   ─┐  deep-merge (over _base.json or the
 *   messages/<locale>/_base.json        │  current monolith)
 *   messages/<locale>.json (fallback)  ─┴─►  messages/<locale>.json
 *
 *   public/images/_requests/*.md        ──►  public/images/IMAGE_REQUESTS.md (## Requests)
 *
 * During the parallel build (Step 6) each page-builder writes ONLY its own
 * per-route fragment; the orchestrator runs this script serially afterward to
 * compose the shared files. Because route translation-namespaces and image slot
 * IDs are pre-assigned in the Build Manifest, fragments are disjoint by
 * construction — this merge is deterministic and idempotent (re-running yields
 * byte-identical output, so it is safe on crash-resume).
 *
 * Usage:
 *   node scripts/merge-fragments.mjs           # compose and write
 *   node scripts/merge-fragments.mjs --check    # verify only (no writes); exit 1 on drift/collision
 *
 * Exit codes: 0 = ok; 1 = fragment↔fragment key collision (a Build Manifest bug)
 * or, under --check, the composed output differs from what is on disk.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Deep-merge `src` onto a copy of `dst`. Every leaf path written is recorded in
 * `seen` (leafPath → contributor name); if a *different* contributor already
 * wrote that leaf, the path is pushed to `collisions`.
 */
export function mergeInto(dst, src, contributor, seen, collisions, path = "") {
  const out = isPlainObject(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) {
    const p = path ? `${path}.${k}` : k;
    if (isPlainObject(v)) {
      // Always descend into object values (merging onto {} when the branch is
      // absent) so every leaf path is recorded in `seen` and collisions between
      // fragments that first *create* a branch are still detected.
      out[k] = mergeInto(isPlainObject(out[k]) ? out[k] : {}, v, contributor, seen, collisions, p);
    } else {
      const prev = seen.get(p);
      if (prev !== undefined && prev !== contributor) {
        collisions.push({ path: p, a: prev, b: contributor });
      }
      seen.set(p, contributor);
      out[k] = v;
    }
  }
  return out;
}

/**
 * Compose one locale's monolith from a base object + sorted route fragments.
 * Returns { merged, collisions } where a collision means two *route fragments*
 * (not base) set the same leaf — i.e. a namespace assignment bug.
 */
export function composeMessages(base, fragments /* [{ name, obj }] */) {
  const seen = new Map();
  const collisions = [];
  // Seed base leaves so a fragment overriding a shared key is flagged too, but
  // treat base as a distinct contributor so base↔fragment overrides can be told
  // apart from fragment↔fragment conflicts by the caller.
  let acc = mergeInto({}, base, "_base", seen, collisions);
  for (const frag of [...fragments].sort((a, b) => a.name.localeCompare(b.name))) {
    acc = mergeInto(acc, frag.obj, frag.name, seen, collisions);
  }
  const fragConflicts = collisions.filter((c) => c.a !== "_base" && c.b !== "_base");
  return { merged: acc, collisions, fragConflicts };
}

/** Value at a dotted leaf path, or undefined. */
export function leafAt(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Stable JSON: object keys sorted recursively, 2-space indent, trailing newline. */
export function stableStringify(value) {
  const sort = (v) =>
    isPlainObject(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
      : Array.isArray(v)
      ? v.map(sort)
      : v;
  return JSON.stringify(sort(value), null, 2) + "\n";
}

/** Split IMAGE_REQUESTS.md fragment markdown into individual `## IMG-<id>` blocks. */
export function splitRequestBlocks(md) {
  const blocks = [];
  const re = /^##\s+(IMG-\S+)/gm;
  const starts = [];
  let m;
  while ((m = re.exec(md)) !== null) starts.push({ id: m[1], index: m.index });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : md.length;
    blocks.push({ id: starts[i].id, text: md.slice(starts[i].index, end).trimEnd() });
  }
  return blocks;
}

/**
 * Rebuild IMAGE_REQUESTS.md: keep everything up to and including the `## Requests`
 * heading, then emit the sorted, de-duplicated request blocks (or a placeholder).
 */
export function composeRequests(headTemplate, blocks) {
  const head = headTemplate.replace(/\s+$/, "");
  const byId = new Map();
  for (const b of blocks) byId.set(b.id, b.text); // last wins; IDs are unique by convention
  const ordered = [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, t]) => t);
  const body = ordered.length
    ? ordered.join("\n\n")
    : "*(No image requests yet. Page-builders write per-route fragments to `public/images/_requests/`; this section is composed by `npm run merge`.)*";
  return `${head}\n\n${body}\n`;
}

// ───────────────────────── filesystem driver ─────────────────────────

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.startsWith("."))
    .map((f) => join(dir, f))
    .sort();
}

/** Locales = every <locale>.json monolith plus every messages/<locale>/ dir. */
function detectLocales(root) {
  const msgDir = join(root, "messages");
  if (!existsSync(msgDir)) return [];
  const set = new Set();
  for (const e of readdirSync(msgDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".json")) set.add(e.name.replace(/\.json$/, ""));
    else if (e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")) set.add(e.name);
  }
  return [...set].sort();
}

function planLocale(root, locale) {
  const base = existsSync(join(root, "messages", locale, "_base.json"))
    ? readJson(join(root, "messages", locale, "_base.json"))
    : existsSync(join(root, "messages", `${locale}.json`))
    ? readJson(join(root, "messages", `${locale}.json`))
    : {};
  const fragFiles = listFiles(join(root, "messages", locale, "_routes"), ".json");
  const fragments = fragFiles.map((p) => ({ name: basename(p), obj: readJson(p) }));
  return { base, fragments, fragFiles };
}

function planRequests(root) {
  const target = join(root, "public", "images", "IMAGE_REQUESTS.md");
  if (!existsSync(target)) return null;
  const fragFilesEarly = listFiles(join(root, "public", "images", "_requests"), ".md");
  if (!fragFilesEarly.length) return null; // nothing to compose — leave the shipped file untouched
  const current = readFileSync(target, "utf8");
  const marker = current.indexOf("## Requests");
  const head =
    marker === -1
      ? current.replace(/\s+$/, "") + "\n\n## Requests"
      : current.slice(0, marker) + "## Requests";
  const blocks = fragFilesEarly.flatMap((p) => splitRequestBlocks(readFileSync(p, "utf8")));
  return { target, current, next: composeRequests(head, blocks), fragCount: fragFilesEarly.length, blockCount: blocks.length };
}

/** Same messages, key order aside. `--check` compared bytes, and the scaffold's
 *  own da.json is not key-sorted, so a fresh site reported drift with zero
 *  fragments and a byte-identical _base.json. */
export function sameMessages(currentText, nextText) {
  try {
    return stableStringify(JSON.parse(currentText)) === stableStringify(JSON.parse(nextText));
  } catch {
    return false;
  }
}

function main() {
  const root = process.cwd();
  const check = process.argv.includes("--check");
  const writes = [];
  let hadConflict = false;
  let drift = false;

  for (const locale of detectLocales(root)) {
    const { base, fragments, fragFiles } = planLocale(root, locale);
    if (!fragFiles.length && !existsSync(join(root, "messages", locale, "_base.json"))) continue;
    const { merged, fragConflicts, collisions } = composeMessages(base, fragments);
    if (fragConflicts.length) {
      hadConflict = true;
      for (const c of fragConflicts) {
        console.error(`✘ ${locale}: key "${c.path}" set by two fragments (${c.a} and ${c.b}) — fix the Build Manifest namespaces`);
      }
    }
    // Fragment-over-base overrides are LEGAL — that is how a builder replaces
    // scaffold boilerplate. But they were previously invisible, so a fragment
    // could silently rewrite shipped copy and nobody would see it in the diff of
    // a generated file. Warn, don't fail; and only when the value actually
    // changed, since re-stating an identical value is noise.
    const overrides = collisions
      .filter((c) => c.a === "_base" || c.b === "_base")
      .map((c) => ({ ...c, by: c.a === "_base" ? c.b : c.a }))
      .filter((c) => JSON.stringify(leafAt(base, c.path)) !== JSON.stringify(leafAt(merged, c.path)));
    for (const c of overrides) {
      console.warn(`⚠︎ ${locale}: "${c.path}" — base value replaced by fragment ${c.by}`);
    }
    if (overrides.length) {
      console.warn(`  ${overrides.length} base key(s) overridden. Legal, but check the new copy is meant to ship.`);
    }
    const target = join(root, "messages", `${locale}.json`);
    const next = stableStringify(merged);
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (next !== current) {
      if (!(check && sameMessages(current, next))) drift = true;
      writes.push({ target, next });
    }
    console.log(`• ${locale}: ${fragFiles.length} route fragment(s) → messages/${locale}.json`);
  }

  const req = planRequests(root);
  if (req) {
    if (req.next !== req.current) {
      drift = true;
      writes.push({ target: req.target, next: req.next });
    }
    console.log(`• images: ${req.fragCount} request fragment(s), ${req.blockCount} row(s) → public/images/IMAGE_REQUESTS.md`);
  }

  if (hadConflict) {
    console.error("merge-fragments: aborting — fragment key collisions above.");
    process.exit(1);
  }
  if (check) {
    if (drift) {
      console.error("merge-fragments --check: composed output differs from disk. Run `npm run merge`.");
      process.exit(1);
    }
    console.log("merge-fragments --check: clean.");
    return;
  }
  for (const w of writes) writeFileSync(w.target, w.next);
  console.log(writes.length ? `merge-fragments: wrote ${writes.length} file(s).` : "merge-fragments: already up to date.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
