---
name: news-and-cases
description: Use when the owner wants to add, finish or improve a customer case, reference, project story or news post, or asks which project to feature. Covers what makes a case believable, the facts to collect before writing, the three-part shape, and how a new case or post is wired into this site. Not for general page text (writing-web-copy).
---

# Cases and news that a buyer believes

A case is evidence, not a success story. It answers one question: *have you
solved a problem like mine, for a company like mine, and can you prove it?*
The story has the customer as the hero and a number as the punchline. Miss
the story and it is a spec sheet; miss the number and it is a brochure.

## Collect before writing (ask in one short batch)

- Customer name and industry, and whether it may be named publicly.
- The problem in the customer's words, and what it cost them.
- What was done, specifically: process, material, tolerance, volume, time.
- The result as a number: percent, weeks, parts per year, defects, cost.
- One sentence the customer would sign off on, if a quote is wanted.
- Photos of the part or the work, if any exist.

Never invent any of these. A missing number becomes a question to the
owner, not an estimate.

## Shape (each in every language, written natively)

1. **Challenge** — two or three sentences, the customer's situation.
2. **Approach** — what this company did and why that choice.
3. **Result** — the number first, then what it meant for the customer.

Title: customer or part plus the outcome ("Velux: from 6 to 2 weeks lead time").

## Wiring on this site

- The slug list is in `src/lib/seo/dynamic-routes.ts` (`getCaseSlugs`,
  and the equivalent for news if the site has it). Add the slug there.
- The copy goes under the case or news namespace in every language's
  messages (fragments in `messages/<locale>/_routes/` then `npm run merge`,
  else `messages/<locale>.json`). A slug without copy in every language
  fails the build on purpose.
- Images follow `new-photo`; an `articleSchema` from
  `src/lib/seo/structured-data.ts` belongs on a news post.
- Listing pages and the sitemap read from the slug list; nothing else to
  register.

## Editing the messages files

Change JSON with the file-edit tool, one entry at a time. Never regenerate a
messages file with a script: it re-serialises the whole file, turns escaped
characters and spacing into a page-long diff, and the owner's change list
then reads "everything changed". A blown-up file is reverted, not committed.
