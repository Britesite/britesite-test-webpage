import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Placeholder } from "@/components/Placeholder";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildMetadata({ locale, path: "/lagkager-og-selskaber", metaKey: "cakes" });
}

const STEPS = ["one", "two", "three"] as const;

export default async function CakesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cakes");
  const info = await getTranslations("info");

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <div className="mt-6 grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <h1 className="text-5xl text-neutral-950 sm:text-7xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-neutral-800 sm:text-xl">{t("lead")}</p>
        </div>
        <Image
          src="/images/services/lagkage-paa-kagefad.webp"
          alt={t("imageAlt")}
          width={1536}
          height={1024}
          priority
          sizes="(min-width: 1152px) 470px, (min-width: 768px) 40vw, 100vw"
          className="aspect-[3/2] w-full rounded-[20px] object-cover"
        />
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2">
        <section className="rounded-[20px] bg-accent p-8 text-white">
          <h2 className="text-4xl">{t("cake.title")}</h2>
          <p className="mt-4 text-lg leading-relaxed text-white/90">{t("cake.text")}</p>
          <Placeholder as="p" text={t("cake.kinds")} />
          <p className="mt-6 inline-block rounded-[999px] bg-background px-4 py-2 text-lg font-semibold text-accent">{t("cake.price")}</p>
        </section>
        <section className="rounded-[20px] border border-oak bg-cream p-8">
          <h2 className="text-4xl text-neutral-950">{t("room.title")}</h2>
          <p className="mt-4 text-lg leading-relaxed text-neutral-800">{t("room.text")}</p>
          <Placeholder as="p" text={t("room.price")} />
          <Placeholder as="p" text={t("room.food")} />
        </section>
      </div>

      <section className="mt-20">
        <h2 className="text-4xl text-neutral-950 sm:text-5xl">{t("howTitle")}</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {STEPS.map((key, i) => (
            <li key={key} className="border-t-2 border-accent pt-4">
              <p aria-hidden="true" className="font-display text-5xl leading-none text-cinnamon">{i + 1}</p>
              <h3 className="mt-3 text-2xl text-neutral-950">{t(`steps.${key}.title`)}</h3>
              <p className="mt-2 leading-relaxed text-neutral-800">{t(`steps.${key}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 flex flex-col gap-6 rounded-[20px] border border-oak bg-cream p-8 sm:p-10 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl text-neutral-950 sm:text-4xl">{t("ctaTitle")}</h2>
          <p className="mt-2 text-lg text-neutral-800">{t("ctaText")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a href={info("phoneHref")} className="rounded-[999px] bg-accent px-6 py-3 text-center text-lg font-medium text-white hover:bg-accent-dark">
            {t("ctaPhone", { phone: info("phone") })}
          </a>
          <a href={info("emailHref")} className="rounded-[999px] border border-accent px-6 py-3 text-center text-lg font-medium text-accent hover:bg-accent hover:text-white">
            {t("ctaEmail")}
          </a>
        </div>
      </section>
    </div>
  );
}
