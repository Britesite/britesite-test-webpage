# Run-State

Ephemeral per-project state shared across pipeline phases and terminals. Committed to the repo so `/redesign` can resume across sessions and review loops running in separate terminals can deliver findings back to the orchestrator.

## Files

| File | Writer | Reader | Purpose |
|------|--------|--------|---------|
| `decisions.md` | `/redesign` orchestrator | Humans + orchestrator on resume | Append-only log of orchestrator choices (which strategy selected at 5.1, which revisions applied after Phase 0, which review findings accepted/deferred, which `[NEEDS:]` drafted vs. escalated). Each entry is one timestamped line. |
| `review-findings.md` | `/review-architect`, `/review-customer`, `/review-a11y` | `/redesign` orchestrator between phases | Append-only queue of review findings. Each entry carries: reviewer, severity, blocking?, page/file, one-line quote, suggested fix. Orchestrator drains and clears this between phases. |
| `compliance-log.md` | `web-designer` agent (Phase 3 self-check) | `/redesign` orchestrator after each page build | Structured pass/fail results for each page against its direction brief. Unjustified FAILs block the page from being marked done. |
| `url-inventory.md` | `brand-intelligence` agent (Step 1); `site-replicator` agent (`/replicate` R2, adds a backticked `Path` column) | `redirect-mapping` skill (Step 4); `verify-source` check 8 | Complete URL list discovered during the old-site crawl. Feeds Step 4 so it doesn't have to re-crawl. |
| `pipeline-mode` | `/replicate` Step R0 | `pipeline-state.mjs`, `gate.mjs`, the site's `verify-source.mjs` / `verify-delivery.mjs` / `state-fingerprint.mjs`, the a11y, browser-qa and seo agents' `## Replicate mode` sections | **The pipeline mode marker.** One line: `redesign` or `replicate`. **Absent = redesign** (every replicate branch is inert on an existing site). An unrecognised value is an error, never a default — a typo'd marker silently running redesign rules against a clone is the failure this contract exists to prevent. In replicate mode the site is a **mirror** of the original (`src/mirror/`, `public/_mirror/`): the review lanes are a11y, browser-qa and seo, the image-slot gate checks do not apply, and check 13 is browser-qa's fidelity verdict. Two implementations, one contract: `plugin/scripts/lib/redesign-state.mjs` (`readPipelineMode`) and `template/scripts/pipeline-mode.mjs`. |
| `crawl/manifest.json`, `crawl/<slug>.json` | `site-capture.mjs` (`/replicate` R2) | `site-mirror.mjs capture` (the page list), `mirror-install.mjs` (locales, alternates, the origin's own redirects), `verify-source` / `verify-delivery` (the crawl corpus that exempts the original's own copy and titles), `pipeline-state.mjs` | The crawl: every URL classified, and one JSON per page with its verbatim copy and metadata. |
| `mirror/<path>/index.html`, `mirror/_mirror/**`, `mirror/mirror-manifest.json` | `site-mirror.mjs capture` (`/replicate` R4) | `site-mirror.mjs verify`, `scripts/mirror-install.mjs` (copies the pages into `src/mirror/pages/` and the assets into `public/_mirror/`), `pipeline-state.mjs` | The mirror: each page's rendered DOM with its class names, every stylesheet, asset and linked same-host file localised path-preserving, trackers and the consent banner stripped, kept scripts and provenance listed in the manifest. |
| `walk.json` | `site-mirror.mjs walk` (`/replicate` R5) | `gate.mjs` check 14, browser-qa (`/replicate` R6) | The behaviour walk of the served build: every internal link followed, every linked file fetched, menu and lightbox opened, every failed request and console error recorded, with the plugin version that ran it. The mechanical floor under browser-qa; a failure in it is a capture or hosting defect. Not committed. |
| `reference/<slug>-<width>.png` | `site-capture.mjs extract` (`/replicate` R2) | `site-mirror.mjs verify`, the R5 compare loop, browser-qa (`site-capture.mjs compare`) | Full-page renders of the original at 375/768/1440/1920 — the frozen fidelity standard every compare measures the mirror against. Committed. |

## Conventions

- **Append-only by default.** Readers may mark entries as "handled" by appending a status line below the entry, but do not delete historical content.
- **Dated entries.** Every new entry begins with an ISO date line (`### 2026-04-22T13:15 — [topic]`).
- **Machine-readable where feasible.** Review findings and compliance results should follow the schema documented in each file's header so the orchestrator can parse without re-prompting.
- **Safe to delete between projects.** When starting a fresh redesign in the same repo, this directory can be cleared. Nothing here is load-bearing across projects.

## Why this exists

Before `.redesign-state/` existed, pipeline state lived in three unreliable places:

1. **Terminal stdout** — review findings from `/loop` terminals printed to the reviewer's own terminal and never reached the builder.
2. **Mutated skill files** — per-project state got written into reference skills, confusing the instruction-vs-state boundary.
3. **The orchestrator's context window** — which is wiped on restart and can't be read by parallel processes.

This directory fixes all three by making state a first-class, file-backed artifact.
