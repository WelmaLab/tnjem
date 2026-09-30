/* ══════════════════════════════════════════════════════════════════════════════
   EVERY LEGAL VALUE, IN ONE FILE.

   Retention periods, grace periods, the age of majority, document versions and
   the wording people agree to. Each carries a `LEGAL-REVIEW:` marker saying where
   the value came from and what counsel has to decide. NONE of them was set by a
   lawyer: they are the values the product already published (in /privacy, /terms,
   or the code) on or before 15 Sept 2026, gathered here so that counsel changes
   ONE line and every enforcement point and every sentence that quotes it follows.

   `grep -rn "LEGAL-REVIEW" packages apps` lists every open legal question.

   Pure values only: this module is imported by client components (/privacy,
   /terms render these numbers) and must never import a Node builtin.
   ══════════════════════════════════════════════════════════════════════════════ */

/* ── Identity documents ──────────────────────────────────────────────────────── */

/** An identity document is deleted at most this many days after the verification
    decision, whether the tutor was accepted or refused.
    LEGAL-REVIEW: retention period for national ID scans. Published in /privacy §5
    since the 12 July 2026 draft (product team). Enforced by packages/db/src/retention.ts. */
export const ID_DOCUMENT_RETENTION_DAYS = 90;

/* ── Accounts ────────────────────────────────────────────────────────────────── */

/** Days between "supprimer mon compte" and the erasure; the request can be withdrawn.
    LEGAL-REVIEW: grace period. Product decision (Step 15), published in /privacy §3. */
export const DELETION_GRACE_DAYS = 30;

/** An account nobody has used for this long is erased, exactly as if its owner had
    asked. Measured from the last authenticated request.
    LEGAL-REVIEW: retention of an inactive account. Published in /privacy §5 ("jusqu'à
    3 ans après ta dernière activité") since 12 July 2026, and enforced from 15 Sept
    2026. No warning is sent before the erasure: whether one is required is open. */
export const INACTIVE_ACCOUNT_RETENTION_DAYS = 3 * 365;

/** When an account is erased, the messages it wrote are deleted — EXCEPT a message
    somebody reported, which is kept (without the author's identity) as evidence.
    LEGAL-REVIEW: lawful basis for keeping reported messages after erasure
    (safeguarding of minors vs. the right to erasure). Not decided. */
export const KEEP_REPORTED_MESSAGES_ON_ERASURE = true;

/* ── Minors and guardian consent ─────────────────────────────────────────────── */

/** Under this age, an account needs a guardian's consent. An unknown age counts as a minor.
    LEGAL-REVIEW: age threshold for parental consent under Loi organique 2004-63. */
export const MINOR_AGE_YEARS = 18;

/** The words a consent row records, and the policy version it was given under.
    LEGAL-REVIEW: wording of the guardian consent, and whether a consent given by a
    minor on a parent's behalf (self-attested today, not verified) is sufficient. */
export const CONSENT_TEXT = "Consentement du parent/tuteur pour un compte de moins de 18 ans (INPDP).";

/* ── Published documents ─────────────────────────────────────────────────────── */

/** LEGAL-REVIEW: version of /privacy. Both documents are drafts pending counsel; the
    banner on each page says so. A new version is recorded on the next consent.
    phase-a lane L6 (A19): 2026-09-15 → 2026-09-24, the Phase A rewrite (adult-only
    pilot, conversations that close, moderation, first name + initial, …), so a
    consent recorded from now on points at the text it was actually given under. */
export const PRIVACY_POLICY_VERSION = "2026-09-24";

/** LEGAL-REVIEW: version of /terms, recorded against every account created under it
    (profiles.terms_version). Re-acceptance of a new version is not built.
    phase-a lane L6 (A19): 2026-09-15 → 2026-09-24, same reason as above. */
export const TERMS_VERSION = "2026-09-24";

/** Consents are recorded against the privacy policy they were given under. */
export const CONSENT_POLICY_VERSION = PRIVACY_POLICY_VERSION;

/** LEGAL-REVIEW: the mailbox /privacy tells people to write to. It must exist. */
export const PRIVACY_CONTACT_EMAIL = "privacy@tnajem.com";

/* ── Sessions ────────────────────────────────────────────────────────────────── */

/** LEGAL-REVIEW (security values, described in /privacy §5): a session ends 30 days
    after login, or after 14 days without use, whichever comes first. */
export const SESSION_DAYS = 30;
export const SESSION_IDLE_DAYS = 14;

/* ── Cancellation (Terms §7) ─────────────────────────────────────────────────── */

/** LEGAL-REVIEW: commercial terms published in /terms §7. Nothing is charged while
    payments are off; the ledger records what WOULD be retained. */
export const CANCEL_FREE_WINDOW_HOURS = 48;
export const LATE_CANCEL_RETAINED_PCT = 0.4;

/* ── Décret n° 2015-1619 (private tutoring by serving public-school teachers) ─── */

/** What a tutor declares before their application can be submitted, and its version.
    LEGAL-REVIEW: wording, and whether a declaration plus an admin check is enough to
    meet the obligation never to feature an identifiable serving public-school teacher. */
export const PUBLIC_TEACHER_DECLARATION_VERSION = "2026-09-15";
export const PUBLIC_TEACHER_DECLARATION = {
  fr: "Je déclare ne pas exercer comme enseignant·e dans un établissement d'enseignement public.",
  ar: "نصرّح إنّي ما نخدمش كأستاذ في مؤسسة تعليم عمومية.",
} as const;
