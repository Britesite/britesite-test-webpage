# Review Findings Queue

Append-only queue of findings surfaced by the review agents (`architect`, `customer-perspective`, `accessibility-auditor`, `browser-qa`) plus the `seo` lane (`seo-auditor`, run inside Step 9). The `/redesign` orchestrator drains this file at phase boundaries and at the Step 9 final review pass. `/publish` reads it as part of the pre-publish gate.

**The `seo` lane runs inside Step 9 — see "SEO lane" below.** Each audit appends one `reviewer=seo` Run-log line with an `iter=` field; the auditor itself never reads this file, so writing its findings here cannot poison the next fresh audit.

## Run log

Every time a review lane runs, it appends ONE line to this section with the plugin version it ran against. This is how the orchestrator detects stale review passes on resumption — if the current plugin version is newer than the last run of a given lane, that lane is stale and must re-run before publish.

```
YYYY-MM-DDThh:mm — reviewer=<name> — plugin=<version> — scope=<routes/dimensions/all> — verdict=<N critical, M warning, K note>
```

Two lanes carry an extra per-page field the publish gate's check 13 reads: `customer` folds in `buyer=<page>:<yes|maybe|no>,...` (redesign mode), and `browser-qa` folds in `fidelity=<page>:<match|drift|miss>,...` (replicate mode — the worst `site-capture.mjs compare` verdict per page). Page labels are the route's slug as in the reference filenames — `home` for `/`, `services-smed` for `/services/smed` — without any locale prefix; the gate maps each `--core-pages` path through the same slug rule.

Example:

```
YYYY-MM-DDThh:mm — reviewer=architect         — plugin=<version> — scope=all — verdict=0 critical, 1 warning, 2 note
YYYY-MM-DDThh:mm — reviewer=customer          — plugin=<version> — scope=home,services,contact — verdict=1 warning, 3 note
YYYY-MM-DDThh:mm — reviewer=a11y              — plugin=<version> — scope=all — verdict=0 critical, 0 warning
YYYY-MM-DDThh:mm — reviewer=browser-qa        — plugin=<version> — scope=home,kontakt,ydelser,om-os,cookie-politik — verdict=1 critical, 0 warning, 2 note
YYYY-MM-DDThh:mm — reviewer=seo               — plugin=<version> — scope=all — verdict=2 critical, 1 high, 3 medium, 4 ongoing — iter=1
YYYY-MM-DDThh:mm — reviewer=seo               — plugin=<version> — scope=all — verdict=0 critical, 0 high, 3 medium, 4 ongoing — iter=2
```

The last `seo` line above is **converged** (0 critical, 0 high — only nits remain), which is what the publish gate's SEO check requires.

*(No review runs recorded yet.)*

<!-- LIVE RUN LOG — lane-record.mjs appends below this line. Keep real entries
     OUTSIDE any code fence: everything fenced above is documentation. -->

---

## Finding schema

Each finding is a single block. **Every field is non-optional in the structure** — use `n/a` if not applicable. The publish gate parses these fields, so schema drift breaks the gate.

```
### YYYY-MM-DDThh:mm — [reviewer] — [severity] — blocking:[yes|no]
**Where:** [file:line or page route]
**What:** [one-line description]
**Why:** [WCAG criterion / brief quote / buyer friction — cite the source]
**Suggested fix:** [concrete change]
**Status:** pending
**Reason:** n/a           *(required on deferred and rejected; n/a otherwise)*
**Publish-allowed:** n/a   *(required on deferred; `yes` or `no` — see publish-gate contract below)*
**Related findings:** none *(IDs of findings this duplicates or relates to)*
```

**Severity:** `critical` | `warning` | `note`
**Blocking:** `yes` (build halts until addressed) | `no`
**Status:** `pending` | `handled` | `deferred` | `rejected`

## Publish-gate contract

The orchestrator reads this file during Step 10 to compute the publish gate:

| Finding state | Publish gate |
|---------------|-------------|
| `status: pending` AND `blocking: yes` | **BLOCK** — must reach a terminal state before publish. |
| `status: deferred` AND `blocking: yes` | **BLOCK** — blocking findings cannot be indefinitely deferred. |
| `status: deferred` AND **`blocking: no`** AND `publish-allowed: yes` AND `reason` set | **ALLOW** — explicit deferral with a documented reason. The `blocking: no` qualifier is load-bearing: without it a finding that is deferred, blocking AND publish-allowed matched this row and the BLOCK row above it, and an orchestrator could pick either. `redesign.md` gate checks 4–5 are the authority and they fail a deferred blocker. |
| `status: deferred` AND `publish-allowed: no` | **BLOCK** — deferred but not cleared for publish. |
| `status: deferred` AND `publish-allowed` missing or empty | **BLOCK** — malformed deferral is treated as unsafe. |
| `status: handled` | ALLOW. |
| `status: rejected` AND `reason` set | ALLOW — but on `blocking: yes` findings the rejection reason must cite concrete evidence (see "Rejected criticals" below). |
| `status: rejected` AND `reason` missing | **BLOCK** — unjustified rejection is treated as unhandled. |

## Rejected criticals

A `blocking: yes` finding cannot be `status: rejected` without a substantive `reason:` that proves the reviewer was factually wrong (e.g., "architect cited missing hero photo but `design-direction.md` brief section 3.2 explicitly states hero may be type-only on legal pages — this is a legal page"). Vague reasons ("not needed," "will do later") do not clear the gate.

## Distinctiveness is always blocking

Any finding from `architect` citing a `design-direction.md` violation is `critical` and `blocking`, regardless of how the reviewer phrased it. Any `rendered-fidelity` finding from `browser-qa` whose severity is `critical` is also blocking. The orchestrator must treat these as build-halting.

## Stale-lane detection on resumption

When `/redesign` resumes on an existing project, it reads this file's Run log, compares each lane's last-run `plugin=<version>` to the current plugin version from `.claude-plugin/plugin.json`, and:

- If any Step 9 final-review lane's (`architect`, `customer`, `a11y`, `browser-qa`) last run is OLDER than the current plugin version → that lane is stale → Step 9 re-enters for that lane before publish.
- If a Step 9 lane has no run-log entry at all → that lane has never run → Step 9 re-enters for that lane.
- The `seo` lane has a stricter test — see "SEO lane" below.
- If all lanes ran on the current plugin version AND the `seo` lane converged AND no finding is in a blocking state → the gate is green and Step 11 may proceed.

## SEO lane (Step 9)

The `seo` lane is the `seo-auditor` run as a lane of the Step 9 final review — spawned fresh, with a neutral prompt, once for the review (`iter=1`), once for the bounded re-review (`iter=2`), and at most once more if the re-review is not converged (`iter=3`). Its run-log line carries that `iter=` field and a four-bucket verdict (`critical, high, medium, ongoing`). It is satisfied for resumption/gate purposes only when **both**:

1. **Fresh** — its most recent run-log line is `plugin=<current version>`, and
2. **Converged** — that line's verdict shows `0 critical, 0 high` (only nits — medium/ongoing — remain).

If the `seo` lane is stale, missing, or its latest verdict still carries any critical/high, the orchestrator **re-enters Step 9** before publish, and the publish gate's SEO check (check 10) FAILs.

The auditor is never shown the queue, prior audits or the fixer's notes. Its Critical/High findings are written here by the orchestrator like any other lane's (`reviewer: seo`, `blocking: yes` for Critical) and routed to the same batched fix pass; whatever is still Critical/High after the last audit stays `pending` and blocks the gate.

---

*(No findings recorded yet. Review commands write here between their `/loop` cycles. Each finding uses the schema above verbatim.)*
