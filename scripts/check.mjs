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
// Steps (in order): messages, parity, fragments, types, source.
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

// ── (d) types ─────────────────────────────────────────────────────────────────

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

// ── (e) source (warn-only for FINDINGS; a crash is a failure) ──────────────────

function runSourceStep(root, spawn) {
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
