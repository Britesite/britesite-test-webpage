#!/usr/bin/env node
// Content fingerprint of everything the publish gate implicitly approves.
//
// The gate used to be considered fresh if its mtime beat HEAD's. That answers
// "was this written recently", not "was this written about THIS code" — and those
// differ in exactly the case that matters. Edit a page after Step 10 without
// committing and the gate is still newer than HEAD, so it reads fresh and
// /publish ships code no review ever saw. Change design-direction.md and every
// built page is now approved against a brief that no longer exists.
//
// So: hash the content, not the clock. Step 10 embeds this block in
// publish-gate.md; /publish recomputes it and refuses on any difference.
//
// Grouped rather than one opaque digest, because WHICH group moved tells you what
// to do: `decisions` changed means re-run the review lanes, `source` changed means
// re-run the build and the verifiers, `config` changed means both.
//
// Usage:
//   node scripts/state-fingerprint.mjs            # print the block
//   node scripts/state-fingerprint.mjs --check    # compare against publish-gate.md, exit 1 on drift

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";
import { runIdentity, designManifest, visualAssets, readJson, inside, fileHashes } from "./lib/design-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

/** Files whose change invalidates a REVIEW: the decisions every page executes.
 *  The pipeline-mode marker is one of them — flipping it after the gate changes
 *  which standard the reviews were held to. Missing files are skipped by digest(),
 *  so a redesign site (no marker) hashes exactly as before. */
const DECISIONS = [
  "brand.md", "content-strategy.md", "SITE_PLAN_TEMPLATE.md",
  "design-direction.md", "design-system.md", "IMAGE_SLOTS.md",
  ".redesign-state/pipeline-mode",
];
/** Files whose change invalidates a BUILD. */
const CONFIG = ["next.config.ts", "package.json", "src/app/globals.css"];
/** Trees whose change invalidates both. */
const TREES = ["src", "messages"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function walk(dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** Hash a file list by path+content, sorted, so the digest is order-independent. */
function digest(files) {
  const h = createHash("sha256");
  let count = 0;
  for (const f of [...files].sort()) {
    const abs = join(root, f);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    h.update(f);
    h.update(readFileSync(abs));
    count++;
  }
  return { hash: h.digest("hex").slice(0, 16), count };
}

const groups = {
  decisions: digest(DECISIONS),
  config: digest(CONFIG),
  source: digest(walk("src")),
  messages: digest(walk("messages")),
};
try {
if (runIdentity(root).schemaVersion === 2) {
  const paths = [".redesign-state/run-contract.json", ".redesign-state/design-manifest.json", ".redesign-state/design-review.json"];
  const index = readJson(join(root, ".redesign-state/design-review.json"));
  for (const entry of Object.values(index.stages)) {
    paths.push(entry.path);
    const record = readJson(inside(root, entry.path));
    paths.push(...record.captures.screenshots.map((shot) => shot.path));
  }
  const assets = existsSync(join(root, ".redesign-state/design-manifest.json")) ? visualAssets(root, designManifest(root)) : [];
  fileHashes(root, assets);
  groups.visuals = digest(assets);
  groups.evidence = digest(paths);
}
} catch (error) {
  console.error(`state-fingerprint: schema-2 evidence unreadable — ${error.message}`);
  process.exit(1);
}
const overall = createHash("sha256")
  .update(Object.entries(groups).map(([k, v]) => `${k}:${v.hash}`).join("|"))
  .digest("hex")
  .slice(0, 16);

const block =
  Object.entries(groups)
    .map(([k, v]) => `${k.padEnd(10)} ${v.hash}  (${v.count} file${v.count === 1 ? "" : "s"})`)
    .join("\n") + `\noverall    ${overall}`;

if (!CHECK) {
  console.log(block);
  process.exit(0);
}

// ── --check: compare against what the gate recorded ──────────────────────────
const gatePath = join(root, ".redesign-state/publish-gate.md");
if (!existsSync(gatePath)) {
  console.error("state-fingerprint: no .redesign-state/publish-gate.md — run Step 10 first.");
  process.exit(1);
}
const gate = readFileSync(gatePath, "utf8");
const recorded = Object.fromEntries(
  [...gate.matchAll(/^(decisions|config|source|messages|visuals|evidence|overall)\s+([a-f0-9]{16})/gm)].map((m) => [m[1], m[2]]),
);
if (!recorded.overall) {
  console.error(
    "state-fingerprint: the gate records no fingerprint block.\n" +
      "  It was written before this check existed, so it cannot say WHICH code it approved.\n" +
      "  Re-run Step 10 to write a gate that can.",
  );
  process.exit(1);
}

const drift = Object.entries(groups).filter(([k, v]) => recorded[k] && recorded[k] !== v.hash);
if (!drift.length && recorded.overall === overall) {
  console.log(`state-fingerprint: MATCH (overall ${overall}) — the gate approved exactly this content.`);
  process.exit(0);
}

const WHAT = {
  decisions: "the brief the pages were built to. Re-run the review lanes — every page is now approved against a decision that changed.",
  config: "build configuration. Re-run the build and both verifiers.",
  source: "the built site itself. Re-run the build, the verifiers, and any review lane that read a changed page.",
  messages: "site copy. Re-run the build and the delivery verifier.",
  visuals: "consumed visual assets. Re-render and repeat affected visual reviews.",
  evidence: "run or design evidence. Recompute the gate after validating the current review records.",
};
console.error("state-fingerprint: DRIFT — the gate did not approve this content.\n");
for (const [k, v] of drift) {
  console.error(`  ${k}: gate ${recorded[k]} -> now ${v.hash}`);
  console.error(`    changed: ${WHAT[k]}\n`);
}
console.error("A gate approves a state, not a moment. Re-run Step 10.");
process.exit(1);
