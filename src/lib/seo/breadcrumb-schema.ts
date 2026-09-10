import { absoluteUrl } from "./url";

export type CrumbItem = {
  /** Visible label — already localized by the caller. */
  label: string;
  /** Route path without locale or domain, e.g. "/services". Omit for the current page. */
  path?: string;
};

/**
 * Build BreadcrumbList JSON-LD with ABSOLUTE, locale-correct `item` URLs.
 *
 * Pure (only `absoluteUrl`), so `Breadcrumbs` can call it whether it renders as a
 * server or client component.
 * The visual breadcrumb resolves the locale via next-intl's `<Link>`; the schema
 * must resolve it identically, or the two diverge — the schema would emit a
 * relative, locale-less `item` (which schema.org rejects) while the link renders
 * correctly. Routing both through `absoluteUrl` is what keeps them in sync.
 */
export function breadcrumbList(locale: string, items: CrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.label,
      ...(crumb.path ? { item: absoluteUrl(locale, crumb.path) } : {}),
    })),
  };
}
