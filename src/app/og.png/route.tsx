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
          {"Britesite Test"}
        </div>
        <div style={{ fontSize: 34, marginTop: 28, color: "#a3a3a3" }}>
          {"A safe place to try website changes"}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
