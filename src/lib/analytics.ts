import { track } from "@vercel/analytics";
import { readStoredPreferences } from "@/lib/cookie-consent";

type AnalyticsProperties = Record<string, string | number | boolean | null>;

export function trackWithConsent(
  name: string,
  properties?: AnalyticsProperties,
) {
  if (typeof window === "undefined") return;
  if (readStoredPreferences()?.analytics !== true) return;

  track(name, properties);
}
