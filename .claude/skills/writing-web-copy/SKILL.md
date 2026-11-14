---
name: writing-web-copy
description: Use whenever new or rewritten text goes on the site — a headline, a paragraph, a page title or description, a new service or product blurb — and whenever the owner asks to be "found on Google", "rank for", "show up in ChatGPT", or "improve SEO". Covers how text on this site reaches search engines and AI assistants, the per-language rule, and the checks before saving. Not for photos (new-photo) or whole new pages (adding-a-page).
---

# Writing text that gets found

Search engines and AI assistants read the same words visitors do. Good copy is
specific, answers a question in its first sentence, and says the same thing in
every language. Nothing here is a trick; it is writing that machines can quote.

## Where the machine-facing text comes from

- Page title and description: the `meta.<key>` entry in every language's
  messages. `buildMetadata` in `src/lib/seo/metadata.ts` turns it into the
  title tag, description, canonical and Open Graph — never write those tags by
  hand.
- Structured data: the builders in `src/lib/seo/structured-data.ts`
  (`organizationSchema`, `serviceSchema`, `articleSchema`,
  `contactPageSchema`) rendered through `JsonLd`. When the text is an event,
  article, product or service, the matching builder belongs on the page.
- The visible copy itself: `messages/<locale>.json`, or the fragment under
  `messages/<locale>/_routes/` followed by `npm run merge` when that folder
  exists.

## Rules that move the needle

1. **Title**: 50–60 characters, the page's subject first, the company name
   last. One `h1` per page, and it says the same thing as the title.
2. **Description**: 120–155 characters, a full sentence a person would click.
   Say what the page offers and for whom; no slogans.
3. **First sentence answers the question** the page exists for ("We cast
   zinc parts from 0.5 g to 2 kg for…"). Facts, numbers, places, names —
   those are what get quoted.
4. **Headings are questions or claims**, not labels: "How fast can we
   deliver?" beats "Delivery".
5. **Every language, idiomatically.** A change of meaning goes into all
   languages, written as a native would say it. A fix to one language stays in
   that language.
6. **Never invent** a figure, a certification, a customer or a date. Ask.
7. **Link the page to its neighbours** in the text where it reads naturally
   (service → case, case → contact).

## Before saving

- Every edited JSON file parses; the same keys exist in every language.
- Title and description lengths are inside the ranges above in each language.
- If a builder from `structured-data.ts` applies, the page renders it.
- The text says nothing the owner has not confirmed.

## Editing the messages files

Change JSON with the file-edit tool, one entry at a time. Never regenerate a
messages file with a script: it re-serialises the whole file, turns escaped
characters and spacing into a page-long diff, and the owner's change list
then reads "everything changed". A blown-up file is reverted, not committed.
