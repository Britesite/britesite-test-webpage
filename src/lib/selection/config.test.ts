import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionBridgeConfig } from "./config.ts";

test("selection bridge is enabled only for preview deployments with a canonical HTTPS app origin", () => {
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com",
  }).origin, "https://app.example.com");
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "production",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com/preview",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com?mode=preview",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com#preview",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://user@app.example.com",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "http://app.example.com",
  }).origin, null);
  assert.equal(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://localhost:3000",
  }).origin, null);
});

test("selection frame headers allow only the configured preview app", () => {
  assert.deepEqual(selectionBridgeConfig({
    VERCEL_ENV: "preview",
    WEBSITE_AGENT_ORIGIN: "https://app.example.com",
  }), {
    origin: "https://app.example.com",
    frameAncestors: "frame-ancestors https://app.example.com",
    xFrameOptions: null,
  });
  assert.deepEqual(selectionBridgeConfig({}), {
    origin: null,
    frameAncestors: "frame-ancestors 'none'",
    xFrameOptions: "DENY",
  });
});
