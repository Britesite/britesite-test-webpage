# Image Slots

<!-- DERIVATION METADATA — do not edit by hand; the /redesign orchestrator maintains this block -->
<!--
derived-at: <ISO timestamp or "not yet derived">
plugin-version: <value from .claude-plugin/plugin.json when derived>
schema-version: 1
inputs:
  design-direction-hash: <first 12 chars of sha256 of design-direction.md at derivation time>
  site-plan-hash:        <first 12 chars of sha256 of SITE_PLAN_TEMPLATE.md at derivation time>
-->
<!-- Replicate mode adds `mode: replicate` and an informational `crawl-manifest-hash:` line (not gated) — the inventory is then derived from the crawl by `site-capture.mjs slots`, one slot per image the original renders, every row terminal (`catalog-reuse` = downloaded original, `justified-none` = unreachable, client-owed). -->

Authoritative inventory of every image slot the committed design direction requires, enumerated per route. **This is the brief-derived binding list** — it exists so missing imagery can't hide in the gap between "web-designer forgot a marker" and "no one noticed." Every row here must resolve to a concrete state before a page can pass its Phase 3 compliance check.

## Freshness — resumption check contract

On any `/redesign` resumption, the orchestrator re-computes the current hashes of `design-direction.md` and `SITE_PLAN_TEMPLATE.md` and compares them against the HTML-comment `inputs:` block above. If any differ, or the block is missing, or `derived-at: not yet derived` / empty, **this file is stale** and must be re-derived before Step 6 can proceed. An existing file that is empty of slots or was populated without a derivation record does NOT count as complete — the empty template we ship with has `not yet derived` in the metadata on purpose, so existence alone is insufficient.

Hash computation: `sha256sum <path> | cut -c1-12` — short hashes are stable enough for human inspection and change detection. The plugin version comes from `.claude-plugin/plugin.json` `"version"` field.

## Who writes this

Derived once from `design-direction.md` (the legacy committed P-strategy and attribute→visual translation table, or the schema-2 brief's descriptive imagery clauses) and `SITE_PLAN_TEMPLATE.md` (which pages exist, their purpose) at the **end of Step 5.2** (tokenization). The web-designer then updates the **Resolution** field on each slot during Step 6 page builds.

On `/redesign` resumption: if `design-direction.md` exists but this file doesn't, the orchestrator derives it as a migration step before continuing. That covers projects that started before this artifact existed.

## Schema

One section per route, one row per required slot. Fields are:

```markdown
## <route slug> — <route description>

### SLOT-<route>-<section>-<nnn>

- **Section:** <hero | team-teaser | services-section | about-story | … free-form section label>
- **Role:** hero | content | card | background | decorative
- **Photography commitment:** <quote the brief's imagery requirement in prose; legacy runs may retain their P-strategy field>
- **Why required:** <one-line reason the brief mandates imagery here>
- **Resolution:** <pending | catalog-reuse | manifest-row | image-present | drawn-in-code | justified-none>
  - *catalog-reuse:* `public/images/<path>` from `IMAGE_CATALOG.md`, referenced through the component's actual image path
  - *manifest-row:* `IMG-<id>` in `public/images/IMAGE_REQUESTS.md`
  - *image-present:* `public/images/<path>` (file installed and referenced from source) — the reference may be `next/image`, a CSS background, a data-driven image path or another actual component path. It is also the state for a **motion asset**: `public/video/<path>`, installed and referenced from a `<video>`/`<source>`. The evidence the state guarantees (a real file at the named path, referenced from source) is unchanged; only the referencing API differs. Note the deviation on the row.
  - *drawn-in-code:* `src/components/<Name>.tsx` — the artwork is authored in that component, as an inline `<svg>` drawing or a `<pre>` typeset specimen. There is no file in `public/images/` and no manifest row; the source *is* the asset. Diagrammatic briefs commonly define imagery as both kinds, and a specimen doing a hero's job is exactly as load-bearing as a drawing.
  - *justified-none:* one-line brand-constraint reason that references `design-direction.md` or an explicit brief exception. "Client hasn't provided a photo yet" is NOT a justified-none — that's asset-pending, which resolves to `manifest-row`.
- **Notes:** <optional — mobile crop behavior, rights caveats, locale variants, etc.>
```

For a `manifest-row`, use the media-prompting request schema to record the slot's purpose/message, actual layout and crop, references, and fit criteria; these fields describe why the image belongs here and how it will be judged.

## Resolution lifecycle

A slot begins `pending` when derived from the brief. It progresses through exactly one of:

- **`catalog-reuse`** — an existing catalog image fits. The web-designer references it through the component's actual image path and updates this row. No manifest row needed.
- **`manifest-row`** — a new image is needed. The web-designer writes an `IMG-...` row in `IMAGE_REQUESTS.md` (per the media-prompting skill), inserts a `[NEEDS:image IMG-...]` marker in the component, and updates this row to point at the manifest ID. Becomes `image-present` when an authorized operator or image tool generates and installs the image.
- **`image-present`** — a file exists at the target path and the component's actual image path references it (`next/image`, CSS background, data-driven path or another appropriate implementation). Terminal state.
- **`drawn-in-code`** — the web-designer authored the artwork in a component — an inline SVG drawing or a typeset code specimen — rather than requesting a raster, per the `schematic-drawing` skill's checklist gate. Terminal state. This is the **normal** resolution on a legacy diagrammatic brief (P5/P7/P8) or a schema-2 brief that explicitly commits to authored drawings/specimens, not an exception: when a company has nothing to photograph, drawing the thing *is* the imagery strategy, and routing those slots through `manifest-row` would generate raster prompts for artwork the brief's own Avoid list bans. Cite the component path. **Misusing this is a critical audit failure** in the same way `justified-none` is — a row claiming a drawing that isn't there, or an SVG that doesn't depict the specific artifact the brief names, is an unresolved slot wearing a terminal label.
- **`justified-none`** — the slot is deliberately not filled, and the reason is legitimate (specific brand constraint citing the brief, not asset-pending). Terminal state. **Misusing this is a critical audit failure** — the architect absence audit cross-checks `justified-none` reasons and flags rubber-stamp justifications. On a diagrammatic brief, reaching for this to escape an audit is the tell: the slot almost certainly wanted `drawn-in-code`, and declaring the imagery deliberately absent is what makes the absence audit vacuous on exactly the sites where imagery carries the most weight.

### Two rules about inherited assets

**1. Every asset the catalog flags as available terminates in a slot — or in an explicit `justified-none`.** Not in a paragraph. If `IMAGE_CATALOG.md` says a thing exists and could be reused, it is either claimed by a row here or deliberately declined on a row here. Prose describing an available asset is invisible to every enforcement mechanism listed below: none of them read paragraphs, so an asset mentioned only in prose is one nobody is accountable for. This is how a client's own facility film — the strongest single asset on the site — got left out of a rebuild while three separate documents mentioned it.

**2. A brief ruling that bans a USE does not ban the ASSET.** Design briefs rule on uses: "no autoplaying background video", "no photograph in the hero", "never a section lead". When you carry such a ruling into a slot row, carry its scope with it. Flattening "not as an autoplaying hero" into "do not use this file" reads like faithful compliance and silently discards an asset the brief may permit elsewhere — often in the very same sentence, which typically names the permitted alternative ("…it belongs on the gallery as an explicit click-to-play item"). If a ruling names an alternative use, that alternative is a slot, and someone has to build it. Quote the ruling verbatim on the row rather than paraphrasing it; paraphrase is where the scope gets lost.

## How this is enforced

- **Web-designer Phase 3 compliance log** — every page's compliance entry includes a row per slot in that route: "SLOT-home-hero-001: <resolution>". Any `pending` slot = Phase 3 FAIL unless the row is demoted to `justified-none` with a real brand-constraint reason.
- **Architect absence audit** — during review, the architect reads this file and verifies every non-`justified-none` slot resolves to catalog-reuse (file exists and is referenced), manifest-row (row exists in `IMAGE_REQUESTS.md`), image-present (file + actual source reference), or drawn-in-code (component exists and contains authored artwork — an inline `<svg>` drawing or a `<pre>` typeset specimen — depicting the specific artifact the brief names). Unresolved = Critical distinctiveness finding, blocking.
- **`verify:source` check 6** — deterministic. Fails on any `Resolution: pending`, on a `drawn-in-code` row whose component is missing or contains neither an inline `<svg>` nor a `<pre>` specimen, and on any Resolution naming a state outside this schema. This is what stops `drawn-in-code` becoming a second rubber stamp: every other terminal state cites evidence that can be checked, and so must this one.
- **browser-qa rendered-fidelity check** — at phase boundaries and final review, browser-qa cross-references rendered pages against this file. A route with an unresolved hero slot AND a visibly empty hero band = Critical rendered-fidelity finding.
- **`/generate-media-prompts`** — reconciles this file, the manifest, markers, and installed files four-way. Any slot not accounted for across all four is surfaced.

## Deriving the initial slot list

When the orchestrator derives this file at end of Step 5.2 (or on resumption if missing), it walks:

1. For each route in `SITE_PLAN_TEMPLATE.md`, identify required sections (hero, service list, team section, case studies, about story, contact form, etc.) using the `page-design` references.
2. On a legacy run, intersect with the committed P-strategy in `design-direction.md`; if it demands imagery (P1–P8), the hero is a slot. On a schema-2 run, use the brief's descriptive Photography/Shape passages and explicit imagery clauses. In either run, if the brief's attribute→visual translation says "staff portraits are first-class page elements," team sections are slots; if it commits to abstract texture or another visual treatment, record the sections it actually requires.
3. For each slot, record the triggering brief quote verbatim in `Photography commitment` (legacy runs may retain the recorded `P-strategy` field).
4. Every slot starts `Resolution: pending`.
5. Output this file grouped by route, in build-phase order (Phase 0 shared components first, then Phase 1 core pages, etc.).

**A diagrammatic brief still has slots — they just resolve differently.** On a legacy run, if the committed P-strategy is P5/P7/P8, or on any run if the brief says imagery means drawings and typographic specimens rather than photographs, do **not** conclude the site has no image slots. Enumerate them exactly as you would for a photographic brief; they will resolve `drawn-in-code` instead of `manifest-row`. Skipping enumeration because "there are no photos" is the failure this file exists to prevent: it leaves the architect's absence audit and the publish gate's slot checks with nothing to verify, so they pass by having no work to do, on precisely the sites where the drawings *are* the identity.

**The site plan's own Images column is a Step 3 guess, not the answer.** On legacy runs it is written before the P-strategy is committed at Step 5.1, so "None" in that column reliably means *no photographs* — true on a diagrammatic brief, and an answer to a different question than this file asks. On schema-2 runs, use the later descriptive brief and selected concept. Where the column and `design-direction.md` disagree, the brief is the later and more specific commitment and wins. Record the disagreement per-slot rather than resolving it silently, or a reviewer reading only the plan will take a correct inventory for a wrong one.

**Named artifacts are a vocabulary, not a per-page mandate.** When a brief lists the things a diagram may depict, that list constrains *what fills a slot*, not *how many slots exist*. Deriving one slot per named artifact manufactures work the brief never asked for.

**Do not guess imagery requirements.** On legacy runs, if a route's P-strategy commitment doesn't clearly require imagery for a section, don't invent a slot; on schema-2 runs, use the explicit descriptive imagery clauses and selected concept. Conversely, if the brief explicitly names a slot, it's required regardless of whether the web-designer would have added one on their own.

## Interaction with `IMAGE_CATALOG.md` and `IMAGE_REQUESTS.md`

- `IMAGE_CATALOG.md` — what's already on disk. Input. A slot can resolve to `catalog-reuse` by referencing a catalog path.
- `IMAGE_REQUESTS.md` — prompts for images not yet generated. Output destination when a slot resolves to `manifest-row`.
- `IMAGE_SLOTS.md` — **what's required.** The binding list the other two are reconciled against. If a slot isn't in either of the other files AND isn't `justified-none`, that's an audit failure.

---

## Slots

*(Populated by the `/redesign` orchestrator after Step 5.2 completes, or manually derived from `design-direction.md` + `SITE_PLAN_TEMPLATE.md` if bootstrapping a project that predates this artifact. Until populated AND the derivation metadata is filled, this section is empty and the file is not enforcing — the resumption-check's hash gate catches this condition.)*

## Schema-2 design evidence

For schema-2 redesign runs, add these fields to every real slot (not only essential slots):

- **Route:** exact site-relative route from the design manifest, such as `/` or `/services`
- **Essential for design:** true or false
- **Asset paths:** comma-separated site-relative actual image/font/component paths; empty while pending
- **Provenance:** authentic catalog source, licensed illustrative source, or authored illustration; never invented proof
- **Owner:** the responsible route/lead or client
- **Alternative rationale:** required for a deliberate composition using `justified-none`

The orchestrator runs `design-review.mjs sync-slots --site .` to derive the machine slot view in the design manifest. Builders return changes; they do not race to edit this file. A `manifest-row` is pending work for an essential slot. Only a rendered art-director pass can accept a deliberate alternative composition before freeze.

For schema 2, derive slots from the site plan and the selected concept's named essential assets. References above to a P-strategy mean the prose imagery commitment in `design-direction.md`; no strategy code is required or invented.
