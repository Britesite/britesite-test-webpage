import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { OpeningHours } from "@/components/OpeningHours";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildMetadata({ locale, path: "/kontakt", metaKey: "contact" });
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  const info = await getTranslations("info");
  const label = "font-body text-sm font-semibold uppercase tracking-[0.14em] text-neutral-700";

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <h1 className="mt-6 max-w-3xl text-5xl text-neutral-950 sm:text-7xl">{t("title")}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-800 sm:text-xl">{t("lead")}</p>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        <section className="rounded-[20px] border border-oak bg-cream p-6 md:self-start">
          <h2 className={label}>{info("hoursTitle")}</h2>
          <OpeningHours className="mt-4 text-lg" />
          <p className="mt-4 text-neutral-700">{info("hoursNote")}</p>
        </section>
        <section className="rounded-[20px] border border-oak p-6">
          <h2 className={label}>{t("addressTitle")}</h2>
          <address className="mt-3 text-lg not-italic leading-relaxed text-neutral-950">
            {info("name")}
            <br />
            {info("street")}
            <br />
            {info("city")}
          </address>
          <p className="mt-3 text-neutral-700">{t("directions")}</p>
        </section>
        <section className="rounded-[20px] border border-oak p-6">
          <h2 className={label}>{t("phoneTitle")}</h2>
          <a href={info("phoneHref")} className="mt-3 block text-2xl tabular-nums text-accent underline decoration-oak underline-offset-4 hover:decoration-accent">
            {info("phone")}
          </a>
          <p className="mt-3 text-neutral-700">{t("phoneNote")}</p>
          <h2 className={`${label} mt-6`}>{t("emailTitle")}</h2>
          <a href={info("emailHref")} className="mt-3 block break-all text-lg text-accent underline decoration-oak underline-offset-4 hover:decoration-accent">
            {info("email")}
          </a>
          <p className="mt-3 text-neutral-700">{t("emailNote")}</p>
        </section>
        <section id="bestil" className="scroll-mt-6 rounded-[20px] bg-accent p-6 text-white md:col-span-3">
          <h2 className="text-3xl">{t("cakeTitle")}</h2>
          <p className="mt-3 text-lg leading-relaxed text-white/90">{t("cakeText")}</p>
          <p className="mt-3 font-medium">{t("cakePrice")}</p>
        </section>
      </div>

      <section className="mt-14 max-w-2xl">
        <h2 className="text-4xl text-neutral-950">{t("partyTitle")}</h2>
        <p className="mt-4 text-lg leading-relaxed text-neutral-800">{t("partyText")}</p>
      </section>
    </div>
  );
}
