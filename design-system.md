# Café Lærke — Design System

Visual foundation for the website. Every page and component executes the brief at
`design-direction.md` and uses these tokens.

## Direction Reference
**Direction in one sentence:** A bright corner room seen from the window seat: warm paper white, the
green of the front door, light oak, and a menu you can read standing in the street on your phone.
**Consolidated from:** homepage + header/footer + menu page, as built and screenshotted on
2026-11-14 (desktop 1440 px, phone 390 px). No concept round: this is a demo built in one pass.

## Color Palette

| Token | Hex | Use |
|---|---|---|
| `--background` | `#FBF7F0` | Paper: page background |
| `--foreground` / `neutral-900` | `#2B2520` | Ink: body text |
| `neutral-950` | `#1C1815` | Headings |
| `neutral-800` / `neutral-700` | `#3D352E` / `#554A40` | Secondary text, small labels |
| `neutral-600` | `#6B5E52` | The quietest text allowed on paper or cream (AA) |
| `accent` | `#2F5D4A` | Door green: links, primary buttons, the name in the header, section rules |
| `accent-dark` | `#234737` | Button hover; the demo strip |
| `accent-light` | `#3E7660` | Spare |
| `oak` | `#E8D6B9` | 1 px borders, underline colour |
| `cream` | `#F3EADB` | Alternating bands, cards, the hours box, the footer |
| `cinnamon` | `#9E4F22` | Small "today" / "weekend" / gluten-free labels only |

`neutral-500` and lighter are for decoration only, never text.

## Typography
- **Fraunces** (`--font-display-family`, `font-display`) for h1–h6 at weight 400, optical size and
  SOFT axes on; letter-spacing −0.01em.
- **Figtree** (`--font-body-family`, `font-body`) for everything else; prices use `tabular-nums`.
- Both through `next/font/google` in `src/app/[locale]/layout.tsx`, latin + latin-ext.
- Scale: h1 2.75rem phone → 4.5rem desktop (home), 3rem → 4.5rem inner pages; h2 2.25–3rem;
  h3 1.5rem; body 17–20 px with `leading-relaxed`; small uppercase labels 0.875rem, tracking 0.14em.

## Spacing
Container `max-w-6xl` (72 rem) with `px-4` / `sm:px-6`. Sections 64–80 px apart (`py-16`/`sm:py-20`
or `mt-20`); cards pad 24–48 px.

## Component Patterns
- **Buttons:** pill (999 px radius), 12 × 24 px padding, 1.125rem text. Primary = green fill, white
  text; secondary = green 1 px outline. On the green band the button inverts to paper.
- **Cards and boxes:** 16–20 px radius, 1 px oak border or cream fill, no shadows (the mobile menu
  panel is the one shadow).
- **Photos:** rounded 16–20 px, `object-cover` at fixed aspect ratios (4/3, 3/2, hero 5/6 on desktop).
- **Menu list:** name (semibold) + one-line description, price right-aligned in tabular figures,
  oak dividers, a 2 px green rule under each section heading.
- **Facts row:** 2 px green top rule, title + one sentence.
- **Demo strip:** `aside` in `accent-dark` at the very top of every page.
- **Header:** name in Fraunces + uppercase tagline; desktop nav pills; phone menu is a `<details>`
  disclosure (no JavaScript).

## Interaction Patterns
Colour transitions on hover only; `focus-visible` 2 px outline in green (white on green fills). No
scroll animations. Smooth scrolling only without `prefers-reduced-motion` (template default).

## CSS Custom Properties Reference
See `src/app/globals.css` (`:root` and `@theme inline`): `--background`, `--foreground`,
`--color-neutral-50…950`, `--color-accent`, `--color-accent-light`, `--color-accent-dark`,
`--color-oak`, `--color-cream`, `--color-cinnamon`, `--font-display`, `--font-body`, `--font-mono`.

## Drift Checks
- **Identity test:** if the site used a dark, high-contrast palette or black food photography, it
  would be a cocktail bar, not this café.
- **Cautions:** see `design-direction.md`'s site-specific cautions — reviewers check built pages
  against them.
