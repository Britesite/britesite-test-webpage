import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { buildModel } from "./site-guide.mjs";

import { installMirror } from "./mirror-install.mjs";
import { mirrorHeadFragment } from "../src/lib/mirror/head.ts";
import { extractRedirectSources, findDeadRedirectTargets, findSitemapCoverageGaps, publicRouteOf } from "./verify-source.mjs";

function write(root, file, content) {
  const target = join(root, file);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function typedArray(index, name) {
  const match = new RegExp(`export const ${name}[^=]*= (\\[[\\s\\S]*?\\]);`).exec(index);
  assert.ok(match, `expected ${name} in mirror index`);
  const start = match.index + match[0].indexOf(match[1]);
  return { values: JSON.parse(match[1]), start, end: start + match[1].length };
}

function editArray(index, name, edit) {
  const array = typedArray(index, name);
  edit(array.values);
  return `${index.slice(0, array.start)}${JSON.stringify(array.values, null, 2)}${index.slice(array.end)}`;
}

function localNavHrefs(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/gi)].map((match) => match[1]);
}

const templateRoot = fileURLToPath(new URL("../", import.meta.url));

function verifyCompiledFixture(fixture, kind) {
  if (process.env.OWNER_EDITING_BUILD_TESTS !== "1") return;
  const compiled = mkdtempSync(join(tmpdir(), `owner-${kind}-compiled-`));
  try {
    assert.ok(existsSync(join(templateRoot, "node_modules/.bin/next")), "compiled fixtures require installed template dependencies");
    cpSync(templateRoot, compiled, {recursive: true, filter: source => {
      const name = basename(source);
      return !["node_modules", ".next", ".git"].includes(name) && !name.startsWith(".env") && !name.endsWith(".tsbuildinfo");
    }});
    symlinkSync(join(templateRoot, "node_modules"), join(compiled, "node_modules"), "dir");
    const paths = kind === "mirror" ? ["src/mirror", "public/_mirror"]
      : ["src/app/[locale]", "src/components", "src/lib/seo/routes.ts", "messages", "public/images"];
    for (const path of paths) cpSync(join(fixture, path), join(compiled, path), {recursive: true});
    if (kind === "mirror") rmSync(join(compiled, "src/app/[locale]/page.tsx"));
    else {
      const layout = join(compiled, "src/app/[locale]/layout.tsx");
      writeFileSync(layout, 'import Header from "@/components/Header";\n' + readFileSync(layout, "utf8").replace("{children}", "<Header />{children}"));
    }
    const config = join(compiled, "next.config.ts");
    writeFileSync(config, readFileSync(config, "utf8").replace(/cpus:\s*\d+/, "cpus: 1"));
    const env = {...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SITE_DOMAIN: "example.test"};
    const preview = process.env.SELECTION_PREVIEW_BUILD_TESTS === "1";
    env.VERCEL_ENV = preview ? "preview" : "production";
    env.WEBSITE_AGENT_ORIGIN = "https://editor.example.test";
    execFileSync("npm", ["run", "build", "--", "--webpack"], {cwd: compiled, env, stdio: "pipe", timeout: 240_000});
    execFileSync("npm", ["run", "check"], {cwd: compiled, env, stdio: "pipe", timeout: 60_000});
    const assertBridge = html => {
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
      const bridges = scripts.filter(source => source.trim().startsWith("(function(parentOrigin)"));
      assert.equal(bridges.length, preview ? 1 : 0, "bridge is delivered only in preview HTML");
      if (preview) assert.ok(html.indexOf(bridges[0]) < html.indexOf("</head>"), "bridge installs event interception in the head before page body scripts");
      if (!preview) assert.ok(!html.includes("website-selection:init"), "production contains no bridge source or serialized bridge props");
      for (const source of bridges) assert.doesNotThrow(() => new Script(source), "delivered bridge is valid JavaScript");
    };
    const routes = JSON.parse(readFileSync(join(compiled, ".next/routes-manifest.json"), "utf8"));
    const headers = routes.headers.flatMap(route => route.headers);
    assert.ok(headers.some(header => header.key === "Content-Security-Policy"
      && header.value.includes(preview ? "frame-ancestors https://editor.example.test" : "frame-ancestors 'none'")));
    assert.equal(headers.some(header => header.key === "X-Frame-Options" && header.value === "DENY"), !preview);
    if (kind === "rebuilt") {
      for (const [locale, heading] of [["da", "Ydelser"], ["en", "Services"]]) {
        const html = readFileSync(join(compiled, `.next/server/app/${locale}/services.html`), "utf8");
        assert.ok(html.includes(heading), "compiled page contains its translated heading");
        assert.ok(html.includes(`href="/${locale}/services"`), "compiled navigation points at the new page");
        assertBridge(html);
      }
      assert.ok(readFileSync(join(compiled, ".next/server/app/da.html"), "utf8").includes("/images/hero/owner.svg"));
    } else {
      assert.ok(routes.dynamicRoutes.some(route => route.page === "/api/mirror-page/[[...path]]"));
      const root = join(compiled, ".next/server/app/api");
      const bodies = readdirSync(root, {recursive: true}).filter(path => path.endsWith(".body") && path.startsWith("mirror-page"));
      assert.ok(bodies.length > 0, "mirror fixture produced static HTML responses");
      for (const path of bodies) assertBridge(readFileSync(join(root, path), "utf8"));
    }
  } finally {
    rmSync(compiled, {recursive: true, force: true});
  }
}

function handlerRoute(path) {
  return path === "/" ? "/api/mirror-page" : `/api/mirror-page${path}`;
}

test("owners can edit a mirrored site's text and images, then add navigation or replace a removed page with a redirect", () => {
  const site = mkdtempSync(join(tmpdir(), "mirror-owner-site-"));
  const from = mkdtempSync(join(tmpdir(), "mirror-owner-from-"));
  const crawl = mkdtempSync(join(tmpdir(), "mirror-owner-crawl-"));
  try {
    write(from, "mirror-manifest.json", JSON.stringify({
      pages: [
        { path: "/", locale: "da-DK", ok: true },
        { path: "/om-os", locale: "da-DK", ok: true },
      ],
    }));
    write(crawl, "manifest.json", JSON.stringify({
      locales: { detected: ["da"], default: "da", trailingSlash: false },
      routes: [
        { path: "/", lang: "da-DK", alternates: { da: "/" } },
        { path: "/om-os", lang: "da-DK", alternates: { da: "/om-os" } },
      ],
      dropped: [{ path: "/gammel", class: "redirect", redirectsTo: "https://old.example/" }],
    }));
    write(from, "index.html", '<html><head><title>Forside</title><meta name="description" content="Bevaret beskrivelse"></head><body><nav><a href="/om-os">Om os</a></nav><p>Bevar dette indhold</p><p>Bevar denne note</p><img src="/_mirror/origin/hero.jpg"></body></html>');
    write(from, "om-os/index.html", '<html><head><title>Om os</title></head><body><nav><a href="/">Forside</a></nav><p>Om virksomheden</p></body></html>');
    write(from, "_mirror/origin/hero.jpg", "origin image");

    const installed = installMirror({ siteDir: site, fromDir: from, crawlDir: crawl });
    const home = join(site, "src/mirror/pages/index.html");
    const indexFile = join(site, "src/mirror/index.ts");
    assert.match(readFileSync(indexFile, "utf8"), /Owners may edit MIRROR_PAGES and the HTML files for routine site changes/);

    write(site, "public/_mirror/uploads/new-hero.jpg", "owner image");
    writeFileSync(home, readFileSync(home, "utf8")
      .replace("Bevar dette indhold", "Opdateret indhold")
      .replace("/_mirror/origin/hero.jpg", "/_mirror/uploads/new-hero.jpg")
      .replace('<a href="/om-os">Om os</a>', '<a href="/om-os">Om os</a><a href="/ydelser">Ydelser</a>'));
    write(site, "src/mirror/pages/ydelser/index.html", '<html><head><title>Ydelser</title><meta name="description" content="Vores ydelser"></head><body><nav><a href="/">Forside</a><a href="/om-os">Om os</a><a href="/ydelser">Ydelser</a></nav><p>Ny side</p></body></html>');

    const addedPage = {
      path: "/ydelser",
      locale: "da",
      alternates: { da: "/ydelser" },
      title: "Ydelser",
      description: "Vores ydelser",
      file: "src/mirror/pages/ydelser/index.html",
      successPath: null,
    };
    writeFileSync(indexFile, editArray(readFileSync(indexFile, "utf8"), "MIRROR_PAGES", (pages) => pages.push(addedPage)));

    const editedHome = readFileSync(home, "utf8");
    assert.match(editedHome, /Opdateret indhold/);
    assert.match(editedHome, /Bevar denne note/, "unrelated captured content remains after an owner edit");
    assert.match(editedHome, /_mirror\/uploads\/new-hero\.jpg/);
    assert.equal(readFileSync(join(site, "public/_mirror/origin/hero.jpg"), "utf8"), "origin image");

    const ownerPages = typedArray(readFileSync(indexFile, "utf8"), "MIRROR_PAGES").values;
    assert.ok(ownerPages.some((page) => page.path === "/om-os"), "an unrelated registry entry remains");
    assert.deepEqual(typedArray(readFileSync(indexFile, "utf8"), "MIRROR_REDIRECTS").values, [{ source: "/gammel", destination: "/" }]);
    const registeredPaths = new Set(ownerPages.map((page) => page.path));
    for (const page of ownerPages) {
      for (const href of localNavHrefs(readFileSync(join(site, page.file), "utf8"))) {
        assert.ok(registeredPaths.has(href), `${page.path} navigation points at a registered route: ${href}`);
      }
    }
    assert.deepEqual(
      findSitemapCoverageGaps(ownerPages.map((page) => publicRouteOf(handlerRoute(page.path))), ownerPages.map((page) => page.path), [], ["da"], new Set(), "da"),
      [],
    );
    const persistedAddedPage = ownerPages.find((page) => page.path === "/ydelser");
    assert.ok(persistedAddedPage);
    const head = mirrorHeadFragment({ siteUrl: "https://example.test", page: persistedAddedPage, defaultLocale: "da", trailingSlash: false });
    assert.match(head, /rel="canonical" href="https:\/\/example\.test\/ydelser"/);
    assert.match(head, /hrefLang="da" href="https:\/\/example\.test\/ydelser"/);

    rmSync(join(site, "src/mirror/pages/om-os"), { recursive: true });
    writeFileSync(home, editedHome.replace('<a href="/om-os">Om os</a>', ""));
    const servicesFile = join(site, "src/mirror/pages/ydelser/index.html");
    writeFileSync(servicesFile, readFileSync(servicesFile, "utf8").replace('<a href="/om-os">Om os</a>', ""));
    let removed = editArray(readFileSync(indexFile, "utf8"), "MIRROR_PAGES", (pages) => {
      pages.splice(pages.findIndex((page) => page.path === "/om-os"), 1);
    });
    removed = editArray(removed, "MIRROR_REDIRECTS", (redirects) => redirects.push({ source: "/om-os", destination: "/ydelser" }));
    writeFileSync(indexFile, removed);

    const afterRemoval = typedArray(readFileSync(indexFile, "utf8"), "MIRROR_PAGES").values;
    const redirects = typedArray(readFileSync(indexFile, "utf8"), "MIRROR_REDIRECTS").values;
    assert.ok(afterRemoval.every((page) => page.path !== "/om-os" && !Object.values(page.alternates).includes("/om-os")));
    const remainingPaths = new Set(afterRemoval.map((page) => page.path));
    for (const page of afterRemoval) {
      for (const href of localNavHrefs(readFileSync(join(site, page.file), "utf8"))) assert.ok(remainingPaths.has(href));
    }
    assert.deepEqual(extractRedirectSources(readFileSync(indexFile, "utf8")).sort(), ["/gammel", "/om-os"]);
    assert.deepEqual(findDeadRedirectTargets(redirects, afterRemoval.map((page) => page.path), [], {}, ["da"]), []);
    assert.equal(installed.pages.length, 2, "the original capture remains available as the starting point only");
    verifyCompiledFixture(site, "mirror");
  } finally {
    rmSync(site, { recursive: true, force: true });
    rmSync(from, { recursive: true, force: true });
    rmSync(crawl, { recursive: true, force: true });
  }
});


test("rebuilt source edits preserve shared copy and add a translated page to navigation and the registry", () => {
  const site = mkdtempSync(join(tmpdir(), "rebuilt-owner-site-"));
  const mergeScript = fileURLToPath(new URL("./merge-fragments.mjs", import.meta.url));
  const read = (file) => readFileSync(join(site, file), "utf8");
  const page = (path, key) => `import {buildMetadata} from "@/lib/seo/metadata";
import {getTranslations, setRequestLocale} from "next-intl/server";
type Props = {params: Promise<{locale: string}>};
export async function generateMetadata({params}: Props) {
  const {locale} = await params;
  return buildMetadata({locale, path: "${path}", metaKey: "${key}"});
}
export default async function Page({params}: Props) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations({locale, namespace: "${key}"});
  return <main><h1>{t("heading")}</h1><img src="/images/hero/original.svg" alt="Workshop" /></main>;
}`;
  try {
    write(site, "src/i18n/routing.ts", 'export const routing = {locales: ["da", "en"], defaultLocale: "da"};');
    write(site, "src/app/[locale]/page.tsx", page("", "home"));
    const registryTypes = readFileSync(join(templateRoot, "src/lib/seo/routes.ts"), "utf8").split("export const STATIC_ROUTES")[0];
    write(site, "src/lib/seo/routes.ts", registryTypes + 'export const STATIC_ROUTES: StaticRoute[] = [{path: "", metaKey: "home", priority: 1, changeFrequency: "monthly"}];');
    write(site, "src/components/Header.tsx", 'import {Link} from "@/i18n/routing";\nconst navLinks = [{href: "/", label: "Home"}]; export default function Header() {return <nav>{navLinks.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>;}');
    for (const locale of ["da", "en"]) {
      write(site, `messages/${locale}/_base.json`, JSON.stringify({...JSON.parse(readFileSync(join(templateRoot, `messages/${locale}.json`), "utf8")), footer: { copyright: "Fixture Company" } }));
      write(site, `messages/${locale}/_routes/home.json`, JSON.stringify({home: {heading: locale === "da" ? "Velkommen" : "Welcome"}, meta: {home: {title: "Home", description: "Workshop"}}}));
    }
    write(site, "public/images/hero/original.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    execFileSync(process.execPath, [mergeScript], {cwd: site, stdio: "pipe"});
    const originalBase = read("messages/da/_base.json");
    const englishBefore = read("messages/en.json");
    const home = JSON.parse(read("messages/da/_routes/home.json"));
    home.home.heading = "Velkommen til værkstedet";
    write(site, "messages/da/_routes/home.json", JSON.stringify(home));
    write(site, "public/images/hero/owner.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
    write(site, "src/app/[locale]/page.tsx", read("src/app/[locale]/page.tsx").replace("original.svg", "owner.svg"));
    execFileSync(process.execPath, [mergeScript], {cwd: site, stdio: "pipe"});
    assert.equal(JSON.parse(read("messages/da.json")).home.heading, "Velkommen til værkstedet");
    assert.equal(read("messages/en.json"), englishBefore, "single-language correction preserves other languages");
    assert.equal(read("messages/da/_base.json"), originalBase);
    assert.match(read("src/app/[locale]/page.tsx"), /owner\.svg/);
    assert.ok(read("public/images/hero/original.svg"));

    write(site, "src/app/[locale]/services/page.tsx", page("/services", "services"));
    const registryBefore = read("src/lib/seo/routes.ts");
    write(site, "src/lib/seo/routes.ts", registryBefore.replace(/];\s*$/, ', {path: "/services", metaKey: "services", priority: 0.8, changeFrequency: "monthly"}];'));
    write(site, "src/components/Header.tsx", read("src/components/Header.tsx").replace("]", ', {href: "/services", label: "Services"}]'));
    for (const locale of ["da", "en"]) {
      write(site, `messages/${locale}/_routes/services.json`, JSON.stringify({services: {heading: locale === "da" ? "Ydelser" : "Services"}, meta: {services: {title: locale === "da" ? "Ydelser" : "Services", description: "Workshop services"}}}));
    }
    execFileSync(process.execPath, [mergeScript], {cwd: site, stdio: "pipe"});
    execFileSync(process.execPath, [mergeScript, "--check"], {cwd: site, stdio: "pipe"});
    const model = buildModel(site);
    assert.deepEqual(model.registryDrift, {registryOnly: [], fileOnly: []});
    assert.deepEqual(model.pages.map(p => p.url), ["/", "/services"]);
    assert.ok(model.navArrays.some(nav => nav.hrefs.includes("/services")));
    for (const locale of model.locales) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      for (const route of model.pages) assert.ok(messages.meta[route.metaKey].title);
      assert.equal(messages.footer.copyright, "Fixture Company");
    }
    verifyCompiledFixture(site, "rebuilt");
    write(site, "src/lib/seo/routes.ts", registryBefore);
    assert.deepEqual(buildModel(site).registryDrift.fileOnly, ["/services"], "missing registration must be detected");
  } finally {
    rmSync(site, {recursive: true, force: true});
  }
});
