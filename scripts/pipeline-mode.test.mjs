import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPipelineMode, PIPELINE_MODES } from "./pipeline-mode.mjs";

function withSite(marker, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-mode-"));
  try {
    if (marker !== null) {
      mkdirSync(join(dir, ".redesign-state"), { recursive: true });
      writeFileSync(join(dir, ".redesign-state", "pipeline-mode"), marker);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("absent marker means redesign", () => {
  withSite(null, (dir) => assert.equal(readPipelineMode(dir), "redesign"));
});

test("reads replicate, tolerant of case and whitespace", () => {
  withSite("Replicate \n", (dir) => assert.equal(readPipelineMode(dir), "replicate"));
});

test("throws, naming the file, on an unrecognised value", () => {
  withSite("clone\n", (dir) => assert.throws(() => readPipelineMode(dir), /pipeline-mode.*clone/));
});

test("the allowed set is exactly redesign|replicate", () => {
  assert.deepEqual(PIPELINE_MODES, ["redesign", "replicate"]);
});
