import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { CookieConsent } from "@/components/CookieConsent";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/site-config";
import { TITLE_TEMPLATE } from "@/lib/seo/constants";
import { organizationSchema } from "@/lib/seo/structured-data";
import { selectionBridgeScript } from "@/lib/selection/bridge";
import { selectionBridgeConfig } from "@/lib/selection/config";

// TODO: Import fonts chosen by the web-designer agent
// import { Font_Name } from "next/font/google";
// const fontVariable = Font_Name({ variable: "--font-display-family", ... });

// Layout-level defaults + NON-locale-varying metadata only. Each page's title,
// description, canonical, hreflang, and og:locale are set by its own
// generateMetadata via buildMetadata (@/lib/seo/metadata). Do NOT set canonical
// or og:locale here — they would freeze to one value across every route/locale.
// A page that omits its own generateMetadata silently inherits these defaults,
// which the Step 8/10 delivery verifier flags as a duplicate/frozen value.
export const metadata: Metadata = {
  title: {
    default: "Britesite Test — A safe place to try website changes",
    template: TITLE_TEMPLATE,
  },
  description: "A permanent test website for Britesite editing, preview and recovery.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    siteName: "Britesite Test",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
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
  const CLIENT_NAMESPACES = ["cookies", "error", "contact"] as const;
  const messages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in allMessages).map((ns) => [ns, allMessages[ns]]),
  );

  return (
    <html lang={locale} className="scroll-smooth">
      <head>
        {selectionBridgeSource ? <script dangerouslySetInnerHTML={{ __html: selectionBridgeSource }} /> : null}
      </head>
      {/* TODO: Add font CSS variable classes to body once fonts are chosen */}
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <JsonLd data={await organizationSchema(locale)} />
          {/* TODO: Add the designed Header and Footer around this content. Keep the settings control in the Footer. */}
          {/* `tabIndex={-1}` is what makes the Header's skip link actually MOVE focus.
              Without it the fragment updates and Chromium's sequential-focus fallback
              makes the next Tab land plausibly, so the link looks like it works while
              no element is ever focused or announced — SC 2.4.1 (Level A). Rename the
              id to whatever the skip link targets; do not drop the tabIndex. */}
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="p-6">
            <CookieSettingsButton />
          </footer>
          <CookieConsent />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
