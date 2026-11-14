#!/usr/bin/env node
// site-guide — generates SITE_GUIDE.md from the repo tree itself. The editing
// agent (a managed Claude session with the site cloned at /workspace) has no
// prior knowledge of how a kit-built site is structured — translation
// fragments, the route registry, hand-written nav/footer arrays, where contact
// details are duplicated, open [NEEDS:] markers, the CSP for embeds. This
// script derives all of that from source so the guide can never drift: it is
// never hand-written, only regenerated.
//
// Self-contained — node builtins only, no imports from sibling scripts — so
// update-child-sites.sh can copy this one file into an already-scaffolded site.
//
// Usage:
//   node scripts/site-guide.mjs [root] [--check]
//
// Default: writes <root>/SITE_GUIDE.md. --check: exit 1 if the existing file
// differs from what would be generated, 0 if identical (no write either way).
// Output is deterministic — no timestamps, sorted lists — so a rerun with no
// source changes produces a byte-identical file.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next"]);

function walkFiles(dir, skipDirs = SKIP_DIRS) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p, skipDirs));
    else out.push(p);
  }
  return out;
}

/** Index of the bracket matching the one at `openIndex`, skipping string/template literals. */
function findMatchingBracket(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let inString = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────

/** Locales + default locale from src/i18n/routing.ts source (same regexes as check.mjs). */
export function parseRouting(src) {
  const locales = [...(src.match(/locales:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  const defaultLocale = src.match(/defaultLocale:\s*['"]([^'"]+)['"]/)?.[1] ?? locales[0];
  return { locales, defaultLocale };
}

/** src/app/[locale]/.../page.tsx (relative to repo root) → { url, catchAll }. */
export function routeFromPageFile(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  if (/\[\.\.\..+?\]/.test(norm)) return { url: "/*", catchAll: true };
  let p = norm.replace(/^.*src\/app\/\[locale\]/, "");
  p = p.replace(/\/page\.tsx$/, "");
  const segments = p.split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg));
  return { url: segments.length ? `/${segments.join("/")}` : "/", catchAll: false };
}

/** Sorted, unique i18n namespaces from useTranslations(...) and any `namespace: "..."` option. */
export function extractNamespaces(src) {
  const set = new Set();
  for (const m of src.matchAll(/useTranslations\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) set.add(m[2]);
  for (const m of src.matchAll(/namespace:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) set.add(m[2]);
  return [...set].sort();
}

/** The metaKey passed to a buildMetadata({ ... }) call, or null. */
export function extractMetaKey(src) {
  const m = src.match(/buildMetadata\(\s*\{[\s\S]*?metaKey:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
  return m ? m[2] : null;
}

/** Sorted names imported from @/lib/seo/structured-data or @/lib/seo/breadcrumb-schema. */
export function extractSchemaBuilders(src) {
  const names = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*(["'])@\/lib\/seo\/(?:structured-data|breadcrumb-schema)\2/g;
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** STATIC_ROUTES entries from src/lib/seo/routes.ts source → [{ path, metaKey, noindex }]. */
export function parseStaticRoutes(routesSrc) {
  const arrayMatch = routesSrc.match(/STATIC_ROUTES[^=]*=\s*\[([\s\S]*)\]\s*;/);
  const body = arrayMatch ? arrayMatch[1] : routesSrc;
  const routes = [];
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const entry = m[1];
    const pathMatch = entry.match(/path:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    const metaKeyMatch = entry.match(/metaKey:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/);
    if (!pathMatch || !metaKeyMatch) continue;
    routes.push({
      path: pathMatch[2],
      metaKey: metaKeyMatch[2],
      noindex: /noindex\s*:\s*true/.test(entry),
    });
  }
  return routes;
}

/** Every `const NAME(: Type)? = [ ... ]` (any indentation) whose literal contains href: strings. */
export function findLinkArrays(src) {
  const results = [];
  const constRe = /^[ \t]*const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\[/gm;
  let m;
  while ((m = constRe.exec(src)) !== null) {
    const openIndex = m.index + m[0].length - 1;
    const closeIndex = findMatchingBracket(src, openIndex, "[", "]");
    if (closeIndex === -1) continue;
    const body = src.slice(openIndex, closeIndex + 1);
    if (!/href\s*:/.test(body)) continue;
    const hrefs = [...body.matchAll(/href\s*:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((h) => h[2]);
    results.push({
      name: m[1],
      start: lineOf(src, m.index),
      end: lineOf(src, closeIndex),
      hrefs,
    });
  }
  return results;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_INTL_RE = /\+\d{2,3}[\d\s]{6,14}\d/g;
const PHONE_TEL_RE = /tel:([+\d][\d\s-]*)/g;
const CVR_RE = /CVR[:\s]*\d{8}/gi;

/** Emails, phone numbers and CVR numbers found in one file's text, with line numbers. */
export function findContactDetails(text, file) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    for (const m of line.matchAll(EMAIL_RE)) out.push({ kind: "email", value: m[0], file, line: lineNo });
    for (const m of line.matchAll(PHONE_INTL_RE)) {
      out.push({ kind: "phone", value: m[0].replace(/\s+/g, ""), file, line: lineNo });
    }
    for (const m of line.matchAll(PHONE_TEL_RE)) {
      out.push({ kind: "phone", value: m[1].replace(/\s+/g, ""), file, line: lineNo });
    }
    for (const m of line.matchAll(CVR_RE)) out.push({ kind: "cvr", value: m[0], file, line: lineNo });
  });
  return out;
}

/** Groups findContactDetails() matches by (kind, value), sorted, locations sorted + deduped. */
export function groupContactDetails(matches) {
  const byKey = new Map();
  for (const m of matches) {
    const key = `${m.kind}\u0000${m.value}`;
    if (!byKey.has(key)) byKey.set(key, { kind: m.kind, value: m.value, locations: new Set() });
    byKey.get(key).locations.add(`${m.file}:${m.line}`);
  }
  return [...byKey.values()]
    .map((g) => ({ kind: g.kind, value: g.value, locations: [...g.locations].sort() }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

/** Dotted keys of a messages object whose string value contains an open [NEEDS:] marker. */
export function markerKeyPaths(json, prefix = "") {
  const out = [];
  if (json === null || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [key, value] of Object.entries(json)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      if (value.includes("[NEEDS:")) out.push(path);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...markerKeyPaths(value, path));
    }
  }
  return out;
}

// Duplicated from plugin/scripts/lib/redesign-state.mjs countMarkers — the template
// cannot import the plugin, and this is the source-file half of marker detection
// (the messages/*.json half is markerKeyPaths above).
const MARKER_RE = /\[NEEDS: *[^\]]+\]/;
const EXCLUDED_BASENAMES = new Set(["placeholder.ts", "Placeholder.tsx"]);
const MARKER_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".md"]);

/** { perLocale: {locale: n}, keys: {locale: [...]}, sources: ["file:line", ...] }. */
export function findMarkers(root) {
  const { locales } = detectLocales(root);
  const perLocale = {};
  const keys = {};
  for (const locale of locales) {
    const monolithPath = join(root, "messages", `${locale}.json`);
    let json = {};
    if (existsSync(monolithPath)) {
      try {
        json = JSON.parse(readFileSync(monolithPath, "utf8"));
      } catch {
        json = {};
      }
    }
    const localeKeys = markerKeyPaths(json).sort();
    perLocale[locale] = localeKeys.length;
    keys[locale] = localeKeys;
  }

  // Source files only: pipeline docs (.redesign-state/, CLAUDE.md, the plan)
  // quote the marker syntax without being content, and listing them would
  // send the editing agent into the docs instead of the site.
  const sources = [];
  for (const file of walkFiles(join(root, "src"))) {
    const base = file.split("/").pop();
    if (EXCLUDED_BASENAMES.has(base)) continue;
    if (!MARKER_SOURCE_EXTENSIONS.has(extname(file))) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, file);
    text.split("\n").forEach((line, i) => {
      if (!MARKER_RE.test(line)) return;
      if (/^\s*\/\//.test(line)) return;
      sources.push(`${rel}:${i + 1}`);
    });
  }
  sources.sort();
  return { perLocale, keys, sources };
}

function extractQuoted(text) {
  return [...text.matchAll(/(["'])((?:(?!\1)[\s\S])*)\1/g)].map((m) => m[2]);
}

/** { directives: { "default-src": [...], ... } } from next.config.ts's CSP header value. */
export function parseCsp(nextConfigSrc) {
  const directives = {};
  const arrayMatch = nextConfigSrc.match(
    /key:\s*(["'])Content-Security-Policy\1[\s\S]*?value:\s*\[([\s\S]*?)\]\s*\.join/,
  );
  const stringMatch = nextConfigSrc.match(
    /key:\s*(["'])Content-Security-Policy\1[\s\S]*?value:\s*(["'])((?:(?!\2)[\s\S])*)\2/,
  );
  let directiveStrings = [];
  if (arrayMatch) {
    directiveStrings = extractQuoted(arrayMatch[2]);
  } else if (stringMatch) {
    directiveStrings = stringMatch[3].split(";").map((s) => s.trim()).filter(Boolean);
  }
  for (const entry of directiveStrings) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    directives[name] = rest;
  }
  return { directives };
}

function countRedirectSources(nextConfigSrc) {
  const startMatch = nextConfigSrc.match(/\bredirects\s*\([^)]*\)\s*(?::[^{]+)?\{/);
  if (!startMatch) return 0;
  const braceIndex = startMatch.index + startMatch[0].length - 1;
  const endIndex = findMatchingBracket(nextConfigSrc, braceIndex, "{", "}");
  const body = endIndex === -1 ? nextConfigSrc.slice(braceIndex) : nextConfigSrc.slice(braceIndex, endIndex + 1);
  return (body.match(/\bsource:/g) || []).length;
}

function detectLocales(root) {
  const routingPath = join(root, "src", "i18n", "routing.ts");
  if (existsSync(routingPath)) {
    const { locales, defaultLocale } = parseRouting(readFileSync(routingPath, "utf8"));
    if (locales.length) return { locales, defaultLocale: defaultLocale ?? locales[0] };
  }
  const msgDir = join(root, "messages");
  if (!existsSync(msgDir)) return { locales: [], defaultLocale: undefined };
  const locales = readdirSync(msgDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  return { locales, defaultLocale: locales[0] };
}

function hasFragments(root) {
  const msgDir = join(root, "messages");
  if (!existsSync(msgDir)) return false;
  for (const entry of readdirSync(msgDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const localeDir = join(msgDir, entry.name);
    if (existsSync(join(localeDir, "_base.json"))) return true;
    const routesDir = join(localeDir, "_routes");
    if (existsSync(routesDir) && readdirSync(routesDir).some((f) => f.endsWith(".json") && !f.startsWith("."))) {
      return true;
    }
  }
  return false;
}

const VOICE_HEADING_RE = /tone|voice|verbatim|terminology|locked|typography|colou?r|contrast/i;
const VOICE_DOCS = ["brand.md", "content-strategy.md", "design-direction.md", "design-system.md"];

function extractVoiceHeadings(text) {
  const headings = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && VOICE_HEADING_RE.test(m[1])) headings.push(m[1]);
  }
  return headings.slice(0, 8);
}

// ───────────────────────── buildModel (fs) ─────────────────────────

/** Pages listed in the generated `src/mirror/index.ts` (replicate mode). A regex,
 *  not an import: the file is TypeScript and this script stays dependency-free. */
export function parseMirrorIndex(src) {
  const out = [];
  for (const m of src.matchAll(/\{\s*"path":\s*"([^"]+)",\s*"locale":\s*"([^"]+)"[\s\S]*?"title":\s*"((?:[^"\\]|\\.)*)"[\s\S]*?"file":\s*"([^"]+)"/g)) {
    out.push({ path: m[1], locale: m[2], title: m[3].replace(/\\"/g, '"'), file: m[4] });
  }
  return out;
}

export function buildModel(root) {
  const { locales, defaultLocale } = detectLocales(root);

  const mirrorIndex = join(root, "src", "mirror", "index.ts");
  const mirror = {
    pages: existsSync(mirrorIndex) ? parseMirrorIndex(readFileSync(mirrorIndex, "utf8")) : [],
    assetsDir: existsSync(join(root, "public", "_mirror")) ? "public/_mirror" : null,
  };

  // Pages + registry drift
  const routesPath = join(root, "src", "lib", "seo", "routes.ts");
  const staticRoutes = existsSync(routesPath) ? parseStaticRoutes(readFileSync(routesPath, "utf8")) : [];
  const routeByPath = new Map(staticRoutes.map((r) => [r.path === "" ? "/" : r.path, r]));

  const appLocaleDir = join(root, "src", "app", "[locale]");
  const pageFiles = walkFiles(appLocaleDir)
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => relative(root, f))
    .sort();

  const pages = [];
  const seenUrls = new Set();
  for (const relPath of pageFiles) {
    const { url, catchAll } = routeFromPageFile(relPath);
    const src = readFileSync(join(root, relPath), "utf8");
    const route = catchAll ? undefined : routeByPath.get(url);
    if (!catchAll) seenUrls.add(url);
    pages.push({
      url,
      file: relPath,
      catchAll,
      namespaces: extractNamespaces(src),
      metaKey: extractMetaKey(src),
      schemaBuilders: extractSchemaBuilders(src),
      noindex: route?.noindex ?? false,
      inRegistry: catchAll ? false : Boolean(route),
    });
  }
  pages.sort((a, b) => (a.catchAll === b.catchAll ? a.url.localeCompare(b.url) : a.catchAll ? 1 : -1));

  const registryOnly = staticRoutes
    .map((r) => (r.path === "" ? "/" : r.path))
    .filter((p) => !seenUrls.has(p))
    .sort();
  const fileOnly = pages
    .filter((p) => !p.catchAll && !p.inRegistry)
    .map((p) => p.url)
    .sort();

  // Navigation
  const navArrays = [];
  for (const file of ["src/components/Header.tsx", "src/components/Footer.tsx"]) {
    const abs = join(root, file);
    if (!existsSync(abs)) continue;
    for (const arr of findLinkArrays(readFileSync(abs, "utf8"))) {
      navArrays.push({ ...arr, file });
    }
  }
  navArrays.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);

  // Route registry
  const dynamicRoutesPath = join(root, "src", "lib", "seo", "dynamic-routes.ts");
  const dynamicRoutesExists = existsSync(dynamicRoutesPath);
  const dynamicFunctions = dynamicRoutesExists
    ? [...readFileSync(dynamicRoutesPath, "utf8").matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)]
        .map((m) => m[1])
        .sort()
    : [];

  // Translations
  const layoutPath = join(root, "src", "app", "[locale]", "layout.tsx");
  let clientNamespaces = [];
  if (existsSync(layoutPath)) {
    const layoutSrc = readFileSync(layoutPath, "utf8");
    const m = layoutSrc.match(/CLIENT_NAMESPACES\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
    if (m) clientNamespaces = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort();
  }

  // Contact details
  const contactMatches = [];
  for (const dir of ["src", "messages"]) {
    for (const file of walkFiles(join(root, dir))) {
      const ext = extname(file);
      if (![".ts", ".tsx", ".json"].includes(ext)) continue;
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      contactMatches.push(...findContactDetails(text, relative(root, file)));
    }
  }
  const contacts = groupContactDetails(contactMatches);

  // Data content
  const dataDir = join(root, "src", "data");
  let dataFiles = null;
  if (existsSync(dataDir)) {
    dataFiles = readdirSync(dataDir)
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => {
        const src = readFileSync(join(dataDir, f), "utf8");
        const exports = [...src.matchAll(/export\s+(?:const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)]
          .map((m) => m[1])
          .sort();
        return { file: `src/data/${f}`, exports };
      });
  }

  // Images
  const imagesDir = join(root, "public", "images");
  const imageDirs = existsSync(imagesDir)
    ? readdirSync(imagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
          name: e.name,
          count: readdirSync(join(imagesDir, e.name), { withFileTypes: true }).filter((f) => f.isFile()).length,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const images = {
    dirs: imageDirs,
    hasSlots: existsSync(join(root, "IMAGE_SLOTS.md")),
    hasCatalog: existsSync(join(root, "IMAGE_CATALOG.md")),
    hasRequests: existsSync(join(root, "public", "images", "IMAGE_REQUESTS.md")),
  };

  // Markers
  const markers = findMarkers(root);

  // CSP
  const nextConfigPath = join(root, "next.config.ts");
  const nextConfigSrc = existsSync(nextConfigPath) ? readFileSync(nextConfigPath, "utf8") : "";
  const csp = parseCsp(nextConfigSrc);

  // Redirects
  const redirects = {
    hasRedirectsDoc: existsSync(join(root, "redirects.md")),
    sourceCount: countRedirectSources(nextConfigSrc),
  };

  // Do not touch
  // Paths the editing agent must leave alone, with the exceptions its own
  // legitimate edits need — the route registry, structured data (contact
  // details live there), the redirects list and CSP allowances.
  const doNotTouchCandidates = [
    ["src/lib/contact/", "external delivery configuration is separate from ordinary content edits"],
    ["src/lib/seo/", "except routes.ts (page registry) and structured-data.ts (business details)"],
    ["src/i18n/", "locale wiring"],
    ["scripts/", "pipeline tooling"],
    [".github/", "blocked at push time anyway"],
    ["package.json", "avoid unrelated dependency or infrastructure changes"],
    ["next.config.ts", "except the redirects() list and CSP allowances for an approved embed"],
    [".redesign-state/", "pipeline memory"],
  ];
  const doNotTouch = doNotTouchCandidates
    .filter(([p]) => existsSync(join(root, p)))
    .map(([path, note]) => ({ path, note }));

  // Voice
  const voice = [];
  for (const file of VOICE_DOCS) {
    const abs = join(root, file);
    if (!existsSync(abs)) continue;
    const headings = extractVoiceHeadings(readFileSync(abs, "utf8"));
    voice.push({ file, headings });
  }

  return {
    locales,
    defaultLocale,
    pages,
    registryDrift: { registryOnly, fileOnly },
    navArrays,
    routeRegistry: {
      file: existsSync(routesPath) ? "src/lib/seo/routes.ts" : null,
      count: staticRoutes.length,
      dynamicRoutesFile: dynamicRoutesExists ? "src/lib/seo/dynamic-routes.ts" : null,
      dynamicFunctions,
    },
    translations: { hasFragments: hasFragments(root), clientNamespaces },
    contacts,
    dataFiles,
    images,
    markers,
    csp,
    redirects,
    doNotTouch,
    voice,
    mirror,
  };
}

// ───────────────────────── renderGuide ─────────────────────────

function heading(_n, title) {
  return `## ${title}`;
}

function tableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

export function renderGuide(model) {
  const lines = [];

  // 1. Header
  lines.push("# Site guide");
  lines.push("");
  lines.push(
    "Generated by `npm run site-guide` from this repository — do not edit by hand; regenerate after structural changes.",
  );
  lines.push("");
  lines.push(`Primary locale: \`${model.defaultLocale ?? "(none)"}\`. Locales: ${model.locales.map((l) => `\`${l}\``).join(", ") || "none found"}.`);
  lines.push("");

  // 1b. Mirrored pages (replicate mode)
  if (model.mirror?.pages?.length) {
    lines.push(heading(1, "Mirrored pages"));
    lines.push("");
    lines.push(
      "This site is a **mirror** of the client's previous site: each page below is the original's rendered HTML, served verbatim at its original URL with this site's canonical, hreflang and structured data injected by `src/app/api/mirror-page/`. The pages under `src/app/[locale]/` are only the not-found and error shell.",
    );
    lines.push("");
    lines.push(tableRow(["URL", "Locale", "Title", "File to edit"]));
    lines.push(tableRow(["---", "---", "---", "---"]));
    for (const p of model.mirror.pages) lines.push(tableRow([`\`${p.path}\``, `\`${p.locale}\``, p.title || "—", `\`${p.file}\``]));
    lines.push("");
    lines.push("Editing rules:");
    lines.push("- The current `src/mirror/index.ts` and listed HTML files are the source of truth. This generated guide can be stale until you run `npm run site-guide`; follow the source when they differ.");
    lines.push("- Text and links: edit the page's HTML file in place; keep the markup structure and class names, which carry the original's styling.");
    lines.push(`- Images: add the new file under \`${model.mirror.assetsDir ?? "public/_mirror"}/uploads/\` and point the \`src\` (and any \`srcset\`) at it. \`${model.mirror.assetsDir ?? "public/_mirror"}/origin/\` and \`ext/\` hold the original's own files, self-hosted; never edit or delete them.`);
    lines.push("- The contact form posts to `/api/contact.json` through a script the handler injects; its fields are mapped by type (email, tel, textarea) — keep those types when editing the form.");
    lines.push("- To add a page: create its `src/mirror/pages/<path>/index.html`, add a `MIRROR_PAGES` entry with `path`, `locale`, `alternates`, `title`, `description` and `file`, then update navigation in the relevant same-locale HTML pages. Keep every alternate pointing at its matching locale page. Preserve the existing JSON-style entry format, unrelated entries, frame origins, redirects and captured assets.");
    lines.push("- To remove a page: remove its HTML and `MIRROR_PAGES` entry, remove its links from navigation, clean any alternates that point at it, and add a `{ source, destination }` entry to `MIRROR_REDIRECTS` for the replacement page.");
    lines.push("- Do not re-run `scripts/mirror-install.mjs` for routine owner edits. Use it only when replacing the captured site or the complete captured asset set.");
    lines.push("");
  }

  // 2. Pages
  lines.push(heading(2, "Pages"));
  lines.push("");
  const normalPages = model.pages.filter((p) => !p.catchAll);
  const catchAllPages = model.pages.filter((p) => p.catchAll);
  if (!normalPages.length && !catchAllPages.length) {
    lines.push("none found");
  } else {
    lines.push(tableRow(["URL", "File", "Namespaces", "Meta key", "Schema builders", "Noindex", "In registry"]));
    lines.push(tableRow(["---", "---", "---", "---", "---", "---", "---"]));
    for (const p of normalPages) {
      lines.push(
        tableRow([
          p.url,
          `\`${p.file}\``,
          p.namespaces.join(", ") || "—",
          p.metaKey ?? "—",
          p.schemaBuilders.join(", ") || "—",
          p.noindex ? "yes" : "no",
          p.inRegistry ? "yes" : "no",
        ]),
      );
    }
    for (const p of catchAllPages) {
      lines.push(tableRow([p.url, `\`${p.file}\``, p.namespaces.join(", ") || "—", p.metaKey ?? "—", p.schemaBuilders.join(", ") || "—", "—", "—"]));
    }
  }
  lines.push("");
  lines.push("**Registry drift**");
  lines.push("");
  if (!model.registryDrift.registryOnly.length && !model.registryDrift.fileOnly.length) {
    lines.push("none found");
  } else {
    for (const p of model.registryDrift.registryOnly) lines.push(`- registered but no page file: \`${p}\``);
    for (const p of model.registryDrift.fileOnly) lines.push(`- page file but not registered: \`${p}\``);
  }
  lines.push("");

  // 3. Navigation
  lines.push(heading(3, "Navigation"));
  lines.push("");
  if (!model.navArrays.length) {
    lines.push("none found");
  } else {
    for (const a of model.navArrays) {
      lines.push(`- \`${a.name}\` — \`${a.file}:${a.start}–${a.end}\` — ${a.hrefs.join(", ") || "no hrefs"}`);
    }
  }
  lines.push("");

  // 4. Route registry
  lines.push(heading(4, "Route registry"));
  lines.push("");
  if (!model.routeRegistry.file) {
    lines.push("none found");
  } else {
    lines.push(`- \`${model.routeRegistry.file}\` — ${model.routeRegistry.count} route(s)`);
    if (model.routeRegistry.dynamicRoutesFile) {
      lines.push(
        `- \`${model.routeRegistry.dynamicRoutesFile}\` — ${model.routeRegistry.dynamicFunctions.join(", ") || "no exported functions"}`,
      );
    } else {
      lines.push("- no dynamic-routes file");
    }
  }
  lines.push("");

  // 5. Translations
  lines.push(heading(5, "Translations"));
  lines.push("");
  if (model.translations.hasFragments) {
    lines.push(
      "Edit `messages/<locale>/_routes/*.json` (and `_base.json` for shared keys), then run `npm run merge`. `messages/<locale>.json` is generated; never edit it directly.",
    );
  } else {
    lines.push("Edit `messages/<locale>.json`.");
  }
  lines.push("");
  lines.push(
    `CLIENT_NAMESPACES (layout.tsx): ${model.translations.clientNamespaces.join(", ") || "none found"}`,
  );
  lines.push("");
  lines.push(
    "Rule: a fix in one language changes only that language; a meaning change updates every language, written idiomatically, never word-for-word.",
  );
  lines.push("");

  // 6. Contact details
  lines.push(heading(6, "Contact details"));
  lines.push("");
  if (!model.contacts.length) {
    lines.push("none found");
  } else {
    lines.push(tableRow(["Kind", "Value", "Locations"]));
    lines.push(tableRow(["---", "---", "---"]));
    for (const c of model.contacts) {
      lines.push(tableRow([c.kind, `\`${c.value}\``, c.locations.map((l) => `\`${l}\``).join(", ")]));
    }
    lines.push("");
    lines.push("Values may appear in two formats (e.g. a spaced phone number and a `tel:` href) and in structured data — update every occurrence together.");
  }
  lines.push("");

  // 7. Data content
  lines.push(heading(7, "Data content"));
  lines.push("");
  if (!model.dataFiles) {
    lines.push("none — content lives in the message files");
  } else if (!model.dataFiles.length) {
    lines.push("none found");
  } else {
    for (const d of model.dataFiles) lines.push(`- \`${d.file}\` — ${d.exports.join(", ") || "no exports"}`);
  }
  lines.push("");

  // 8. Images
  lines.push(heading(8, "Images"));
  lines.push("");
  if (!model.images.dirs.length) {
    lines.push("none found");
  } else {
    for (const d of model.images.dirs) lines.push(`- \`public/images/${d.name}/\` — ${d.count} file(s)`);
  }
  lines.push("");
  lines.push(
    `IMAGE_SLOTS.md: ${model.images.hasSlots ? "present" : "absent"}. IMAGE_CATALOG.md: ${model.images.hasCatalog ? "present" : "absent"}. IMAGE_REQUESTS.md: ${model.images.hasRequests ? "present" : "absent"}.`,
  );
  lines.push("");
  lines.push(
    "Rule: new images go under the matching role dir, descriptive kebab-case names, ≤2000px long edge, and add/adjust the catalog row when the catalog exists.",
  );
  lines.push("");

  // 9. Open content markers
  lines.push(heading(9, "Open content markers"));
  lines.push("");
  const localeEntries = Object.entries(model.markers.perLocale ?? {});
  if (!localeEntries.length && !(model.markers.sources ?? []).length) {
    lines.push("none found");
  } else {
    for (const [locale, count] of localeEntries) {
      lines.push(`- ${locale}: ${count} marker(s)${count ? ` — ${(model.markers.keys[locale] ?? []).join(", ")}` : ""}`);
    }
    if (model.markers.sources.length) {
      lines.push("");
      lines.push("Source files:");
      for (const s of model.markers.sources) lines.push(`- \`${s}\``);
    }
  }
  lines.push("");

  // 10. Embeds and security policy
  lines.push(heading(10, "Embeds and security policy"));
  lines.push("");
  const cspEntries = Object.entries(model.csp.directives ?? {});
  if (!cspEntries.length) {
    lines.push("none found");
  } else {
    lines.push(tableRow(["Directive", "Values"]));
    lines.push(tableRow(["---", "---"]));
    for (const [name, values] of cspEntries) lines.push(tableRow([name, values.join(" ") || "—"]));
  }
  lines.push("");
  lines.push(
    "Third-party embeds (maps, video, social) need a `frame-src`/`script-src` allowance in `next.config.ts` and, when they set cookies, the consent gate — prefer a plain link.",
  );
  lines.push("");

  // 11. Redirects
  lines.push(heading(11, "Redirects"));
  lines.push("");
  lines.push(`\`redirects.md\`: ${model.redirects.hasRedirectsDoc ? "present" : "absent"}.`);
  lines.push(`\`next.config.ts\` \`redirects()\`: ${model.redirects.sourceCount} source(s).`);
  lines.push("");
  lines.push("Rule: removing a page needs a redirect + registry + nav removal.");
  lines.push("");

  // 12. Checks
  lines.push(heading(12, "Checks"));
  lines.push("");
  lines.push("- Text-only edits: validate touched JSON, merge translation fragments and check affected mirror HTML content and links. Report which checks actually ran; source checks do not prove rendering or external delivery.");
  lines.push("- Image or source edits: run `npm run check` when available. Structural changes on rebuilt or mirrored sites, including page/registry/navigation changes, also require `npm run build` when available. Inspect the actual package scripts; a build does not establish deployment readiness.");
  lines.push("- `npm run merge` — after editing a translation fragment.");
  lines.push("");

  // 13. Do not touch
  lines.push(heading(13, "Do not touch"));
  lines.push("");
  if (!model.doNotTouch.length) {
    lines.push("none found");
  } else {
    for (const { path, note } of model.doNotTouch) lines.push(`- \`${path}\` — ${note}`);
  }
  lines.push("");

  // 14. Voice and brand
  lines.push(heading(14, "Voice and brand"));
  lines.push("");
  const voiceLines = [];
  for (const v of model.voice) {
    for (const h of v.headings) voiceLines.push(`- see \`${v.file}\` → ${h}`);
  }
  lines.push(...(voiceLines.length ? voiceLines : ["none found"]));
  lines.push("");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ───────────────────────── CLI ─────────────────────────

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const positional = args.find((a) => !a.startsWith("-"));
  const root = positional ? resolve(positional) : process.cwd();

  const model = buildModel(root);
  const generated = renderGuide(model);
  const target = join(root, "SITE_GUIDE.md");

  if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== generated) {
      console.error("site-guide --check: SITE_GUIDE.md differs from what would be generated. Run `npm run site-guide`.");
      process.exit(1);
    }
    console.log("site-guide --check: up to date.");
    return;
  }

  writeFileSync(target, generated);
  console.log(`site-guide: wrote ${target}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
