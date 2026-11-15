#!/usr/bin/env node
// draft-view — draw the changed pages of a saved draft, so the editing app can
// show them before the hosting build of that draft has finished.
//
// The editing app shows a change of words or a swapped picture on the preview
// that is already built, at once. A new section or any other change of page
// code needs a build before it can be seen, and that build takes half a minute
// or more after the helper has saved. This script is the early look for those:
// it renders the given pages from the working copy with the development
// server, turns each into one self-contained, script-free HTML file (styles,
// fonts and pictures inlined), and pushes them, keyed to the saved commit, to
// the hidden ref refs/britesite/draft-view. Hosting builds branches only, so
// that ref never starts a build; the editing app reads it, shows the page as a
// still copy, and swaps to the real build when it is ready.
//
// Self-contained — node builtins only — so update-child-sites.sh can copy this
// one file into an already-scaffolded site.
//
// Usage (from the top of the working copy, after the change is pushed):
//   node scripts/draft-view.mjs [--no-push] [--out <dir>] <path> [<path> ...]
// <path> is a page address as a visitor types it: /, /menu, /en/about.
// Exit 0 = shared (or written, with --no-push); 1 = nothing usable, with the
// reason on stderr. A page that fails to render is a real fault in the change.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

export const DRAFT_REF = "refs/britesite/draft-view";
export const MAX_PAGES = 4;
// One page's file, everything inlined. Larger means pictures were kept too
// large; the app would rather wait for the build than load megabytes.
export const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MAX_ASSET_BYTES = 1_500_000;
const PICTURE_WIDTH = 1200;
const READY_MS = 120_000;
const PAGE_MS = 90_000;

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────

/** A visitor address the script may render: an absolute path, no host, query or dot segments. */
export function normalisePath(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.length > 300) return null;
  if (/[?#\\\s]/.test(value) || /(^|\/)\.\.?(\/|$)/.test(value)) return null;
  return value.length > 1 ? value.replace(/\/+$/, "") || "/" : "/";
}

/** From a srcset, the candidate whose width is closest to `want` without going far over it. */
export function pickCandidate(srcset, want = PICTURE_WIDTH) {
  const candidates = srcset
    .split(/,\s+/)
    .map((part) => part.trim().split(/\s+/))
    .filter(([url]) => url)
    .map(([url, descriptor]) => ({ url: url.replace(/&amp;/g, "&"), w: Number(String(descriptor ?? "").replace(/w$/, "")) || 0 }));
  if (candidates.length === 0) return null;
  const fitting = candidates.filter((c) => c.w && c.w <= want * 1.4).sort((a, b) => b.w - a.w);
  return (fitting[0] ?? candidates.sort((a, b) => a.w - b.w)[0]).url;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? "") : null;
}

function setAttr(tag, name, value) {
  const without = removeAttr(tag, name);
  return without.replace(/^<([a-z0-9-]+)/i, `<$1 ${name}="${value}"`);
}

function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, "gi"), "");
}

/**
 * The page as a still: no scripts, no preloads, no frames, nothing fetched
 * from anywhere. `inline(url)` returns a data: URI for a local asset address
 * (or null to drop it); `css(href)` returns a stylesheet's text with its own
 * urls already inlined.
 */
export async function stillPage(html, { inline, css }) {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<(?:object|embed)\b[^>]*>(?:[\s\S]*?<\/(?:object|embed)\s*>)?/gi, "")
    .replace(/<link\b[^>]*\brel\s*=\s*["']?(?:preload|modulepreload|prefetch|dns-prefetch|preconnect|manifest|icon|apple-touch-icon|alternate|canonical)\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "");

  // Stylesheets become <style> with their fonts and pictures inside.
  const sheets = [...out.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet\b[^>]*>/gi)];
  for (const [tag] of sheets) {
    const href = attr(tag, "href");
    const text = href ? await css(href) : null;
    // "<" never belongs in a stylesheet outside a string, and inside one the
    // CSS escape reads the same, so nothing in it can close the <style>.
    out = out.replace(tag, text === null ? "" : `<style>${text.replace(/</g, "\\3C ")}</style>`);
  }

  // Pictures: the next/image candidate near the width a desktop shows, inlined.
  const images = [...out.matchAll(/<img\b[^>]*>/gi)];
  for (const [tag] of images) {
    const srcset = attr(tag, "srcset");
    const src = (srcset && pickCandidate(srcset)) || attr(tag, "src") || "";
    const data = src.startsWith("data:") ? src : src ? await inline(src) : null;
    let next = removeAttr(removeAttr(removeAttr(tag, "srcset"), "sizes"), "loading");
    next = data ? setAttr(next, "src", data) : setAttr(next, "src", "");
    out = out.replace(tag, next);
  }

  // Inline style="background-image:url(/…)" and any url() left in <style>.
  out = await replaceAsync(out, /url\(\s*(['"]?)(\/[^'")\s]+)\1\s*\)/g, async (_, _q, url) => {
    const data = await inline(url);
    return data ? `url("${data}")` : "none";
  });

  // Sections that fade in on scroll (framer-motion's whileInView and the
  // like) are server-rendered at their starting point, transparent and
  // shifted, and only a script brings them in. A still runs no script, so
  // each such element is put at its end state: shown, in place.
  out = out.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (whole, _quoted, double, single) => {
    const style = double ?? single ?? "";
    const finished = settledStyle(style);
    return finished === style ? whole : ` style="${finished.replace(/"/g, "&quot;")}"`;
  });

  // Links and forms would leave the still or reach the app's own origin; the
  // app shows the page, it is not for browsing.
  out = out.replace(/<a\b[^>]*>/gi, (tag) => removeAttr(tag, "href"));
  out = out.replace(/<form\b[^>]*>/gi, (tag) => removeAttr(removeAttr(tag, "action"), "method"));
  return out;
}

/**
 * An inline style at the end of its entrance: an element waiting at zero
 * opacity is shown, and the transform or blur it was to settle from is
 * dropped. Any other style is left exactly as it was, so a deliberate
 * half-transparent overlay keeps its opacity.
 */
export function settledStyle(style) {
  const decoded = style.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
  if (!/(^|;)\s*opacity\s*:\s*0(\.0+)?\s*(;|$|!)/i.test(decoded)) return style;
  return decoded
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => rule && !/^(transform|translate|scale|rotate|filter)\s*:/i.test(rule))
    .map((rule) => (/^opacity\s*:/i.test(rule) ? "opacity:1" : rule))
    .join(";");
}

async function replaceAsync(text, pattern, fn) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index), await fn(...match));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts.join("");
}

// ───────────────────────── the render ─────────────────────────

function mime(url, header) {
  if (header && !/octet-stream/.test(header)) return header.split(";")[0].trim();
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  return { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon" }[ext ?? ""]
    ?? "application/octet-stream";
}

async function freePort() {
  return await new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function get(origin, path, timeoutMs = PAGE_MS) {
  // Redirects are followed by hand so they stay on this server (the locale
  // rewrite answers / with /da on some sites, and Location may name a host).
  let url = new URL(path, origin);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "accept-language": "" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      const next = new URL(response.headers.get("location"), url);
      url = new URL(next.pathname + next.search, origin);
      continue;
    }
    return response;
  }
  throw new Error(`too many redirects for ${path}`);
}

async function startServer(root) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error("the site's packages are not installed (node_modules/next is missing)");
  const log = [];
  const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "-p", String(port), "-H", "localhost"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", BROWSER: "none", PORT: String(port) },
  });
  const keep = (chunk) => {
    log.push(String(chunk));
    if (log.length > 200) log.shift();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const exited = new Promise((done) => child.once("exit", done));
  const stop = async () => {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    const killed = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (!killed) try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone after all */ }
  };
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the development server stopped:\n${log.join("").slice(-1500)}`);
    try {
      await fetch(`${origin}/favicon.ico`, { signal: AbortSignal.timeout(2000) });
      return { origin, stop, log };
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await stop();
  throw new Error("the development server did not start in time");
}

/** Paths git reports as changed or new, porcelain v1 -z. */
function dirtyPaths(root) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const paths = new Map();
  const items = out.split("\0");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.length < 4) continue;
    paths.set(item.slice(3), item.slice(0, 2));
    if (item[0] === "R" || item[0] === "C") i++;
  }
  return paths;
}

/**
 * The development server writes into the working copy: Next.js 16 adds its
 * own block to AGENTS.md (and asks agents to commit it), and may write
 * next-env.d.ts. Whatever it changed that was clean before is put back, so
 * the draw never leaves work behind for the next commit.
 */
export function restoreWorkingCopy(root, before, after = dirtyPaths(root)) {
  // git status names paths from the top of the repository, which is not
  // always the site's own folder.
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
  for (const [path, status] of after) {
    if (before.has(path)) continue;
    if (status === "??") rmSync(join(top, path), { force: true });
    else execFileSync("git", ["checkout", "--", path], { cwd: top, stdio: "pipe" });
  }
}

async function renderPages(root, paths) {
  const before = dirtyPaths(root);
  try {
    return await renderWith(root, paths);
  } finally {
    restoreWorkingCopy(root, before);
  }
}

async function renderWith(root, paths) {
  const server = await startServer(root);
  const cache = new Map();
  const inline = async (url) => {
    if (url.startsWith("data:")) return url;
    let local = url;
    try {
      const parsed = new URL(url, server.origin);
      if (parsed.origin !== server.origin) return null;
      local = parsed.pathname + parsed.search;
    } catch {
      return null;
    }
    if (cache.has(local)) return cache.get(local);
    let data = null;
    try {
      let response = await get(server.origin, local, 30_000);
      let bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      // A plain picture too heavy to inline goes through the image optimiser.
      if (bytes && bytes.length > MAX_ASSET_BYTES && /\.(jpe?g|png|webp|avif)$/i.test(local)) {
        response = await get(server.origin, `/_next/image?url=${encodeURIComponent(local)}&w=${PICTURE_WIDTH}&q=70`, 30_000);
        bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      }
      if (bytes && bytes.length <= MAX_ASSET_BYTES) {
        data = `data:${mime(local, response.headers.get("content-type"))};base64,${bytes.toString("base64")}`;
      }
    } catch {
      data = null;
    }
    cache.set(local, data);
    return data;
  };
  const css = async (href) => {
    try {
      const response = await get(server.origin, href, 30_000);
      if (!response.ok) return null;
      const text = await response.text();
      const base = new URL(href, server.origin);
      return await replaceAsync(text, /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, async (whole, _q, url) => {
        if (url.startsWith("data:") || url.startsWith("#")) return whole;
        const data = await inline(new URL(url, base).href);
        return data ? `url("${data}")` : "none";
      });
    } catch {
      return null;
    }
  };
  const pages = [];
  try {
    for (const path of paths) {
      const response = await get(server.origin, path);
      const html = await response.text();
      if (response.status !== 200) {
        throw new Error(`${path} did not render (status ${response.status}):\n${server.log.join("").slice(-1500)}`);
      }
      const still = await stillPage(html, { inline, css });
      if (Buffer.byteLength(still) > MAX_PAGE_BYTES) throw new Error(`${path} came out too large to share (${Buffer.byteLength(still)} bytes)`);
      pages.push({ path, html: still });
    }
  } finally {
    await server.stop();
  }
  return pages;
}

// ───────────────────────── sharing ─────────────────────────

function git(root, args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000, ...options }).trim();
}

/** Commit the pages to a tree of their own (the working copy's index is untouched) and push it to the hidden ref. */
function share(root, head, pages) {
  const scratch = mkdtempSync(join(tmpdir(), "draft-view-"));
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(scratch, "index"),
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Britesite",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "draft-view@britesite.invalid",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Britesite",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "draft-view@britesite.invalid",
  };
  try {
    const manifest = { version: 1, head, pages: pages.map((page, index) => ({ path: page.path, file: `pages/${index}.html` })) };
    const files = [["draft-view.json", JSON.stringify(manifest, null, 2) + "\n"], ...pages.map((page, index) => [`pages/${index}.html`, page.html])];
    for (const [path, content] of files) {
      const blob = git(root, ["hash-object", "-w", "--stdin"], { input: content, env });
      git(root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    }
    const tree = git(root, ["write-tree"], { env });
    const commit = git(root, ["commit-tree", tree, "-m", `Draft view of ${head}`], { env });
    // The ref holds only the newest view; each one replaces the last, so the
    // push is forced. It is not a branch: nothing builds or publishes from it.
    git(root, ["push", "--quiet", "--no-verify", "--force", "origin", `${commit}:${DRAFT_REF}`], { env, timeout: 90_000 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(argv) {
  const root = resolve(".");
  const args = argv.slice(2);
  const noPush = args.includes("--no-push");
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  const raw = args.filter((arg, index) => !arg.startsWith("--") && !(outIndex >= 0 && index === outIndex + 1));
  const paths = [...new Set(raw.map(normalisePath))];
  if (paths.length === 0 || paths.includes(null)) {
    console.error("draft-view: give one to four page addresses, such as / or /menu");
    return 1;
  }
  if (paths.length > MAX_PAGES) {
    console.error(`draft-view: at most ${MAX_PAGES} pages`);
    return 1;
  }
  if (!existsSync(join(root, "package.json")) || !JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies?.next) {
    console.error("draft-view: run it from the top of a Next.js site");
    return 1;
  }

  let head = null;
  if (!noPush) {
    // The view is for the saved draft exactly: the app shows it only while
    // that commit is the preview being built, so it must be pushed first and
    // nothing may be left unsaved.
    try {
      git(root, ["fetch", "--quiet", "origin", "+refs/heads/preview:refs/remotes/origin/preview"], { timeout: 60_000 });
      head = git(root, ["rev-parse", "HEAD"]);
      const remote = git(root, ["rev-parse", "refs/remotes/origin/preview"]);
      if (head !== remote) {
        console.error("draft-view: the change is not pushed yet (preview on the remote is another commit); push it first");
        return 1;
      }
      if (git(root, ["status", "--porcelain", "--untracked-files=no"])) {
        console.error("draft-view: there are unsaved changes; the view must show exactly what was pushed");
        return 1;
      }
    } catch (error) {
      console.error(`draft-view: could not read the saved draft: ${error.message}`);
      return 1;
    }
  }

  let pages;
  try {
    pages = await renderPages(root, paths);
  } catch (error) {
    console.error(`draft-view: ${error.message}`);
    return 1;
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    pages.forEach((page, index) => writeFileSync(join(out, `${index}.html`), page.html));
  }
  if (noPush) {
    console.log(`draft-view: drew ${pages.map((p) => p.path).join(", ")}${out ? ` into ${out}` : ""}`);
    return 0;
  }
  try {
    share(root, head, pages);
  } catch (error) {
    console.error(`draft-view: drew the pages but could not share them: ${String(error.stderr || error.message).slice(0, 500)}`);
    return 1;
  }
  console.log(`draft-view: shared ${pages.map((p) => p.path).join(", ")}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code), (error) => {
    console.error(`draft-view: ${error?.message ?? error}`);
    process.exit(1);
  });
}
