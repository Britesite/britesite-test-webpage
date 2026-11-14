import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findThirdPartyFrames,
  findThirdPartyEmbedsInSource,
  facadeProvidersInSource,
  facadeProvidersInMirror,
  findUnnamedEmbedProviders,
} from "./verify-source.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-source.mjs");
const MAP_FIXTURE = '<html><head><title>Om os</title></head><body><iframe src="https://www.google.com/maps/embed"></iframe></body></html>';

test("findThirdPartyFrames flags the mirrored map iframe", () => {
  const hits = findThirdPartyFrames(MAP_FIXTURE, new Set(["example.dk"]));
  assert.deepEqual(hits.map((h) => [h.tag, h.url, h.host]), [["iframe", "https://www.google.com/maps/embed", "www.google.com"]]);
});

test("findThirdPartyFrames flags an external script and a protocol-relative frame", () => {
  const html = '<script src="https://cdn.widget.io/w.js"></script><iframe class="x" src="//player.vimeo.com/video/1"></iframe>';
  assert.deepEqual(findThirdPartyFrames(html, new Set()).map((h) => h.host), ["cdn.widget.io", "player.vimeo.com"]);
});

test("findThirdPartyFrames passes own-host, relative and facaded embeds", () => {
  const html = [
    '<iframe src="https://example.dk/embed"></iframe>',
    '<iframe src="/local"></iframe>',
    '<script src="/_next/static/chunks/a.js"></script>',
    '<div data-embed-facade data-embed-src="https://www.google.com/maps/embed"></div>',
    '<iframe srcdoc="<p>x</p>"></iframe>',
  ].join("");
  assert.deepEqual(findThirdPartyFrames(html, new Set(["example.dk"])), []);
});

test("findThirdPartyEmbedsInSource flags a raw iframe and an external next/script", () => {
  const src = `import Script from "next/script";\nexport function A(){return <><iframe src="https://maps.google.com" />\n<Script src="https://widget.io/x.js" /></>;}`;
  const hits = findThirdPartyEmbedsInSource(src);
  assert.deepEqual(hits.map((h) => h.line), [2, 3]);
  assert.match(hits[0].why, /MapFacade|VideoFacade/);
});

test("findThirdPartyEmbedsInSource ignores iframe mentions in strings, comments and first-party scripts", () => {
  const src = `// an <iframe> in a comment\nconst sel = "iframe,object";\nexport const S = () => <script src="/local.js" />;`;
  assert.deepEqual(findThirdPartyEmbedsInSource(src), []);
});

test("facadeProvidersInSource reads the providers a site uses", () => {
  const src = '<VideoFacade provider="youtube" id="x" poster="/p.jpg" title="t" />\n<VideoFacade provider="vimeo" id="1" poster="/p.jpg" title="t" />\n<MapFacade interactive address="a" query="a" />\n<MapFacade address="b" query="b" />';
  assert.deepEqual([...facadeProvidersInSource(src)].sort(), ["google-maps", "vimeo", "youtube"]);
  assert.deepEqual([...facadeProvidersInSource('<VideoFacade src="/hero.mp4" poster="/p.jpg" title="t" />')], []);
});

test("facadeProvidersInMirror reads data-embed-provider", () => {
  assert.deepEqual([...facadeProvidersInMirror('<div data-embed-facade data-embed-provider="google-maps"></div>')], ["google-maps"]);
});

test("findThirdPartyFrames reads lazy-loader sources and quoted '>' in attributes, and skips comments", () => {
  const html = [
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/abc"></iframe>',
    '<iframe data-lazy-src="https://player.vimeo.com/video/1"></iframe>',
    '<iframe title="Kort > Aarhus" src="https://www.google.com/maps/embed"></iframe>',
    '<!-- <iframe src="https://calendly.com/old"></iframe> -->',
  ].join("\n");
  assert.deepEqual(findThirdPartyFrames(html, new Set()).map((h) => [h.host, h.line]), [["www.youtube.com", 1], ["player.vimeo.com", 2], ["www.google.com", 3]]);
});

test("findUnnamedEmbedProviders wants the provider's own name, not its parent company", () => {
  assert.equal(findUnnamedEmbedProviders(new Set(["google-maps"]), "We use Google Analytics").length, 1);
  assert.deepEqual(findUnnamedEmbedProviders(new Set(["google-maps"]), "The map loads from Google Maps."), []);
});

test("verify-source reads the privacy policy's messages too, so a combined policy naming the provider passes", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-embeds-"));
  try {
    mkdirSync(join(root, "src", "app"), { recursive: true });
    mkdirSync(join(root, "messages"), { recursive: true });
    writeFileSync(join(root, "src", "app", "page.tsx"), 'export default function P(){return <MapFacade interactive address="A 1" />;}\n');
    writeFileSync(join(root, "messages", "en.json"), JSON.stringify({ privacy: { thirdParties: "The interactive map loads from Google Maps when you ask for it." } }));
    const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SITE_DOMAIN: "" } });
    assert.doesNotMatch(res.stdout, /policy names Google Maps/, res.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frame-src must list exactly the facade providers the source uses", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-embeds-"));
  const listFile = join(root, "src", "components", "embeds", "site-providers.ts");
  const run = () => spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SITE_DOMAIN: "" } }).stdout;
  try {
    mkdirSync(join(root, "src", "components", "embeds"), { recursive: true });
    writeFileSync(join(root, "src", "app.tsx"), 'export const A = () => <VideoFacade provider="youtube" id="x" poster="/p.jpg" title="t" />;\n');
    writeFileSync(listFile, 'export const SITE_EMBED_PROVIDERS: readonly EmbedProvider[] = [];\n');
    assert.match(run(), /site-providers\.ts:\d+ — .*"youtube".*SITE_EMBED_PROVIDERS/);
    writeFileSync(listFile, 'export const SITE_EMBED_PROVIDERS: readonly EmbedProvider[] = ["youtube", "vimeo"];\n');
    const out = run();
    assert.doesNotMatch(out, /"youtube".*SITE_EMBED_PROVIDERS/);
    assert.match(out, /site-providers\.ts:\d+ — .*"vimeo"/, "a provider nothing uses must not widen frame-src");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findUnnamedEmbedProviders fails a provider the cookie policy does not name", () => {
  const hits = findUnnamedEmbedProviders(new Set(["youtube", "google-maps"]), "We embed YouTube videos.");
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /Google Maps/);
  assert.deepEqual(findUnnamedEmbedProviders(new Set(["youtube"]), "videos from youtube"), []);
});

test("verify-source --root fails on a built mirrored page embedding a third-party frame, naming the file", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-embeds-"));
  try {
    const dir = join(root, ".next", "server", "app", "api", "mirror-page");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "om-os.body"), MAP_FIXTURE);
    const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SITE_DOMAIN: "" } });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /\.next\/server\/app\/api\/mirror-page\/om-os\.body:\d+ — .*https:\/\/www\.google\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("VERIFY_ROOT selects the root as --root does", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-embeds-"));
  try {
    const dir = join(root, ".next", "server", "app", "api", "mirror-page");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "om-os.body"), MAP_FIXTURE);
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, VERIFY_ROOT: root, NEXT_PUBLIC_SITE_DOMAIN: "" } });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /mirror-page\/om-os\.body/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-source --root passes a built page whose embed is facaded", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-embeds-"));
  try {
    const dir = join(root, ".next", "server", "app", "api", "mirror-page");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "om-os.body"), '<div data-embed-facade data-embed-src="https://www.google.com/maps/embed"></div><script src="/embed-facade.js"></script>');
    const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SITE_DOMAIN: "" } });
    assert.equal(res.status, 0, res.stdout + res.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
