import { Resend } from 'resend';
import type { ContactInput } from './contact-schema';

type SendArgs = ContactInput & {
  siteName: string;
  recipientEmail: string;
  fromEmail: string;
  subjectPrefix?: string;
};

type SendResult = { ok: true } | { ok: false; error: 'config_missing' | 'send_failed' };

export async function sendContactEmail(args: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'config_missing' };
  }

  const resend = new Resend(apiKey);

  const prefix = args.subjectPrefix ?? `[${args.siteName}]`;
  const subject = args.subject?.trim()
    ? `${prefix} ${args.subject.trim()}`
    : `${prefix} New contact form message`;

  const lines = [
    `Site: ${args.siteName}`,
    '',
    `Name: ${args.name}`,
    `Email: ${args.email}`,
    args.phone ? `Phone: ${args.phone}` : null,
    '',
    'Message:',
    args.message,
  ].filter((line): line is string => line !== null);

  // Use site name as the display name so each client's emails appear
  // to come from their own brand, not generic agency branding.
  // CONTACT_FROM_EMAIL is the bare address; site name is prepended here.
  const from = `${args.siteName} <${args.fromEmail}>`;

  try {
    const { error } = await resend.emails.send({
      from,
      to: [args.recipientEmail],
      replyTo: args.email,
      subject,
      text: lines.join('\n'),
    });

    if (error) {
      console.error('[contact-form] Resend returned error:', error);
      return { ok: false, error: 'send_failed' };
    }

    return { ok: true };
  } catch (err) {
    console.error('[contact-form] Send threw:', err);
    return { ok: false, error: 'send_failed' };
  }
}
