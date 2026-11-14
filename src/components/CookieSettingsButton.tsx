"use client";

import { useTranslations } from "next-intl";
import { consentRequired, openCookieSettings } from "@/lib/cookie-consent";

export function CookieSettingsButton() {
  const t = useTranslations("cookies");

  if (!consentRequired()) return null;

  return (
    <button type="button" onClick={openCookieSettings}>
      {t("settings")}
    </button>
  );
}
