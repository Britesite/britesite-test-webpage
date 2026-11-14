# Image Requests

Authoritative manifest of image-generation requests. Slots resolved by reuse, authored artwork or client-supplied evidence do not need generation rows. One row per image. Written by the `web-designer` during Step 6 page builds and reconciled by `/generate-media-prompts`.

**This file is the source of truth for image generation.** Code markers of the form `[NEEDS:image IMG-<id>]` are pointers — they reference a row here by ID but do NOT duplicate the prompt. A marker without a matching row is a pipeline error; `/generate-media-prompts` resolves this by drafting the missing row.

**How this file is used:**

1. The web-designer inspects the slot, copy and responsive layout, considers permitted reuse, and writes a row when generation is the appropriate solution.
2. The operator or authorized image tool uses the **Prompt**, applicable exclusions, reference assets and **Generation settings**, then installs the result at the **Target slot** path.
3. On install, update **Status** to `installed` and fill **Installed path**. Installation does not imply visual acceptance.
4. The web-designer wires the asset into the intended image/background, inspects desktop and mobile crops, and records **Fit review** against the row's criteria. Fix crop/layout before regenerating a suitable asset.
5. `/generate-media-prompts` reconciles slots, markers, requests, files and actual usage, and refreshes requests affected by layout or subject changes.

**Row schema:** the installed plugin’s `media-prompting` skill owns the schema. It includes purpose, actual layout/crop, references, fit criteria and the portable prompt; no P-code is required for schema 2.

**Status lifecycle:** `pending` (row written, no asset yet) → `generated` (image exists locally but not installed into the repo) → `installed` (asset at target path, referenced by code) → `rejected` (retired; ID stays retired for archaeology, don't reuse).

**ID convention:** `IMG-<route-slug>-<section>-<nnn>`. Route slugs: `home`, `about`, `contact`, `services-<service>`, `cases-<case>`, `jobs`, `news`, `legal-privacy`, `legal-cookies`. Section labels are free-form but consistent within a route (`hero`, `team-portrait`, `process-step-1`, `testimonial-background`, …).

**Summary at Step 7:** the content-audit step includes an `IMAGE_REQUESTS.md` summary — counts by status, any rows with `Rights / privacy notes` flagged for client decision, any orphan markers reconciliation surfaced.

---

## Requests

*(No image requests yet. The web-designer writes rows here during Step 6 page builds. To seed manually, copy the schema from the installed `media-prompting` skill.)*
