import { track } from "@vercel/analytics";
import { purposeAllowed } from "@/lib/cookie-consent";

type AnalyticsProperties = Record<string, string | number | boolean | null>;

export function trackWithConsent(
  name: string,
  properties?: AnalyticsProperties,
) {
  if (typeof window === "undefined") return;
  if (!purposeAllowed("analytics")) return;

  track(name, properties);
}
