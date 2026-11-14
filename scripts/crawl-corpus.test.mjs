import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCopy, loadCrawlCorpus, corpusIncludes, decodeEntities } from "./crawl-corpus.mjs";

test("normalizeCopy unescapes ICU quotes and braces, collapses whitespace, lowercases, NFC", () => {
  assert.equal(normalizeCopy("Vi  leverer\n''hurtigt'' '{'præcist'}'"), "vi leverer 'hurtigt' {præcist}");
  assert.equal(normalizeCopy("Café"), "café");
});

test("loadCrawlCorpus concatenates every string leaf of every crawl JSON and reports which pages it read", () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-corpus-"));
  try {
    mkdirSync(join(dir, ".redesign-state", "crawl"), { recursive: true });
    writeFileSync(join(dir, ".redesign-state", "crawl", "home.json"), JSON.stringify({
      meta: { title: "Acme — Seamless boiler service" },
      sections: [{ kind: "hero", text: "We are the leading provider of boilers in Aarhus", images: ["img1"] }],
      styles: { n1: { 1440: { fontSize: "16px" } } },
    }));
    writeFileSync(join(dir, ".redesign-state", "crawl", "about.json"), JSON.stringify({ sections: [{ text: "Founded 1987" }] }));
    writeFileSync(join(dir, ".redesign-state", "crawl", "manifest.json"), JSON.stringify({ routes: [] }));
    const corpus = loadCrawlCorpus(dir);
    assert.equal(corpus.pages, 2, "manifest.json and assets.json are not pages");
    assert.ok(corpusIncludes(corpus, "the leading provider of boilers"));
    assert.ok(corpusIncludes(corpus, "Founded 1987"));
    assert.ok(corpus.meta.has(normalizeCopy("Acme — Seamless boiler service")));
    assert.equal(corpusIncludes(corpus, "state-of-the-art heating"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCrawlCorpus on a site with no crawl dir is empty, not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-corpus-empty-"));
  try {
    const corpus = loadCrawlCorpus(dir);
    assert.equal(corpus.pages, 0);
    assert.equal(corpusIncludes(corpus, "anything"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corpusIncludes matches a JSON-escaped value after decoding", () => {
  const corpus = { text: normalizeCopy("Vi siger \"ja\" til kunden"), meta: new Set(), pages: 1 };
  assert.ok(corpusIncludes(corpus, 'Vi siger \\"ja\\" til kunden', { jsonEscaped: true }));
});

test("the corpus is built from copy-bearing fields only — URLs, styles and hrefs cannot exempt a word", () => {
  const dir = mkdtempSync(join(tmpdir(), "crawl-corpus-copy-"));
  try {
    mkdirSync(join(dir, ".redesign-state", "crawl"), { recursive: true });
    writeFileSync(join(dir, ".redesign-state", "crawl", "home.json"), JSON.stringify({
      url: "https://example.dk/seamless-page",
      sections: [{ kind: "content", text: "Vi laver alt i VVS", links: [{ href: "https://example.dk/wp-content/plugins/seamless-donations/", text: "Donér" }] }],
      styles: { n1: { 1440: { fontFamily: "Seamless Sans" } } },
      css: { inline: ["/* seamless */"] },
      images: [{ src: "https://cdn.x/empower.jpg", alt: "Montør" }],
    }));
    const corpus = loadCrawlCorpus(dir);
    assert.equal(corpusIncludes(corpus, "seamless"), false);
    assert.equal(corpusIncludes(corpus, "empower"), false);
    assert.equal(corpusIncludes(corpus, "Vi laver alt i VVS"), true);
    assert.equal(corpusIncludes(corpus, "Donér"), true, "link text is copy");
    assert.equal(corpusIncludes(corpus, "Montør"), true, "alt text is copy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corpusIncludes matches on word boundaries — 'seamlessly' does not exempt 'seamless'", () => {
  const corpus = { text: normalizeCopy("It works seamlessly with your architect"), meta: new Set(), pages: 1 };
  assert.equal(corpusIncludes(corpus, "seamless"), false);
  assert.equal(corpusIncludes(corpus, "works seamlessly"), true);
  assert.equal(corpusIncludes(corpus, "your architect"), true);
});

test("decodeEntities reverses the escaping a rendered <head> carries", () => {
  assert.equal(decodeEntities("Hansen VVS &amp; Blik &#x27;s &quot;best&quot; &#39;x&#39; &ndash; &nbsp;y"), "Hansen VVS & Blik 's \"best\" 'x' – \u00a0y");
});
