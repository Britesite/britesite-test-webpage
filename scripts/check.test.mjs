import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  flattenKeys,
  resolveLocales,
  parseMessageFiles,
  compareKeySets,
  hasFragments,
  runChecks,
} from "./check.mjs";

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}
function write(dir, relPath, content) {
  const p = join(dir, relPath);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// ── flattenKeys ──────────────────────────────────────────────────────────────

test("flattenKeys yields dotted leaf paths and treats arrays as leaves", () => {
  const obj = { a: { b: "x", c: ["y", "z"] }, d: "e" };
  const keys = flattenKeys(obj).sort();
  assert.deepEqual(keys, ["a.b", "a.c", "d"]);
});

// ── resolveLocales ───────────────────────────────────────────────────────────

test("resolveLocales reads locales and defaultLocale from routing.ts and falls back to the first locale", () => {
  const src = "export const routing = defineRouting({\n  locales: ['da', 'en'],\n  defaultLocale: 'da'\n});\n";
  assert.deepEqual(resolveLocales(src), { locales: ["da", "en"], defaultLocale: "da" });

  const srcNoDefault = "locales: ['en', 'fr']";
  assert.deepEqual(resolveLocales(srcNoDefault), { locales: ["en", "fr"], defaultLocale: "en" });
});

// ── parseMessageFiles ────────────────────────────────────────────────────────

test("parseMessageFiles names the file and the JSON error for a malformed fragment", () => {
  const files = ["/virtual/good.json", "/virtual/bad.json"];
  const contents = {
    "/virtual/good.json": JSON.stringify({ a: 1 }),
    "/virtual/bad.json": "{ not: valid",
  };
  const { parsed, errors } = parseMessageFiles(files, (f) => contents[f]);
  assert.equal(parsed.size, 1);
  assert.deepEqual(parsed.get("/virtual/good.json"), { a: 1 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, "/virtual/bad.json");
  assert.ok(errors[0].message.length > 0);
});

// ── compareKeySets ───────────────────────────────────────────────────────────

test("compareKeySets reports keys missing from a secondary locale and keys extra relative to the primary", () => {
  const primaryKeys = ["a", "b", "c"];
  const keysByLocale = { en: ["a", "c", "d"] };
  const result = compareKeySets(primaryKeys, keysByLocale);
  assert.equal(result.length, 1);
  assert.equal(result[0].locale, "en");
  assert.deepEqual(result[0].missing, ["b"]);
  assert.deepEqual(result[0].extra, ["d"]);
});

test("compareKeySets is clean when every locale has the same key set", () => {
  const primaryKeys = ["a", "b", "c"];
  const keysByLocale = { en: ["a", "b", "c"] };
  const result = compareKeySets(primaryKeys, keysByLocale);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].missing, []);
  assert.deepEqual(result[0].extra, []);
});

// ── hasFragments ─────────────────────────────────────────────────────────────

test("hasFragments ignores .gitkeep and is true for _base.json alone", () => {
  const dirGitkeepOnly = tmpDir("check-fragments-gitkeep-");
  try {
    write(dirGitkeepOnly, "messages/da/_routes/.gitkeep", "");
    assert.equal(hasFragments(dirGitkeepOnly), false);
  } finally {
    rmSync(dirGitkeepOnly, { recursive: true, force: true });
  }

  const dirBaseOnly = tmpDir("check-fragments-base-");
  try {
    write(dirBaseOnly, "messages/da/_base.json", "{}");
    assert.equal(hasFragments(dirBaseOnly), true);
  } finally {
    rmSync(dirBaseOnly, { recursive: true, force: true });
  }
});

// ── runChecks: messages + parity ─────────────────────────────────────────────

test("runChecks: a malformed fragment fails step messages and parity still runs on the monoliths", () => {
  const dir = tmpDir("check-messages-parity-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en/_routes/bad.json", "{ not valid json");

    const { steps, ok } = runChecks({
      root: dir,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
      skip: new Set(["fragments", "types", "source"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.messages.status, "fail");
    assert.match(byName.messages.lines.join("\n"), /bad\.json/);
    assert.equal(byName.parity.status, "pass");
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runChecks: fragments step ────────────────────────────────────────────────

test("runChecks skips merge --check without fragments and invokes it with _base.json present", () => {
  const dirNoFragments = tmpDir("check-fragments-skip-");
  try {
    write(dirNoFragments, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dirNoFragments, "messages/en.json", JSON.stringify({ a: "1" }));

    const calls = [];
    const { steps } = runChecks({
      root: dirNoFragments,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types", "source"]),
    });
    const fragmentsStep = steps.find((s) => s.name === "fragments");
    assert.equal(fragmentsStep.status, "skip");
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dirNoFragments, { recursive: true, force: true });
  }

  const dirWithBase = tmpDir("check-fragments-run-");
  try {
    write(dirWithBase, "messages/da/_base.json", "{}");
    write(dirWithBase, "messages/da.json", JSON.stringify({ a: "1" }));

    const calls = [];
    const { steps } = runChecks({
      root: dirWithBase,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types", "source"]),
    });
    const fragmentsStep = steps.find((s) => s.name === "fragments");
    assert.equal(fragmentsStep.status, "pass");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "node");
    assert.deepEqual(calls[0].args, ["scripts/merge-fragments.mjs", "--check"]);
  } finally {
    rmSync(dirWithBase, { recursive: true, force: true });
  }
});

// ── runChecks: source step is warn-only ──────────────────────────────────────

test("runChecks never fails on verify-source output (warn-only)", () => {
  const dir = tmpDir("check-source-warn-");
  try {
    write(dir, "scripts/verify-source.mjs", "// stand-in; the spawn is faked");
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));

    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => {
        if (args.some((a) => String(a).includes("verify-source"))) {
          return { status: 1, stdout: "✘ banned marketing phrase in src/app/page.tsx\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.source.status, "warn");
    assert.match(byName.source.lines.join("\n"), /banned marketing phrase/);
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runChecks: types step ────────────────────────────────────────────────────

test("runChecks fails when tsc exits non-zero and passes its diagnostics through", () => {
  const dir = tmpDir("check-types-fail-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    write(dir, "node_modules/.bin/tsc", "");

    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd) => {
        if (cmd.endsWith("tsc")) {
          return { status: 2, stdout: "src/app/page.tsx(3,5): error TS2322: Type mismatch.\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["source"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

    assert.equal(byName.types.status, "fail");
    assert.match(byName.types.lines.join("\n"), /TS2322/);
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test("cli: exits 1 on a fixture with a parity gap and names the missing key (--skip=types,source)", () => {
  const dir = tmpDir("check-cli-parity-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1", b: "2" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));

    let caught;
    try {
      execFileSync(
        process.execPath,
        [new URL("./check.mjs", import.meta.url).pathname, dir, "--skip=types,source"],
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "expected a non-zero exit");
    assert.equal(caught.status, 1);
    assert.match(caught.stdout, /missing in en: b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChecks FAILS (not warns) when verify-source crashes before running a check", () => {
  const dir = tmpDir("check-source-crash-");
  try {
    write(dir, "scripts/verify-source.mjs", "// stand-in; the spawn is faked");
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => {
        if (args && args[0] === "scripts/verify-source.mjs") {
          return { status: 1, stdout: "", stderr: "Error: pipeline-mode: unrecognised value \"replcate\" in .redesign-state/pipeline-mode\n    at readPipelineMode" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      skip: new Set(["types"]),
    });
    const byName = Object.fromEntries(steps.map((s) => [s.name, s]));
    assert.equal(byName.source.status, "fail");
    assert.match(byName.source.lines.join("\n"), /unrecognised value/);
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChecks still only WARNS when verify-source ran and reported findings", () => {
  const dir = tmpDir("check-source-warn-");
  try {
    write(dir, "scripts/verify-source.mjs", "// stand-in; the spawn is faked");
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));
    const { steps, ok } = runChecks({
      root: dir,
      spawn: (cmd, args) => (args && args[0] === "scripts/verify-source.mjs" ? { status: 1, stdout: "  ✘  messages/da.json:3 — banned copy\n", stderr: "" } : { status: 0, stdout: "", stderr: "" }),
      skip: new Set(["types"]),
    });
    assert.equal(steps.find((s) => s.name === "source").status, "warn");
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── seo step ─────────────────────────────────────────────────────────────────

import {
  stripComments,
  readSeoConstants,
  metaEntries,
  judgeMeta,
  imagesWithoutAlt,
  htmlImagesWithoutAlt,
  readBusinessFacts,
  townOf,
  parseMirrorPages,
  seoFindings,
} from "./check.mjs";

const GOOD_DESC = "Café Lærke i Odense C serverer kaffe, hjemmebag og frokost i hverdage og weekender. Se menuen, åbningstiderne og find vej til os her.";

/** A scaffolded one-language redesign site with clean SEO, to break one thing at a time. */
function seoSite({ messages, siteConfig, files = {} } = {}) {
  const dir = tmpDir("check-seo-");
  write(dir, "src/i18n/routing.ts", `export const routing = defineRouting({ locales: ['da'], defaultLocale: 'da' });`);
  write(dir, "src/lib/seo/constants.ts", `export const TITLE_SUFFIX = " | Café Lærke";\nexport const TITLE_MAX_LENGTH = 60;\nexport const DESCRIPTION_MIN_LENGTH = 120;\nexport const DESCRIPTION_MAX_LENGTH = 160;\n`);
  write(dir, "src/lib/seo/routes.ts", `export const STATIC_ROUTES: StaticRoute[] = [\n  { path: "", priority: 1.0, changeFrequency: "monthly", metaKey: "home" },\n  { path: "/menu", priority: 0.9, changeFrequency: "monthly", metaKey: "menu" },\n  { path: "/privatliv", priority: 0.2, changeFrequency: "yearly", metaKey: "privacy", noindex: true },\n];\n`);
  write(dir, "src/app/[locale]/layout.tsx", `export default function L({ children }) { return <html lang={locale}><body>{children}</body></html>; }`);
  write(dir, "src/app/icon.svg", "<svg/>");
  write(dir, "src/lib/seo/structured-data.ts", `export async function organizationSchema(locale) { return { ...businessFacts(SITE_BUSINESS) }; }`);
  write(dir, "src/lib/site-config.ts", siteConfig ?? `// e.g. streetAddress: "Example 1", openingHours: [{ opens: "nine" }]\nexport const SITE_BUSINESS: SiteBusiness | null = {\n  name: "Café Lærke",\n  streetAddress: "Vestergade 12",\n  postalCode: "5000",\n  addressLocality: "Odense C",\n  addressCountry: "DK",\n  telephone: ["+4512345678"],\n  openingHours: [{ days: ["Monday"], opens: "08:00", closes: "17:00" }],\n};\n`);
  write(dir, "messages/da.json", JSON.stringify(messages ?? {
    meta: {
      home: { title: "Café Lærke | Kaffe og kage i Odense C", description: GOOD_DESC },
      menu: { title: "Menu: kaffe, kage og frokost", description: `${GOOD_DESC.slice(0, 100)} Se hele menuen med priser her.` },
      privacy: { title: "Privatlivspolitik", description: "Kort." },
    },
    kontakt: { hours: "Åbningstider" },
  }));
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

function seoStep(dir) {
  const { steps } = runChecks({ root: dir, spawn: () => ({ status: 0, stdout: "", stderr: "" }), skip: new Set(["types", "source", "fragments"]) });
  return steps.find((s) => s.name === "seo");
}

test("seo: a clean site passes, and a noindex page's short description is not judged", () => {
  const dir = seoSite();
  try {
    const step = seoStep(dir);
    assert.equal(step.status, "pass", step.lines.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: a registered page with no title or description of its own fails, naming the key and language", () => {
  const dir = seoSite({ messages: { meta: { home: { title: "Café Lærke | Kaffe i Odense C", description: GOOD_DESC } } } });
  try {
    const step = seoStep(dir);
    assert.equal(step.status, "fail");
    assert.match(step.lines.join("\n"), /page \/menu \(da\): no meta\.menu in messages\/da\.json/);
    assert.doesNotMatch(step.lines.join("\n"), /privatliv/, "a noindex route is not required to have meta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: length, duplicate and [NEEDS:] findings are warnings, a scaffold placeholder fails", () => {
  const dir = seoSite({
    messages: {
      meta: {
        home: { title: "Café Lærke | Kaffe i Odense C", description: GOOD_DESC },
        menu: { title: "En meget lang titel om alt det vi serverer hver eneste dag", description: GOOD_DESC },
        events: { title: "[NEEDS: titel]", description: "[NEEDS: beskrivelse]" },
        jobs: { title: "Job hos {{COMPANY_NAME}}", description: "For kort." },
      },
    },
  });
  try {
    const step = seoStep(dir);
    const out = step.lines.join("\n");
    assert.equal(step.status, "fail");
    assert.match(out, /✘ meta\.jobs \(da\): the title still holds a scaffold placeholder \(\{\{COMPANY_NAME\}\}\)/);
    assert.match(out, /⚠ meta\.menu \(da\): title is 71 characters as Google shows it/, "the suffix is counted");
    assert.match(out, /⚠ meta\.menu \(da\): same description as meta\.home \(da\)/);
    assert.match(out, /⚠ meta\.events \(da\): the title and description are \[NEEDS:\] markers/);
    assert.match(out, /⚠ meta\.jobs \(da\): description is 9 characters; aim for 120–160/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: a picture with no alt attribute fails; alt=\"\" and spread props pass", () => {
  const dir = seoSite({
    files: {
      "src/components/Hero.tsx": `export function Hero(p) {\n  return (<>\n    <Image src="/a.jpg" width={10} height={10} alt={t("hero.alt")} />\n    <img src="/divider.svg" alt="" />\n    <Image {...p.image} />\n    {/* <img src="/old.jpg" /> */}\n    <img\n      src={cond ? "/x.jpg" : "/y.jpg"}\n      className="w-full"\n    />\n  </>);\n}\n`,
    },
  });
  try {
    const step = seoStep(dir);
    assert.equal(step.status, "fail");
    const out = step.lines.join("\n");
    assert.match(out, /src\/components\/Hero\.tsx:7: <img> has no alt text/);
    assert.equal(step.lines.filter((l) => l.includes("no alt text")).length, 1, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: missing business facts, opening hours and the town are warnings; a malformed hour fails", () => {
  const empty = seoSite({ siteConfig: `export const SITE_BUSINESS: SiteBusiness | null = null;\n` });
  const noHours = seoSite({
    siteConfig: `export const SITE_BUSINESS = { name: "Café Lærke", streetAddress: "Vestergade 12", postalCode: "5000", addressLocality: "Svendborg", addressCountry: "DK", telephone: ["+4512345678"] };`,
  });
  const badHours = seoSite({
    siteConfig: `export const SITE_BUSINESS = { name: "Café Lærke", streetAddress: "V 1", postalCode: "5000", addressLocality: "Odense C", addressCountry: "DK", telephone: ["+45"], openingHours: [{ days: ["Monday"], opens: "8", closes: "17:00" }] };`,
  });
  try {
    assert.match(seoStep(empty).lines.join("\n"), /⚠ SITE_BUSINESS in src\/lib\/site-config\.ts is empty/);
    assert.equal(seoStep(empty).status, "warn");
    const out = seoStep(noHours).lines.join("\n");
    assert.match(out, /the site shows opening hours but its structured data has none/);
    assert.match(out, /homepage title and description do not mention Svendborg/);
    const bad = seoStep(badHours);
    assert.equal(bad.status, "fail");
    assert.match(bad.lines.join("\n"), /✘ SITE_BUSINESS\.openingHours: opens "8" is not a 24-hour HH:MM time/);
  } finally {
    for (const d of [empty, noHours, badHours]) rmSync(d, { recursive: true, force: true });
  }
});

test("seo: a site built before SITE_BUSINESS, with facts typed into structured-data.ts, counts as known", () => {
  const dir = seoSite({
    siteConfig: `export const SITE_BUSINESS: MirrorBusiness | null = null;\n`,
    files: {
      "src/lib/seo/structured-data.ts": `export async function organizationSchema() {\n  return {\n    name: "Café Lærke",\n    address: { "@type": "PostalAddress", streetAddress: "Vestergade 12", addressLocality: "Odense C" },\n    telephone: "+4512345678",\n    openingHours: "Mo-Fr 08:00-17:00",\n  };\n}\n`,
    },
  });
  try {
    assert.equal(seoStep(dir).status, "pass", seoStep(dir).lines.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: a mirrored site is judged from its HTML head, and a head that disagrees with MIRROR_PAGES warns", () => {
  const pages = [
    { path: "/", locale: "da", alternates: { da: "/" }, title: "Café Lærke | Kaffe i Odense C", description: GOOD_DESC, file: "src/mirror/pages/index.html" },
    { path: "/menu", locale: "da", alternates: { da: "/menu" }, title: "Menu", description: GOOD_DESC, file: "src/mirror/pages/menu/index.html" },
  ];
  const dir = seoSite({
    files: {
      "src/mirror/index.ts": `import type { MirrorPage } from "@/lib/mirror/head";\n\nexport const MIRROR_PAGES: MirrorPage[] = ${JSON.stringify(pages, null, 2)};\n`,
      "src/mirror/pages/index.html": `<html><head><title>Café Lærke | Kaffe i Odense C</title><meta name="description" content="${GOOD_DESC}"></head><body><img src="a.jpg"><img src="b.jpg" alt=""></body></html>`,
      "src/mirror/pages/menu/index.html": `<html><head><title>Vores menu</title></head><body>Åbningstider</body></html>`,
    },
  });
  try {
    const step = seoStep(dir);
    const out = step.lines.join("\n");
    assert.equal(step.status, "warn", out);
    assert.match(out, /page \/: 1 picture\(s\) with no alt text/);
    assert.match(out, /page \/menu: no meta description in its HTML/);
    assert.match(out, /page \/menu: the <title> in its HTML \("Vores menu"\) differs from its MIRROR_PAGES title \("Menu"\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo: the unscaffolded kit template is skipped, not judged", () => {
  const dir = seoSite({ files: { "src/lib/seo/constants.ts": `export const TITLE_SUFFIX = " | {{COMPANY_NAME}}";` } });
  try {
    const step = seoStep(dir);
    assert.equal(step.status, "skip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seo helpers: comments, constants, meta entries, mirror parsing and the town", () => {
  assert.equal(stripComments(`a // x\nb = "https://x" /* y */ c`).replace(/\s+/g, " ").trim(), `a b = "https://x" c`);
  assert.deepEqual(readSeoConstants('const NAME = "Lærke";\nexport const TITLE_SUFFIX = ` | ${NAME}`;\nexport const TITLE_MAX_LENGTH = 65;'), { titleMax: 65, descMin: 120, descMax: 160, suffix: " | Lærke" });
  assert.deepEqual(metaEntries({ meta: { home: { title: "A", description: "B" }, services: { title: "S", welding: { title: "W" } } } }).map((e) => e.key), ["home", "services", "services.welding"]);
  assert.deepEqual(imagesWithoutAlt(`import Image from "next/image";\n<Image src={a > b ? x : y} />`).length, 1);
  assert.equal(htmlImagesWithoutAlt(`<img src=a alt="x"><IMG SRC=b>`), 1);
  assert.equal(townOf("Odense C"), "odense");
  assert.equal(townOf("København NV"), "københavn");
  assert.equal(townOf("2100 København Ø".replace(/^\d+\s/, "")), "københavn");
  assert.equal(townOf("Agedrup"), "agedrup");
  const hand = parseMirrorPages(`export const MIRROR_PAGES: MirrorPage[] = [\n  { path: "/", locale: "da", alternates: { da: "/" }, title: "Hjem", description: "D", file: "x" },\n];`);
  assert.deepEqual(hand.map((p) => [p.path, p.title]), [["/", "Hjem"]]);
  const facts = readBusinessFacts({ siteConfig: `// SITE_BUSINESS = { streetAddress: "commented" }\nexport const SITE_BUSINESS = null;`, structuredData: "" });
  assert.equal(facts.known, false, "a commented-out example is not a fact");
  void judgeMeta;
  void seoFindings;
});

test("seo review fixes: apostrophes in a mirrored description, hours words, non-picture Image, markup in strings", () => {
  const pages = [{ path: "/en", locale: "en", alternates: { en: "/en" }, title: "Zinc", description: "Denmark's largest dedicated zinc die-casting foundry, with tooling, machining and surface treatment under one roof in Kolding.", file: "x" }];
  const dir = seoSite({
    files: {
      "src/mirror/index.ts": `export const MIRROR_PAGES: MirrorPage[] = ${JSON.stringify(pages)};`,
      "src/mirror/pages/en/index.html": `<html><head><title>Zinc</title><meta content="${pages[0].description}" name="description"></head><body>48 hours' notice. Lovely hours.</body></html>`,
    },
    siteConfig: `export const SITE_BUSINESS = { name: "Café Lærke", streetAddress: "V 1", postalCode: "5000", addressLocality: "Odense C", addressCountry: "DK", telephone: ["+45"] };`,
  });
  try {
    const out = seoStep(dir).lines.join("\n");
    assert.doesNotMatch(out, /description is \d+ characters/, out);
    assert.doesNotMatch(out, /differs from its MIRROR_PAGES description/, out);
    assert.doesNotMatch(out, /shows opening hours/, "\"hours' notice\" is not opening hours");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(imagesWithoutAlt(`import { Image } from "lucide-react";\n<Image className="h-4 w-4" />`).length, 0, "an icon called Image is not a picture");
  assert.equal(imagesWithoutAlt(`import Picture from "next/image";\n<Picture src="/a.jpg" width={1} height={1} />`).length, 1, "next/image under another name is judged");
  assert.equal(imagesWithoutAlt("const html = `<p>x</p><img src=\"/a.png\">`;\nconst s = \"<img src=x>\";").length, 0, "markup in a string is not a tag");
});

test("check: the source step is skipped, not failed, on a site with no verify-source.mjs", () => {
  const dir = tmpDir("check-no-verify-source-");
  try {
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    const { steps, ok } = runChecks({ root: dir, spawn: () => ({ status: 1, stdout: "", stderr: "Cannot find module" }), skip: new Set(["types"]) });
    const source = steps.find((s) => s.name === "source");
    assert.equal(source.status, "skip");
    assert.match(source.lines[0], /no scripts\/verify-source\.mjs/);
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
