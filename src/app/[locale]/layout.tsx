import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Fraunces, Figtree } from "next/font/google";
import { AnalyticsGate } from "@/components/AnalyticsGate";
import { CookieConsent } from "@/components/CookieConsent";
import { DemoBanner } from "@/components/DemoBanner";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/site-config";
import { TITLE_TEMPLATE } from "@/lib/seo/constants";
import { organizationSchema } from "@/lib/seo/structured-data";
import { selectionBridgeScript } from "@/lib/selection/bridge";
import { selectionBridgeConfig } from "@/lib/selection/config";

// Fonts from design-direction.md §3: Fraunces for headings, Figtree for body.
const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display-family",
  display: "swap",
  axes: ["opsz", "SOFT"],
});
const body = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body-family",
  display: "swap",
});

// Layout-level defaults + NON-locale-varying metadata only. Each page's title,
// description, canonical, hreflang, and og:locale are set by its own
// generateMetadata via buildMetadata (@/lib/seo/metadata). Do NOT set canonical
// or og:locale here — they would freeze to one value across every route/locale.
// A page that omits its own generateMetadata silently inherits these defaults,
// which the Step 8/10 delivery verifier flags as a duplicate/frozen value.
export const metadata: Metadata = {
  title: {
    default: "Café Lærke — Kaffe, kage og en god plads ved vinduet",
    template: TITLE_TEMPLATE,
  },
  description: "Kvartercafé med morgenmad, frokost og kage bagt samme morgen",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    siteName: "Café Lærke",
  },
  twitter: {
    card: "summary_large_image",
  },
  // Café Lærke is fictional and lives only on britesite-test-webpage.vercel.app,
  // where src/proxy.ts sends `X-Robots-Tag: noindex` on every response
  // (isIndexableHost refuses *.vercel.app), so search engines never index it.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Refuse to render for any segment that is not a configured locale.
 *
 * Without this, `[locale]` matches ANY single path segment and serves the
 * homepage with a 200. Measured on a real scaffold: `GET /lang_insert.html`
 * returned 200 with the homepage's own <title>. On a migration that promised to
 * preserve an existing tree in place, 124 of 287 preserved URLs came back as
 * duplicate homepages — soft-404s sitting on exactly the URLs carrying the
 * site's search footprint, which is worse than a clean 404 because Google
 * indexes them as duplicate content.
 *
 * `dynamicParams = false` makes Next serve the real 404 for unknown segments in
 * the static build; the explicit guard covers the dynamic path and makes the
 * intent legible.
 */
export const dynamicParams = false;

const selectionBridge = selectionBridgeConfig();
const selectionBridgeSource = selectionBridge.origin
  ? selectionBridgeScript(selectionBridge.origin)
  : null;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);

  // Ship ONLY the namespaces client components read. Server Components resolve
  // their strings during render and need nothing in the browser, so handing the
  // whole tree to the provider inlines the entire site's copy into every page.
  //
  // Measured on a real 18-route build: 134KB on the privacy page, carrying the
  // support price table, the testing copy and the homepage lede — for a page that
  // renders none of them. On a site whose brief argued the design should not
  // outweigh the product, that is the design outweighing the product.
  //
  // Keep this list short and audit it before extending: a client component reading
  // a namespace that is absent fails at runtime with MISSING_MESSAGE, which is
  // loud and easy to fix. The failure this prevents is silent and never gets
  // noticed. The scaffold's own client components need `cookies` and `error`; the contact-form skill mandates a client ContactForm on `contact`, so it is here even when a given site's form happens to take props instead.
  const allMessages = await getMessages();
  const CLIENT_NAMESPACES = ["cookies", "error"] as const;
  const messages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in allMessages).map((ns) => [ns, allMessages[ns]]),
  );

  // Smooth scrolling is a base-layer rule in globals.css, not a utility class
  // on <html>: a utility outranks every base-layer rule, including the
  // reduced-motion one (verify:source check 24).
  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <head>
        {selectionBridgeSource ? <script dangerouslySetInnerHTML={{ __html: selectionBridgeSource }} /> : null}
      </head>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <JsonLd data={await organizationSchema(locale)} />
          <DemoBanner />
          <Header />
          {/* `tabIndex={-1}` is what makes the Header's skip link actually MOVE focus.
              Without it the fragment updates and Chromium's sequential-focus fallback
              makes the next Tab land plausibly, so the link looks like it works while
              no element is ever focused or announced — SC 2.4.1 (Level A). Rename the
              id to whatever the skip link targets; do not drop the tabIndex. */}
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          {/* The footer's settings control, the banner and analytics render nothing
              unless src/lib/site-consent.ts declares a consent purpose. */}
          <Footer />
          <CookieConsent />
        </NextIntlClientProvider>
        <AnalyticsGate />
      </body>
    </html>
  );
}
