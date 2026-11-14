---
name: embeds-and-consent
description: Use when the owner asks to embed a map, video, social feed, booking widget, chat widget, or any third-party script or iframe, asks to add analytics or tracking, asks why an embed does not show, or asks whether the site needs a cookie banner. Covers the site's security policy, click-to-load facades, the consent declaration, and the plain-link alternative that usually serves the visitor better.
---

# Embeds, third-party scripts and consent

## Default: a link, not an embed

Most embeds slow the page. Offer the link first: "Open in Google Maps", a
YouTube link with a still image from `new-photo`, a link to the booking
page. Only embed when the owner insists after hearing that.

## Maps and videos: a facade

Use `VideoFacade` or `MapFacade` from `src/components/embeds/`. Nothing
loads until the visitor clicks, and the click is the visitor asking for
it, so a facade needs no cookie banner.

1. Add the provider to `SITE_EMBED_PROVIDERS` in
   `src/components/embeds/site-providers.ts`. That opens the security
   policy's `frame-src` for it and nothing else.
2. Name the provider in the cookie policy, in every language: what loads
   on click, what it may set, and a link to its privacy policy.
3. `npm run verify:source` fails while either step is missing.

## Analytics, pixels and other trackers: the consent declaration

`src/lib/site-consent.ts` lists the purposes the site stores or reads on
the visitor's device for: `"analytics"`, `"marketing"`, or nothing. With
nothing (the default) the site shows no cookie banner and runs no
tracking.

**A mirrored site (pages under `src/mirror/pages/`) takes no tracker.**
Mirrored pages do not render the site's banner, so nothing on them can
wait for consent. Tell the owner that analytics on this site is not
available yet, and add nothing. `verify:source` fails a declared purpose
or a tracker on a mirrored site.

- Add a tracker only when the owner asks for it by name. Tell the owner
  that it turns on a cookie banner for every visitor.
- Declare its purpose. That turns on the banner and the footer "Cookie
  settings" link. Render the tracker only while `purposeAllowed(purpose)`
  from `@/lib/cookie-consent` is true, in the same file that loads it.
  For Vercel Analytics, `AnalyticsGate` already does this; Speed Insights
  goes inside `AnalyticsGate`, next to `<Analytics />`.
- Load it from its own address or a literal path. A tracker proxied
  through a rewrite in `next.config.ts` or `vercel.json` is still a
  tracker, and a `<Script src={variable}>` cannot be checked.
- Add the host to the right directive of the Content-Security-Policy in
  `next.config.ts` (`script-src`, `connect-src`, `img-src`).
- Update the cookie policy in every language. List `cookie-consent` and
  the tracker, and describe the settings link.
- When the owner removes the last tracker, remove its purpose too. The
  banner then disappears, and the policy must say that only strictly
  necessary items are stored.
- `npm run verify:source` (check 28) fails while the declaration and the
  code disagree. `npm run verify:full` then checks in a browser that
  nothing is sent or stored before the visitor chooses, and that Reject
  keeps it that way. The banner's buttons keep `data-consent-accept` and
  `data-consent-reject` for that check.

## Never

- Load a third-party script outside the gate "just to test".
- Widen the security policy to a wildcard.
- Add tracking pixels or analytics the owner did not ask for by name.
- Add a cookie banner to a site that declares no purpose.
