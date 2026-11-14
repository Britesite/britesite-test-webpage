# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Corporate website for **Café Lærke** — Kvartercafé med morgenmad, frokost og kage bagt samme morgen. This is a full rebuild/redesign migrating from an old site to a modern Next.js application.

- **Old site domain:** {{OLD_SITE_DOMAIN}}
- **Tagline:** Kaffe, kage og en god plads ved vinduet
- **New site domain:** britesite-test-webpage.vercel.app

The site is multilingual (da) and serves as both a marketing site and technical resource for B2B customers.

### Key site sections
- **Services** — core service/product categories
- **Cases** — customer case studies
- **About Us** — company story, team, certifications
- **Contact** — inquiry forms, location, direct contacts
- **News** — blog/updates (when content pipeline exists)
- **Jobs** — career opportunities

## Redesign Pipeline

The redesign pipeline lives in the **kit**, not in this repo. Run `/redesign` and the installed plugin drives it end to end.

`PIPELINE.md` and `FLOW_DIAGRAM.md` are reference docs **in the kit repository** — they are deliberately not copied into a site, because a site should never need them to be built. If you want to read or change how the pipeline works, do it there; changing anything here cannot affect it.

Key entry points:
- `/redesign` — runs the full pipeline (brand → plan → build → review → publish)
- `/publish` — build + commit + push to deploy
- `/review-architect`, `/review-customer`, `/review-a11y` — review lanes; `/redesign`
  spawns all three concurrently at each build phase boundary, and they can also be
  invoked directly on demand
- `/review-browser` — rendered QA against a running dev server (phase-gated)

## Site guide

`SITE_GUIDE.md` is generated from this repository by `npm run site-guide` and is the first thing
to read before editing: pages, menus, translations (fragments!), contact details, open markers,
security policy. Never hand-edit it; regenerate after adding or removing a page, changing menus,
or moving contact details.

## Tech Stack

- **Framework:** Next.js 16 with App Router (`src/app/`)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 (via `@tailwindcss/postcss`)
- **React:** v19 with React Compiler enabled (`reactCompiler: true` in next.config.ts)
- **Consent and analytics:** `src/lib/site-consent.ts` (`SITE_CONSENT_PURPOSES`) declares the non-essential purposes the site uses. Empty (default): no cookie banner, no settings link, no analytics. Listing `"analytics"` turns on the banner, the footer `CookieSettingsButton`, and Vercel Analytics (`@vercel/analytics/next`) through `AnalyticsGate`, which loads only after consent. `verify:source` check 28 keeps the list and the code in agreement (see legal-compliance skill)
- **Runtime:** Node.js 22+, npm

## Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run start        # Serve production build
npm run lint         # oxlint (.oxlintrc.json); under a second
npm run check        # fast pre-build gate: messages JSON, locale parity, fragment drift, types
npm run site-guide   # regenerate SITE_GUIDE.md
npm run images       # list images in public/ over 2400 px or 1000 KB; add `-- --write` to shrink them in place
```

## Dependency security

Dependabot alerts, security updates and the dependency graph are enabled on the repo, and
`.github/dependabot.yml` restricts Dependabot to security PRs — there is deliberately no weekly
version-bump queue for the owner to triage.

Those security PRs **merge themselves**. `.github/workflows/dependabot-build.yml` checks out PR code
with read-only credentials and runs `npm ci && npm run build`; a separate metadata job verifies the
Dependabot-authored commits without checking out or executing them. Only after both jobs succeed,
`.github/workflows/dependabot-auto-merge.yml` runs from the trusted default branch and proves the PR's
current head is the exact SHA that passed, without executing its code. The live branch only admits
the editing agent's publisher App, so the workflow hands that SHA to the agent
(`vars.WEBSITE_AGENT_ORIGIN`, authenticated by a GitHub OIDC token); the agent re-checks that it is a
single GitHub-signed Dependabot commit directly on live and fast-forwards live onto it. A site the
agent does not manage is merged by the workflow itself. Vercel then deploys. Scheduled version-update PRs are disabled by `open-pull-requests-limit: 0`, and major
security bumps fail closed and stay open. The site must therefore build with **no environment
variables set**, which is worth remembering before moving any `process.env` read to module scope.

The one thing it will not do is merge a **major** bump: a major can carry a breaking change that
still compiles, and nobody is reading the diff. Those stay open, labelled `dependabot-major`, and
the kit's weekly **Fleet status** run (`.github/workflows/fleet-status.yml` in the kit repo) goes
red and lists them, together with any security PR whose build or landing failed and any fixable
alert still open after three days. Notification mail is off at the account level, so that red run
is what surfaces them.

**An open-alert count is not a vulnerability count.** GitHub only closes an alert when the
dependency graph re-parses the lockfile. If the graph is off or stale the alert freezes against
whatever version was installed the day it was filed, and GitHub offers no way to force a rescan —
so the badge can read 60 while nothing installed is actually vulnerable. Never quote that number,
least of all to a non-technical owner, without checking the real state first:

```bash
npm audit                                    # 0 vulnerabilities = nothing installed is vulnerable
gh api repos/{owner}/{repo}/dependabot/alerts --paginate \
  -q '.[] | select(.state=="open") | [.dependency.package.name,
       .security_vulnerability.first_patched_version.identifier] | @tsv'
```

Compare each `first_patched_version` against the resolved version in `package-lock.json`. Lock at
or above it → that alert is stale, not a finding. To check whether the graph itself is alive:

```bash
gh api repos/{owner}/{repo}/dependency-graph/compare/HEAD~1...HEAD   # 403 = graph disabled
```

A 403 means alerts will never self-clear. Re-run
`gh api -X PUT repos/{owner}/{repo}/automated-security-fixes`, which turns the graph back on as a
side effect, then give it a few minutes.

## Architecture

### App Router structure
All routes live under `src/app/`. Uses Next.js App Router conventions:
- `layout.tsx` — root layout, wraps all pages
- `page.tsx` — route page component
- `error.tsx` — error boundary
- *(no `loading.tsx` — a route-level Suspense boundary hides prerendered content from no-JS visitors; `verify:source` check 12 fails the build on it)*
- Route groups `(groupName)/` for organizational grouping without affecting URL

### Path alias
`@/*` maps to `./src/*` — use this for all imports (e.g., `@/components/Header`).

### Styling approach
Tailwind CSS v4 is configured through PostCSS (`postcss.config.mjs`). Theme tokens are defined as CSS custom properties in `src/app/globals.css` using `@theme inline`. No `tailwind.config.ts` file — Tailwind v4 uses CSS-first configuration.

### Multilingual routing
Uses `next-intl` for i18n. Locales are defined in `src/i18n/routing.ts`. Translation files live in `messages/{locale}.json`. Proxy in `src/proxy.ts` handles locale detection and routing (Next.js 16 renamed `middleware.ts` to `proxy.ts`).

## Conventions

- Server Components by default; add `"use client"` only when needed (event handlers, hooks, browser APIs)
- Use `next/image` for all images (optimization, lazy loading, responsive)
- Use `next/link` for internal navigation (or the locale-aware `Link` from `@/i18n/routing`)
- Linting is oxlint (`.oxlintrc.json`): its correctness rules for React, React hooks and the React Compiler, Next.js, JSX accessibility and imports
- All user-facing text must come from translation files via `next-intl`, never hardcoded

## Placeholder Convention

Content that must be supplied by the client uses the `[NEEDS: ...]` marker format. **Never use lorem ipsum** — always write real text from brand context, and reserve `[NEEDS:]` only for genuinely missing client-specific content.

### Marker format

```
[NEEDS: Brief description of what content is required]
```

### Per-file-type syntax

| File type | Example |
|-----------|---------|
| JSON (translations) | `"hero_title": "[NEEDS: Primary headline from client tagline]"` |
| JSX/TSX | `<p>[NEEDS: Company founding story from client]</p>` |
| Markdown | `[NEEDS: Case study results data from client]` |
| CSS/Config | `/* [NEEDS: Brand primary color hex from client] */` |

### Finding all placeholders

```bash
grep -rnE '\[NEEDS: *[^]]+\]' src/ messages/ SITE_PLAN_TEMPLATE.md \
  --exclude=placeholder.ts --exclude=Placeholder.tsx | grep -v ':[0-9]*: *//'
```

### Rendering a marker

**Never render a possibly-placeholder string directly.** Pass it through the `Placeholder` component:

```tsx
import { Placeholder } from "@/components/Placeholder";

<Placeholder as="p" text={t("about.story")} />
<Placeholder text={t("privacy.retention")} fallback={<>Vi opbevarer data, så længe …</>} />
```

It renders the marker with a dashed amber border and "NEEDS CONTENT" label in dev **and on preview deployments** — where the client tours what they still owe — and drops it entirely on production, falling back to `fallback` when given.

The gate covers the marker *text*, not just the styling. A marker is an internal note and sometimes addresses the client by name, so hiding the border while shipping the words is not a fix. `verify:source` check 13 fails the build if any marker reaches rendered output.

Omitting is right when the surrounding copy still reads correctly without the marker. It is wrong where the page is legally obliged to say something — dropping a whole section to avoid shipping a marker once left a privacy page silent on data retention, which GDPR Art. 13(2)(a) requires. Pass a truthful `fallback` there: the criteria, not a number you do not have.

### Rules

- Write real text from brand context wherever possible — placeholders are a last resort
- Every placeholder must include a descriptive context so the client knows exactly what to provide
- Never use generic placeholders like `[NEEDS: text]` — be specific: `[NEEDS: Annual revenue figure for trust section]`
