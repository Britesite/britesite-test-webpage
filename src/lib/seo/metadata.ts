import "server-only";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { absoluteUrl, assetUrl, hreflangAlternates, ogLocale } from "./url";

type BuildMetadataOptions = {
  locale: string;
  /** Route path without locale prefix, e.g. "/services". "" = home. */
  path: string;
  /** Key under the `meta` message namespace, e.g. "services" or "services.welding". */
  metaKey: string;
  /**
   * Homepage-style title with NO " | Brand" suffix. The title template would
   * otherwise duplicate the company name on the homepage.
   */
  titleAbsolute?: boolean;
  /**
   * Per-page OG image override. Omit to inherit the locale layout's
   * `opengraph-image` route (Next injects it automatically).
   */
  ogImage?: string;
  /** "website" (default) or "article" for case studies / posts. */
  ogType?: "website" | "article";
};

/**
 * Derive a page's full Metadata from one locale + path + message key.
 *
 * Every locale-varying value (canonical, hreflang, og:locale) is COMPUTED from
 * the required `locale` — so freezing a value to one locale (e.g. canonical
 * `/en` on every locale) is not expressible here. Title/description come from
 * the `meta` message namespace, so they vary per locale by construction. A page
 * that forgets to call this inherits the layout default — which the Step 8 /
 * Step 10 delivery verifier flags as a frozen/duplicate value.
 */
/**
 * The site's default social card, served as a route handler at `/og.png`.
 *
 * NOT Next's `opengraph-image.tsx` file convention. Under `[locale]/` that
 * convention emits `/<locale>/opengraph-image?<hash>`, which on a
 * `localePrefix: "never"` + `trailingSlash: true` project resolves only through
 * 308 → 307 → 200 and fails `verify:full`. The convention also overrides
 * `metadata.openGraph.images`, so it cannot be corrected from the layout.
 * A path with a file extension is exempt from trailing-slash redirects.
 */
export const OG_IMAGE_PATH = "/og.png";

export async function buildMetadata({
  locale,
  path,
  metaKey,
  titleAbsolute = false,
  ogImage,
  ogType = "website",
}: BuildMetadataOptions): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t(`${metaKey}.title`);
  const description = t(`${metaKey}.description`);
  const canonical = absoluteUrl(locale, path);

  return {
    title: titleAbsolute ? { absolute: title } : title,
    description,
    alternates: {
      canonical,
      languages: hreflangAlternates(path),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      locale: ogLocale(locale),
      type: ogType,
      // Always emit an image, defaulting to the site card. A page's `openGraph`
      // object REPLACES the parent's rather than merging into it, so a default
      // declared in the root layout is silently dropped by every page that sets
      // its own metadata — which is every page. This shared builder is the only
      // place the default cannot be lost.
      images: [ogImage ?? assetUrl(OG_IMAGE_PATH)],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage ?? assetUrl(OG_IMAGE_PATH)],
    },
  };
}
