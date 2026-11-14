# URL Inventory

Complete list of URLs discovered during the Step 1 old-site crawl. Consumed by the `redirect-mapping` skill in Step 4 so it doesn't have to re-crawl.

## Schema

```
### Old site: https://oldsite.example/

**Crawled:** YYYY-MM-DDThh:mm
**Source:** homepage nav + sitemap.xml + internal link discovery

## URLs

| URL | Category | Notes |
|-----|----------|-------|
| https://oldsite.example/ | Homepage | Primary entry point |
| https://oldsite.example/about | About | |
| https://oldsite.example/services/welding | Service detail | Flagship service |
| ... | ... | ... |
```

**Replicate mode** (`/replicate`): the `site-replicator` agent writes the same table with three extra columns — a backticked leading-slash **Path** (`` `/about` ``), **Status** and **Indexable/Class** — and one row per dropped URL too. The backticked path is the form `verify:source` check 8 harvests, which turns that check into a real completeness proof against `redirects.md`.

**Category values:** `Homepage`, `About`, `Services hub`, `Service detail`, `Cases listing`, `Case detail`, `Customers`, `Gallery`, `Contact`, `Legal`, `Blog`, `Job`, `Documentation`, `Documentation index`, `Asset`, `Dynamic/query`, `Redirect` (the original already 301s it), `External` (another host, no redirect), `Admin/system` (no redirect), `Dead/broken` (no redirect), `Other` (only as `site-capture.mjs report` writes it when nothing matched — reclassify by hand).

**Generated, not typed.** `site-capture.mjs report --write` renders this file from `.redesign-state/crawl/manifest.json` in both modes; the agent reviews rows (categories, notes), it does not transcribe URLs.

`Documentation` / `Documentation index` exist because on a docs-heavy site they are the *majority* of URLs, and the closed vocabulary previously forced them into `Service detail` — which hands Step 4 a false redirect map, pointing reference pages at commercial service pages. Measured on a real crawl: 152 documentation URLs against 9 commercial pages.

---

(No inventory recorded yet. The `brand-intelligence` agent writes here during Step 1.)
