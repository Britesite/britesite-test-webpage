import type { ReactNode } from "react";
import { isPlaceholder, placeholdersVisible } from "@/lib/placeholder";

type PlaceholderProps = {
  /** Text that may contain a `[NEEDS: ...]` marker — typically a translation lookup. */
  text: string;
  /**
   * What a live visitor sees instead of the marker. Omit to render nothing.
   *
   * Omitting is right when the surrounding copy still reads correctly without it.
   * It is wrong when something is legally obliged to be on the page: dropping a
   * whole section to avoid shipping a marker once left a privacy page silent on
   * data retention, which GDPR Art. 13(2)(a) requires. Where a duty exists, pass a
   * truthful fallback — the criteria rather than the number you do not have.
   */
  fallback?: ReactNode;
  /** Element to render as. Defaults to a span so it is inline-safe. */
  as?: "span" | "p" | "div";
};

/**
 * The only supported way to render copy that may still be client-owed.
 *
 * Renders the marker — visibly flagged — wherever a human is meant to see what is
 * outstanding, and never on the live site. Rendering a possibly-placeholder string
 * directly is the defect this exists to prevent: markers reached a production legal
 * page as body text because the wrapping was a convention rather than a component.
 */
export function Placeholder({ text, fallback, as: Tag = "span" }: PlaceholderProps) {
  if (!isPlaceholder(text)) return <>{text}</>;
  if (!placeholdersVisible()) return fallback === undefined ? null : <>{fallback}</>;
  return <Tag className="placeholder-content">{text}</Tag>;
}
