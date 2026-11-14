import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHead } from "./head-meta.mjs";

// The serialized head is entity-escaped; the budget check measures what a
// reader sees. A brand suffix with "&" was charging every page four characters.
test("parseHead decodes title and description before anyone measures them", () => {
  const h = parseHead('<title>Erhverv | Kissendrup Tømrer &amp; Snedker</title><meta name="description" content="Vi bygger &#x27;rigtigt&#x27; &amp; holdbart">');
  assert.equal(h.title, "Erhverv | Kissendrup Tømrer & Snedker");
  assert.equal(h.title.length, 37);
  assert.equal(h.description, "Vi bygger 'rigtigt' & holdbart");
});

test("parseHead reads hreflang pairs regardless of attribute order", () => {
  const h = parseHead('<link href="https://x.dk/da/" rel="alternate" hrefLang="da" /><link rel="alternate" hrefLang="x-default" href="https://x.dk/" />');
  assert.deepEqual(h.hreflang, { da: "https://x.dk/da/", "x-default": "https://x.dk/" });
});

test("parseHead leaves a missing title falsy", () => {
  assert.ok(!parseHead("<meta name=\"description\" content=\"x\">").title);
});
