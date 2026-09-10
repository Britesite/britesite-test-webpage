import "server-only";
import { getTranslations } from "next-intl/server";
import { SITE_URL } from "@/lib/site-config";
import { absoluteUrl } from "./url";

/**
 * JSON-LD builders for machine-facing structured data.
 *
 * `organizationSchema` reads localized copy from the `meta` namespace via the
 * required `locale`, so the homepage org description can't freeze to one
 * language (the "English schema on /da" bug). The per-page shapers take
 * already-localized strings the page resolved from its own messages — keep
 * passing `t(...)` values, never hardcoded English.
 *
 * `breadcrumbList` lives in `breadcrumb-schema.ts` (pure, client-safe) so the
 * `Breadcrumbs` component can render it whether it's a server or client component.
 */

/** Organization / LocalBusiness — homepage only. */
export async function organizationSchema(locale: string) {
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    "@id": `${SITE_URL}/#organization`,
    name: "Britesite Test",
    description: t("home.description"),
    url: absoluteUrl(locale, ""),
    // Filled per project in Step 5.3 / Step 6. A LocalBusiness `geo` MUST be a
    // real geocode of the exact street address — never a reasoned/guessed
    // coordinate (a town-centre guess is how the audit produced a confident
    // false coordinate). Leave it as a tracked [NEEDS:] until geocoded.
    // address: { "@type": "PostalAddress", streetAddress: "...", addressLocality: "...", postalCode: "...", addressCountry: "..." },
    // geo: { "@type": "GeoCoordinates", latitude: "[NEEDS: geocode of exact street address]", longitude: "[NEEDS: geocode of exact street address]" },
    // telephone: "[NEEDS: company phone]",
    // email: "[NEEDS: company email]",
    // foundingDate: "[NEEDS: founding year]",
    // sameAs: ["[NEEDS: LinkedIn / social profile URLs]"],
  };
}

/** Service page schema. Pass localized name/description from the page's messages. */
export function serviceSchema(opts: {
  locale: string;
  name: string;
  description: string;
  /** Route path without locale prefix, e.g. "/services/welding". */
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(opts.locale, opts.path),
    provider: { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
  };
}

/** Case study / article schema. Pass localized headline/description; ISO date. */
export function articleSchema(opts: {
  locale: string;
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    url: absoluteUrl(opts.locale, opts.path),
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
    publisher: { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
  };
}

/** Contact page schema. `path` is the route the page actually lives on — a
 *  replicated site keeps its own slug (`/kontakt`), and a hardcoded `/contact`
 *  emitted a URL that did not exist. */
export function contactPageSchema(locale: string, path = "/contact") {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    url: absoluteUrl(locale, path),
    mainEntity: { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
  };
}
