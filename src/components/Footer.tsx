import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";
import { OpeningHours } from "@/components/OpeningHours";

const FOOTER_LINKS = [
  { href: "/menu", key: "menu" },
  { href: "/lagkager-og-selskaber", key: "cakes" },
  { href: "/om-os", key: "about" },
  { href: "/kontakt", key: "contact" },
  { href: "/privatlivspolitik", key: "privacy" },
] as const;

export async function Footer() {
  const t = await getTranslations("footer");
  const nav = await getTranslations("header");
  const info = await getTranslations("info");
  return (
    <footer className="mt-24 border-t border-oak bg-cream text-neutral-800">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-3xl text-accent">{info("name")}</p>
          <p className="mt-3 max-w-sm leading-relaxed">{t("about")}</p>
        </div>
        <div>
          <h2 className="font-body text-sm font-semibold uppercase tracking-[0.14em] text-neutral-600">{t("visit")}</h2>
          <address className="mt-3 not-italic leading-relaxed">
            {info("street")}
            <br />
            {info("city")}
            <br />
            <a href={info("phoneHref")} className="inline-block py-0.5 underline decoration-oak underline-offset-4 hover:text-accent">{info("phone")}</a>
            <br />
            <a href={info("emailHref")} className="inline-block py-0.5 underline decoration-oak underline-offset-4 hover:text-accent">{info("email")}</a>
          </address>
          <OpeningHours className="mt-4 max-w-xs text-[0.9375rem]" />
        </div>
        <div>
          <h2 className="font-body text-sm font-semibold uppercase tracking-[0.14em] text-neutral-600">{t("pages")}</h2>
          <ul className="mt-2 space-y-1">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="inline-block py-1 hover:text-accent hover:underline">
                  {link.key === "privacy" ? t("privacy") : nav(link.key)}
                </Link>
              </li>
            ))}
          </ul>
          <CookieSettingsButton />
        </div>
      </div>
      <div className="border-t border-oak">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-sm text-neutral-700 sm:flex-row sm:justify-between sm:px-6">
          <p>{t("copyright")}</p>
          <p>{t("photos")}</p>
        </div>
      </div>
    </footer>
  );
}
