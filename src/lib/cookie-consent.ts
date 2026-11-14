import { SITE_CONSENT_PURPOSES, type ConsentPurpose } from "./site-consent.ts";

export type CookiePreferences = {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
};

export const COOKIE_KEY = "cookie-consent";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const COOKIE_CHANGED_EVENT = "cookie-consent-changed";
export const COOKIE_SETTINGS_EVENT = "cookie-settings-open";

let cachedRawValue: string | null | undefined;
let cachedPreferences: CookiePreferences | null = null;

function isCookiePreferences(value: unknown): value is CookiePreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.necessary === true &&
    typeof candidate.analytics === "boolean" &&
    typeof candidate.marketing === "boolean"
  );
}

function readConsentCookie() {
  const prefix = `${COOKIE_KEY}=`;
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));

  if (!entry) return null;

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

// The preview deployment's own CSP lets only the editing app frame it, so a
// framed page is the owner looking at their draft inside the editor. A consent
// cookie cannot be kept there (a cross-site frame, and a new origin for every
// deployment), so the banner would come back on every build and hold back
// everything gated on a decision; the owner is not a visitor to be asked.
export function framedByEditor(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function readStoredPreferences(): CookiePreferences | null {
  if (typeof window === "undefined") return null;

  const rawValue = readConsentCookie();

  if (rawValue === cachedRawValue) return cachedPreferences;

  cachedRawValue = rawValue;
  try {
    const stored: unknown = JSON.parse(rawValue ?? "null");
    cachedPreferences = isCookiePreferences(stored) ? stored : null;
  } catch {
    cachedPreferences = null;
  }

  return cachedPreferences;
}

export function storePreferences(preferences: CookiePreferences) {
  const value = encodeURIComponent(JSON.stringify(preferences));
  document.cookie = `${COOKIE_KEY}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(COOKIE_CHANGED_EVENT));
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}

export function consentRequired(declared: readonly ConsentPurpose[] = SITE_CONSENT_PURPOSES): boolean {
  return declared.length > 0;
}

export function purposeDeclared(
  purpose: ConsentPurpose,
  declared: readonly ConsentPurpose[] = SITE_CONSENT_PURPOSES,
): boolean {
  return declared.includes(purpose);
}

// The declaration is checked before the device is read: a purpose the site does
// not declare has no banner to consent in, so a stale or forged cookie must not
// switch it on, and nothing is read for it.
export function purposeAllowed(
  purpose: ConsentPurpose,
  declared: readonly ConsentPurpose[] = SITE_CONSENT_PURPOSES,
  read: () => CookiePreferences | null = readStoredPreferences,
): boolean {
  return purposeDeclared(purpose, declared) && read()?.[purpose] === true;
}

export function acceptAllPreferences(
  declared: readonly ConsentPurpose[] = SITE_CONSENT_PURPOSES,
): CookiePreferences {
  return {
    necessary: true,
    analytics: purposeDeclared("analytics", declared),
    marketing: purposeDeclared("marketing", declared),
  };
}
