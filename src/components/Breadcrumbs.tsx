import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { JsonLd } from "./JsonLd";
import { breadcrumbList, type CrumbItem } from "@/lib/seo/breadcrumb-schema";

export function Breadcrumbs({ items }: { items: CrumbItem[] }) {
  const t = useTranslations("header");
  const locale = useLocale();

  const allCrumbs: CrumbItem[] = [{ label: t("home"), path: "/" }, ...items];

  return (
    <>
      {/* JSON-LD `item` URLs are absolute + locale-correct via breadcrumbList →
          absoluteUrl — the same composition the visual <Link> uses, so the two
          can't diverge (a relative, locale-less schema item is invalid). */}
      <JsonLd data={breadcrumbList(locale, allCrumbs)} />
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <ol className="flex items-center gap-2">
          {allCrumbs.map((crumb, i) => (
            <li key={i} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="text-neutral-300">
                  /
                </span>
              )}
              {crumb.path && i < allCrumbs.length - 1 ? (
                <Link
                  href={crumb.path}
                  className="hover:text-neutral-800 transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-neutral-700">{crumb.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
