/**
 * Tells the editing agent that a contact message was sent, so the owner's
 * dashboard can count enquiries. Only the page the form sat on and the job type
 * the visitor picked from the site's fixed list leave the site — never the
 * free-text subject, nor the visitor's name, email, phone, message, IP or user
 * agent. The message itself still goes by email only.
 *
 * Best effort by construction: skipped when the site has no agent binding
 * (either env var unset — a prospect, local dev, a self-hosted copy), bounded
 * by a short timeout, and it never throws. A lost count is acceptable; a
 * contact form that waits on, or fails with, the agent is not.
 */

export type Enquiry = { page: string; jobType?: string };

type RecordOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (...args: unknown[]) => void;
};

const PAGE_MAX = 200;
const JOB_TYPE_MAX = 80;

export async function recordEnquiry(enquiry: Enquiry, options: RecordOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const origin = env.BRITESITE_AGENT_ORIGIN;
  const token = env.BRITESITE_ENQUIRY_TOKEN;
  if (!origin || !token) return;

  const log = options.log ?? console.error;
  // The agent requires a path; anything else would be answered 400 and lost.
  const page = enquiry.page.startsWith('/') ? enquiry.page : '/';
  // Built field by field so a caller handing over the whole submission cannot leak it.
  const body: Enquiry = { page: page.slice(0, PAGE_MAX) };
  const jobType = enquiry.jobType?.trim();
  if (jobType) body.jobType = jobType.slice(0, JOB_TYPE_MAX);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
  try {
    const res = await (options.fetch ?? fetch)(`${origin.replace(/\/+$/, '')}/api/enquiries`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status !== 202) log(`[contact] Enquiry record answered HTTP ${res.status}.`);
  } catch (err) {
    log('[contact] Enquiry record failed:', err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

/** The path of the page a submission came from, from its Referer. The query and
 *  fragment are dropped: a prefilled form can carry the visitor's details there. */
export function pagePathFrom(referer: string | null | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).pathname;
  } catch {
    return undefined;
  }
}
