"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import {
  COOKIE_CHANGED_EVENT,
  COOKIE_SETTINGS_EVENT,
  readStoredPreferences,
  storePreferences,
  type CookiePreferences,
} from "@/lib/cookie-consent";

const defaultPreferences: CookiePreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
};

function subscribeToConsent(onChange: () => void) {
  window.addEventListener(COOKIE_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COOKIE_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function subscribeToHydration() {
  return () => {};
}

function getHydratedClientSnapshot() {
  return true;
}

function getHydratedServerSnapshot() {
  return false;
}

export function CookieConsent() {
  const t = useTranslations("cookies");
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedClientSnapshot,
    getHydratedServerSnapshot,
  );
  const storedPreferences = useSyncExternalStore(
    subscribeToConsent,
    readStoredPreferences,
    () => null,
  );
  const [visibleOverride, setVisibleOverride] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [draftPreferences, setDraftPreferences] =
    useState<CookiePreferences | null>(null);
  const preferences =
    draftPreferences ?? storedPreferences ?? defaultPreferences;
  const visible = hydrated && (visibleOverride || storedPreferences === null);

  useEffect(() => {
    const openSettings = () => {
      setShowDetails(true);
      setDraftPreferences(readStoredPreferences() ?? defaultPreferences);
      setVisibleOverride(true);
    };

    window.addEventListener(COOKIE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, openSettings);
  }, []);

  function acceptAll() {
    const prefs = { necessary: true, analytics: true, marketing: true };
    setDraftPreferences(prefs);
    storePreferences(prefs);
    setVisibleOverride(false);
  }

  function acceptSelected() {
    storePreferences(preferences);
    setVisibleOverride(false);
  }

  function rejectOptional() {
    const prefs = { necessary: true, analytics: false, marketing: false };
    setDraftPreferences(prefs);
    storePreferences(prefs);
    setVisibleOverride(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-neutral-200 shadow-lg p-6"
    >
      <div className="max-w-4xl mx-auto">
        <h2 className="text-lg font-semibold mb-2">{t("title")}</h2>
        <p className="text-sm text-neutral-600 mb-4">{t("description")}</p>

        {showDetails && (
          <div className="mb-4 space-y-3">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked disabled className="accent-accent" />
              <span>
                <strong>{t("necessary")}</strong> — {t("necessaryDesc")}
              </span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={preferences.analytics}
                onChange={(e) =>
                  setDraftPreferences((p) => ({
                    ...(p ?? preferences),
                    analytics: e.target.checked,
                  }))
                }
                className="accent-accent"
              />
              <span>
                <strong>{t("analytics")}</strong> — {t("analyticsDesc")}
              </span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={preferences.marketing}
                onChange={(e) =>
                  setDraftPreferences((p) => ({
                    ...(p ?? preferences),
                    marketing: e.target.checked,
                  }))
                }
                className="accent-accent"
              />
              <span>
                <strong>{t("marketing")}</strong> — {t("marketingDesc")}
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={acceptAll}
            className="px-5 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 transition-colors"
          >
            {t("acceptAll")}
          </button>
          <button
            onClick={rejectOptional}
            className="px-5 py-2 border border-neutral-300 text-sm font-medium rounded hover:bg-neutral-50 transition-colors"
          >
            {t("rejectOptional")}
          </button>
          {showDetails ? (
            <button
              onClick={acceptSelected}
              className="px-5 py-2 border border-neutral-300 text-sm font-medium rounded hover:bg-neutral-50 transition-colors"
            >
              {t("savePreferences")}
            </button>
          ) : (
            <button
              onClick={() => setShowDetails(true)}
              className="text-sm text-neutral-500 underline hover:text-neutral-700"
            >
              {t("customize")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
