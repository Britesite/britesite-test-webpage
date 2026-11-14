import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripManagedHead,
  injectMirrorHead,
  mirrorHeadFragment,
  mirrorAbsoluteUrl,
  mirrorHreflang,
  absolutiseSocialImages,
  readSiteName,
  ensureSocialImage,
  setHtmlLang,
  type MirrorPage,
} from "./head.ts";

const SITE = "https://example.com";
const page: MirrorPage = {
  path: "/om-os",
  locale: "da",
  alternates: { da: "/om-os", en: "/en/about-us" },
  title: "Om os - Firma",
  description: "Beskrivelse",
  file: "src/mirror/pages/om-os/index.html",
};

test("stripManagedHead removes canonical, hreflang, og:url, og:locale and feed/oembed alternates, keeps the rest", () => {
  const html = `<html><head><!-- mirror:head -->
<link rel="canonical" href="https://old.example/om-os/">
<link rel="alternate" hreflang="en" href="https://old.example/en/about-us/">
<link rel="alternate" type="application/rss+xml" title="Feed" href="https://old.example/feed/">
<link rel="alternate" title="oEmbed (JSON)" type="application/json+oembed" href="https://old.example/wp-json/oembed">
<meta property="og:url" content="https://old.example/om-os/">
<meta property="og:locale" content="da_DK">
<meta property="og:title" content="Om os">
<title>Om os - Firma</title></head><body></body></html>`;
  const out = stripManagedHead(html);
  assert.doesNotMatch(out, /rel="canonical"/);
  assert.doesNotMatch(out, /hreflang=/);
  assert.doesNotMatch(out, /rss\+xml/);
  assert.doesNotMatch(out, /oembed/);
  assert.doesNotMatch(out, /og:url/);
  assert.doesNotMatch(out, /og:locale/);
  assert.match(out, /og:title/);
  assert.match(out, /<title>Om os - Firma<\/title>/);
});

test("mirrorAbsoluteUrl applies the site origin and trailing-slash policy", () => {
  assert.equal(mirrorAbsoluteUrl(SITE, "/om-os", false), "https://example.com/om-os");
  assert.equal(mirrorAbsoluteUrl(SITE, "/om-os", true), "https://example.com/om-os/");
  assert.equal(mirrorAbsoluteUrl(SITE, "/", true), "https://example.com/");
  assert.equal(mirrorAbsoluteUrl(SITE, "/", false), "https://example.com");
});

test("mirrorHreflang lists every alternate plus x-default on the default locale", () => {
  const h = mirrorHreflang(SITE, page, "da", true);
  assert.deepEqual(h, {
    da: "https://example.com/om-os/",
    en: "https://example.com/en/about-us/",
    "x-default": "https://example.com/om-os/",
  });
});

test("mirrorHeadFragment carries canonical, hreflang, og:url, og:locale and JSON-LD for the page", () => {
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true });
  assert.match(frag, /<link rel="canonical" href="https:\/\/example.com\/om-os\/">/);
  assert.match(frag, /<link rel="alternate" hrefLang="en" href="https:\/\/example.com\/en\/about-us\/">/);
  assert.match(frag, /<link rel="alternate" hrefLang="x-default" href="https:\/\/example.com\/om-os\/">/);
  assert.match(frag, /<meta property="og:url" content="https:\/\/example.com\/om-os\/">/);
  assert.match(frag, /<meta property="og:locale" content="da_DK">/);
  assert.match(frag, /application\/ld\+json/);
  assert.match(frag, /"@type":"WebPage"/);
  assert.match(frag, /"inLanguage":"da"/);
});

// A mirrored framework that hydrates the whole document (TanStack Start on
// React 19) reads a whitespace text node in <head> as a hydration mismatch and
// client-renders the page from its bundle, with the original's asset URLs.
test("mirrorHeadFragment puts no whitespace text node into the head", () => {
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true });
  assert.doesNotMatch(frag, />\s+</);
  const html = injectMirrorHead(`<!DOCTYPE html><html><head><!-- mirror:head --><meta charset="utf-8"></head><body></body></html>`, frag);
  assert.doesNotMatch(html.slice(0, html.indexOf("</head>")), />\s+</);
});

// The favicon is the original's: the captured head links it and capture localises
// the file. The template ships no /icon.svg, so declaring one added a 404 link
// ahead of the original's own icons.
test("mirrorHeadFragment declares no icon of its own", () => {
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true });
  assert.doesNotMatch(frag, /rel="icon"/);
});

// og:image is read by crawlers that have no page context to resolve against, so
// a root-relative one (which is what localizing the original's leaves behind)
// has to be made absolute against this site's own origin.
test("absolutiseSocialImages makes a localized og:image absolute and leaves everything else alone", () => {
  const html = '<html><head><meta property="og:image" content="/_mirror/origin/img/card.jpg"><meta name="twitter:image" content="/_mirror/origin/img/tw.jpg"><meta property="og:title" content="/not/an/image"></head><body><img src="/_mirror/origin/img/in-body.jpg"></body></html>';
  const out = absolutiseSocialImages(html, SITE);
  assert.match(out, /<meta property="og:image" content="https:\/\/example\.com\/_mirror\/origin\/img\/card\.jpg">/);
  assert.match(out, /<meta name="twitter:image" content="https:\/\/example\.com\/_mirror\/origin\/img\/tw\.jpg">/);
  assert.match(out, /<meta property="og:title" content="\/not\/an\/image">/, "a non-image meta is untouched");
  assert.match(out, /<img src="\/_mirror\/origin\/img\/in-body\.jpg">/, "body markup is untouched");
});

test("absolutiseSocialImages leaves an already-absolute og:image as it is", () => {
  const html = '<meta property="og:image" content="https://cdn.example.org/card.jpg">';
  assert.equal(absolutiseSocialImages(html, SITE), html);
});

test("stripManagedHead removes the original's JSON-LD — the kit publishes the site's one graph", () => {
  const html = '<html><head><script type="application/ld+json" class="yoast-schema-graph">{"@id":"x"}</script><title>t</title></head><body><script type="application/ld+json">{"body":1}</script></body></html>';
  const out = stripManagedHead(html);
  assert.ok(!out.includes("yoast-schema-graph"), "the original's graph is gone from the head");
  assert.match(out, /<title>t<\/title>/);
  assert.match(out, /\{"body":1\}/, "a JSON-LD block in the BODY is not the head's to manage");
});

test("readSiteName takes the site name from the captured og:site_name, or null", () => {
  assert.equal(readSiteName('<meta property="og:site_name" content="MK Murerne">'), "MK Murerne");
  assert.equal(readSiteName("<meta charset=\"utf-8\">"), null);
});

test("mirrorHeadFragment names the WebSite by the SITE, not by the page", () => {
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true, siteName: "MK Murerne" });
  assert.match(frag, /"@type":"WebSite","@id":"https:\/\/example\.com\/#website","url":"https:\/\/example\.com\/","name":"MK Murerne"/);
});

test("mirrorHeadFragment emits a LocalBusiness node when the business facts are supplied", () => {
  const business = { name: "MK Murerne ApS", streetAddress: "Ved Bækken 3", postalCode: "5320", addressLocality: "Agedrup", addressCountry: "DK", telephone: ["+4522937053"], email: "mail@mkmurerne.dk", vatID: "DK40696296" };
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true, siteName: "MK Murerne", business });
  assert.match(frag, /"@type":"LocalBusiness"/);
  assert.match(frag, /"streetAddress":"Ved Bækken 3"/);
  assert.match(frag, /"vatID":"DK40696296"/);
  assert.ok(!/"geo"/.test(frag), "no coordinate is invented — that needs a real geocode");
});

test("the WebSite name falls back to the business, never to the page's title", () => {
  const business = { name: "Hein-Byg", streetAddress: "Gl. Holmegårdsvej 45, st. tv", postalCode: "3400", addressLocality: "Hillerød", addressCountry: "DK", telephone: ["+4526239929"] };
  assert.match(mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true, siteName: null, business }), /"@type":"WebSite","@id":"https:\/\/example\.com\/#website","url":"https:\/\/example\.com\/","name":"Hein-Byg"/);
  const nameless = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true });
  assert.match(nameless, /"@type":"WebSite","@id":"https:\/\/example\.com\/#website","url":"https:\/\/example\.com\/"\}/, "no name beats a different name on every page");
});

test("the LocalBusiness node carries the description, service area and profiles the original published", () => {
  const business = {
    name: "Hein-Byg", streetAddress: "Gl. Holmegårdsvej 45, st. tv", postalCode: "3400", addressLocality: "Hillerød", addressCountry: "DK", telephone: ["+4526239929"],
    description: "Tømrer- og byggefirma i Hillerød.",
    areaServed: [{ type: "AdministrativeArea", name: "Nordsjælland" }, { type: "City", name: "Hillerød" }],
    sameAs: ["https://www.instagram.com/heinbyg/"],
  };
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true, business });
  assert.match(frag, /"description":"Tømrer- og byggefirma i Hillerød\."/);
  assert.match(frag, /"areaServed":\[\{"@type":"AdministrativeArea","name":"Nordsjælland"\},\{"@type":"City","name":"Hillerød"\}\]/);
  assert.match(frag, /"sameAs":\["https:\/\/www\.instagram\.com\/heinbyg\/"\]/);
});

test("mirrorHeadFragment omits LocalBusiness entirely when no facts are supplied", () => {
  const frag = mirrorHeadFragment({ siteUrl: SITE, page, defaultLocale: "da", trailingSlash: true });
  assert.ok(!/LocalBusiness/.test(frag));
});

test("ensureSocialImage adds og:image only when the page has none", () => {
  const without = "<html><head><title>t</title></head><body>x</body></html>";
  assert.match(ensureSocialImage(without, "https://example.com/card.jpg"), /<meta property="og:image" content="https:\/\/example\.com\/card\.jpg">/);
  const withOne = '<html><head><meta property="og:image" content="https://example.com/own.jpg"></head><body>x</body></html>';
  assert.equal(ensureSocialImage(withOne, "https://example.com/card.jpg"), withOne, "the original's own card is never replaced");
  assert.equal(ensureSocialImage(without, null), without, "no fallback available: nothing invented");
});

test("injectMirrorHead replaces the marker, or inserts after <head> when the marker is missing", () => {
  assert.equal(injectMirrorHead("<html><head><!-- mirror:head --><title>x</title></head></html>", "<meta a>"), "<html><head><meta a><title>x</title></head></html>");
  assert.equal(injectMirrorHead("<html><head lang=\"da\"><title>x</title></head></html>", "<meta a>"), "<html><head lang=\"da\"><meta a><title>x</title></head></html>");
});

test("injectMirrorHead loads the first-party facade script only on a page that has a facade", () => {
  const facaded = injectMirrorHead('<html><head><!-- mirror:head --></head><body><span data-embed-facade></span></body></html>', "<meta a>");
  assert.match(facaded, /<head><meta a><script src="\/embed-facade\.js" defer><\/script><\/head>/);
  assert.doesNotMatch(injectMirrorHead("<html><head><!-- mirror:head --></head><body></body></html>", "<meta a>"), /embed-facade/);
  assert.equal(injectMirrorHead(facaded, "<meta b>").match(/embed-facade\.js/g)?.length, 1);
});

test("setHtmlLang declares the page's own locale on <html>, replacing the original's or adding one", () => {
  assert.equal(setHtmlLang('<!DOCTYPE html><html lang="en" class="x"><head></head></html>', "da"), '<!DOCTYPE html><html lang="da" class="x"><head></head></html>');
  assert.equal(setHtmlLang("<html><head></head></html>", "da"), '<html lang="da"><head></head></html>');
  assert.equal(setHtmlLang('<html class="x" lang=en-US><head></head><body lang="en"></body></html>', "da"), '<html class="x" lang="da"><head></head><body lang="en"></body></html>', "only the document element is the page's language");
});
