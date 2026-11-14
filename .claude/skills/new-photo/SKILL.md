---
name: new-photo
description: Use when the owner sends a photo or asks to swap, add or remove an image anywhere on the site — hero, team, cases, services, logos. Covers where image files live, sizing, alt text in every language, and keeping the page's image settings intact. Not for text (writing-web-copy).
---

# Putting a photo on the site

## Receiving it

A message may end with a line like `[Attached photo: /mnt/uploads/…]`. That
is the file. Open it first and look at it: alt text and placement depend on
what is actually in the picture.

## Preparing it

- Save under `public/images/<role>/` (`hero`, `team`, `cases`, `services`,
  `facility`, `brand`) with a descriptive kebab-case name:
  `casting-hall-robot-cell.jpg`, not `IMG_2041.jpg`.
- Resize to at most 2000 px on the long edge, strip metadata. Use `sharp`
  from `node_modules` when present; otherwise copy as is. Where the site has
  it, `npm run images -- --write --max-edge 2000 public/images/<role>/<file>`
  does this for that one file and keeps its name. Always name the file: without
  one the command goes through every image on the site.
- A picture made by the image tool is the exception: copy it exactly as it
  is. The file carries the mark that says how it was made, and resizing or
  re-encoding drops it. (`npm run images` leaves such a file alone.)
- JPEG for photographs, PNG only for logos and cut-outs that need
  transparency. Never replace a file under `public/images/brand/` without the
  owner asking for a new logo in so many words.

## Placing it

- Keep the existing `next/image` props on the slot you replace: `sizes`,
  `priority`, width and height, `fill`. They were tuned for that spot; only
  the `src` and `alt` change.
- Alt text in every language, describing what is in the photo for someone
  who cannot see it ("Robotcelle i støbehallen med en operatør ved
  kontrolpanelet"), never keywords or the file name. Decorative images get an
  empty alt.
- A new slot (a photo where there was none) copies the nearest existing
  image markup on that page, so it inherits the site's sizing and styling.
- If `public/images/IMAGE_SLOTS.md` or `IMAGE_CATALOG.md` list the slot,
  update that row.

## Before saving

`npm run check`, then `npm run build` — a wrong path or a missing dimension
fails the build, not the page.
