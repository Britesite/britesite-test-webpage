import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBED_PROVIDERS, frameSrcDirective } from "./providers.ts";

test("frame-src grants only the providers the site uses plus the mirror's origins, once each", () => {
  const d = frameSrcDirective(["https://www.google.com", "https://calendly.com"], ["youtube", "google-maps"]);
  assert.deepEqual(d?.split(" "), ["frame-src", EMBED_PROVIDERS.youtube.origin, "https://www.google.com", "https://calendly.com"]);
  assert.equal(frameSrcDirective([], ["vimeo"]), `frame-src ${EMBED_PROVIDERS.vimeo.origin}`);
});

test("with no provider and no mirror origin there is no frame-src at all", () => {
  assert.equal(frameSrcDirective([], []), null);
});
