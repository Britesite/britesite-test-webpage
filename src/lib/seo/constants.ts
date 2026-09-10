/**
 * Single source of truth for SEO title/description formatting.
 *
 * The root layout's `metadata.title.template`, the per-page metadata builder
 * (`src/lib/seo/metadata.ts`), AND the delivery-boundary verifier
 * (`scripts/verify-delivery.mjs`) all read these constants — so the composed
 * title length is checked against the SAME suffix that ships in the rendered
 * `<title>`, never a source-level guess. (Checking the source title while the
 * template silently pushes the composed string past 60 chars is exactly the
 * "constraint checked at the wrong altitude" failure this module prevents.)
 */

/** Brand suffix appended to every page title via the title template. */
export const TITLE_SUFFIX = " | Britesite Test";

/** `%s` is replaced by the per-page title. Used as `metadata.title.template`. */
export const TITLE_TEMPLATE = `%s${TITLE_SUFFIX}`;

/** Google truncates titles past ~60 chars; the COMPOSED string must fit. */
export const TITLE_MAX_LENGTH = 60;

/** Descriptions outside this band get rewritten or truncated by search engines. */
export const DESCRIPTION_MIN_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 160;
