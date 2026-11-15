import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildMetadata({ locale, path: "/privatlivspolitik", metaKey: "privacy" });
}

const SECTIONS = ["collect", "basis", "processors", "retention"] as const;
const COLUMNS = ["name", "provider", "purpose", "duration", "category"] as const;

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
      <Breadcrumbs items={[{ label: t("title") }]} />
      <h1 className="mt-6 text-5xl text-neutral-950 sm:text-6xl">{t("title")}</h1>
      <p className="mt-3 text-neutral-700">{t("updated")}</p>
      <p className="mt-6 text-lg leading-relaxed text-neutral-800">{t("intro")}</p>

      {SECTIONS.map((key) => (
        <section key={key} className="mt-10">
          <h2 className="text-3xl text-neutral-950">{t(`${key}Title`)}</h2>
          <p className="mt-3 text-lg leading-relaxed text-neutral-800">{t(`${key}Text`)}</p>
          {key === "processors" ? (
            <p className="mt-3">
              <a href="https://vercel.com/legal/dpa" className="text-accent underline underline-offset-4">
                {t("processorsLink")}
              </a>
            </p>
          ) : null}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-3xl text-neutral-950">{t("cookiesTitle")}</h2>
        <p className="mt-3 text-lg leading-relaxed text-neutral-800">{t("cookiesText")}</p>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-oak">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="bg-cream">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col} scope="col" className="px-4 py-3 text-sm font-semibold">{t(`cookieTable.${col}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-oak align-top">
                {COLUMNS.map((col) => (
                  <td key={col} className={`px-4 py-3 ${col === "name" ? "font-mono text-sm" : ""}`}>{t(`cookieRow.${col}`)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-5 leading-relaxed text-neutral-800">{t("botid")}</p>
        <p className="mt-5 leading-relaxed text-neutral-800">{t("maps")}</p>
        <p className="mt-3">
          <a href="https://policies.google.com/privacy" className="text-accent underline underline-offset-4">
            {t("mapsLink")}
          </a>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-3xl text-neutral-950">{t("rightsTitle")}</h2>
        <p className="mt-3 text-lg leading-relaxed text-neutral-800">{t("rightsText")}</p>
      </section>
    </div>
  );
}
