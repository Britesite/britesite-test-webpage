import { test } from "node:test";
import assert from "node:assert/strict";
import { isIndexableHost } from "./indexable-host.ts";

// A rebuild usually goes live on a Vercel host while the real domain still
// serves the old site; its canonicals already name the real domain, so an
// indexable temporary host files pages under a canonical that resolves to
// someone else's content. Keyed on the request host, not an env flag, so
// indexing switches on by itself the moment DNS moves.
test("only the configured site host is indexable", () => {
  assert.equal(isIndexableHost("www.example.dk", "www.example.dk"), true);
  assert.equal(isIndexableHost("WWW.Example.dk", "www.example.dk"), true);
  assert.equal(isIndexableHost("example-git-preview-team.vercel.app", "www.example.dk"), false);
  assert.equal(isIndexableHost("example.vercel.app", "www.example.dk"), false);
  assert.equal(isIndexableHost(null, "www.example.dk"), false);
});

test("port is part of the host, so a spare-port verify server is a different host", () => {
  assert.equal(isIndexableHost("localhost:3000", "localhost:3000"), true);
  assert.equal(isIndexableHost("localhost:3100", "localhost:3000"), false);
});

// With no domain set, a site resolves to its Vercel production URL. That is
// where a signed client's bare scaffold first goes live, and where a /replicate
// mirror duplicates the client's own live site — neither belongs in an index.
// Attaching the real domain to the Vercel project moves SITE_DOMAIN to it on the
// next deploy, so indexing still needs nothing flipped by hand.
test("a Vercel host is never indexable, even when the site resolved to it", () => {
  assert.equal(isIndexableHost("cnc-team-webpage.vercel.app", "cnc-team-webpage.vercel.app"), false);
  assert.equal(isIndexableHost("CNC-Team-Webpage.Vercel.App", "cnc-team-webpage.vercel.app"), false);
  assert.equal(isIndexableHost("cnc-team-webpage-abc123-britesite.vercel.app", "cnc-team-webpage.vercel.app"), false);
});
