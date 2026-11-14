export type ConsentPurpose = "analytics" | "marketing";

/**
 * The non-essential purposes THIS site stores or reads on the visitor's device
 * for. Empty: the site keeps only strictly necessary items (NEXT_LOCALE), so it
 * shows no cookie banner, no settings control and loads no analytics.
 * List "analytics" to render Vercel Web Analytics (AnalyticsGate) or send
 * trackWithConsent() events; "marketing" for ad or retargeting pixels. Listing a
 * purpose is what turns the banner on. verify:source check 28 fails while this
 * list and src/ disagree. A plain list, read by that check as text.
 */
export const SITE_CONSENT_PURPOSES: readonly ConsentPurpose[] = [];
