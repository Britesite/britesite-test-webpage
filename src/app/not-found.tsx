import Link from "next/link";

// ROOT not-found — the boundary for anything that never matched `[locale]`.
//
// `[locale]/not-found.tsx` only catches `notFound()` thrown INSIDE the locale
// segment. A URL that matches no route at all falls through to Next's raw error
// page instead, and on a site whose routes are still being built that is nearly
// every reachable URL. Production-readiness item 5 claims users never see an
// unstyled error page; without this file that claim is false.
//
// The root layout is a pass-through (it renders `children` so the locale layout
// can own <html lang>), so this component must supply its own <html>/<body> or
// React has nothing to mount into.
//
// Deliberately dependency-free, and that means NO design tokens either — every
// colour and family below is a literal. This file must render correctly BEFORE
// tokenization has run, so a `var(--token, fallback)` here always paints the
// fallback in the one situation the file exists for, and the token name is
// therefore pure decoration. Worse, the names drifted: earlier revisions
// referenced `--color-surface` and `--font-body`, which no generated design
// system defines (they are `--color-ground` and `--font-sans`), so the "real"
// branch was dead on every site while the fallback shipped a pure #ffffff that
// most briefs explicitly ban. It also must not import a locale-aware helper,
// since by definition no locale matched. The copy is a real default, not a substitution
// token: the scaffolder replaces only the tokens it knows about, and an unknown
// one ships to production as literal braces. Phase 0 rebuilds this file against
// the brief and the site's language, so a plain default costs nothing.

export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f7f8",
          color: "#17181a",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "36rem", padding: "2rem", textAlign: "left" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.875rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#6b6d72",
            }}
          >
            404
          </p>
          <h1
            style={{
              margin: "0.75rem 0 0",
              fontFamily: "ui-monospace, monospace",
              fontSize: "1.75rem",
              lineHeight: 1.2,
            }}
          >
            {"Page not found"}
          </h1>
          <p style={{ margin: "1rem 0 1.5rem", fontSize: "1.0625rem", lineHeight: 1.55 }}>
            {"The link is wrong, or the page has moved. Head back to the homepage to find what you were looking for."}
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "0.875rem 1.25rem",
              minHeight: "3.5rem",
              boxSizing: "border-box",
              background: "#17181a",
              color: "#f7f7f8",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            {"Back to homepage"}
          </Link>
        </main>
      </body>
    </html>
  );
}
