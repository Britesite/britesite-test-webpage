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
