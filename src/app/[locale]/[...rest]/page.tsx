import { notFound } from "next/navigation";

// Catch-all inside the locale segment — the only thing that makes
// `[locale]/not-found.tsx` reachable.
//
// Without this file, a URL like `/da/does-not-exist` matches no route, so Next
// never resolves the `[locale]` dynamic segment and never enters the locale
// layout. The carefully built locale-aware not-found is skipped entirely and the
// request lands on the ROOT `not-found.tsx` instead: no header, no nav, no
// footer, no cookie consent, and the wrong language regardless of the prefix the
// visitor typed. That is nearly every 404 on a real site, not an edge case.
//
// Two things in the pipeline depend on this being here. The Phase 0 gate tells
// reviewers to use an unmatched URL as their test canvas precisely because it
// "renders not-found.tsx inside the real shell" — a claim that is false without
// this file. And production-readiness item 5 claims visitors never see an
// unstyled error page.
//
// Calling notFound() rather than rendering anything keeps the 404 status code
// correct; the locale layout wraps the result, so the response gets the real
// shell in the right language.
export default function CatchAllNotFound() {
  notFound();
}
