import { ImageResponse } from "next/og";

// Default Open Graph / Twitter card, served at a fixed, locale-independent path.
//
// This is deliberately a ROUTE HANDLER rather than Next's `opengraph-image.tsx`
// file convention. Under `[locale]/` that convention emits
// `/<locale>/opengraph-image?<hash>`, which on a `localePrefix: "never"` +
// `trailingSlash: true` project resolves only via 308 → 307 → 200 and fails
// `verify:full`. It also overrides `metadata.openGraph.images`, so the resulting
// URL cannot be corrected from the layout or from `buildMetadata`. A path
// carrying a file extension is exempt from trailing-slash redirects, so `/og.png`
// returns 200 directly.
//
// `buildMetadata` points every page here via OG_IMAGE_PATH, so og:image ALWAYS
// resolves at exactly 1200×630 — killing the "unverified reference" bug class
// (an og:image that 404s, renders a gray box, or is the wrong size). The
// web-designer may make this card richer; keep the path and the 1200×630
// contract intact so the guarantee holds.

const OG_SIZE = { width: 1200, height: 630 };

// Rendered once at build and served as a file. A GET route handler is dynamic
// by default, so without this every crawler and every link preview ran a
// function to draw the same PNG again (about 200 ms each, uncacheable). The
// card takes nothing from the request, so there is nothing to recompute.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>
          {"Café Lærke"}
        </div>
        <div style={{ fontSize: 34, marginTop: 28, color: "#a3a3a3" }}>
          {"Kaffe, kage og en god plads ved vinduet"}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
