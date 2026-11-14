import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { carriesProvenanceMark, listImages, needsWork, optimizeImages } from "./optimize-images.mjs";

let sharp = null;
try {
  sharp = createRequire(import.meta.url)("sharp");
} catch {
  /* sharp comes with Next.js; without node_modules the file tests skip */
}
const skip = !sharp && "sharp is not installed (run npm ci)";

/** A photograph-like image: soft noise, the same bytes on every run. Fine
 *  per-pixel noise would not do, since no encoder can shrink it the way it
 *  shrinks a photograph. */
async function photo(width, height, format) {
  const w = Math.ceil(width / 16);
  const h = Math.ceil(height / 16);
  const raw = Buffer.alloc(w * h * 3);
  let state = 0x2545f491;
  for (let i = 0; i < raw.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    raw[i] = state >>> 24;
  }
  const image = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(width, height, { fit: "fill", kernel: "cubic" });
  // No quality for PNG: sharp reads it as a request for a reduced palette.
  return (format === "png" ? image.png({ compressionLevel: 0 }) : image[format]({ quality: 98 })).toBuffer();
}

function site(files) {
  const root = mkdtempSync(join(tmpdir(), "optimg-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test("needsWork: a long edge over the limit or a file over the budget, and nothing else", () => {
  const limits = { maxEdge: 2400, budgetKb: 1000 };
  assert.equal(needsWork({ width: 2400, height: 1600, bytes: 500_000 }, limits), false);
  assert.equal(needsWork({ width: 2401, height: 1600, bytes: 500_000 }, limits), true);
  assert.equal(needsWork({ width: 1600, height: 4000, bytes: 500_000 }, limits), true, "the long edge may be the height");
  assert.equal(needsWork({ width: 1200, height: 800, bytes: 1024 * 1000 + 1 }, limits), true);
});

test("listImages finds rasters in public/, in any letter case, and skips mirrors, old-site screenshots and other files", () => {
  const root = site({
    "public/images/hero/a.jpg": "x",
    "public/images/team/B.PNG": "x",
    "public/images/brand/logo.svg": "x",
    "public/videos/hero.mp4": "x",
    "public/_mirror/origin/big.jpg": "x",
    "public/images/old-site-screenshots/home.png": "x",
    "src/photo.jpg": "x",
  });
  try {
    assert.deepEqual(
      listImages(root).map((f) => f.slice(root.length + 1)),
      ["public/images/hero/a.jpg", "public/images/team/B.PNG"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dry run reports the saving and changes no file", { skip }, async () => {
  const big = await photo(3600, 2400, "jpeg");
  const root = site({ "public/images/hero/big.jpg": big });
  try {
    const [row] = await optimizeImages(root, { sharp });
    assert.equal(row.action, "would shrink");
    assert.ok(row.after < row.before);
    assert.equal(statSync(join(root, "public/images/hero/big.jpg")).size, big.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--write resizes to the long-edge limit, keeps the format and aspect ratio, and leaves a small image alone", { skip }, async () => {
  const small = await photo(800, 600, "jpeg");
  const root = site({
    "public/images/hero/big.jpg": await photo(3600, 2400, "jpeg"),
    "public/images/hero/tall.png": await photo(1000, 3000, "png"),
    "public/images/hero/small.jpg": small,
  });
  try {
    const rows = await optimizeImages(root, { write: true, sharp });
    const by = Object.fromEntries(rows.map((r) => [r.file.slice(root.length + 1), r]));
    assert.equal(by["public/images/hero/big.jpg"].action, "shrunk");
    assert.equal(by["public/images/hero/tall.png"].action, "shrunk");
    assert.equal(by["public/images/hero/small.jpg"].action, "ok");

    const big = await sharp(readFileSync(join(root, "public/images/hero/big.jpg"))).metadata();
    assert.deepEqual([big.format, big.width, big.height], ["jpeg", 2400, 1600]);
    const tall = await sharp(readFileSync(join(root, "public/images/hero/tall.png"))).metadata();
    assert.deepEqual([tall.format, tall.width, tall.height], ["png", 800, 2400]);
    assert.deepEqual(readFileSync(join(root, "public/images/hero/small.jpg")), small, "untouched byte for byte");

    // A second run finds nothing left to do.
    const again = await optimizeImages(root, { write: true, sharp });
    assert.deepEqual(again.filter((r) => r.action === "shrunk").map((r) => r.file), [], "no file is compressed twice");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an image that is still over the budget after optimizing is reported as over", { skip }, async () => {
  const root = site({ "public/images/hero/noise.png": await photo(2000, 1400, "png") });
  try {
    const [row] = await optimizeImages(root, { write: true, sharp, budgetKb: 100 });
    assert.equal(row.over, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a camera's sideways photo is turned upright and measured by what the visitor sees", { skip }, async () => {
  const sideways = await sharp(await photo(3000, 2000, "jpeg")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const root = site({ "public/images/team/portrait.jpg": sideways });
  try {
    const [row] = await optimizeImages(root, { write: true, sharp });
    assert.deepEqual([row.width, row.height], [2000, 3000]);
    const out = await sharp(readFileSync(join(root, "public/images/team/portrait.jpg"))).metadata();
    assert.deepEqual([out.width, out.height, out.orientation ?? 1], [1600, 2400, 1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A generated picture carries a C2PA manifest, and the site shows no "made with
// AI" caption because the file says it. sharp does not carry the manifest
// across a re-encode, so this command would have silently unmarked every
// generated image over the limits.
test("an image that carries an AI provenance mark is left byte for byte and reported", { skip }, async () => {
  const marked = Buffer.concat([await photo(3600, 2400, "jpeg"), Buffer.from("\x00jumb\x00c2pa\x00manifest")]);
  assert.equal(carriesProvenanceMark(marked), true);
  assert.equal(carriesProvenanceMark(await photo(40, 40, "jpeg")), false);
  const root = site({ "public/images/hero/generated.jpg": marked, "public/images/hero/camera.jpg": await photo(3600, 2400, "jpeg") });
  try {
    const rows = await optimizeImages(root, { write: true, sharp, budgetKb: 100 });
    const by = Object.fromEntries(rows.map((r) => [r.file.slice(root.length + 1), r]));
    assert.equal(by["public/images/hero/generated.jpg"].action, "kept (AI mark)");
    assert.equal(by["public/images/hero/generated.jpg"].over, true, "still over the budget, and says so");
    assert.deepEqual(readFileSync(join(root, "public/images/hero/generated.jpg")), marked);
    assert.equal(by["public/images/hero/camera.jpg"].action, "shrunk", "the unmarked photograph beside it is still shrunk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an animated image is left alone: sharp would keep its first frame only", { skip }, async () => {
  const frame = (r) => sharp({ create: { width: 2600, height: 200, channels: 3, background: { r, g: 40, b: 40 } } }).png().toBuffer();
  const animated = await sharp([await frame(10), await frame(200)], { join: { animated: true } }).webp().toBuffer();
  const root = site({ "public/images/hero/loop.webp": animated });
  try {
    const [row] = await optimizeImages(root, { write: true, sharp });
    assert.equal(row.action, "kept (animated)");
    assert.deepEqual(readFileSync(join(root, "public/images/hero/loop.webp")), animated);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The photo skill hands the editing agent this command for ONE new file. Run
// bare it goes through the whole site, logos included.
test("with file arguments only those images are looked at; a path it does not handle is refused", { skip }, async () => {
  const other = await photo(3600, 2400, "jpeg");
  const root = site({
    "public/images/hero/new.jpg": await photo(3600, 2400, "jpeg"),
    "public/images/brand/logo.jpg": other,
    "package.json": "{}",
  });
  const script = fileURLToPath(new URL("./optimize-images.mjs", import.meta.url));
  // sharp is resolved from the project the command runs in.
  const env = { ...process.env, NODE_PATH: join(dirname(script), "..", "node_modules") };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env });
  try {
    const one = run("--write", "--max-edge", "2000", "public/images/hero/new.jpg");
    assert.equal(one.status, 0, one.stderr + one.stdout);
    assert.match(one.stdout, /1 image\(s\) checked/);
    const meta = await sharp(readFileSync(join(root, "public/images/hero/new.jpg"))).metadata();
    assert.equal(meta.width, 2000);
    assert.deepEqual(readFileSync(join(root, "public/images/brand/logo.jpg")), other, "the logo was not named, so it is untouched");

    const stray = run("--write", "package.json");
    assert.equal(stray.status, 2);
    assert.match(stray.stderr, /Not an image this command handles/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
