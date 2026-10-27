import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  routeFromPageFile,
  extractNamespaces,
  extractMetaKey,
  extractSchemaBuilders,
  parseStaticRoutes,
  findLinkArrays,
  findContactDetails,
  groupContactDetails,
  markerKeyPaths,
  parseCsp,
  renderGuide,
  parseMirrorIndex,
} from "./site-guide.mjs";

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}
function write(dir, relPath, content) {
  const p = join(dir, relPath);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// ── routeFromPageFile ─────────────────────────────────────────────────────────

test("routeFromPageFile maps [locale]/services/cnc-milling/page.tsx to /services/cnc-milling, strips route groups and flags [...rest]", () => {
  assert.deepEqual(routeFromPageFile("src/app/[locale]/services/cnc-milling/page.tsx"), {
    url: "/services/cnc-milling",
    catchAll: false,
  });
  assert.deepEqual(routeFromPageFile("src/app/[locale]/page.tsx"), { url: "/", catchAll: false });
  assert.deepEqual(routeFromPageFile("src/app/[locale]/(marketing)/about/page.tsx"), {
    url: "/about",
    catchAll: false,
  });
  assert.deepEqual(routeFromPageFile("src/app/[locale]/[...rest]/page.tsx"), {
    url: "/*",
    catchAll: true,
  });
});

// ── extractNamespaces ─────────────────────────────────────────────────────────

test("extractNamespaces reads useTranslations(\"x\") and getTranslations({ locale, namespace: \"x\" }) and de-duplicates", () => {
  const src = `
    const t = useTranslations("header");
    const t2 = useTranslations('header');
    async function generateMetadata() {
      const tMeta = await getTranslations({
        locale,
        namespace: "meta",
      });
    }
  `;
  assert.deepEqual(extractNamespaces(src), ["header", "meta"]);
});

// ── extractMetaKey / extractSchemaBuilders ────────────────────────────────────

test("extractMetaKey and extractSchemaBuilders read the buildMetadata call and the structured-data imports", () => {
  const src = `
    import { serviceSchema } from "@/lib/seo/structured-data";
    import { breadcrumbSchema } from "@/lib/seo/breadcrumb-schema";
    import { buildMetadata } from "@/lib/seo/metadata";

    export async function generateMetadata({ params }) {
      const { locale } = await params;
      return buildMetadata({ locale, path: PATH, metaKey: "service.cncMilling" });
    }
  `;
  assert.equal(extractMetaKey(src), "service.cncMilling");
  assert.deepEqual(extractSchemaBuilders(src), ["breadcrumbSchema", "serviceSchema"]);
  assert.equal(extractMetaKey("no buildMetadata call here"), null);
});

// ── parseStaticRoutes ─────────────────────────────────────────────────────────

test("parseStaticRoutes returns path, metaKey and noindex in either quote style", () => {
  const src = `
    export const STATIC_ROUTES = [
      { path: "", priority: 1.0, changeFrequency: "monthly", metaKey: "home" },
      { path: '/terms', priority: 0.3, changeFrequency: 'yearly', metaKey: 'terms', noindex: true },
      { path: "/services/cnc-milling", priority: 0.8, changeFrequency: "monthly", metaKey: "service.cncMilling" },
    ];
  `;
  const routes = parseStaticRoutes(src);
  assert.equal(routes.length, 3);
  assert.deepEqual(routes[0], { path: "", metaKey: "home", noindex: false });
  assert.deepEqual(routes[1], { path: "/terms", metaKey: "terms", noindex: true });
  assert.deepEqual(routes[2], { path: "/services/cnc-milling", metaKey: "service.cncMilling", noindex: false });
});

// ── findLinkArrays ───────────────────────────────────────────────────────────

test("findLinkArrays reports start/end lines for a top-level const and an in-function const items: NavItem[] = [", () => {
  const src = [
    /* 1 */ "const SERVICE_LINKS = [",
    /* 2 */ '  { href: "/services", key: "hub" },',
    /* 3 */ '  { href: "/services/cnc-milling", key: "cncMilling" },',
    /* 4 */ "] as const;",
    /* 5 */ "",
    /* 6 */ "export async function Header() {",
    /* 7 */ "  const items: NavItem[] = [",
    /* 8 */ "    {",
    /* 9 */ '      href: "/services",',
    /* 10 */ "      panel: {",
    /* 11 */ "        items: [",
    /* 12 */ '          { href: "/services/cnc-turning", label: "x" },',
    /* 13 */ "        ],",
    /* 14 */ "      },",
    /* 15 */ "    },",
    /* 16 */ '    { href: "/gallery" },',
    /* 17 */ "  ];",
    /* 18 */ "  return null;",
    /* 19 */ "}",
  ].join("\n");

  const arrays = findLinkArrays(src);
  assert.equal(arrays.length, 2);

  const service = arrays.find((a) => a.name === "SERVICE_LINKS");
  assert.equal(service.start, 1);
  assert.equal(service.end, 4);
  assert.deepEqual(service.hrefs, ["/services", "/services/cnc-milling"]);

  const items = arrays.find((a) => a.name === "items");
  assert.equal(items.start, 7);
  assert.equal(items.end, 17);
  assert.deepEqual(items.hrefs, ["/services", "/services/cnc-turning", "/gallery"]);
});

// ── findContactDetails / groupContactDetails ──────────────────────────────────

test("findContactDetails groups emails, phones and CVR by value across TSX and JSON", () => {
  const tsxText = [
    'const MAILTO_GENERAL = "mailto:kontakt@example.dk";',
    'const TEL_HREF = "tel:+4576260605";',
  ].join("\n");
  const jsonText = ['{', '  "value": "kontakt@example.dk",', '  "phone": "+45 76 26 06 05",', '  "cvr": "CVR: 12345678"', '}'].join(
    "\n",
  );

  const matches = [
    ...findContactDetails(tsxText, "src/components/Footer.tsx"),
    ...findContactDetails(jsonText, "messages/da.json"),
  ];
  const grouped = groupContactDetails(matches);

  const email = grouped.find((g) => g.kind === "email");
  assert.equal(email.value, "kontakt@example.dk");
  assert.deepEqual(email.locations.sort(), ["messages/da.json:2", "src/components/Footer.tsx:1"].sort());

  const phone = grouped.find((g) => g.kind === "phone");
  assert.equal(phone.value, "+4576260605");
  assert.ok(phone.locations.includes("src/components/Footer.tsx:2"));
  assert.ok(phone.locations.includes("messages/da.json:3"));

  const cvr = grouped.find((g) => g.kind === "cvr");
  assert.ok(cvr, "expected a cvr match");
  assert.match(cvr.value, /12345678/);
});

// ── markerKeyPaths ────────────────────────────────────────────────────────────

test("markerKeyPaths returns the dotted key of every [NEEDS:] leaf", () => {
  const json = {
    home: {
      hero: { title: "[NEEDS: fill company value prop]", eyebrow: "Real copy" },
    },
    footer: { copyright: "© 2026" },
    contact: { note: "[NEEDS: confirm phone number]" },
  };
  assert.deepEqual(markerKeyPaths(json).sort(), ["contact.note", "home.hero.title"]);
});

// ── parseCsp ─────────────────────────────────────────────────────────────────

test("parseCsp reports script-src hosts and a missing frame-src", () => {
  const src = `
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://vitals.vercel-insights.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];
`;
  const { directives } = parseCsp(src);
  assert.ok(directives["script-src"].includes("https://va.vercel-scripts.com"));
  assert.equal(directives["frame-src"], undefined);
});

// ── renderGuide ───────────────────────────────────────────────────────────────

function minimalModel(overrides = {}) {
  return {
    locales: ["da", "en"],
    defaultLocale: "da",
    pages: [],
    registryDrift: { registryOnly: [], fileOnly: [] },
    navArrays: [],
    routeRegistry: { file: null, count: 0, dynamicRoutesFile: null, dynamicFunctions: [] },
    translations: { hasFragments: false, clientNamespaces: [] },
    contacts: [],
    dataFiles: null,
    images: { dirs: [], hasSlots: false, hasCatalog: false, hasRequests: false },
    markers: { perLocale: {}, keys: {}, sources: [] },
    csp: { directives: {} },
    redirects: { hasRedirectsDoc: false, sourceCount: 0 },
    doNotTouch: [],
    voice: [],
    mirror: { pages: [], assetsDir: null },
    ...overrides,
  };
}

test("renderGuide is deterministic (same model → identical string) and links voice rules to headings rather than copying them", () => {
  const model = minimalModel({
    voice: [{ file: "brand.md", headings: ["Preserve verbatim", "Tone of Voice — Principles"] }],
  });
  const one = renderGuide(model);
  const two = renderGuide(model);
  assert.equal(one, two);
  assert.match(one, /see `brand\.md` → Preserve verbatim/);
  assert.match(one, /see `brand\.md` → Tone of Voice — Principles/);
  // Links to the heading, not a copy of section prose from brand.md.
  assert.doesNotMatch(one, /non-ASCII local part/);
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test("cli: writes SITE_GUIDE.md for a fixture tree; --check exits 1 when stale and 0 when fresh", () => {
  const dir = tmpDir("site-guide-cli-");
  try {
    write(dir, "src/i18n/routing.ts", "locales: ['da', 'en'],\ndefaultLocale: 'da'\n");
    write(dir, "messages/da.json", JSON.stringify({ a: "1" }));
    write(dir, "messages/en.json", JSON.stringify({ a: "1" }));

    const scriptPath = new URL("./site-guide.mjs", import.meta.url).pathname;

    execFileSync(process.execPath, [scriptPath, dir], { encoding: "utf8", stdio: "pipe" });
    const guidePath = join(dir, "SITE_GUIDE.md");
    const written = readFileSync(guidePath, "utf8");
    assert.match(written, /^# Site guide/);

    // Fresh: --check exits 0.
    const freshResult = execFileSync(process.execPath, [scriptPath, dir, "--check"], { encoding: "utf8", stdio: "pipe" });
    assert.ok(freshResult !== undefined);

    // Stale: append a line, --check exits 1.
    writeFileSync(guidePath, written + "\nstale extra line\n");
    let caught;
    try {
      execFileSync(process.execPath, [scriptPath, dir, "--check"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "expected --check to exit non-zero on drift");
    assert.equal(caught.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseMirrorIndex reads path, locale and file from the generated mirror index", () => {
  const src = `export const MIRROR_PAGES: MirrorPage[] = [
  { "path": "/", "locale": "da", "alternates": { "da": "/" }, "title": "Home", "description": "", "file": "src/mirror/pages/index.html" },
  { "path": "/en/about", "locale": "en", "alternates": { "en": "/en/about" }, "title": "About", "description": "", "file": "src/mirror/pages/en/about/index.html", "successPath": null }
];`;
  assert.deepEqual(parseMirrorIndex(src), [
    { path: "/", locale: "da", title: "Home", file: "src/mirror/pages/index.html" },
    { path: "/en/about", locale: "en", title: "About", file: "src/mirror/pages/en/about/index.html" },
  ]);
  assert.deepEqual(parseMirrorIndex("export const MIRROR_PAGES: MirrorPage[] = [];"), []);
});

test("renderGuide documents mirrored pages with their files and the editing rules when the site is a mirror", () => {
  const model = minimalModel({
    mirror: { pages: [{ path: "/om-os", locale: "da", title: "Om os", file: "src/mirror/pages/om-os/index.html" }], assetsDir: "public/_mirror" },
  });
  const out = renderGuide(model);
  assert.match(out, /## Mirrored pages/);
  assert.match(out, /`\/om-os` \| `da` \| Om os \| `src\/mirror\/pages\/om-os\/index.html`/);
  assert.match(out, /public\/_mirror/);
  assert.match(out, /src\/mirror\/index\.ts.*source of truth/);
  assert.match(out, /`path`, `locale`, `alternates`, `title`, `description` and `file`/);
  assert.match(out, /MIRROR_REDIRECTS/);
  assert.match(out, /Do not re-run `scripts\/mirror-install\.mjs` for routine owner edits/);
  assert.doesNotMatch(renderGuide(minimalModel()), /## Mirrored pages/);
});
