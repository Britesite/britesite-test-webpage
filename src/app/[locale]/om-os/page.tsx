import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Link } from "@/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildMetadata({ locale, path: "/om-os", metaKey: "about" });
}

const HOW = ["baked", "simple", "everyone"] as const;

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <h1 className="mt-6 max-w-3xl text-5xl text-neutral-950 sm:text-7xl">{t("title")}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-800 sm:text-xl">{t("lead")}</p>

      <section className="mt-14 grid gap-10 md:grid-cols-2 md:items-center">
        <Image
          src="/images/facility/kaffe.jpg"
          alt={t("imageAlt")}
          width={1600}
          height={1067}
          priority
          sizes="(min-width: 1152px) 540px, (min-width: 768px) 45vw, 100vw"
          className="aspect-[4/3] w-full rounded-[20px] object-cover"
        />
        <div>
          <h2 className="text-4xl text-neutral-950">{t("storyTitle")}</h2>
          <p className="mt-4 text-lg leading-relaxed text-neutral-800">{t("story1")}</p>
          <p className="mt-4 text-lg leading-relaxed text-neutral-800">{t("story2")}</p>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-4xl text-neutral-950 sm:text-5xl">{t("howTitle")}</h2>
        <ul className="mt-8 grid gap-8 md:grid-cols-3">
          {HOW.map((key) => (
            <li key={key} className="border-t-2 border-accent pt-4">
              <h3 className="text-2xl text-neutral-950">{t(`how.${key}.title`)}</h3>
              <p className="mt-2 leading-relaxed text-neutral-800">{t(`how.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-20 rounded-[20px] border border-oak bg-cream p-8 sm:p-12">
        <h2 className="text-4xl text-neutral-950">{t("teamTitle")}</h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-800">{t("teamText")}</p>
        <Link href="/menu" className="mt-6 inline-block rounded-[999px] bg-accent px-6 py-3 text-lg font-medium text-white hover:bg-accent-dark">
          {t("cta")}
        </Link>
      </section>
    </div>
  );
}
