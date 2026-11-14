#!/usr/bin/env node
// Static map for MapFacade — no API key, no billing, nothing fetched at build or
// runtime.
//
// Geocodes the address ONCE through Nominatim and saves it to
// src/data/location.json (re-runs with the same address reuse it), downloads the
// handful of OpenStreetMap tiles around it, and stitches them in a headless
// Chromium canvas into public/embeds/map@1x.webp and map@2x.webp with a marker and
// the "© OpenStreetMap contributors" notice drawn in. Commit the output: the site
// serves the images as its own files.
//
// OSM's tile and Nominatim policies allow light use with an identifying
// User-Agent: one geocode and a few dozen tiles per site, run by hand, never from
// a build, a test or a page.
//
// Usage: node scripts/static-map.mjs --address "Street 1, 1234 City" [--zoom 16]
//          [--width 512] [--height 320]
// Env: STATIC_MAP_USER_AGENT — the identifying User-Agent (default: the agency's
//      contact address).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Nominatim's policy wants a User-Agent that lets OSM reach whoever runs the
 *  requests. STATIC_MAP_USER_AGENT overrides the agency default. */
export function userAgent(env = process.env) {
  return env.STATIC_MAP_USER_AGENT || "Britesite website builder (info@britesite.dk)";
}
export const ATTRIBUTION = "© OpenStreetMap contributors";
const TILE = 256;

/** Fractional slippy-map tile coordinates of a point. */
export function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** The tiles covering a width×height frame centred on the point, each with its
 *  draw offset in the frame, and where the marker goes. */
export function tilePlan({ lat, lon, zoom, width, height }) {
  const c = lonLatToTile(lon, lat, zoom);
  const left = c.x * TILE - width / 2;
  const top = c.y * TILE - height / 2;
  const tiles = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height - 1) / TILE); ty++) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width - 1) / TILE); tx++) {
      tiles.push({ url: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`, dx: Math.round(tx * TILE - left), dy: Math.round(ty * TILE - top) });
    }
  }
  return { tiles, marker: { x: Math.round(width / 2), y: Math.round(height / 2) } };
}

export async function geocode(address, { fetch: doFetch = fetch } = {}) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
  const res = await doFetch(url, { headers: { "User-Agent": userAgent(), "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`Nominatim found nothing for "${address}" — check the address, or draw the map in code instead`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), displayName: hit.display_name };
}

/** The saved location when it is for this address, otherwise a fresh geocode. */
export async function ensureLocation({ address, zoom, saved, fetch: doFetch }) {
  if (saved && saved.address === address) return { ...saved, zoom: zoom ?? saved.zoom };
  const hit = await geocode(address, { fetch: doFetch });
  return { address, lat: hit.lat, lon: hit.lon, zoom, source: "nominatim", displayName: hit.displayName };
}

async function fetchTile(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent() } });
  if (!res.ok) throw new Error(`tile ${url} answered ${res.status}`);
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function render(page, { plan, width, height, scale }) {
  const tiles = [];
  // Sequential and throttled: the tile policy asks for light, polite use.
  for (const t of plan.tiles) {
    tiles.push({ ...t, data: await fetchTile(t.url) });
    await new Promise((r) => setTimeout(r, 150));
  }
  const dataUrl = await page.evaluate(
    async ({ tiles, marker, width, height, scale, attribution }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      for (const t of tiles) {
        const img = new Image();
        img.src = t.data;
        await img.decode();
        ctx.drawImage(img, t.dx, t.dy);
      }
      ctx.fillStyle = "#c81e1e";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y - 14 * scale, 9 * scale, Math.PI, 0);
      ctx.lineTo(marker.x, marker.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = `${11 * scale}px sans-serif`;
      const w = ctx.measureText(attribution).width + 8 * scale;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(width - w, height - 16 * scale, w, 16 * scale);
      ctx.fillStyle = "#333";
      ctx.fillText(attribution, width - w + 4 * scale, height - 4 * scale);
      return canvas.toDataURL("image/webp", 0.85);
    },
    { tiles, marker: plan.marker, width, height, scale, attribution: ATTRIBUTION },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
  const address = flag("address", null);
  if (!address) {
    console.error('usage: node scripts/static-map.mjs --address "Street 1, 1234 City" [--zoom 16] [--width 512] [--height 320]');
    process.exit(2);
  }
  const zoom = Number(flag("zoom", 16));
  const width = Number(flag("width", 512));
  const height = Number(flag("height", 320));
  const locationPath = join(root, "src", "data", "location.json");
  const saved = existsSync(locationPath) ? JSON.parse(readFileSync(locationPath, "utf8")) : null;
  const location = await ensureLocation({ address, zoom, saved });
  mkdirSync(dirname(locationPath), { recursive: true });
  writeFileSync(locationPath, JSON.stringify({ ...location, width, height }, null, 2) + "\n");

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const outDir = join(root, "public", "embeds");
    mkdirSync(outDir, { recursive: true });
    for (const scale of [1, 2]) {
      // @2x is the next zoom level over the same area, not an upscale.
      const plan = tilePlan({ lat: location.lat, lon: location.lon, zoom: zoom + (scale - 1), width: width * scale, height: height * scale });
      const out = join(outDir, `map@${scale}x.webp`);
      writeFileSync(out, await render(page, { plan, width: width * scale, height: height * scale, scale }));
      console.log(`STATIC_MAP ${out} tiles=${plan.tiles.length}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`STATIC_MAP_DONE lat=${location.lat} lon=${location.lon} — commit public/embeds/ and src/data/location.json; pass image={{ src: "/embeds/map@1x.webp", src2x: "/embeds/map@2x.webp", width: ${width}, height: ${height} }} to MapFacade`);
}
