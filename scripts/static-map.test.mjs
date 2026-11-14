import { test } from "node:test";
import assert from "node:assert/strict";
import { lonLatToTile, tilePlan, geocode, ensureLocation, userAgent } from "./static-map.mjs";

test("lonLatToTile matches the slippy-map formula", () => {
  const t = lonLatToTile(0, 0, 1);
  assert.deepEqual(t, { x: 1, y: 1 });
  const cph = lonLatToTile(12.5683, 55.6761, 16);
  assert.equal(Math.floor(cph.x), 35055);
  assert.equal(Math.floor(cph.y), 20512);
});

test("tilePlan covers the frame around the point with a handful of tiles", () => {
  const plan = tilePlan({ lat: 55.6761, lon: 12.5683, zoom: 16, width: 512, height: 320 });
  assert.ok(plan.tiles.length >= 4 && plan.tiles.length <= 9, `${plan.tiles.length} tiles`);
  for (const t of plan.tiles) {
    assert.ok(t.dx > -256 && t.dx < 512 && t.dy > -256 && t.dy < 320);
    assert.match(t.url, /^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/);
  }
  assert.deepEqual(plan.marker, { x: 256, y: 160 });
});

test("geocode asks Nominatim once, with the kit's User-Agent, and reads the first hit", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), ua: init?.headers?.["User-Agent"] });
    return { ok: true, json: async () => [{ lat: "55.6761", lon: "12.5683", display_name: "København" }] };
  };
  const hit = await geocode("Rådhuspladsen 1, København", { fetch: fetchStub });
  assert.deepEqual(hit, { lat: 55.6761, lon: 12.5683, displayName: "København" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?.*q=R%C3%A5dhuspladsen/);
  assert.equal(calls[0].ua, userAgent());
});

test("ensureLocation reuses a saved location for the same address without any request", async () => {
  const saved = { address: "A 1", lat: 1, lon: 2, zoom: 16 };
  const fetchStub = async () => assert.fail("must not fetch");
  assert.deepEqual(await ensureLocation({ address: "A 1", zoom: 16, saved, fetch: fetchStub }), saved);
});

test("ensureLocation geocodes a changed address", async () => {
  const fetchStub = async () => ({ ok: true, json: async () => [{ lat: "3", lon: "4", display_name: "B" }] });
  const loc = await ensureLocation({ address: "B 2", zoom: 15, saved: { address: "A 1", lat: 1, lon: 2, zoom: 16 }, fetch: fetchStub });
  assert.equal(loc.lat, 3);
  assert.equal(loc.zoom, 15);
  assert.equal(loc.address, "B 2");
});

test("the User-Agent names a contact OSM can reach, overridable per operator", () => {
  assert.equal(userAgent({}), "Britesite website builder (info@britesite.dk)");
  assert.doesNotMatch(userAgent({}), /github\.com/);
  assert.equal(userAgent({ STATIC_MAP_USER_AGENT: "Acme site build (ops@acme.dk)" }), "Acme site build (ops@acme.dk)");
});
