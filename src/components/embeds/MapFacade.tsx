import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { EMBED_PROVIDERS, googleMapsSearchUrl } from "./providers";
import { FacadeFrame } from "./FacadeFrame";

type MapFacadeProps = {
  /** The address as written on the page. */
  address: string;
  /** What Google Maps should search for; defaults to the address. */
  query?: string;
  /** The committed static map from scripts/static-map.mjs (public/embeds/). */
  image?: { src: string; src2x?: string; width: number; height: number };
  /** Offer the interactive Google map behind a click. Off: nothing Google loads, ever. */
  interactive?: boolean;
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
  className,
}: MapFacadeProps) {
  const t = await getTranslations("embeds");
  const picture = (
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
  );
  return (
    <figure className={className}>
      {interactive ? (
        <FacadeFrame
          src={EMBED_PROVIDERS["google-maps"].embedUrl(query)}
          title={t("mapAlt", { address })}
          label={t("showMap", { provider: "Google" })}
          aspectRatio={`${image.width} / ${image.height}`}
          aside={<Link href="/cookies">{t("cookiePolicy")}</Link>}
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
