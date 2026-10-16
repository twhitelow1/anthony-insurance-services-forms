/**
 * Wording and limits Anthony Insurance changes often, kept in one place.
 * Safe to import from browser code (no server-only imports here).
 */

/**
 * Highest aerial silks rig the gymnastics carrier accepts, in feet. One carrier's
 * appetite is changing, so check with Caitlyn before raising it.
 */
export const SILKS_MAX_HEIGHT_FT = 12;

/**
 * TODO(Caitlyn): replace with the final Hired & Non-Owned Auto wording she's sending.
 * Until then this is the text the aerial studio forms already use.
 */
export const HNOA_TOOLTIP =
  "Hired & Non-Owned Auto covers liability when vehicles you rent, borrow or hire, or that employees or volunteers own, are driven for your business. It covers injury or damage to others; it doesn't cover damage to the vehicle itself (no comprehensive or collision).";

/** Auto-decline popup: answers we can't write coverage for. */
export const DECLINE_TITLE = "We can't offer coverage";
export const declineMessage = (reason: string) =>
  `Unfortunately we can't offer coverage when ${reason}. Please call our office if you think this is a mistake or would like to discuss other options.`;

/** Compliance popup: allowed, but must be in place before coverage starts. */
export const COMPLIANCE_TITLE = "Required before coverage starts";

/**
 * Sample documents attached to the applicant's confirmation email when a compliance
 * popup was triggered. Files live in compliance-docs/ at the repo root; replace the
 * placeholders there with the real samples (same file names) or change the names here.
 */
export const COMPLIANCE_DOCS = {
  concussion: "sample-concussion-return-to-play-policy.pdf",
  backgroundChecks: "sample-background-check-policy.pdf",
} as const;

/**
 * Applicant portal links. Off for now: confirmation and status emails, and the
 * "Application submitted" screen, don't point applicants to the portal.
 * Set to true to add the "Check application status" links back.
 */
export const APPLICANT_PORTAL_LINKS = false;

/** Shown when an applicant goes on without uploading a waiver, and repeated in their confirmation email. */
export const WAIVER_MISSING = {
  title: "A signed waiver is required before coverage starts",
  message:
    "We can still quote your application without it. Please send your waiver before coverage can start: upload it here, or email it to melanie@anthonyinsuranceservices.com.",
};
