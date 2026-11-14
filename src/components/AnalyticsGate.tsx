"use client";

import { useEffect, useState } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import {
  COOKIE_CHANGED_EVENT,
  purposeAllowed,
  purposeDeclared,
} from "@/lib/cookie-consent";

function filterAnalyticsEvent(event: BeforeSendEvent) {
  return purposeAllowed("analytics") ? event : null;
}

function ConsentedAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const syncConsent = () => {
      setEnabled(purposeAllowed("analytics"));
    };

    syncConsent();
    window.addEventListener(COOKIE_CHANGED_EVENT, syncConsent);
    return () => window.removeEventListener(COOKIE_CHANGED_EVENT, syncConsent);
  }, []);

  return enabled ? <Analytics beforeSend={filterAnalyticsEvent} /> : null;
}

export function AnalyticsGate() {
  return purposeDeclared("analytics") ? <ConsentedAnalytics /> : null;
}
