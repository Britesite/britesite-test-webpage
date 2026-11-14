---
name: adding-a-page
description: Use when the owner wants a new page on the site, wants a page removed or hidden, or wants a page's address changed. Covers the five places a page lives on this site — route file, route registry, navigation, translations, redirects — so that nothing is half-added. Not for editing text on an existing page.
---

# Adding, removing or moving a page

A page on this site is five things. Do all five, in this order, or the page
will render but stay invisible, or vanish but keep being advertised.

## Add

1. **Route file**: `src/app/[locale]/<route>/page.tsx`, modelled on the most
   similar existing page. It gets its metadata via `buildMetadata` with a new
   `metaKey`.
2. **Registry**: an entry in `STATIC_ROUTES` in `src/lib/seo/routes.ts`
   (path, priority, changeFrequency, metaKey). This feeds the sitemap and
   `llms.txt`. A page that must not be indexed (a campaign page, a thank-you
   page) gets `noindex: true` here AND `robots: { index: false }` in its own
   metadata; the checks fail if the two disagree.
3. **Navigation**: the hand-written arrays in `src/components/Header.tsx` and
   `Footer.tsx`, if the owner wants it in a menu. Ask which, if unclear.
4. **Words**: `meta.<metaKey>` plus the page's own copy, in every language
   (fragments under `messages/<locale>/_routes/` then `npm run merge`, else
   `messages/<locale>.json`). Follow `writing-web-copy`.
5. **Check**: `npm run check`, then `npm run build`.

## Remove

Reverse the list, and add one thing: a redirect in `next.config.ts` from the
old path to the closest surviving page. A removed page with no redirect is a
dead link for every visitor who saved it and every search result that still
lists it. Never redirect to the homepage when a related page exists.

## Move (change the address)

Treat as add + remove: new route and registry entry, old path redirected to
the new one, navigation and internal links updated in every language.

## Say to the owner

Name the page and where it appears in the menu. If you removed one, say that
visitors with the old address are sent to the page you chose, and name it.
