import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  composeLocalizedPath,
  composeAbsoluteUrl,
  composeHreflang,
  composeOgLocale,
} from "./url-core.ts";

const SITE = "https://example.com";

test("normalizePath collapses home variants to empty", () => {
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath("/"), "");
});

test("normalizePath adds a leading slash and strips trailing slashes", () => {
  assert.equal(normalizePath("services"), "/services");
  assert.equal(normalizePath("/services/"), "/services");
  assert.equal(normalizePath("/services///"), "/services");
});

test("composeLocalizedPath always-prefix: home and inner pages", () => {
  assert.equal(composeLocalizedPath("da", "", "da", "always"), "/da");
  assert.equal(composeLocalizedPath("en", "/services", "da", "always"), "/en/services");
});

test("composeLocalizedPath as-needed: default locale is unprefixed", () => {
  assert.equal(composeLocalizedPath("da", "/services", "da", "as-needed"), "/services");
  assert.equal(composeLocalizedPath("en", "/services", "da", "as-needed"), "/en/services");
  assert.equal(composeLocalizedPath("da", "", "da", "as-needed"), "/");
});

test("composeLocalizedPath never: no prefix at all", () => {
  assert.equal(composeLocalizedPath("en", "/x", "da", "never"), "/x");
  assert.equal(composeLocalizedPath("en", "", "da", "never"), "/");
});

test("composeAbsoluteUrl strips a trailing slash on siteUrl and composes locale", () => {
  assert.equal(
    composeAbsoluteUrl("https://x.com/", "da", "/services", "da", "always"),
    "https://x.com/da/services",
  );
  assert.equal(composeAbsoluteUrl(SITE, "en", "", "da", "always"), "https://example.com/en");
});

test("composeHreflang lists every locale plus x-default → default locale", () => {
  const alts = composeHreflang(SITE, "/services", ["da", "en"], "da", "always");
  assert.deepEqual(alts, {
    da: "https://example.com/da/services",
    en: "https://example.com/en/services",
    "x-default": "https://example.com/da/services",
  });
});

test("composeHreflang as-needed: default-locale alt is unprefixed and equals x-default", () => {
  const alts = composeHreflang(SITE, "/c", ["da", "en"], "da", "as-needed");
  assert.equal(alts.da, "https://example.com/c");
  assert.equal(alts["x-default"], "https://example.com/c");
  assert.equal(alts.en, "https://example.com/en/c");
});

test("composeOgLocale maps known languages and falls back to the bare code", () => {
  assert.equal(composeOgLocale("da"), "da_DK");
  assert.equal(composeOgLocale("en"), "en_US");
  assert.equal(composeOgLocale("xx"), "xx");
});
