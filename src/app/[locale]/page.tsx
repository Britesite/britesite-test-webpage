import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { OpeningHours } from "@/components/OpeningHours";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // titleAbsolute: the homepage title is the full brand statement; the
  // "%s | Company" template would otherwise duplicate the company name.
  return buildMetadata({ locale, path: "", metaKey: "home", titleAbsolute: true });
}

const OFFER = [
  { key: "breakfast", image: "/images/services/morgenmad.jpg" },
  { key: "cake", image: "/images/services/kage-og-kaffe.jpg" },
  { key: "lunch", image: "/images/services/frokost.jpg" },
] as const;

const FACTS = ["seats", "glutenFree", "refill", "pay"] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const info = await getTranslations("info");

  return (
    <>
      {/* Hero: words and the practical box first, the photo after. On a phone this
          keeps the opening hours above the fold (design-direction.md §2). */}
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[1fr_1.05fr] md:gap-12 md:pt-14">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cinnamon">{t("eyebrow")}</p>
          <h1 className="mt-3 text-[2.75rem] leading-[1.05] text-neutral-950 sm:text-6xl lg:text-7xl">{t("title")}</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-neutral-800 sm:text-xl">{t("lead")}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/menu"
              className="rounded-[999px] bg-accent px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("ctaMenu")}
            </Link>
            <Link
              href="/kontakt"
              className="rounded-[999px] border border-accent px-6 py-3 text-lg font-medium text-accent transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("ctaVisit")}
            </Link>
          </div>

          <div className="mt-8 max-w-md rounded-2xl border border-oak bg-cream p-5">
            <h2 className="font-body text-sm font-semibold uppercase tracking-[0.14em] text-neutral-700">{t("practicalTitle")}</h2>
            <OpeningHours className="mt-3 text-[1.0625rem]" />
            <p className="mt-4 border-t border-oak pt-4 text-[1.0625rem]">
              {info("street")}, {info("city")}
            </p>
            <p className="mt-2 text-neutral-700">{t("practicalWalkIn")}</p>
          </div>
        </div>

        <div>
          <Image
            src="/images/hero/plads-i-naturen-realistisk.webp"
            alt={t("heroAlt")}
            width={1536}
            height={1024}
            priority
            sizes="(min-width: 1152px) 560px, (min-width: 768px) 50vw, 100vw"
            className="aspect-[4/3] w-full rounded-[20px] object-cover object-[50%_center] md:aspect-[5/6]"
          />
        </div>
      </section>

      <section className="border-y border-oak bg-cream py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-4xl text-neutral-950 sm:text-5xl">{t("offerTitle")}</h2>
          <ul className="mt-10 grid gap-8 md:grid-cols-3">
            {OFFER.map((item) => (
              <li key={item.key} className="flex flex-col">
                <Image
                  src={item.image}
                  alt={t(`offer.${item.key}.alt`)}
                  width={1600}
                  height={1067}
                  sizes="(min-width: 1152px) 352px, (min-width: 768px) 30vw, 100vw"
                  className="aspect-[3/2] w-full rounded-2xl object-cover"
                />
                <h3 className="mt-5 text-2xl text-neutral-950">{t(`offer.${item.key}.title`)}</h3>
                <p className="mt-2 leading-relaxed text-neutral-800">{t(`offer.${item.key}.text`)}</p>
                <p className="mt-3 font-medium tabular-nums text-accent">{t(`offer.${item.key}.price`)}</p>
              </li>
            ))}
          </ul>
          <Link href="/menu" className="mt-10 inline-block text-lg font-medium text-accent underline decoration-oak decoration-2 underline-offset-4 hover:decoration-accent">
            {t("offer.link")}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid items-center gap-0 overflow-hidden md:gap-8 rounded-[20px] border border-oak bg-background md:grid-cols-2">
          <div className="p-8 sm:p-12">
            <p className="inline-block rounded-[999px] bg-cream px-3 py-1 text-sm font-semibold text-cinnamon">{t("weekendLabel")}</p>
            <h2 className="mt-4 hyphens-none text-4xl text-neutral-950 sm:text-5xl">{t("weekendTitle")}</h2>
            <p className="mt-4 text-lg leading-relaxed text-neutral-800">{t("weekendText")}</p>
          </div>
          <Image
            src="/images/services/kanelsnegle.jpg"
            alt={t("weekendAlt")}
            width={1024}
            height={768}
            sizes="(min-width: 1152px) 550px, (min-width: 768px) 50vw, 100vw"
            className="h-full w-full object-cover md:aspect-auto aspect-[4/3]"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl text-neutral-950 sm:text-5xl">{t("factsTitle")}</h2>
        <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact} className="border-t-2 border-accent pt-4">
              <dt className="text-xl font-semibold text-neutral-950">{t(`facts.${fact}.title`)}</dt>
              <dd className="mt-2 leading-relaxed text-neutral-800">{t(`facts.${fact}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 rounded-[20px] bg-accent p-8 text-white sm:p-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-4xl sm:text-5xl">{t("cakeTitle")}</h2>
            <p className="mt-3 max-w-xl text-lg leading-relaxed text-white/90">{t("cakeText")}</p>
          </div>
          <Link
            href="/kontakt#bestil"
            className="shrink-0 self-start rounded-[999px] bg-background px-6 py-3 text-lg font-medium text-accent transition-colors hover:bg-cream md:self-center"
          >
            {t("cakeLink")}
          </Link>
        </div>
      </section>
    </>
  );
}
