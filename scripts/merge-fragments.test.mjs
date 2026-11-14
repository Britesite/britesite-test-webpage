import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeMessages,
  stableStringify,
  sameMessages,
  splitRequestBlocks,
  composeRequests,
} from "./merge-fragments.mjs";

test("composeMessages deep-merges disjoint route namespaces onto the base", () => {
  const base = { header: { home: "Forside" }, footer: { copyright: "©" } };
  const fragments = [
    { name: "home.json", obj: { home: { hero_title: "Velkommen" } } },
    { name: "service.smed.json", obj: { service: { smed: { h1: "Smed" } } } },
  ];
  const { merged, fragConflicts } = composeMessages(base, fragments);
  assert.deepEqual(fragConflicts, []);
  assert.equal(merged.header.home, "Forside");
  assert.equal(merged.home.hero_title, "Velkommen");
  assert.equal(merged.service.smed.h1, "Smed");
});

test("composeMessages merges two fragments under the same top namespace without collision", () => {
  const fragments = [
    { name: "service.smed.json", obj: { service: { smed: { h1: "Smed" } } } },
    { name: "service.maler.json", obj: { service: { maler: { h1: "Maler" } } } },
  ];
  const { merged, fragConflicts } = composeMessages({}, fragments);
  assert.deepEqual(fragConflicts, []);
  assert.equal(merged.service.smed.h1, "Smed");
  assert.equal(merged.service.maler.h1, "Maler");
});

test("composeMessages flags a leaf written by two different fragments (namespace bug)", () => {
  const fragments = [
    { name: "a.json", obj: { service: { smed: { h1: "A" } } } },
    { name: "b.json", obj: { service: { smed: { h1: "B" } } } },
  ];
  const { fragConflicts } = composeMessages({}, fragments);
  assert.equal(fragConflicts.length, 1);
  assert.equal(fragConflicts[0].path, "service.smed.h1");
});

test("composeMessages does NOT treat a fragment overriding a base key as a fragment conflict", () => {
  const base = { header: { cta: "Kontakt" } };
  const fragments = [{ name: "home.json", obj: { header: { cta: "Kontakt os" } } }];
  const { merged, fragConflicts } = composeMessages(base, fragments);
  assert.deepEqual(fragConflicts, []);
  assert.equal(merged.header.cta, "Kontakt os");
});

test("composeMessages is order-independent (fragments sorted by name)", () => {
  const a = { name: "a.json", obj: { a: { x: 1 } } };
  const b = { name: "b.json", obj: { b: { y: 2 } } };
  const one = stableStringify(composeMessages({}, [a, b]).merged);
  const two = stableStringify(composeMessages({}, [b, a]).merged);
  assert.equal(one, two);
});

test("stableStringify sorts keys recursively and is idempotent", () => {
  const s1 = stableStringify({ b: 1, a: { d: 4, c: 3 } });
  const s2 = stableStringify(JSON.parse(s1));
  assert.equal(s1, s2);
  assert.match(s1, /"a":/);
  assert.ok(s1.indexOf('"a"') < s1.indexOf('"b"'));
  assert.ok(s1.endsWith("\n"));
});

test("merge is idempotent: re-composing a merged monolith as base yields identical output", () => {
  const base = { header: { home: "Forside" } };
  const fragments = [{ name: "home.json", obj: { home: { t: "x" } } }];
  const first = composeMessages(base, fragments).merged;
  const second = composeMessages(first, fragments).merged;
  assert.equal(stableStringify(first), stableStringify(second));
});

test("splitRequestBlocks extracts one block per IMG heading", () => {
  const md = [
    "## IMG-home-hero-001",
    "- Prompt: a",
    "",
    "## IMG-services-smed-hero-001",
    "- Prompt: b",
  ].join("\n");
  const blocks = splitRequestBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].id, "IMG-home-hero-001");
  assert.match(blocks[0].text, /Prompt: a/);
  assert.equal(blocks[1].id, "IMG-services-smed-hero-001");
});

test("composeRequests sorts blocks by ID, dedups, and keeps the head", () => {
  const head = "# Image Requests\n\nintro\n\n## Requests";
  const blocks = [
    { id: "IMG-b", text: "## IMG-b\nsecond" },
    { id: "IMG-a", text: "## IMG-a\nfirst" },
    { id: "IMG-a", text: "## IMG-a\nfirst-updated" },
  ];
  const out = composeRequests(head, blocks);
  assert.ok(out.startsWith("# Image Requests"));
  assert.ok(out.indexOf("## IMG-a") < out.indexOf("## IMG-b"));
  assert.match(out, /first-updated/);
  assert.doesNotMatch(out, /\nfirst\n/); // the older duplicate was dropped
  assert.ok(out.endsWith("\n"));
});

test("composeRequests emits a placeholder when there are no blocks", () => {
  const out = composeRequests("# Image Requests\n\n## Requests", []);
  assert.match(out, /No image requests yet/);
});

test("--check drift is semantic: a scaffold monolith with unsorted keys but identical content is clean", () => {
  const onDisk = JSON.stringify({ header: { home: "Forside" }, footer: { copyright: "©" } }, null, 2) + "\n";
  const composed = stableStringify({ footer: { copyright: "©" }, header: { home: "Forside" } });
  assert.equal(sameMessages(onDisk, composed), true);
  assert.equal(sameMessages(onDisk, stableStringify({ header: { home: "Home" }, footer: { copyright: "©" } })), false);
  assert.equal(sameMessages("not json", composed), false);
});
