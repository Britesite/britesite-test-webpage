/**
 * Placeholder content utilities.
 *
 * Convention: placeholders use the format `[NEEDS: Brief description]`
 * to mark content that must be supplied by the client.
 */

const PLACEHOLDER_REGEX = /\[NEEDS:\s*(.+?)\]/;
const PLACEHOLDER_REGEX_GLOBAL = /\[NEEDS:\s*(.+?)\]/g;

/** Returns `true` if the text contains one or more `[NEEDS: ...]` markers. */
export function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_REGEX.test(text);
}

/** Extracts the description from the first `[NEEDS: ...]` marker, or `null`. */
export function getPlaceholderDescription(text: string): string | null {
  const match = text.match(PLACEHOLDER_REGEX);
  return match ? match[1].trim() : null;
}

/** Returns all `[NEEDS: ...]` descriptions found in the text. */
export function getAllPlaceholderDescriptions(text: string): string[] {
  const matches = Array.from(text.matchAll(PLACEHOLDER_REGEX_GLOBAL));
  return matches.map((m) => m[1].trim());
}

/**
 * Whether unresolved placeholders may render.
 *
 * A marker is an internal note to the client, sometimes addressing them by name — so
 * "hide the amber styling in production" is not enough; the *text* must not ship either.
 * Preview is the exception and the whole point of the marker: it is where the client
 * tours what they still owe. Anything that is a production build and cannot prove it is
 * a preview is treated as live, so a self-hosted build fails closed.
 */
export function placeholdersVisible(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.VERCEL_ENV === "preview";
}
