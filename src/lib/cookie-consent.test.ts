import { test } from "node:test";
import assert from "node:assert/strict";
import { framedByEditor } from "./cookie-consent.ts";

const g = globalThis as { window?: unknown };

test("framedByEditor is false on the server", () => {
  delete g.window;
  assert.equal(framedByEditor(), false);
});

test("framedByEditor is false for a top-level page and true inside a frame", () => {
  const top = {};
  g.window = { self: top, top };
  assert.equal(framedByEditor(), false);
  g.window = { self: {}, top };
  assert.equal(framedByEditor(), true);
  delete g.window;
});

test("framedByEditor treats a parent it may not read as a frame", () => {
  g.window = { self: {}, get top() { throw new Error("cross-origin"); } };
  assert.equal(framedByEditor(), true);
  delete g.window;
});

test("the template declares no consent purposes, so a new site shows no banner", async () => {
  const { SITE_CONSENT_PURPOSES } = await import("./site-consent.ts");
  const { consentRequired } = await import("./cookie-consent.ts");
  assert.deepEqual([...SITE_CONSENT_PURPOSES], []);
  assert.equal(consentRequired(), false);
});

test("consentRequired is true exactly when a purpose is declared", async () => {
  const { consentRequired } = await import("./cookie-consent.ts");
  assert.equal(consentRequired([]), false);
  assert.equal(consentRequired(["analytics"]), true);
});

test("purposeAllowed refuses an undeclared purpose without reading the device", async () => {
  const { purposeAllowed } = await import("./cookie-consent.ts");
  let reads = 0;
  const read = () => { reads++; return { necessary: true, analytics: true, marketing: true } as const; };
  assert.equal(purposeAllowed("analytics", [], read), false);
  assert.equal(purposeAllowed("marketing", ["analytics"], read), false);
  assert.equal(reads, 0);
});

test("purposeAllowed needs both the declaration and the visitor's consent", async () => {
  const { purposeAllowed } = await import("./cookie-consent.ts");
  const stored = { necessary: true, analytics: true, marketing: false } as const;
  assert.equal(purposeAllowed("analytics", ["analytics"], () => stored), true);
  assert.equal(purposeAllowed("marketing", ["analytics", "marketing"], () => stored), false);
  assert.equal(purposeAllowed("analytics", ["analytics"], () => null), false);
});

test("accepting all grants only the declared purposes", async () => {
  const { acceptAllPreferences } = await import("./cookie-consent.ts");
  assert.deepEqual(acceptAllPreferences(["analytics"]), { necessary: true, analytics: true, marketing: false });
  assert.deepEqual(acceptAllPreferences([]), { necessary: true, analytics: false, marketing: false });
});
