import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalisePath, pickCandidate, restoreWorkingCopy, settledStyle, stillPage, MAX_PAGES } from "./draft-view.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("normalisePath takes visitor addresses and nothing else", () => {
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath("/menu"), "/menu");
  assert.equal(normalisePath("/menu/"), "/menu");
  assert.equal(normalisePath(" /en/om-os "), "/en/om-os");
  assert.equal(normalisePath("/kontakt%C3%A6"), "/kontakt%C3%A6");
  for (const bad of ["menu", "//evil.example/x", "https://x.dk/", "/a?b=1", "/a#top", "/../etc", "/a/./b", "/a b", "/a\\b", "", null]) {
    assert.equal(normalisePath(bad), null, String(bad));
  }
  assert.equal(MAX_PAGES, 4);
});

test("pickCandidate prefers the width a desktop shows, not the largest", () => {
  const srcset = "/_next/image?url=%2Fa.jpg&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fa.jpg&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fa.jpg&amp;w=3840&amp;q=75 3840w";
  assert.equal(pickCandidate(srcset), "/_next/image?url=%2Fa.jpg&w=1200&q=75");
  // Density descriptors only: the first is as good as any.
  assert.equal(pickCandidate("/a.jpg 1x, /a@2x.jpg 2x"), "/a.jpg");
  // Every candidate far too large: the smallest.
  assert.equal(pickCandidate("/b.jpg 3840w, /c.jpg 2400w"), "/c.jpg");
  assert.equal(pickCandidate(""), null);
});

test("stillPage leaves a page that runs nothing and fetches nothing", async () => {
  const html = `<!DOCTYPE html><html lang="da"><head>
<meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://evil.example">
<base href="https://evil.example/">
<link rel="stylesheet" href="/_next/static/a.css" data-precedence="next">
<link rel="preload" as="script" href="/_next/static/chunks/x.js">
<link rel="icon" href="/favicon.ico">
<script>alert(1)</script><script src="/_next/static/chunks/main.js" async=""></script>
</head><body>
<a href="/menu" class="btn">Se menuen</a>
<a href="https://evil.example">ud</a>
<form action="/api/contact.json" method="post"><input name="x"></form>
<picture><source srcset="/images/a.avif" type="image/avif"><img alt="Vindue" loading="lazy" width="800" height="600" srcset="/_next/image?url=%2Fimages%2Fa.jpg&amp;w=1200&amp;q=75 1200w" sizes="50vw" src="/_next/image?url=%2Fimages%2Fa.jpg&amp;w=3840&amp;q=75"></picture>
<img alt="" src="/images/missing.png">
<div style="background-image:url('/images/bg.jpg')">x</div>
<iframe src="https://www.youtube.com/embed/x"></iframe>
<script type="application/ld+json">{"@type":"Cafe"}</script>
</body></html>`;
  const asked = [];
  const out = await stillPage(html, {
    inline: async (url) => {
      asked.push(url);
      return url.includes("missing") ? null : `data:image/jpeg;base64,${Buffer.from(url).toString("base64")}`;
    },
    css: async (href) => (href === "/_next/static/a.css" ? "body{color:red}</style><script>x</script>" : null),
  });
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<iframe/i);
  assert.doesNotMatch(out, /<link/i);
  assert.doesNotMatch(out, /<base/i);
  assert.doesNotMatch(out, /http-equiv/i);
  assert.doesNotMatch(out, /<source/i);
  assert.doesNotMatch(out, /\shref=/i);
  assert.doesNotMatch(out, /\saction=/i);
  assert.doesNotMatch(out, /srcset|sizes=|loading=/i);
  assert.match(out, /<style>body\{color:red\}\\3C \/style>\\3C script>x\\3C \/script><\/style>/);
  // The 1200w candidate was used, not the 3840w src.
  assert.ok(asked.includes("/_next/image?url=%2Fimages%2Fa.jpg&w=1200&q=75"), asked.join(" "));
  assert.ok(!asked.some((url) => url.includes("w=3840")));
  assert.match(out, /<img src="data:image\/jpeg;base64,[^"]+" alt="Vindue" width="800" height="600">/);
  // A picture that could not be read is emptied rather than left fetching.
  assert.match(out, /<img src="" alt="">/);
  assert.match(out, /background-image:url\("data:image\/jpeg;base64,/);
  assert.match(out, /<a class="btn">Se menuen<\/a>/);
  assert.match(out, /<input name="x">/);
});

test("settledStyle shows an element waiting to fade in, and leaves every other style alone", () => {
  assert.equal(settledStyle("opacity:0;transform:translateY(24px)"), "opacity:1");
  assert.equal(settledStyle("opacity: 0; transform: translateY(40px) scale(0.95); filter: blur(8px); color: red"), "opacity:1;color: red");
  assert.equal(settledStyle("opacity:0.0;translate:0 20px"), "opacity:1");
  // A deliberate overlay or an element that is simply moved keeps its look.
  assert.equal(settledStyle("opacity:0.6;background:#000"), "opacity:0.6;background:#000");
  assert.equal(settledStyle("opacity:0.05"), "opacity:0.05");
  assert.equal(settledStyle("transform:rotate(3deg)"), "transform:rotate(3deg)");
  assert.equal(settledStyle(""), "");
});

test("stillPage brings a scroll-in section into view", async () => {
  // How framer-motion's whileInView server-renders a section before any script runs.
  const html = `<section style="opacity:0;transform:translateY(32px)"><h2>Det siger vores gæster</h2></section><div style="opacity:0.4">overlay</div>`;
  const out = await stillPage(html, { inline: async () => null, css: async () => null });
  assert.match(out, /<section style="opacity:1"><h2>Det siger vores gæster<\/h2><\/section>/);
  assert.match(out, /<div style="opacity:0.4">overlay<\/div>/);
});

test("stillPage drops a stylesheet it could not read", async () => {
  const out = await stillPage(`<head><link rel="stylesheet" href="/gone.css"></head>`, { inline: async () => null, css: async () => null });
  assert.equal(out, "<head></head>");
});

test("restoreWorkingCopy puts back what the server wrote and nothing else, in a site below the repository's top", () => {
  const top = mkdtempSync(join(tmpdir(), "draft-view-git-"));
  try {
    const site = join(top, "site");
    mkdirSync(site);
    const git = (...args) => execFileSync("git", args, { cwd: top, stdio: "pipe" });
    writeFileSync(join(site, "AGENTS.md"), "rules\n");
    writeFileSync(join(site, "page.tsx"), "a\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    // The owner's own unsaved edit, there before the draw.
    writeFileSync(join(site, "page.tsx"), "b\n");
    const status = () => new Map(execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: top, encoding: "utf8" })
      .split("\n").filter(Boolean).map((line) => [line.slice(3), line.slice(0, 2)]));
    const before = status();
    writeFileSync(join(site, "AGENTS.md"), "rules\nnext.js block\n");
    writeFileSync(join(site, "next-env.d.ts"), "x\n");
    restoreWorkingCopy(site, before);
    assert.equal(readFileSync(join(site, "AGENTS.md"), "utf8"), "rules\n");
    assert.ok(!existsSync(join(site, "next-env.d.ts")));
    assert.equal(readFileSync(join(site, "page.tsx"), "utf8"), "b\n");
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test("the command refuses bad addresses before starting anything", () => {
  const script = fileURLToPath(new URL("./draft-view.mjs", import.meta.url));
  for (const args of [[], ["menu"], ["/a", "/b", "/c", "/d", "/e"]]) {
    let failed = false;
    try {
      execFileSync(process.execPath, [script, "--no-push", ...args], { cwd: root, stdio: "pipe" });
    } catch (error) {
      failed = error.status === 1;
    }
    assert.ok(failed, args.join(" "));
  }
});

// Renders the template's own home page with the development server, the way
// the editing helper does after saving. Needs the template's packages.
// Starts a development server, so it runs where asked for (the kit's own
// test run sets DRAFT_VIEW_RENDER_TEST=1), not in every site's npm test.
const renderSkip = process.env.DRAFT_VIEW_RENDER_TEST !== "1" ? "set DRAFT_VIEW_RENDER_TEST=1 to draw a real page"
  : !existsSync(join(root, "node_modules", "next")) && "packages not installed";
test("draws the template's home page as one still file", { skip: renderSkip, timeout: 180_000 }, () => {
  const script = fileURLToPath(new URL("./draft-view.mjs", import.meta.url));
  const out = mkdtempSync(join(tmpdir(), "draft-view-test-"));
  try {
    execFileSync(process.execPath, [script, "--no-push", "--out", out, "/"], { cwd: root, stdio: "pipe", timeout: 170_000 });
    const page = readFileSync(join(out, "0.html"), "utf8");
    assert.match(page, /<html/i);
    assert.match(page, /<style>/);
    assert.doesNotMatch(page, /<script/i);
    assert.doesNotMatch(page, /\ssrc="\/(?!\/)/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
