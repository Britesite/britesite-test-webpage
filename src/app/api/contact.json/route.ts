import { processContactSubmission } from "@/lib/contact/process-contact";

/**
 * JSON contact endpoint for mirrored pages (replicate mode). The original's
 * form posted to its CMS; the script the mirror handler injects posts here
 * instead, and the same honeypot, schema, env contract and send apply as for the
 * template's Server Action. BotID is not run: it needs its client on the page,
 * and a mirrored page carries none. Rejects cross-origin posts by Origin so the
 * endpoint cannot be driven from another site.
 *
 * The path carries an extension on purpose: with `trailingSlash: true` Next
 * 308s `/api/contact` to `/api/contact/`, which the static handler then does
 * not match (the locale catch-all answers 404). A dotted path is exempt from
 * the trailing-slash redirect, like `/og.png` and `/llms.txt`.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ status: "error", code: "validation_failed" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ status: "error", code: "validation_failed" }, { status: 400 });
  }
  const result = await processContactSubmission(body);
  return Response.json(result, { status: result.status === "success" ? 200 : 422 });
}
