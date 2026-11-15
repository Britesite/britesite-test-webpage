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
  return buildMetadata({ locale, path: "/menu", metaKey: "menu" });
}

// The menu itself lives in messages `menu.sections`: change a dish or a price
// there. Add a dish by adding it to the message file AND to its list here.
const SECTIONS = [
  { key: "breakfast", items: ["plate", "porridge", "bun", "yoghurt"] },
  { key: "lunch", items: ["soup", "smorrebrod", "sandwich", "salad"] },
  { key: "cake", items: ["today", "gfCake", "snail", "cookie"] },
  { key: "drinks", items: ["filter", "cappuccino", "latte", "tea", "juice"] },
] as const;

export default async function MenuPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("menu");

  const tagsOf = (section: string, item: string) => {
    const key = `sections.${section}.items.${item}.tags`;
    return t.has(key) ? t(key).split(" ") : [];
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <div className="mt-6 grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <h1 className="text-5xl text-neutral-950 sm:text-7xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-neutral-800 sm:text-xl">{t("lead")}</p>
          <p className="mt-4 flex flex-wrap gap-3 text-sm text-neutral-700">
            <span><span className="mr-1 rounded-[999px] bg-cream px-2 py-0.5 font-semibold text-cinnamon">GF</span>{t("legendGf")}</span>
            <span><span className="mr-1 rounded-[999px] bg-cream px-2 py-0.5 font-semibold text-accent">V</span>{t("legendVegan")}</span>
          </p>
        </div>
        <Image
          src="/images/services/morgenmad.jpg"
          alt={t("imageAlt")}
          width={1600}
          height={1067}
          priority
          sizes="(min-width: 1152px) 470px, (min-width: 768px) 40vw, 100vw"
          className="aspect-[3/2] w-full rounded-[20px] object-cover"
        />
      </div>

      <div className="mt-14 grid gap-x-16 gap-y-14 md:grid-cols-2">
        {SECTIONS.map((section) => {
          const note = t(`sections.${section.key}.note`);
          return (
            <section key={section.key} aria-labelledby={`menu-${section.key}`}>
              <div className="flex items-baseline justify-between gap-4 border-b-2 border-accent pb-2">
                <h2 id={`menu-${section.key}`} className="text-3xl text-neutral-950 sm:text-4xl">
                  {t(`sections.${section.key}.title`)}
                </h2>
                {note ? <p className="text-sm text-neutral-700">{note}</p> : null}
              </div>
              <ul className="divide-y divide-oak">
                {section.items.map((item) => {
                  const base = `sections.${section.key}.items.${item}`;
                  const tags = tagsOf(section.key, item);
                  return (
                    <li key={item} className="flex items-baseline justify-between gap-6 py-4">
                      <div>
                        <p className="text-lg font-semibold text-neutral-950">
                          {t(`${base}.name`)}
                          {tags.includes("gf") ? (
                            <abbr title={t("legendGf")} className="ml-2 rounded-[999px] bg-cream px-2 py-0.5 align-middle text-xs font-semibold text-cinnamon no-underline">GF</abbr>
                          ) : null}
                          {tags.includes("vegan") ? (
                            <abbr title={t("legendVegan")} className="ml-2 rounded-[999px] bg-cream px-2 py-0.5 align-middle text-xs font-semibold text-accent no-underline">V</abbr>
                          ) : null}
                        </p>
                        <p className="mt-1 leading-relaxed text-neutral-700">{t(`${base}.desc`)}</p>
                      </div>
                      <p className="shrink-0 text-lg font-medium tabular-nums text-neutral-950">{t(`${base}.price`)}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-neutral-700">{t("footnote")}</p>

      <div className="mt-14 flex flex-col gap-4 rounded-[20px] border border-oak bg-cream p-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl text-neutral-950">{t("cakeTitle")}</h2>
          <p className="mt-2 text-lg text-neutral-800">{t("cakeText")}</p>
        </div>
        <Link href="/lagkager-og-selskaber" className="shrink-0 self-start rounded-[999px] bg-accent px-6 py-3 text-lg font-medium text-white hover:bg-accent-dark sm:self-center">
          {t("cakeLink")}
        </Link>
      </div>
    </div>
  );
}
