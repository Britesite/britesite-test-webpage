import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  flattenKeys,
  resolveLocales,
  parseMessageFiles,
  compareKeySets,
  hasFragments,
  runChecks,
} from "./check.mjs";

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}
function write(dir, relPath, content) {
  const p = join(dir, relPath);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// ── flattenKeys ──────────────────────────────────────────────────────────────

test("flattenKeys yields dotted leaf paths and treats arrays as leaves", () => {
  const obj = { a: { b: "x", c: ["y", "z"] }, d: "e" };
  const keys = flattenKeys(obj).sort();
  assert.deepEqual(keys, ["a.b", "a.c", "d"]);
});

// ── resolveLocales ───────────────────────────────────────────────────────────

test("resolveLocales reads locales and defaultLocale from routing.ts and falls back to the first locale", () => {
  const src = "export const routing = defineRouting({\n  locales: ['da', 'en'],\n  defaultLocale: 'da'\n});\n";
  assert.deepEqual(resolveLocales(src), { locales: ["da", "en"], defaultLocale: "da" });

  const srcNoDefault = "locales: ['en', 'fr']";
  assert.deepEqual(resolveLocales(srcNoDefault), { locales: ["en", "fr"], defaultLocale: "en" });
});

// ── parseMessageFiles ────────────────────────────────────────────────────────

test("parseMessageFiles names the file and the JSON error for a malformed fragment", () => {
  const files = ["/virtual/good.json", "/virtual/bad.json"];
  const contents = {
    "/virtual/good.json": JSON.stringify({ a: 1 }),
    "/virtual/bad.json": "{ not: valid",
  };
  const { parsed, errors } = parseMessageFiles(files, (f) => contents[f]);
  assert.equal(parsed.size, 1);
  assert.deepEqual(parsed.get("/virtual/good.json"), { a: 1 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, "/virtual/bad.json");
  assert.ok(errors[0].message.length > 0);
});

// ── compareKeySets ───────────────────────────────────────────────────────────

test("compareKeySets reports keys missing from a secondary locale and keys extra relative to the primary", () => {
  const primaryKeys = ["a", "b", "c"];
  const keysByLocale = { en: ["a", "c", "d"] };
  const result = compareKeySets(primaryKeys, keysByLocale);
  assert.equal(result.length, 1);
  assert.equal(result[0].locale, "en");
  assert.deepEqual(result[0].missing, ["b"]);
  assert.deepEqual(result[0].extra, ["d"]);
});

test("compareKeySets is clean when every locale has the same key set", () => {
  const primaryKeys = ["a", "b", "c"];
  const keysByLocale = { en: ["a", "b", "c"] };
  const result = compareKeySets(primaryKeys, keysByLocale);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].missing, []);
  assert.deepEqual(result[0].extra, []);
});

// ── hasFragments ─────────────────────────────────────────────────────────────

test("hasFragments ignores .gitkeep and is true for _base.json alone", () => {
  const dirGitkeepOnly = tmpDir("check-fragments-gitkeep-");
  try {
    write(dirGitkeepOnly, "messages/da/_routes/.gitkeep", "");
    assert.equal(hasFragments(dirGitkeepOnly), false);
  } finally {
    rmSync(dirGitkeepOnly, { recursive: true, force: true });
  }

  const dirBaseOnly = tmpDir("check-fragments-base-");
  try {
    write(dirBaseOnly, "messages/da/_base.json", "{}");
    assert.equal(hasFragments(dirBaseOnly), true);
  } finally {
    rmSync(dirBaseOnly, { recursive: true, force: true });
  }
});

// ── runChecks: messages + parity ─────────────────────────────────────────────

test("runChecks: a malformed fragment fails step messages and parity still runs on the monoliths", () => {
  const dir = tmpDir("check-messages-parity-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en/_routes/bad.json", "{ not valid json");

    const { steps, ok } = runChecks({
      root: dir,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
      skip: new Set(["fragments", "types", "source"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.messages.status, "fail");
    assert.match(byName.messages.lines.join("\n"), /bad\.json/);
    assert.equal(byName.parity.status, "pass");
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runChecks: fragments step ────────────────────────────────────────────────

test("runChecks skips merge --check without fragments and invokes it with _base.json present", () => {
  const dirNoFragments = tmpDir("check-fragments-skip-");
  try {
    write(dirNoFragments, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dirNoFragments, "messages/en.json", JSON.stringify({ a: "1" }));

    const calls = [];
    const { steps } = runChecks({
      root: dirNoFragments,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types", "source"]),
    });
    const fragmentsStep = steps.find((s) => s.name === "fragments");
    assert.equal(fragmentsStep.status, "skip");
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dirNoFragments, { recursive: true, force: true });
  }

  const dirWithBase = tmpDir("check-fragments-run-");
  try {
    write(dirWithBase, "messages/da/_base.json", "{}");
    write(dirWithBase, "messages/da.json", JSON.stringify({ a: "1" }));

    const calls = [];
    const { steps } = runChecks({
      root: dirWithBase,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types", "source"]),
    });
    const fragmentsStep = steps.find((s) => s.name === "fragments");
    assert.equal(fragmentsStep.status, "pass");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "node");
    assert.deepEqual(calls[0].args, ["scripts/merge-fragments.mjs", "--check"]);
  } finally {
    rmSync(dirWithBase, { recursive: true, force: true });
  }
});

// ── runChecks: source step is warn-only ──────────────────────────────────────

test("runChecks never fails on verify-source output (warn-only)", () => {
  const dir = tmpDir("check-source-warn-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));

    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => {
        if (args.some((a) => String(a).includes("verify-source"))) {
          return { status: 1, stdout: "✘ banned marketing phrase in src/app/page.tsx\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.source.status, "warn");
    assert.match(byName.source.lines.join("\n"), /banned marketing phrase/);
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runChecks: types step ────────────────────────────────────────────────────

test("runChecks fails when tsc exits non-zero and passes its diagnostics through", () => {
  const dir = tmpDir("check-types-fail-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    write(dir, "node_modules/.bin/tsc", "");

    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd) => {
        if (cmd.endsWith("tsc")) {
          return { status: 2, stdout: "src/app/page.tsx(3,5): error TS2322: Type mismatch.\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["source"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.types.status, "fail");
    assert.match(byName.types.lines.join("\n"), /TS2322/);
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test("cli: exits 1 on a fixture with a parity gap and names the missing key (--skip=types,source)", () => {
  const dir = tmpDir("check-cli-parity-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1", b: "2" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));

    let caught;
    try {
      execFileSync(
        process.execPath,
        [new URL("./check.mjs", import.meta.url).pathname, dir, "--skip=types,source"],
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "expected a non-zero exit");
    assert.equal(caught.status, 1);
    assert.match(caught.stdout, /missing in en: b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChecks FAILS (not warns) when verify-source crashes before running a check", () => {
  const dir = tmpDir("check-source-crash-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => {
        if (args && args[0] === "scripts/verify-source.mjs") {
          return { status: 1, stdout: "", stderr: "Error: pipeline-mode: unrecognised value \"replcate\" in .redesign-state/pipeline-mode\n    at readPipelineMode" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));
    assert.equal(byName.source.status, "fail");
    assert.match(byName.source.lines.join("\n"), /unrecognised value/);
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChecks still only WARNS when verify-source ran and reported findings", () => {
  const dir = tmpDir("check-source-warn-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => (args && args[0] === "scripts/verify-source.mjs" ? { status: 1, stdout: "  ✘  messages/da.json:3 — banned copy\n", stderr: "" } : { status: 0, stdout: "", stderr: "" }),
      skip: new Set(["types"]),
    });
    assert.equal(steps.find((s) => s.name === "source").status, "warn");
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
