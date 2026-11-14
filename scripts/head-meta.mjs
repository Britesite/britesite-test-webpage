import { decodeEntities } from "./crawl-corpus.mjs";

/** The head fields the delivery verifier judges, pulled from serialized HTML.
 *  `title` and `description` are decoded here, once, because their LENGTH is
 *  measured against a search-engine budget: the serialized head is
 *  entity-escaped (`&amp;`, `&#x27;`) but Google counts the characters a reader
 *  sees, so measuring the raw markup charged 4 characters for every `&` and 4
 *  for every apostrophe — on a site whose brand suffix has an `&`, on every
 *  page, invisibly. Decoding at extraction also means the crawl's unescaped
 *  value and the rendered one compare directly. */
export function parseHead(html) {
  const pick = (re) => html.match(re)?.[1];
  const hreflang = {};
  // Match the whole alternate <link> tag, then pull hreflang/href independently —
  // robust to attribute order changing across Next/next-intl versions.
  for (const tag of html.matchAll(/<link\b[^>]*\brel="alternate"[^>]*>/gi)) {
    const lang = tag[0].match(/\bhrefLang="([^"]+)"/i)?.[1];
    const href = tag[0].match(/\bhref="([^"]+)"/i)?.[1];
    if (lang && href) hreflang[lang] = href;
  }
  return {
    title: decodeEntities(pick(/<title>([^<]*)<\/title>/i)),
    canonical: pick(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i),
    ogLocale: pick(/<meta[^>]*property="og:locale"[^>]*content="([^"]+)"/i),
    description: decodeEntities(pick(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)),
    ogImage: pick(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i),
    ogImageW: pick(/<meta[^>]*property="og:image:width"[^>]*content="([^"]+)"/i),
    ogImageH: pick(/<meta[^>]*property="og:image:height"[^>]*content="([^"]+)"/i),
    hreflang,
  };
}
