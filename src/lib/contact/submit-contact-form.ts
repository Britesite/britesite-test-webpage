'use server';

import { checkBotId } from 'botid/server';
import { processContactSubmission, type ContactFormState } from './process-contact';

export type { ContactFormState } from './process-contact';

/**
 * Vercel BotID. It short-circuits to isBot=false ONLY when NODE_ENV !== 'production'
 * — i.e. in `next dev`. Under any production build it runs for real and THROWS when
 * it cannot reach Vercel's request context:
 *
 *   "The 'x-vercel-oidc-token' header is missing from the request"
 *   "VERCEL_OIDC_TOKEN is not set"
 *   "Must be deployed on Vercel to access response headers"
 *
 * Unguarded, that throw escapes the action and the visitor gets a bare HTTP 500 —
 * and it happens BEFORE the config check, so the `config_missing` state we wrote
 * for exactly this situation is unreachable in production. Any self-hosted
 * deployment (Docker, a VPS, `next start` behind nginx) has a contact form that
 * 500s on every submission, which on most of these sites is the only conversion
 * path there is. A transient BotID outage does the same thing on Vercel.
 *
 * Fail OPEN only where BotID cannot work by construction (off Vercel: no request
 * context, no OIDC token, so every submission would 500 forever — a permanently
 * dead contact form is worse than an unprotected one). ON Vercel the same throw
 * means something is misconfigured or down, and swallowing it would silently
 * reduce protection to a honeypot and schema validation for as long as nobody
 * notices. That is the case worth failing closed on.
 */
async function botIdVerdict(): Promise<ContactFormState | null> {
  try {
    const verification = await checkBotId();
    if (verification.isBot) {
      return { status: 'error', code: 'bot_detected' };
    }
  } catch (error) {
    const onVercel = Boolean(process.env.VERCEL);
    console.error(
      `[contact] BotID check failed (VERCEL=${onVercel ? '1' : 'unset'}). ` +
        (onVercel
          ? 'On Vercel this is a misconfiguration or outage — failing closed rather than accepting unverified submissions.'
          : 'Expected off-Vercel; proceeding without bot protection.'),
      error,
    );
    if (onVercel) {
      return { status: 'error', code: 'bot_check_unavailable' };
    }
  }
  return null;
}

export async function submitContactForm(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  return processContactSubmission(
    {
      website: formData.get('website'),
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      subject: formData.get('subject'),
      message: formData.get('message'),
    },
    botIdVerdict,
  );
}
