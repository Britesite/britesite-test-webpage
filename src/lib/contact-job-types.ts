/**
 * The job types a visitor can pick on the contact form, if the form offers the
 * choice at all. Empty (default): the form has no job-type field and none is
 * recorded.
 *
 * Each entry is the stable value of one `<option>` in a `<select name="jobType">`
 * — a short key such as "roof-repair", not display text; the label comes from
 * the translations. A submitted value that is not in this list is dropped, so
 * the only job types that ever leave the site (to the owner's email and the
 * editing agent's enquiry count) are ones written here. Keep each under 80
 * characters.
 *
 * Lives outside `src/lib/contact/` on purpose: that directory is the locked
 * contact contract, and choosing a site's services is not a change to it.
 */
export const CONTACT_JOB_TYPES: readonly string[] = [];
