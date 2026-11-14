// The pipeline mode marker, read by the SITE's own scripts (verify-source,
// verify-delivery, state-fingerprint). `/replicate` writes it before handing off
// to `/redesign`; absent = redesign, so every replicate branch is inert on an
// existing site. The plugin has the same function in
// plugin/scripts/lib/redesign-state.mjs — the site cannot import the plugin, so
// the CONTRACT (file path, allowed values, absent = redesign, unknown = error) is
// documented once in .redesign-state/README.md and both copies implement it.
//
// An unrecognised value throws rather than defaulting: a typo'd marker silently
// running redesign rules against a clone is the silent failure this pipeline's
// verifiers exist to prevent.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PIPELINE_MODES = ["redesign", "replicate"];
export const PIPELINE_MODE_FILE = ".redesign-state/pipeline-mode";

export function readPipelineMode(root) {
  const p = join(root, PIPELINE_MODE_FILE);
  if (!existsSync(p)) return "redesign";
  const v = readFileSync(p, "utf8").trim().toLowerCase();
  if (!PIPELINE_MODES.includes(v)) {
    throw new Error(`pipeline-mode: unrecognised value "${v}" in ${p} (expected one of ${PIPELINE_MODES.join("|")})`);
  }
  return v;
}
