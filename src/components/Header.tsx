import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

const NAV_LINKS = [
  { href: "/", key: "home" },
  { href: "/menu", key: "menu" },
  { href: "/lagkager-og-selskaber", key: "cakes" },
  { href: "/om-os", key: "about" },
  { href: "/kontakt", key: "contact" },
] as const;

export async function Header() {
  const t = await getTranslations("header");
  const info = await getTranslations("info");
  return (
    <header className="border-b border-oak bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
      >
        {t("skip")}
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="group flex flex-col leading-none text-accent">
          <span className="font-display text-2xl sm:text-3xl">{info("name")}</span>
          <span className="mt-1 text-xs uppercase tracking-[0.14em] text-neutral-600">{t("tagline")}</span>
        </Link>

        <nav aria-label={t("navLabel")} className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="whitespace-nowrap rounded-[999px] px-3 py-2 text-[1.0625rem] lg:px-4 text-neutral-800 transition-colors hover:bg-cream hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <details className="group relative md:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[999px] border border-oak px-4 py-2 text-neutral-800 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="flex flex-col gap-1">
              <span className="block h-0.5 w-4 bg-current" />
              <span className="block h-0.5 w-4 bg-current" />
              <span className="block h-0.5 w-4 bg-current" />
            </span>
            {t("openMenu")}
          </summary>
          <nav
            aria-label={t("navLabel")}
            className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-oak bg-background p-2 shadow-lg"
          >
            <ul>
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="block rounded-xl px-4 py-3 text-lg text-neutral-800 hover:bg-cream hover:text-accent">
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
