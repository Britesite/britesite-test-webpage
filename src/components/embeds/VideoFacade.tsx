import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { EMBED_PROVIDERS, type VideoProvider } from "./providers";
import { FacadeFrame } from "./FacadeFrame";

type Common = {
  /** Local poster image (public/…), shown until the visitor presses play. */
  poster: string;
  /** What the video is; the frame's and the video's accessible name. */
  title: string;
  className?: string;
};

type VideoFacadeProps =
  | (Common & { provider: VideoProvider; id: string; src?: never })
  /** Self-hosted: served from this site, so nothing third-party loads and no facade is needed. */
  | (Common & { src: string; provider?: never; id?: never });

/**
 * A video that loads nothing third-party until the visitor asks. A YouTube or
 * Vimeo video shows its local poster and a real button naming the provider;
 * pressing it inserts the privacy-enhanced player (youtube-nocookie, Vimeo
 * with dnt=1). A self-hosted file renders as a plain `<video preload="none">`.
 */
export async function VideoFacade(props: VideoFacadeProps) {
  if (props.src !== undefined) {
    return (
      <video controls preload="none" poster={props.poster} className={props.className} aria-label={props.title}>
        <source src={props.src} />
      </video>
    );
  }
  const t = await getTranslations("embeds");
  const provider = EMBED_PROVIDERS[props.provider];
  return (
    <FacadeFrame
      src={provider.embedUrl(props.id)}
      title={props.title}
      label={t("playVideo", { provider: provider.name })}
      allow="autoplay; fullscreen; picture-in-picture"
      className={props.className}
      aside={<Link href="/cookies">{t("cookiePolicy")}</Link>}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local poster at its own size; nothing to optimize remotely */}
      <img src={props.poster} alt="" style={{ display: "block", width: "100%", height: "auto" }} />
    </FacadeFrame>
  );
}
