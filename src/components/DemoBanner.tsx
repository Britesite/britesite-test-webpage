import { getTranslations } from "next-intl/server";

/** The strip that says Café Lærke is fictional. Keep it on every page (design-direction.md §2). */
export async function DemoBanner() {
  const t = await getTranslations("demo");
  return (
    <aside aria-label={t("label")} className="bg-accent-dark px-4 py-2 text-center text-sm leading-snug text-white">
      {t("text")}
    </aside>
  );
}
