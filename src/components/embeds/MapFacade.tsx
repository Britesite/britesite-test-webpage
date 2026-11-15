import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { EMBED_PROVIDERS, googleMapsSearchUrl } from "./providers";
import { FacadeFrame } from "./FacadeFrame";

type MapFacadeProps = {
  /** The address as written on the page. */
  address: string;
  /** What Google Maps should search for; defaults to the address. */
  query?: string;
  /** The committed static map from scripts/static-map.mjs (public/embeds/).
   *  null: no static map yet; a plain map-pin poster stands in until the click. */
  image?: { src: string; src2x?: string; width: number; height: number } | null;
  /** Offer the interactive Google map behind a click. Off: nothing Google loads, ever. */
  interactive?: boolean;
  /** The page that names the map provider (the cookie or privacy policy). */
  policyHref?: string;
  className?: string;
};

/**
 * A map that loads nothing third-party until the visitor asks: a self-hosted
 * static image (OpenStreetMap render, attribution drawn in), the address, and
 * an "Open in Google Maps" link. With `interactive`, a button additionally
 * swaps the image for Google's keyless embed on click.
 */
export async function MapFacade({
  address,
  query = address,
  image = { src: "/embeds/map@1x.webp", src2x: "/embeds/map@2x.webp", width: 512, height: 320 },
  interactive = false,
  policyHref = "/cookies",
  className,
}: MapFacadeProps) {
  const t = await getTranslations("embeds");
  const shape = image ? `${image.width} / ${image.height}` : "16 / 9";
  const picture = image ? (
    // eslint-disable-next-line @next/next/no-img-element -- committed static render; the optimizer adds nothing
    <img
      src={image.src}
      srcSet={image.src2x ? `${image.src} 1x, ${image.src2x} 2x` : undefined}
      width={image.width}
      height={image.height}
      alt={t("mapAlt", { address })}
      loading="lazy"
      style={{ display: "block", width: "100%", height: "auto" }}
    />
  ) : (
    <div
      aria-hidden="true"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", aspectRatio: shape, minHeight: "18rem", paddingBottom: "7rem" }}
    >
      <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </svg>
    </div>
  );
  return (
    <figure className={className}>
      {interactive ? (
        <FacadeFrame
          src={EMBED_PROVIDERS["google-maps"].embedUrl(query)}
          title={t("mapAlt", { address })}
          label={t("showMap", { provider: "Google" })}
          aspectRatio={shape}
          aside={<Link href={policyHref}>{t("cookiePolicy")}</Link>}
        >
          {picture}
        </FacadeFrame>
      ) : (
        picture
      )}
      <figcaption>
        <address style={{ fontStyle: "normal" }}>{address}</address>
        <a href={googleMapsSearchUrl(query)} target="_blank" rel="noopener">
          {t("openInMaps")}
        </a>
      </figcaption>
    </figure>
  );
}
