#!/usr/bin/env node
// optimize-images — shrink oversized images in public/ in place.
//
// The companion of verify:source check 29, which fails a site that carries an
// image over the budget. This is the fix: every raster image whose long edge is
// over the limit, or whose file is over the budget, is resized to fit the limit
// and re-encoded in its own format, with metadata stripped and the camera's
// rotation baked in. The file keeps its name and its aspect ratio, so no source
// file has to change. A file is only replaced when the result is at least a
// tenth smaller, so running it twice does not compress a photograph twice.
//
// Usage:
//   node scripts/optimize-images.mjs [--write] [--max-edge 2400] [--budget-kb 1000] [file ...]
//
// With files it looks at those images only; without, at every image in public/.
// Without --write it only lists what it would do. Exit 1 when an image is still
// over the budget after optimizing (a photograph saved as PNG: save it as JPEG,
// or as WebP if it needs transparency, and update where it is used), or when
// --write is missing and work remains.
//
// Never touched:
//   - an image that carries a C2PA manifest, the mark that says how a generated
//     picture was made. Re-encoding drops it, and the site shows no "made with
//     AI" caption precisely because the file carries that mark. Such an image
//     is reported and left byte for byte: generate it again at a smaller size.
//   - an animated image (sharp would keep its first frame only).
//   - public/_mirror (a mirrored site's originals stay byte for byte) and
//     public/images/old-site-screenshots (reference captures, not content).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

export const DEFAULT_MAX_EDGE = 2400;
export const DEFAULT_BUDGET_KB = 1000;
/** The result must be under this share of the original to replace it. */
const MIN_SAVING = 0.9;
const RASTER = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const SKIP = ["_mirror", join("images", "old-site-screenshots")];

/** Raster images under `<root>/public`, minus the skipped trees. */
export function listImages(root) {
  const publicDir = join(root, "public");
  const out = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.includes(relative(publicDir, full))) visit(full);
      } else if (RASTER.has(extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  visit(publicDir);
  return out.sort();
}

/** Does this file carry a C2PA manifest? The label is in the bytes whatever
 *  the container: the `C2PA` chunk of a WebP, the JUMBF box in a JPEG's APP11
 *  segment, a PNG's `caBX` chunk. Exported for verify:source check 29. */
export function carriesProvenanceMark(bytes) {
  return /c2pa/i.test(bytes.toString("latin1"));
}

/** Does this image need work? Pure, so the rule is tested without files. */
export function needsWork({ width, height, bytes }, { maxEdge, budgetKb }) {
  return Math.max(width, height) > maxEdge || bytes > budgetKb * 1024;
}

function encode(pipeline, ext) {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return pipeline.jpeg({ quality: 82, mozjpeg: true });
    case ".png":
      return pipeline.png({ compressionLevel: 9 });
    case ".webp":
      return pipeline.webp({ quality: 82 });
    case ".avif":
      return pipeline.avif({ quality: 60 });
    default:
      throw new Error(`unsupported image type: ${ext}`);
  }
}

/**
 * Optimize every image that needs it. Returns one row per image looked at:
 * `{ file, before, after, width, height, action }` where action is "ok" (nothing
 * to do), "would shrink" (dry run), "shrunk", "kept" (the result was not
 * clearly smaller), "kept (AI mark)" or "kept (animated)" (never re-encoded) —
 * and `over: true` when the file is still past the budget. `only` limits the
 * run to those absolute paths.
 */
export async function optimizeImages(root, { write = false, maxEdge = DEFAULT_MAX_EDGE, budgetKb = DEFAULT_BUDGET_KB, sharp, only = null } = {}) {
  const rows = [];
  for (const file of listImages(root)) {
    if (only && !only.includes(file)) continue;
    const input = readFileSync(file);
    const before = input.length;
    const meta = await sharp(input).metadata();
    // EXIF orientations 5 to 8 store the picture on its side.
    const sideways = (meta.orientation ?? 1) >= 5;
    const width = sideways ? meta.height : meta.width;
    const height = sideways ? meta.width : meta.height;
    const row = { file, before, after: before, width, height, action: "ok", over: false };
    if (!needsWork({ width, height, bytes: before }, { maxEdge, budgetKb })) {
      // nothing to do
    } else if (carriesProvenanceMark(input)) {
      row.action = "kept (AI mark)";
    } else if ((meta.pages ?? 1) > 1) {
      row.action = "kept (animated)";
    } else {
      const output = await encode(
        sharp(input).rotate().resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true }),
        extname(file).toLowerCase(),
      ).toBuffer();
      // Only a real saving replaces the file. Re-encoding a JPEG that an
      // earlier run already compressed gains a few percent and loses quality
      // each time; the threshold makes a second run leave it alone.
      if (output.length < before * MIN_SAVING) {
        row.after = output.length;
        row.action = write ? "shrunk" : "would shrink";
        if (write) writeFileSync(file, output);
      } else {
        row.action = "kept";
      }
    }
    row.over = row.after > budgetKb * 1024;
    rows.push(row);
  }
  return rows;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(args[i + 1]);
  };
  const write = args.includes("--write");
  const maxEdge = flag("max-edge", DEFAULT_MAX_EDGE);
  const budgetKb = flag("budget-kb", DEFAULT_BUDGET_KB);
  const root = resolve(".");
  const named = args.filter((a, i) => !a.startsWith("--") && !["--max-edge", "--budget-kb"].includes(args[i - 1])).map((a) => resolve(a));
  const known = listImages(root);
  const stray = named.filter((f) => !known.includes(f));
  if (stray.length) {
    console.error(`Not an image this command handles (a raster image under public/, outside _mirror and old-site-screenshots): ${stray.map((f) => relative(root, f)).join(", ")}`);
    process.exit(2);
  }
  if (!Number.isFinite(maxEdge) || maxEdge < 1 || !Number.isFinite(budgetKb) || budgetKb < 1) {
    console.error("--max-edge and --budget-kb take a positive number");
    process.exit(2);
  }

  let sharp;
  try {
    sharp = createRequire(pathToFileURL(join(root, "package.json")))("sharp");
  } catch {
    console.error("sharp is not installed in this project. It comes with Next.js: run `npm ci` first.");
    process.exit(2);
  }

  const rows = await optimizeImages(root, { write, maxEdge, budgetKb, sharp, only: named.length ? named : null });
  const touched = rows.filter((r) => r.action !== "ok");
  for (const r of touched) {
    const note =
      r.action === "kept (AI mark)"
        ? "  NOT CHANGED: the file carries the mark that says how it was made. Generate it again at a smaller size."
        : r.action === "kept (animated)"
          ? "  NOT CHANGED: an animated image. Shrink it with the tool that made it."
          : r.over
            ? "  STILL OVER BUDGET: a photograph saved as PNG? Save it as JPEG, or as WebP if it needs transparency, and update where it is used."
            : "";
    console.log(`  ${r.action.padEnd(15)} ${relative(root, r.file)}  ${r.width}x${r.height}  ${kb(r.before)} -> ${kb(r.after)}${note}`);
  }
  const saved = rows.reduce((n, r) => n + (r.action === "shrunk" || r.action === "would shrink" ? r.before - r.after : 0), 0);
  const pending = rows.filter((r) => r.action === "would shrink").length;
  const over = rows.filter((r) => r.over && r.action !== "would shrink").length;
  console.log(
    `${rows.length} image(s) checked, ${touched.length} over the limits (${maxEdge} px long edge, ${budgetKb} KB)` +
      (saved ? `, ${kb(saved)} ${write ? "saved" : "to save"}` : ""),
  );
  if (pending) console.log("Dry run. Re-run with --write to change the files.");
  process.exit(pending || over ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
