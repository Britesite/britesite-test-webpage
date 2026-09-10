"use client";

import { useTranslations } from "next-intl";
import { openCookieSettings } from "@/lib/cookie-consent";

export function CookieSettingsButton() {
  const t = useTranslations("cookies");

  return (
    <button type="button" onClick={openCookieSettings}>
      {t("settings")}
    </button>
  );
}
