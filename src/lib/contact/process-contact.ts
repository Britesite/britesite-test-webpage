import { contactSchema } from './contact-schema.ts';
import { sendContactEmail } from './send-contact-email.ts';

export type ContactErrorCode =
  | 'validation_failed'
  | 'bot_detected'
  | 'bot_check_unavailable'
  | 'send_failed'
  | 'config_missing';

export type ContactFormState =
  | { status: 'idle' }
  | { status: 'success' }
  | {
      status: 'error';
      code: ContactErrorCode;
      fieldErrors?: Record<string, string[] | undefined>;
    };

export type ContactFields = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  subject?: unknown;
  message?: unknown;
  /** Honeypot. Bots fill hidden fields; humans don't see them. */
  website?: unknown;
};

/**
 * The one contact pipeline both entry points share: the Server Action behind the
 * template's React form, and the JSON route mirrored pages post to. Bot
 * verification is the caller's, because it is entry-point specific (BotID needs
 * its client on the page; a mirrored page has none). Everything else — the
 * honeypot, the schema, the env contract, the send — is here so the two paths
 * cannot drift.
 */
export async function processContactSubmission(
  fields: ContactFields,
  botCheck?: () => Promise<ContactFormState | null>,
): Promise<ContactFormState> {
  // Return success silently so attackers can't tell they were caught.
  if (typeof fields.website === 'string' && fields.website.length > 0) {
    return { status: 'success' };
  }

  const parsed = contactSchema.safeParse({
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    subject: fields.subject,
    message: fields.message,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      code: 'validation_failed',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  if (botCheck) {
    const verdict = await botCheck();
    if (verdict) return verdict;
  }

  const siteName = process.env.CONTACT_SITE_NAME;
  const recipientEmail = process.env.CONTACT_RECIPIENT_EMAIL;
  const fromEmail = process.env.CONTACT_FROM_EMAIL;
  if (!siteName || !recipientEmail || !fromEmail) {
    return { status: 'error', code: 'config_missing' };
  }

  const result = await sendContactEmail({
    ...parsed.data,
    siteName,
    recipientEmail,
    fromEmail,
    subjectPrefix: process.env.CONTACT_SUBJECT_PREFIX,
  });

  if (!result.ok) {
    return { status: 'error', code: result.error };
  }

  return { status: 'success' };
}
