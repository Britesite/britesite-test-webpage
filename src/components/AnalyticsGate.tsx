"use client";

import { useEffect, useState } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import {
  COOKIE_CHANGED_EVENT,
  readStoredPreferences,
} from "@/lib/cookie-consent";

function filterAnalyticsEvent(event: BeforeSendEvent) {
  return readStoredPreferences()?.analytics === true ? event : null;
}

export function AnalyticsGate() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const syncConsent = () => {
      setEnabled(readStoredPreferences()?.analytics === true);
    };

    syncConsent();
    window.addEventListener(COOKIE_CHANGED_EVENT, syncConsent);
    return () => window.removeEventListener(COOKIE_CHANGED_EVENT, syncConsent);
  }, []);

  return enabled ? <Analytics beforeSend={filterAnalyticsEvent} /> : null;
}
