# Brief-Compliance Log

Structured pass/fail results from the `web-designer` agent's Phase 3 self-check. The `/redesign` orchestrator reads this after each page build and blocks pages with unjustified FAILs from being marked complete.

## Schema

Each entry is one page:

```
### YYYY-MM-DDThh:mm — [page route or component name]

| Check | Result | Quote / justification |
|-------|--------|-----------------------|
| T [strategy] | PASS / FAIL / JUSTIFIED | [quote from design-direction.md, or justification if JUSTIFIED] |
| C [strategy] | ... | ... |
| L [strategy] | ... | ... |
| P [strategy] | ... | ... |
| S [strategy] | ... | ... |
| D [strategy] | ... | ... |
| M [strategy] | ... | ... |
| Avoid list | ... | ... |
| Identity test | ... | ... |
| What we're moving away from | ... | ... |

**Overall:** pass / blocked-pending-rework / justified
```

## Orchestrator enforcement

After every page build, the orchestrator reads the most recent entry:

- **All PASS** → accept the page, proceed.
- **Any FAIL with no `JUSTIFIED` alongside** → reject; spawn `web-designer` again to rework.
- **Any FAIL marked `JUSTIFIED` with a reason** → accept if the justification references a concrete brand constraint that over-rides the brief. Log the acceptance in `decisions.md`.

A page without a compliance entry in this log is treated as not yet done.

---

(No entries recorded yet. The `web-designer` agent appends an entry as the final step of every page build.)
