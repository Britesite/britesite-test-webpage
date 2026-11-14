import { contactSchema } from './contact-schema.ts';
import { sendContactEmail } from './send-contact-email.ts';
import { recordEnquiry, type Enquiry } from './record-enquiry.ts';
import { CONTACT_JOB_TYPES } from '../contact-job-types.ts';

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
  /** A closed choice: kept only when it is one of `CONTACT_JOB_TYPES`. */
  jobType?: unknown;
  /** Honeypot. Bots fill hidden fields; humans don't see them. */
  website?: unknown;
};

export type SubmissionContext = {
  /** Path of the page the form was submitted from (see `pagePathFrom`). */
  page?: string;
  /**
   * Runs the enquiry record once the response is on its way. Callers pass
   * Next's `after`, which keeps a serverless function alive for the task
   * without making the visitor wait on it. Default: start it and don't await.
   */
  defer?: (task: () => Promise<void>) => void;
  /** Seams for tests; production uses the real list, send and record. */
  jobTypes?: readonly string[];
  send?: typeof sendContactEmail;
  record?: (enquiry: Enquiry) => Promise<void>;
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
  context: SubmissionContext = {},
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

  // Never the free-text subject: a visitor types names and phone numbers there.
  const allowed = context.jobTypes ?? CONTACT_JOB_TYPES;
  const jobType =
    typeof fields.jobType === 'string' && allowed.includes(fields.jobType) ? fields.jobType : undefined;

  const send = context.send ?? sendContactEmail;
  const result = await send({
    ...parsed.data,
    jobType,
    siteName,
    recipientEmail,
    fromEmail,
    subjectPrefix: process.env.CONTACT_SUBJECT_PREFIX,
  });

  if (!result.ok) {
    return { status: 'error', code: result.error };
  }

  scheduleEnquiryRecord(context, { page: context.page || '/', ...(jobType ? { jobType } : {}) });

  return { status: 'success' };
}

/** Only after the owner's email went out, and never at the visitor's expense:
 *  nothing here may throw into the submission or delay its answer. */
function scheduleEnquiryRecord(context: SubmissionContext, enquiry: Enquiry) {
  const record = context.record ?? recordEnquiry;
  const task = () =>
    record(enquiry).catch((err) => {
      console.error('[contact] Enquiry record failed:', err);
    });
  try {
    if (context.defer) context.defer(task);
    else void task();
  } catch (err) {
    console.error('[contact] Could not schedule the enquiry record:', err);
  }
}
